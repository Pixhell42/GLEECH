import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEffect } from '@gleech/project-model';
import { createPresetLibrary } from './preset-library';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const recipe = { masterSeed: 123, effects: [createEffect('rgb-split', 'effect')] };
const thumbnail = 'data:image/png;base64,aGVsbG8=';
async function library() {
  const directory = await mkdtemp(join(tmpdir(), 'gleech-presets-'));
  directories.push(directory);
  const path = join(directory, 'presets.json');
  return { directory, path, store: createPresetLibrary(path) };
}

describe('local preset library', () => {
  it('preserves the library when an automation lease is revoked before committing a save or import', async () => {
    const { store, path, directory } = await library();
    const original = await store.save('Existing', recipe, thumbnail);
    const before = await readFile(path);
    let calls = 0;
    const guard = () => {
      if (++calls === 2) throw new Error('Permission revoked');
    };
    await expect(store.save('Denied', recipe, thumbnail, 'statue', guard)).rejects.toThrow(
      /revoked/,
    );
    expect(await readFile(path)).toEqual(before);
    expect(await readdir(directory)).toEqual(['presets.json']);
    await expect(
      store.importPreset(original, () => {
        throw new Error('Expired');
      }),
    ).rejects.toThrow(/Expired/);
    expect(await readFile(path)).toEqual(before);
  });
  it('reads the pre-existing preset library when distortion recipes omit Edge Handling', async () => {
    const { store, path } = await library();
    const saved = await store.save('Older preset', recipe, thumbnail);
    const stored = JSON.parse(await readFile(path, 'utf8'));
    delete stored.presets[0].effects[0].params.edgeHandling;
    await writeFile(path, JSON.stringify(stored));
    const older = (await store.list())[0]!;
    expect(older.id).toBe(saved.id);
    expect(older.effects[0]!.params).not.toHaveProperty('edgeHandling');
  });
  it('edits the name and thumbnail choice without changing the saved recipe, seed or identity', async () => {
    const { store, path } = await library();
    const saved = await store.save('Original', recipe, thumbnail, 'image');
    const changedThumbnail = 'data:image/png;base64,Y2hhbmdlZA==';
    const edited = await store.edit(saved.id, 'Statue version', changedThumbnail, 'statue');
    expect(edited).toEqual({
      ...saved,
      name: 'Statue version',
      thumbnail: changedThumbnail,
      thumbnailSource: 'statue',
    });
    expect(await createPresetLibrary(path).list()).toEqual([edited]);
    await expect(store.edit(saved.id, 'Broken', 'invalid', 'image')).rejects.toThrow();
    expect(await store.list()).toEqual([edited]);
  });
  it('serializes concurrent saves and retains masks, seeds and thumbnails after restart, rename and delete', async () => {
    const { store, path, directory } = await library();
    expect(await store.list()).toEqual([]);
    const [a, b] = await Promise.all([
      store.save(' First ', recipe, thumbnail),
      store.save('Second', recipe, thumbnail),
    ]);
    expect(a.name).toBe('First');
    expect(a.id).not.toBe(b.id);
    const restarted = createPresetLibrary(path);
    expect(await restarted.list()).toEqual([b, a]);
    await restarted.rename(a.id, 'Renamed');
    await restarted.delete(b.id);
    expect(await createPresetLibrary(path).list()).toEqual([{ ...a, name: 'Renamed' }]);
    const contents = await readFile(path, 'utf8');
    expect(contents).not.toContain('source');
    expect(contents).not.toContain('snapshots');
    expect(await readdir(directory)).toEqual(['presets.json']);
  });

  it('preserves malformed or unsupported saved contents rather than silently overwriting them', async () => {
    const { path, store } = await library();
    for (const invalid of [
      'broken',
      JSON.stringify({ schemaVersion: 99, presets: [] }),
      JSON.stringify({ schemaVersion: 1, presets: [null] }),
    ]) {
      await writeFile(path, invalid);
      await expect(store.list()).rejects.toThrow('preserved');
      await expect(store.save('New', recipe, thumbnail)).rejects.toThrow('preserved');
      expect(await readFile(path, 'utf8')).toBe(invalid);
    }
    await writeFile(path, JSON.stringify({ schemaVersion: 1, presets: [] }));
    await store.save('Recovered', recipe, thumbnail);
    expect(await store.list()).toHaveLength(1);
  });

  it('rejects invalid changes without losing existing presets or leaving temporary files', async () => {
    const { store, path, directory } = await library();
    const preset = await store.save('Original', recipe, thumbnail);
    const before = await readFile(path, 'utf8');
    expect(() => store.save(' ', recipe, thumbnail)).toThrow();
    expect(() => store.save('Wrong seed', { ...recipe, masterSeed: NaN }, thumbnail)).toThrow();
    expect(() => store.save('Wrong image', recipe, 'https://example.com/image.png')).toThrow();
    await expect(store.rename('missing', 'Missing')).rejects.toThrow();
    await expect(store.delete('missing')).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await readdir(directory)).toEqual(['presets.json']);
    expect(await store.list()).toEqual([preset]);
  });

  it('imports without replacing entries, preserves effect identities and numbers duplicate names atomically', async () => {
    const { store, path } = await library();
    const original = await store.save('Gold', recipe, thumbnail);
    const [a, b] = await Promise.all([store.importPreset(original), store.importPreset(original)]);
    expect(a.name).toBe('Gold (2)');
    expect(b.name).toBe('Gold (3)');
    expect(new Set([original.id, a.id, b.id]).size).toBe(3);
    expect(a.effects).toEqual(original.effects);
    expect(a.masterSeed).toBe(original.masterSeed);
    expect(a.thumbnail).toBe(original.thumbnail);
    expect(await createPresetLibrary(path).list()).toEqual([b, a, original]);
    const before = await readFile(path, 'utf8');
    expect(() => store.importPreset({ ...original, masterSeed: -1 })).toThrow();
    expect(await readFile(path, 'utf8')).toBe(before);
    const long = await store.save('G'.repeat(120), recipe, thumbnail);
    expect((await store.importPreset(long)).name).toBe('G'.repeat(116) + ' (2)');
  });
});
