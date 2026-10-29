import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

assert.equal(
  process.argv.length,
  2,
  'Release candidate verification does not accept modes or paths.',
);
assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'Verify candidates on disposable native CI runners.',
);
assert.ok(
  ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'].includes(
    `${process.platform}-${process.arch}`,
  ),
);
const root = resolve(import.meta.dirname, '..');
const app = join(
  root,
  'apps/desktop/release',
  process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? 'mac-arm64/GLEECH.app'
      : 'mac/GLEECH.app'
    : process.platform === 'linux'
      ? 'linux-unpacked'
      : 'win-unpacked',
);
const resources = join(app, process.platform === 'darwin' ? 'Contents/Resources' : 'resources');
const verify = (script, args = []) =>
  execFileSync(process.execPath, [join(root, 'tooling', script), ...args], {
    cwd: root,
    stdio: 'inherit',
    timeout: 180000,
  });
if (process.platform === 'darwin') verify('mac-package-check.mjs');
else if (process.platform === 'linux') verify('linux-package-check.mjs');
else verify('native-release-check.mjs', [app]);
verify('ffmpeg-package-check.mjs', [resources]);
verify('update-package-check.mjs', [resources, join(root, 'apps/desktop/release')]);
verify('runtime-security-check.mjs', [
  join(
    app,
    process.platform === 'darwin'
      ? 'Contents/MacOS/GLEECH'
      : process.platform === 'linux'
        ? 'gleech-bin'
        : 'GLEECH.exe',
  ),
]);
