import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import type { UpdatePreferences, UpdateSessionOptions } from '../shared/updates';
import { updateChildPath } from './update-path';

async function atomicUpdateWrite(
  folder: string,
  name: string,
  data: string | Buffer,
): Promise<void> {
  const path = updateChildPath(folder, name);
  await mkdir(dirname(path), { recursive: true });
  const temporary = updateChildPath(folder, `${name}.${randomUUID()}.tmp`);
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

async function openUpdateFile(folder: string, name: string) {
  const path = updateChildPath(folder, name);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ELOOP')
        throw new Error('Update data must be a regular file, not a link.');
      throw error;
    },
  );
  try {
    // Validate the opened handle. A later rename cannot redirect its reads.
    // The entry comparison also rejects links on platforms without O_NOFOLLOW.
    const info = await file.stat({ bigint: true });
    const entry = await lstat(path, { bigint: true });
    if (
      !info.isFile() ||
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      info.dev !== entry.dev ||
      info.ino !== entry.ino
    )
      throw new Error('Update data must be a regular file, not a link or replaced entry.');
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function readJson(folder: string, name: string): Promise<unknown> {
  try {
    const file = await openUpdateFile(folder, name);
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
  const folder = dirname(path);
  const name = basename(path);
  if (!['updates.json', 'tui-updates.json'].includes(name))
    throw new Error('Invalid update preferences filename.');
  let writes = Promise.resolve();
  return {
    async load(): Promise<UpdatePreferences> {
      const defaults = {
        automatic: true,
        dismissedVersion: null,
        lastSeenVersion: showFirstLaunchNotes ? '' : version,
        pendingNotes: null,
      };
      const value = await readJson(folder, name);
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
      const next = writes.catch(() => {}).then(() => atomicUpdateWrite(folder, name, data));
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
  const manifest = updateChildPath(folder, 'session.json');
  const nameFor = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid update session.');
    return `${id}.gleech`;
  };
  return {
    async save(
      bytes: Buffer | null,
      documentPath: string | null,
      options: UpdateSessionOptions,
    ): Promise<string> {
      const id = randomUUID();
      if (bytes) await atomicUpdateWrite(folder, nameFor(id), bytes);
      const metadata: StoredUpdateSession & { hasProject: boolean } = {
        id,
        documentPath,
        ...options,
        hasProject: Boolean(bytes),
      };
      await atomicUpdateWrite(folder, 'session.json', JSON.stringify(metadata));
      return id;
    },
    async read(): Promise<(StoredUpdateSession & { path: string | null }) | null> {
      const value = await readJson(folder, 'session.json');
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
      const path = updateChildPath(folder, nameFor(item.id));
      if (item.hasProject) {
        const file = await openUpdateFile(folder, nameFor(item.id));
        await file.close();
      }
      return { ...item, path: item.hasProject ? path : null };
    },
    async acknowledge(id: string): Promise<void> {
      const item = await this.read();
      if (item?.id !== id) throw new Error('This update session is no longer current.');
      await unlink(manifest);
      await unlink(updateChildPath(folder, nameFor(id))).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    },
    async validate(id: string): Promise<void> {
      const item = await this.read();
      if (item?.id !== id)
        throw new Error('Save the current session before installing the update.');
      if (item.path) {
        const file = await openUpdateFile(folder, nameFor(id));
        await file.close();
      }
    },
  };
}
