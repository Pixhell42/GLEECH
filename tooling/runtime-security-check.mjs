import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
assert.ok(process.argv.length <= 3, 'Usage: runtime-security-check.mjs [electron-or-app-path]');
const knownExecutables = new Map(
  [
    require('electron'),
    ...[
      'apps/desktop/release/win-unpacked/GLEECH.exe',
      'apps/desktop/release/mac/GLEECH.app/Contents/MacOS/GLEECH',
      'apps/desktop/release/mac-arm64/GLEECH.app/Contents/MacOS/GLEECH',
      'apps/desktop/release/linux-unpacked/gleech-bin',
    ].map((file) => resolve(root, file)),
  ].map((file) => [file, file]),
);
const executable = knownExecutables.get(
  process.argv[2] ? resolve(process.argv[2]) : require('electron'),
);
assert.ok(executable, 'Use the installed Electron runtime or a known packaged GLEECH executable.');
const output = resolve(root, 'test-results/runtime-security');
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(resolve(output, 'probe-'));
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
delete env.NODE_OPTIONS;
delete env.ELECTRON_RENDERER_URL;
const result = await new Promise((accept, reject) => {
  const child = spawn(executable, [resolve(root, 'tooling/runtime-security/runtime-probe.mjs')], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('Runtime security checks exceeded 45 seconds.'));
  }, 45000);
  child.stdout.on('data', (data) => (stdout += data));
  child.stderr.on('data', (data) => (stderr += data));
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('close', (code) => {
    clearTimeout(timer);
    accept({ code, stdout, stderr });
  });
});
assert.equal(result.code, 0, `Runtime probe failed: ${result.stderr}`);
const report = JSON.parse(result.stdout.trim());
report.checkedAt = new Date().toISOString();
report.executableSHA256 = createHash('sha256')
  .update(await readFile(executable))
  .digest('hex');
report.stderr = result.stderr;
await writeFile(resolve(scratch, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const expected = {
  electron: '45.1.0',
  node: '24.22.1',
  chrome: '156.0.8078.49',
  modules: '150',
  ares: '1.34.9',
  undici: '7.30.1',
};
for (const [name, version] of Object.entries(expected))
  assert.equal(report.versions[name], version, `Unexpected embedded ${name} version.`);
const desktop = JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8'));
assert.equal(desktop.devDependencies.electron, expected.electron, 'Review the new runtime pin.');
assert.deepEqual(
  report.checks.map(({ name }) => name).sort(),
  [
    'v8-json-escaped-keys',
    'dns-nul-validation',
    'tls-noncanonical-hostnames',
    'brotli-block-switch-and-roundtrip',
    'http-agent-pending-read',
    'permission-realpath-sync',
  ].sort(),
  'A required runtime regression probe is missing or duplicated.',
);
for (const check of report.checks)
  assert.equal(check.passed, true, `${check.name}: ${check.error}`);
assert.equal(report.passed, true);
assert.equal(report.platform, process.platform);
assert.equal(report.arch, process.arch);
console.log(
  `Runtime security checks passed: ${basename(executable)}, Electron ${report.versions.electron}, Node ${report.versions.node}; ${report.checks.length} groups. Report: ${resolve(scratch, 'report.json')}`,
);
