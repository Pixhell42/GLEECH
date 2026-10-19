import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const supplied = process.argv[2];
assert.ok(supplied, 'Pass a packaged executable, .app or AppImage.');
const appimage = supplied.endsWith('.AppImage');
const metadata = JSON.parse(await readFile(join(root, 'apps/desktop/package.json'), 'utf8'));
const candidates = [
  'win-unpacked/GLEECH.exe',
  'mac-arm64/GLEECH.app',
  'mac/GLEECH.app',
  'linux-unpacked/gleech',
  'GLEECH-' + metadata.version + '-linux-x86_64.AppImage',
].map((p) => resolve(root, 'apps/desktop/release', p));
const executable = new Map(candidates.map((p) => [p, p])).get(resolve(supplied));
assert.ok(executable, 'Use a known package under apps/desktop/release.');
const parent = join(root, 'test-results/cli-launcher');
await mkdir(parent, { recursive: true });
const home = await mkdtemp(join(parent, 'user-'));
const app = supplied.endsWith('.app') ? join(executable, 'Contents/MacOS/GLEECH') : executable;
const launcher = appimage
  ? app
  : process.platform === 'darwin'
    ? resolve(dirname(app), '../Resources/cli/gleech')
    : join(dirname(app), 'resources/cli', process.platform === 'win32' ? 'gleech.cmd' : 'gleech');
const env = {
  ...process.env,
  HOME: home,
  ZDOTDIR: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  SHELL: '/bin/bash',
  NO_COLOR: '1',
  GLEECH_USER_DATA: join(home, 'profile'),
};
delete env.ELECTRON_RUN_AS_NODE;
if (appimage) env.APPIMAGE_EXTRACT_AND_RUN = '1';
async function invoke(args, command = launcher) {
  const prefix = command === app && appimage ? ['--cli'] : [];
  const result =
    process.platform === 'win32'
      ? await run(
          'cmd.exe',
          ['/d', '/s', '/c', '"' + [command, ...args].map((a) => '"' + a + '"').join(' ') + '"'],
          {
            env,
            timeout: 90000,
            maxBuffer: 4e6,
            windowsHide: true,
            windowsVerbatimArguments: true,
          },
        )
      : await run(command, [...prefix, ...args], { env, timeout: 90000, maxBuffer: 4e6 });
  return result.stdout;
}
const version = JSON.parse(await readFile(join(root, 'apps/desktop/package.json'), 'utf8')).version;
assert.equal((await invoke(['--version'])).trim(), version);
const info = JSON.parse(await invoke(['info', '--json', '--renderer', 'cpu']));
assert.equal(info.codec, 'sharp');
const output = join(home, 'preview.png');
await invoke([
  'render',
  'sample',
  '--renderer',
  'cpu',
  '--max-size',
  '64',
  '-e',
  'rgb-split',
  '-o',
  output,
]);
await access(output);
if (process.platform !== 'win32') {
  await invoke(['install-cli']);
  const stable = join(home, '.local/bin/gleech');
  const text = await readFile(stable, 'utf8');
  if (appimage) {
    assert.ok(text.includes(executable));
    assert.ok(!text.includes('/.mount_'));
  }
  assert.equal((await invoke(['--version'], stable)).trim(), version);
  await invoke(['install-cli'], stable);
  const profile = await readFile(join(home, '.profile'), 'utf8');
  assert.equal(profile.split('# >>> GLEECH CLI PATH >>>').length, 2);
  await invoke(['uninstall-cli'], stable);
  await assert.rejects(access(stable), { code: 'ENOENT' });
  assert.ok(!(await readFile(join(home, '.profile'), 'utf8')).includes('GLEECH CLI PATH'));
}
console.log('Packaged terminal launcher, CPU render and per-user PATH checks passed.');
