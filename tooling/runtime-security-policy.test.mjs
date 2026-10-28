import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const run = (file, args) =>
  spawnSync(process.execPath, [resolve(root, file), ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });

test('runtime checks reject arbitrary executables before launching or hashing them', () => {
  const result = run('tooling/runtime-security-check.mjs', ['unreviewed-runtime.exe']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use the installed Electron runtime or a known packaged/);
});

test('the runtime probe rejects caller-provided scratch paths and scripts', () => {
  const result = run('tooling/runtime-security/runtime-probe.mjs', ['unreviewed-scratch']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not accept paths or scripts/);
});
