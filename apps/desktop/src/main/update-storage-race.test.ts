import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const race = vi.hoisted(() => ({
  beforeOpen: undefined as (() => Promise<void>) | undefined,
  afterOpen: undefined as (() => Promise<void>) | undefined,
  handle: undefined as FileHandle | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const before = race.beforeOpen;
      race.beforeOpen = undefined;
      await before?.();
      const handle = await fs.open(...args);
      race.handle = handle;
      const after = race.afterOpen;
      race.afterOpen = undefined;
      try {
        await after?.();
        return handle;
      } catch (error) {
        await handle.close();
        throw error;
      }
    },
  };
});
import { createUpdatePreferenceStore } from './update-storage';

const folders: string[] = [];
const preferences = (automatic: boolean) =>
  JSON.stringify({
    automatic,
    dismissedVersion: null,
    lastSeenVersion: '0.2.0',
    pendingNotes: null,
  });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gleech-update-race-'));
  folders.push(root);
  const path = join(root, 'updates.json');
  await writeFile(path, preferences(true));
  return { root, path, store: createUpdatePreferenceStore(path, '0.2.0') };
}
afterEach(async () => {
  race.beforeOpen = undefined;
  race.afterOpen = undefined;
  for (const root of folders.splice(0)) {
    expect(root.startsWith(join(tmpdir(), 'gleech-update-race-'))).toBe(true);
    await rm(root, { recursive: true, force: true });
  }
});

describe('update file identity', () => {
  it('rejects replacement after opening and closes the original handle', async () => {
    const f = await fixture();
    race.afterOpen = async () => {
      await rename(f.path, `${f.path}.previous`);
      await writeFile(f.path, preferences(false));
    };
    await expect(f.store.load()).rejects.toThrow(/replaced entry/);
    await expect(race.handle!.stat()).rejects.toMatchObject({ code: 'EBADF' });
    expect(await readFile(f.path, 'utf8')).toBe(preferences(false));
    expect(await readFile(`${f.path}.previous`, 'utf8')).toBe(preferences(true));
  });
  it.skipIf(process.platform === 'win32')(
    'rejects a symlink substituted immediately before opening',
    async () => {
      const f = await fixture();
      const outside = await fixture();
      await writeFile(outside.path, preferences(false));
      race.beforeOpen = async () => {
        await rename(f.path, `${f.path}.previous`);
        await symlink(outside.path, f.path);
      };
      await expect(f.store.load()).rejects.toThrow(/regular file/);
      expect(await readFile(outside.path, 'utf8')).toBe(preferences(false));
    },
  );
});
