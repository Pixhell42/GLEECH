import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import type { UpdatePreferences, UpdateSessionOptions } from '../shared/updates';

export async function atomicUpdateWrite(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    const file = await open(path, 'r');
    try {
      if ((await file.stat()).size > 1024 * 1024) throw new Error('Update settings are too large.');
      return JSON.parse(await file.readFile('utf8'));
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function createUpdatePreferenceStore(
  path: string,
  version: string,
  showFirstLaunchNotes = true,
) {
  let writes = Promise.resolve();
  return {
    async load(): Promise<UpdatePreferences> {
      const defaults = {
        automatic: true,
        dismissedVersion: null,
        lastSeenVersion: showFirstLaunchNotes ? '' : version,
        pendingNotes: null,
      };
      const value = await readJson(path);
      if (value === null) return defaults;
      const item = value as Partial<UpdatePreferences>;
      if (
        typeof item.automatic !== 'boolean' ||
        typeof item.lastSeenVersion !== 'string' ||
        !(item.dismissedVersion === null || typeof item.dismissedVersion === 'string') ||
        !(
          item.pendingNotes === null ||
          (item.pendingNotes &&
            typeof item.pendingNotes.version === 'string' &&
            typeof item.pendingNotes.notes === 'string')
        )
      )
        throw new Error('Update preferences are invalid.');
      return item as UpdatePreferences;
    },
    save(value: UpdatePreferences) {
      const data = JSON.stringify(value);
      const next = writes.catch(() => {}).then(() => atomicUpdateWrite(path, data));
      writes = next;
      return next;
    },
  };
}

export interface StoredUpdateSession extends UpdateSessionOptions {
  id: string;
  documentPath: string | null;
}

export function createUpdateSessionStore(folder: string) {
  const manifest = join(folder, 'session.json');
  const fileFor = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid update session.');
    return join(folder, `${id}.gleech`);
  };
  return {
    async save(
      bytes: Buffer | null,
      documentPath: string | null,
      options: UpdateSessionOptions,
    ): Promise<string> {
      const id = randomUUID();
      if (bytes) await atomicUpdateWrite(fileFor(id), bytes);
      const metadata: StoredUpdateSession & { hasProject: boolean } = {
        id,
        documentPath,
        ...options,
        hasProject: Boolean(bytes),
      };
      await atomicUpdateWrite(manifest, JSON.stringify(metadata));
      return id;
    },
    async read(): Promise<(StoredUpdateSession & { path: string | null }) | null> {
      const value = await readJson(manifest);
      if (value === null) return null;
      const item = value as StoredUpdateSession & { hasProject: boolean };
      if (
        typeof item.id !== 'string' ||
        !(
          item.documentPath === null ||
          (typeof item.documentPath === 'string' && isAbsolute(item.documentPath))
        ) ||
        typeof item.hasProject !== 'boolean' ||
        typeof item.dirty !== 'boolean' ||
        !['image', 'timeline'].includes(item.mode) ||
        !Number.isFinite(item.playhead) ||
        item.playhead < 0
      )
        throw new Error('The update recovery session is invalid.');
      const path = fileFor(item.id);
      return { ...item, path: item.hasProject ? path : null };
    },
    async acknowledge(id: string): Promise<void> {
      const item = await this.read();
      if (item?.id !== id) throw new Error('This update session is no longer current.');
      await unlink(manifest);
      await unlink(fileFor(id)).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    },
    async validate(id: string): Promise<void> {
      const item = await this.read();
      if (item?.id !== id)
        throw new Error('Save the current session before installing the update.');
      if (item.path) await readFile(item.path);
    },
  };
}
