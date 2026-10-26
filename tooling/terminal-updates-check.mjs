// Real CLI bundle and Electron IPC, fixture release metadata; never installs an update.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const parent = resolve(root, 'test-results/terminal-updates');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'run-'));
const supplied = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const allowed = [
  'win-unpacked/GLEECH.exe',
  'mac-arm64/GLEECH.app/Contents/MacOS/GLEECH',
  'mac/GLEECH.app/Contents/MacOS/GLEECH',
  'linux-unpacked/gleech',
  'linux-unpacked/gleech-bin',
].map((path) => resolve(root, 'apps/desktop/release', path));
const allowedExecutables = new Map(allowed.map((path) => [path, path]));
const executable = supplied
  ? allowedExecutables.get(
      resolve(supplied, ...(supplied.endsWith('.app') ? ['Contents/MacOS/GLEECH'] : [])),
    )
  : createRequire(import.meta.url)('electron');
assert.ok(executable, 'Use a known packaged executable.');
const entry = supplied
  ? resolve(
      dirname(executable),
      process.platform === 'darwin' ? '../Resources/cli/gleech.cjs' : 'resources/cli/gleech.cjs',
    )
  : resolve(root, 'apps/desktop/out/cli/gleech.cjs');
const appArgs = supplied ? [] : [resolve(root, 'apps/desktop')];
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      ![
        'ELECTRON_RUN_AS_NODE',
        'ELECTRON_RENDERER_URL',
        'GLEECH_SMOKE_USER_DATA',
        'GLEECH_USER_DATA',
      ].includes(key.toUpperCase()),
  ),
);
const profile = join(output, 'profile');
await mkdir(profile);
const packageInfo = JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8'));
const parts = packageInfo.version.split('.').map(Number);
const version = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
const suffix =
  process.platform === 'win32'
    ? `${process.arch}-setup.exe`
    : process.platform === 'darwin'
      ? `mac-${process.arch}.zip`
      : `linux-${process.arch === 'x64' ? 'x86_64' : process.arch}.AppImage`;
const asset = `GLEECH-${version}-${suffix}`;
const manifest = `latest-${process.arch}${process.platform === 'darwin' ? '-mac' : process.platform === 'linux' ? '-linux' : ''}.yml`;
const releases = [
  {
    draft: false,
    prerelease: false,
    tag_name: `v${version}`,
    body: 'Fixture notes',
    assets: [
      { name: manifest },
      {
        name: asset,
        browser_download_url: `https://github.com/Pixhell42/GLEECH/releases/download/v${version}/${asset}`,
        size: 3,
        digest: `sha256:${'a'.repeat(64)}`,
      },
    ],
  },
];
const fixture = join(output, 'releases.cjs');
await writeFile(join(output, 'releases.json'), JSON.stringify(releases));
await writeFile(
  fixture,
  `const { readFileSync } = require('node:fs');
const { join } = require('node:path');
globalThis.fetch = async () => new Response(readFileSync(join(__dirname, 'releases.json'), 'utf8'), { status: 200 });
`,
);
const cliEnv = {
  ...env,
  GLEECH_USER_DATA: profile,
  ...(supplied ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
};
const cliExe = supplied ? executable : process.execPath;
async function cli(args) {
  return run(cliExe, ['--require', fixture, entry, ...args], {
    env: cliEnv,
    cwd: root,
    timeout: 30000,
    windowsHide: true,
  });
}
assert.match((await cli(['update', '--help'])).stdout, /--check/);
assert.match((await cli(['help', 'update'])).stdout, /--yes/);
const check = await cli(['update', '--check', '--json']);
assert.deepEqual(JSON.parse(check.stdout), {
  currentVersion: packageInfo.version,
  available: true,
  version,
  url: `https://github.com/Pixhell42/GLEECH/releases/tag/v${version}`,
});
assert.equal(check.stderr, '');
await assert.rejects(cli(['update']), (error) => /--yes/.test(error.stderr));
console.log('PASS compiled CLI help, JSON release discovery and noninteractive approval guard');

async function helper(userData, expected, terminalProfile = userData) {
  await mkdir(userData, { recursive: true });
  const child = spawn(executable, [...appArgs, '--smoke-test', '--gleech-terminal-update'], {
    cwd: root,
    env: { ...env, GLEECH_SMOKE_USER_DATA: userData, GLEECH_USER_DATA: terminalProfile },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const errors = [];
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.on('message', (event) => {
    if (event.type === 'error') errors.push(event.error);
  });
  const timeout = setTimeout(() => child.kill(), 20000);
  try {
    const code = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', done);
    });
    assert.equal(code, 1, stderr);
    assert.ok(
      errors.some((error) => expected.test(error)),
      JSON.stringify({ errors, stderr }),
    );
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
  }
}
await helper(join(output, 'unavailable'), /Development and unpacked test builds/);
console.log('PASS real Electron IPC refuses installation in a smoke/test build');
const desktop = await electron.launch({
  executablePath: executable,
  args: [...appArgs, '--smoke-test'],
  cwd: root,
  env: { ...env, GLEECH_SMOKE_USER_DATA: profile },
});
try {
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => !!window.gleech);
  await helper(
    profile,
    /Save and close the GLEECH desktop/,
    join(output, 'separate-terminal-profile'),
  );
  console.log('PASS terminal updater refuses to replace files while the desktop is open');
} finally {
  await closeTestApp(desktop);
}
console.log(`Terminal updater checks passed. Fixtures: ${output}`);
