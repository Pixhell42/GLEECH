import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path';
import type { RecentProject } from '../shared/image-api';

export const MAX_RECENT_PROJECTS = 20;
const identity = (path: string) => normalize(path).toLocaleLowerCase('en-US');

// Only paths selected in native Open/Save dialogs enter this store. Renderer
// requests use opaque IDs rather than gaining an arbitrary-path open operation.
export function createRecentProjects(path: string) {
  let queue: Promise<unknown> = Promise.resolve();
  async function read(): Promise<RecentProject[]> {
    let file;
    try {
      file = await open(path, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      if ((await file.stat()).size > 2 * 1024 * 1024)
        throw new Error('Recent-project history is too large.');
      const data = JSON.parse(await file.readFile('utf8'));
      if (
        data.schemaVersion !== 1 ||
        !Array.isArray(data.projects) ||
        data.projects.length > MAX_RECENT_PROJECTS
      )
        throw new Error('Unsupported recent-project history.');
      const ids = new Set<string>(),
        paths = new Set<string>();
      for (const item of data.projects) {
        if (
          !item ||
          typeof item.id !== 'string' ||
          !item.id ||
          item.id.length > 1024 ||
          typeof item.path !== 'string' ||
          !isAbsolute(item.path) ||
          item.path.length > 32768 ||
          item.path.includes('\0') ||
          typeof item.name !== 'string' ||
          item.name !== basename(item.path) ||
          typeof item.lastUsed !== 'string' ||
          !Number.isFinite(Date.parse(item.lastUsed)) ||
          ids.has(item.id) ||
          paths.has(identity(item.path))
        )
          throw new Error('Invalid recent project.');
        ids.add(item.id);
        paths.add(identity(item.path));
      }
      return data.projects;
    } catch (error) {
      throw new Error(
        'Could not read Recents. Clear Recents to reset the history. Your project files are unchanged.',
        { cause: error },
      );
    } finally {
      await file.close();
    }
  }
  async function write(projects: readonly RecentProject[]) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, projects }), { flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  function serialize<T>(operation: () => Promise<T>) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  return {
    async list() {
      await queue;
      return read();
    },
    async get(id: unknown) {
      if (typeof id !== 'string' || !id || id.length > 1024)
        throw new Error('Choose a project from Recents.');
      await queue;
      const item = (await read()).find((entry) => entry.id === id);
      if (!item) throw new Error('This project is no longer in Recents.');
      return item;
    },
    remember(selectedPath: string) {
      return serialize(async () => {
        if (
          typeof selectedPath !== 'string' ||
          !isAbsolute(selectedPath) ||
          selectedPath.length > 32768 ||
          selectedPath.includes('\0')
        )
          throw new Error('Invalid recent-project path.');
        const canonical = resolve(selectedPath),
          projects = await read(),
          previous = projects.find((entry) => identity(entry.path) === identity(canonical));
        const item: RecentProject = {
          id: previous?.id ?? randomUUID(),
          path: canonical,
          name: basename(canonical),
          lastUsed: new Date().toISOString(),
        };
        await write(
          [item, ...projects.filter((entry) => identity(entry.path) !== identity(canonical))].slice(
            0,
            MAX_RECENT_PROJECTS,
          ),
        );
        return item;
      });
    },
    clear() {
      return serialize(() => write([]));
    },
  };
}
