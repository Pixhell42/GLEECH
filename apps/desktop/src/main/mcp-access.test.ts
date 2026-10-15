import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { createMcpAccess } from './mcp-access';

async function cleanup(root: string) {
  if (
    !resolve(root).startsWith(resolve(tmpdir()) + sep) ||
    !basename(root).startsWith('gleech-mcp-')
  )
    throw new Error('Unexpected temporary test folder.');
  await rm(root, { recursive: true, force: true });
}
describe('MCP approved filesystem scopes', () => {
  it('rechecks approval immediately before committing a folder grant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-mcp-approval-'));
    const access = createMcpAccess();
    try {
      await expect(
        access.addFolder('imports', root, () => {
          throw new Error('Request cancelled');
        }),
      ).rejects.toThrow('Request cancelled');
      expect(access.folders()).toEqual([]);
    } finally {
      await cleanup(root);
    }
  });
  it('requires an independent clipboard grant, an active matching request and Edit mode', () => {
    const access = createMcpAccess();
    access.setMode('edit');
    access.begin('copy', { action: 'copy_to_clipboard' }, Date.now() + 30000);
    expect(() => access.clipboard('copy')).toThrow(/clipboard permission/);
    access.setClipboardAllowed(true);
    expect(() => access.clipboard('copy')).not.toThrow();
    access.begin('other', { action: 'get_project_state' }, Date.now() + 30000);
    expect(() => access.clipboard('other')).toThrow(/clipboard permission/);
    access.end('copy');
    expect(() => access.clipboard('copy')).toThrow(/revoked/);
    access.begin('copy', { action: 'copy_to_clipboard' }, Date.now() - 1);
    expect(() => access.clipboard('copy')).toThrow(/revoked/);
    access.setMode('off');
    expect(access.clipboardAllowed()).toBe(false);
    access.setMode('observe');
    access.setClipboardAllowed(true);
    access.begin('copy', { action: 'copy_to_clipboard' }, Date.now() + 30000);
    expect(() => access.clipboard('copy')).toThrow(/revoked/);
  });
  it('enforces independent scope kinds, mode, revocation, deadlines and no-overwrite writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-mcp-access-'));
    const approved = join(root, 'approved');
    const outside = join(root, 'outside');
    await mkdir(approved);
    await mkdir(outside);
    await writeFile(join(approved, 'input.png'), 'input');
    await writeFile(join(outside, 'input.png'), 'outside');
    const access = createMcpAccess();
    try {
      await access.addFolder('imports', approved);
      await access.addFolder('exports', approved);
      access.begin(
        'read',
        { action: 'load_image', path: join(approved, 'input.png') },
        Date.now() + 30000,
      );
      await expect(access.read('read', 'imports', join(approved, 'input.png'))).rejects.toThrow(
        /revoked/,
      );
      access.setMode('full');
      access.begin(
        'read',
        { action: 'load_image', path: join(approved, 'input.png') },
        Date.now() + 30000,
      );
      // Hosted Windows can expose Temp through an 8.3 alias; access returns its real path.
      await expect(access.read('read', 'imports', join(approved, 'input.png'))).resolves.toBe(
        await realpath(join(approved, 'input.png')),
      );
      await expect(access.read('read', 'projects', join(approved, 'input.png'))).rejects.toThrow(
        /outside/,
      );
      await expect(
        access.read('read', 'imports', join(approved, '..', 'outside', 'input.png')),
      ).rejects.toThrow(/outside/);
      await expect(access.read('read', 'imports', 'relative.png')).rejects.toThrow(/absolute/);
      await expect(
        access.read('read', 'imports', join(approved, 'input.png:stream')),
      ).rejects.toThrow(/alternate/);
      const destination = join(approved, 'export.png');
      access.begin(
        'write',
        { action: 'export_image', path: destination, format: 'png', overwrite: false },
        Date.now() + 30000,
      );
      await access.write('write', 'exports', destination, Buffer.from('first'), false);
      await expect(
        access.write('write', 'exports', destination, Buffer.from('second'), false),
      ).rejects.toThrow();
      expect(await readFile(destination, 'utf8')).toBe('first');
      await access.write('write', 'exports', destination, Buffer.from('third'), true);
      expect(await readFile(destination, 'utf8')).toBe('third');
      access.removeFolder(access.folders().find((folder) => folder.kind === 'exports')!.id);
      await expect(
        access.write('write', 'exports', destination, Buffer.from('denied'), true),
      ).rejects.toThrow(/outside/);
      access.setMode('edit');
      await expect(access.read('read', 'imports', join(approved, 'input.png'))).rejects.toThrow(
        /revoked/,
      );
      access.setMode('full');
      access.begin(
        'expired',
        { action: 'load_image', path: join(approved, 'input.png') },
        Date.now() - 1,
      );
      await expect(access.read('expired', 'imports', join(approved, 'input.png'))).rejects.toThrow(
        /expired/,
      );
    } finally {
      await cleanup(root);
    }
  });
  it('rejects junction escapes for reads and output directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-mcp-junction-'));
    const approved = join(root, 'approved');
    const outside = join(root, 'outside');
    await mkdir(approved);
    await mkdir(outside);
    await writeFile(join(outside, 'secret.png'), 'outside');
    await symlink(outside, join(approved, 'escape'), 'junction');
    const access = createMcpAccess();
    access.setMode('full');
    try {
      await access.addFolder('imports', approved);
      await access.addFolder('exports', approved);
      access.begin(
        'read',
        { action: 'load_image', path: join(approved, 'escape', 'secret.png') },
        Date.now() + 30000,
      );
      await expect(
        access.read('read', 'imports', join(approved, 'escape', 'secret.png')),
      ).rejects.toThrow(/outside/);
      access.begin(
        'write',
        {
          action: 'export_image',
          path: join(approved, 'escape', 'export.png'),
          format: 'png',
          overwrite: false,
        },
        Date.now() + 30000,
      );
      await expect(
        access.write(
          'write',
          'exports',
          join(approved, 'escape', 'export.png'),
          Buffer.from('denied'),
          false,
        ),
      ).rejects.toThrow(/outside/);
    } finally {
      await cleanup(root);
    }
  });
});
