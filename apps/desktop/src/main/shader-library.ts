import { randomUUID } from 'node:crypto';
import { open, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertExecutableShader, type ShaderPackage } from '@gleech/project-model/shader-package';
import type { LibraryShader } from '../shared/image-api';

export function createShaderLibrary(path: string) {
  let queue: Promise<unknown> = Promise.resolve();
  async function read(): Promise<LibraryShader[]> {
    let file;
    try {
      file = await open(path, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      if ((await file.stat()).size > 32 * 1024 * 1024)
        throw new Error('Shader library exceeds 32 MiB.');
      const value = JSON.parse(await file.readFile('utf8'));
      if (value.schemaVersion !== 1 || !Array.isArray(value.shaders) || value.shaders.length > 64)
        throw new Error('Unsupported shader library.');
      const ids = new Set<string>();
      for (const shader of value.shaders) {
        assertExecutableShader(shader.package);
        if (
          typeof shader.id !== 'string' ||
          !shader.id ||
          ids.has(shader.id) ||
          typeof shader.thumbnail !== 'string' ||
          shader.thumbnail.length > 512 * 1024 ||
          !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(shader.thumbnail)
        )
          throw new Error('Invalid shader library entry.');
        ids.add(shader.id);
      }
      return value.shaders;
    } catch (error) {
      throw new Error('Could not read the shader library. Saved contents were preserved.', {
        cause: error,
      });
    } finally {
      await file.close();
    }
  }
  function change<T>(operation: (shaders: LibraryShader[]) => T): Promise<T> {
    const work = queue.then(async () => {
      const shaders = await read(),
        result = operation(shaders);
      const contents = JSON.stringify({ schemaVersion: 1, shaders });
      if (shaders.length > 64 || Buffer.byteLength(contents) > 32 * 1024 * 1024)
        throw new Error('The shader library is full.');
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, contents, { flag: 'wx' });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return result;
    });
    queue = work.catch(() => {});
    return work;
  }
  return {
    async list() {
      await queue;
      return read();
    },
    store(pkg: ShaderPackage, thumbnail: string) {
      assertExecutableShader(pkg);
      const packageCopy = structuredClone(pkg);
      if (
        thumbnail.length > 512 * 1024 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(thumbnail)
      )
        throw new Error('Invalid shader thumbnail.');
      return change((shaders) => {
        const index = shaders.findIndex(
          (entry) =>
            entry.package.id === packageCopy.id && entry.package.version === packageCopy.version,
        );
        const entry = JSON.parse(
          JSON.stringify({
            id: index < 0 ? randomUUID() : shaders[index]!.id,
            package: packageCopy,
            thumbnail,
          }),
        ) as LibraryShader;
        if (index < 0) shaders.push(entry);
        else shaders[index] = entry;
        return entry;
      });
    },
    delete(id: string) {
      return change((shaders) => {
        const index = shaders.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error('Shader does not exist.');
        shaders.splice(index, 1);
      });
    },
  };
}
