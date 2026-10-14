import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecentProjects, MAX_RECENT_PROJECTS } from './recent-projects';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'gleech-recents-'));
  const path = join(directory, 'profile', 'recent-projects.json');
  return { directory, path, store: createRecentProjects(path) };
}

describe('recent-project history', () => {
  it('starts empty, persists only metadata and promotes previously used paths', async () => {
    const { directory, path, store } = await fixture();
    expect(await store.list()).toEqual([]);
    const first = await store.remember(join(directory, 'first.gleech'));
    const second = await store.remember(join(directory, 'second.gleech'));
    expect((await store.list()).map((item) => item.id)).toEqual([second.id, first.id]);
    const promoted = await store.remember(first.path);
    expect(promoted.id).toBe(first.id);
    const reopened = createRecentProjects(path);
    expect(await reopened.list()).toEqual([promoted, second]);
    expect(await reopened.get(second.id)).toEqual(second);
    expect(Object.keys(promoted).sort()).toEqual(['id', 'lastUsed', 'name', 'path']);
  });
  it('serializes concurrent updates and bounds history to the latest 20 projects', async () => {
    const { directory, store } = await fixture();
    const items = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        store.remember(join(directory, `project-${index}.gleech`)),
      ),
    );
    expect(await store.list()).toEqual(items.slice(-MAX_RECENT_PROJECTS).reverse());
    await expect(store.get(items[0]!.id)).rejects.toThrow('no longer in Recents');
  });
  it('deduplicates Windows path casing while preserving distinct paths with identical names', async () => {
    const { directory, store } = await fixture();
    const first = await store.remember(join(directory, 'Work', 'Name.gleech'));
    const second = await store.remember(join(directory, 'other', 'Name.gleech'));
    const variant = await store.remember(first.path.toUpperCase());
    expect(variant.id).toBe(first.id);
    expect(await store.list()).toEqual([variant, second]);
  });
  it('only resolves stored opaque IDs and rejects invalid paths without changing history', async () => {
    const { directory, store } = await fixture();
    const item = await store.remember(join(directory, 'safe.gleech'));
    for (const id of [null, 42, '', item.path]) await expect(store.get(id)).rejects.toThrow();
    for (const path of ['relative.gleech', join(directory, 'bad\0.gleech'), ''])
      await expect(store.remember(path)).rejects.toThrow();
    expect(await store.list()).toEqual([item]);
  });
  it('preserves corrupt history until explicitly cleared, then allows fresh saves', async () => {
    const { directory, path, store } = await fixture();
    await store.remember(join(directory, 'valid.gleech'));
    await writeFile(path, '{broken');
    await expect(store.list()).rejects.toThrow('Clear Recents');
    await expect(store.remember(join(directory, 'new.gleech'))).rejects.toThrow('Clear Recents');
    expect(await readFile(path, 'utf8')).toBe('{broken');
    await store.clear();
    expect(await store.list()).toEqual([]);
    await store.remember(join(directory, 'new.gleech'));
    expect((await store.list()).length).toBe(1);
  });
  it('rejects malformed records and duplicate identities', async () => {
    const { directory, path, store } = await fixture();
    const item = await store.remember(join(directory, 'valid.gleech'));
    for (const projects of [
      [{ ...item, path: 'relative.gleech' }],
      [{ ...item, lastUsed: 'invalid' }],
      [{ ...item, name: 'wrong.gleech' }],
      [item, item],
      [{ ...item, id: '' }],
    ]) {
      await writeFile(path, JSON.stringify({ schemaVersion: 1, projects }));
      await expect(store.list()).rejects.toThrow('Clear Recents');
    }
    for (const value of ['null', '{}', '{"schemaVersion":99,"projects":[]}']) {
      await writeFile(path, value);
      await expect(store.list()).rejects.toThrow('Clear Recents');
    }
  });
  it('clear removes history without touching a project file', async () => {
    const { directory, store } = await fixture();
    const path = join(directory, 'keep.gleech');
    await writeFile(path, 'project content');
    await store.remember(path);
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe('project content');
  });
});
