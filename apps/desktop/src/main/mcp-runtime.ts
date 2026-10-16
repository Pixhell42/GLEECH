import { mkdir, rename, symlink, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, relative } from 'node:path';
import type { McpLauncherPaths } from './mcp-config';

/** AppImage mounts change on every launch; client configuration must not. */
export function mcpRuntime(
  nativePaths: McpLauncherPaths,
  options: { appImage: boolean; userData: string },
) {
  if (!options.appImage) return { paths: nativePaths, prepare: async () => {} };
  const directory = join(options.userData, 'mcp-appimage');
  const runtime = join(directory, 'runtime');
  const mount = dirname(nativePaths.command);
  return {
    paths: {
      command: join(runtime, basename(nativePaths.command)),
      script: join(runtime, relative(mount, nativePaths.script)),
      connectionPath: nativePaths.connectionPath,
    },
    async prepare() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = join(directory, `runtime-${randomUUID()}.tmp`);
      try {
        await symlink(mount, temporary, 'dir');
        await rename(temporary, runtime);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
  };
}
