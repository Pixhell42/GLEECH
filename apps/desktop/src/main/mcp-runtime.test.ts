import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { mcpRuntime } from './mcp-runtime';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gleech-mcp-runtime-'));
  directories.push(root);
  return root;
}

it('leaves ordinary packaged and development launcher paths unchanged', async () => {
  const root = await fixture();
  const paths = {
    command: '/opt/gleech/gleech',
    script: '/opt/gleech/resources/mcp/server.cjs',
    connectionPath: join(root, 'connection.json'),
  };
  const runtime = mcpRuntime(paths, { appImage: false, userData: root });
  expect(runtime.paths).toEqual(paths);
  await runtime.prepare();
  expect(await readdir(root)).toEqual([]);
});

it.skipIf(process.platform === 'win32')(
  'keeps saved client paths usable when an AppImage remounts',
  async () => {
    const root = await fixture();
    const userData = join(root, 'profile with spaces');
    async function mount(name: string) {
      const directory = join(root, name);
      const paths = {
        command: join(directory, 'gleech'),
        script: join(directory, 'resources/mcp/server.cjs'),
        connectionPath: join(userData, 'mcp-connection.json'),
      };
      await mkdir(dirname(paths.script), { recursive: true });
      await writeFile(paths.command, name);
      await writeFile(paths.script, `${name} server`);
      return { directory, runtime: mcpRuntime(paths, { appImage: true, userData }) };
    }
    const first = await mount('mount-one');
    await first.runtime.prepare();
    const saved = first.runtime.paths;
    expect(await readFile(saved.command, 'utf8')).toBe('mount-one');
    expect(await readFile(saved.script, 'utf8')).toBe('mount-one server');
    const second = await mount('mount-two');
    await second.runtime.prepare();
    await rm(first.directory, { recursive: true });
    expect(second.runtime.paths).toEqual(saved);
    expect(await readFile(saved.command, 'utf8')).toBe('mount-two');
    expect(await readFile(saved.script, 'utf8')).toBe('mount-two server');
    expect((await stat(join(userData, 'mcp-appimage'))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(userData, 'mcp-appimage'))).toEqual(['runtime']);
  },
);

it.skipIf(process.platform === 'win32')(
  'reports an unusable launcher location and removes the temporary link',
  async () => {
    const root = await fixture();
    const directory = join(root, 'mcp-appimage');
    await mkdir(join(directory, 'runtime'), { recursive: true });
    const runtime = mcpRuntime(
      {
        command: '/example/gleech',
        script: '/example/resources/mcp/server.cjs',
        connectionPath: join(root, 'connection.json'),
      },
      { appImage: true, userData: root },
    );
    await expect(runtime.prepare()).rejects.toThrow();
    expect(await readdir(directory)).toEqual(['runtime']);
  },
);
