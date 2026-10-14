import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ShaderPackage } from '@gleech/project-model/shader-package';
import { createShaderLibrary } from './shader-library';
import { createImportedShader, type ImportedShaderEffect } from '@gleech/project-model';
import { encodePreset, decodePreset } from './preset-file';
const sample = (): ShaderPackage =>
  JSON.parse(
    readFileSync(
      new URL('../../resources/shaders/prism-weave.gleech-shader', import.meta.url),
      'utf8',
    ),
  );
const thumbnail = 'data:image/png;base64,aGVsbG8=';
async function library() {
  const directory = await mkdtemp(join(tmpdir(), 'gleech-shaders-'));
  const path = join(directory, 'shaders.json');
  return { path, store: createShaderLibrary(path) };
}
describe('local shader library', () => {
  it('exports portable presets with their complete shader source and attribution', () => {
    const effect = createImportedShader(sample(), 'a');
    const preset = {
      schemaVersion: 1 as const,
      id: 'test',
      name: 'Portable',
      createdAt: '2026-10-07T00:00:00Z',
      masterSeed: 8172,
      thumbnail,
      effects: [effect],
    };
    const reopened = decodePreset(encodePreset(preset));
    expect((reopened.effects[0] as ImportedShaderEffect).shader).toEqual(effect.shader);
  });
  it('serializes concurrent imports, survives restart, and reimports a version without duplicate tiles', async () => {
    const { store, path } = await library();
    const pkg = sample();
    const [a, b] = await Promise.all([
      store.store(pkg, thumbnail),
      store.store({ ...pkg, id: 'gleech.other' }, thumbnail),
    ]);
    expect(await createShaderLibrary(path).list()).toEqual([a, b]);
    const updated = await store.store({ ...pkg, name: 'Updated' }, thumbnail);
    expect(updated.id).toBe(a.id);
    expect(await store.list()).toHaveLength(2);
    await store.delete(a.id);
    expect(await store.list()).toEqual([b]);
    expect(a.package.source).toBe(pkg.source);
  });
  it('preserves corrupt saved contents and refuses to overwrite them', async () => {
    const { store, path } = await library();
    await writeFile(path, 'invalid contents');
    await expect(store.list()).rejects.toThrow(/preserved/);
    await expect(store.store(sample(), thumbnail)).rejects.toThrow(/preserved/);
    expect(await readFile(path, 'utf8')).toBe('invalid contents');
  });
});
