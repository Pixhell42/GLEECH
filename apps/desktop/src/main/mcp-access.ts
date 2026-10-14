import { realpath, stat, lstat, writeFile, link, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, relative, dirname, basename, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { McpMode, McpRequest } from '@gleech/mcp/protocol';

export type McpFolderKind = 'imports' | 'projects' | 'exports';
export interface McpFolder {
  id: string;
  kind: McpFolderKind;
  path: string;
}
export function createMcpAccess() {
  let mode: McpMode = 'off';
  let clipboardAllowed = false;
  const folders: McpFolder[] = [];
  const leases = new Map<string, { request: McpRequest; deadline: number }>();
  function lease(id: string, permission: 'observe' | 'edit' | 'full' = 'full') {
    const entry = leases.get(id);
    if (
      !(permission === 'full'
        ? mode === 'full'
        : permission === 'edit'
          ? ['edit', 'full'].includes(mode)
          : mode !== 'off') ||
      !entry ||
      Date.now() >= entry.deadline
    )
      throw new Error('MCP file access expired or was revoked.');
    return entry;
  }
  function pathValue(value: string) {
    if (
      !isAbsolute(value) ||
      value.includes('\0') ||
      /^(\\\\[?.]\\)/.test(value) ||
      value.slice(2).includes(':')
    )
      throw new Error(
        'Use an absolute, ordinary file path without device names or alternate data streams.',
      );
    if (
      value
        .split(/[\\/]/)
        .slice(1)
        .some(
          (part) =>
            /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      throw new Error('Invalid Windows file name.');
    return resolve(value);
  }
  function within(root: string, target: string) {
    const rest = relative(root, target);
    return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`));
  }
  async function authorize(kind: McpFolderKind, value: string, write: boolean) {
    if (mode !== 'full') throw new Error('Enable Full Control in GLEECH for file operations.');
    const path = pathValue(value);
    let canonical: string;
    if (write) {
      canonical = resolve(await realpath(dirname(path)), basename(path));
      try {
        // Existing files and junctions must also resolve inside the approved root.
        const existing = await lstat(canonical);
        if (!existing.isFile() || existing.isSymbolicLink())
          throw new Error('Choose an ordinary file destination, not a directory or link.');
        canonical = await realpath(canonical);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } else canonical = await realpath(path);
    for (const folder of folders.filter((folder) => folder.kind === kind)) {
      // Re-resolve grants to detect a folder replaced with a junction after approval.
      const current = await realpath(folder.path).catch(() => null);
      if (
        current &&
        current.toLowerCase() === folder.path.toLowerCase() &&
        within(folder.path, canonical)
      )
        return canonical;
    }
    throw new Error(
      `Path is outside the approved ${kind} folders. Add its folder in GLEECH's MCP panel.`,
    );
  }
  return {
    setMode(next: McpMode) {
      mode = next;
      if (next === 'off') clipboardAllowed = false;
      if (next !== 'full') leases.clear();
    },
    folders: () => folders.map((folder) => ({ ...folder })),
    clipboardAllowed: () => clipboardAllowed,
    setClipboardAllowed(next: boolean) {
      clipboardAllowed = next;
    },
    clipboard(id: string) {
      const request = lease(id, 'edit').request;
      if (!clipboardAllowed || request.action !== 'copy_to_clipboard')
        throw new Error('Enable the separate clipboard permission in GLEECH’s MCP panel.');
    },
    async addFolder(kind: McpFolderKind, path: string) {
      const canonical = await realpath(pathValue(path));
      if (!(await stat(canonical)).isDirectory()) throw new Error('Choose an existing folder.');
      if (
        !folders.some(
          (folder) => folder.kind === kind && folder.path.toLowerCase() === canonical.toLowerCase(),
        )
      )
        folders.push({ id: randomUUID(), kind, path: canonical });
    },
    removeFolder(id: string) {
      const index = folders.findIndex((folder) => folder.id === id);
      if (index < 0) throw new Error('Approved folder no longer exists.');
      folders.splice(index, 1);
    },
    begin(id: string, request: McpRequest, deadline: number) {
      leases.set(id, { request, deadline });
    },
    end(id: string) {
      leases.delete(id);
    },
    request(id: string, permission: 'observe' | 'edit' | 'full' = 'full') {
      return lease(id, permission).request;
    },
    async read(id: string, kind: McpFolderKind, path: string) {
      lease(id);
      const canonical = await authorize(kind, path, false);
      lease(id);
      return canonical;
    },
    async output(id: string, kind: McpFolderKind, path: string, overwrite: boolean) {
      lease(id);
      const canonical = await authorize(kind, path, true);
      lease(id);
      if (!overwrite) {
        try {
          await lstat(canonical);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return canonical;
          throw error;
        }
        throw new Error('Output already exists. Use a new path or explicitly allow overwrite.');
      }
      return canonical;
    },
    async write(
      id: string,
      kind: McpFolderKind,
      path: string,
      bytes: Uint8Array,
      overwrite: boolean,
    ) {
      lease(id);
      const canonical = await authorize(kind, path, true);
      const temporary = `${canonical}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes, { flag: 'wx' });
        lease(id);
        if ((await authorize(kind, path, true)) !== canonical)
          throw new Error('Destination changed while writing.');
        if (overwrite) await rename(temporary, canonical);
        else await link(temporary, canonical);
        return canonical;
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
  };
}
export type McpAccess = ReturnType<typeof createMcpAccess>;
