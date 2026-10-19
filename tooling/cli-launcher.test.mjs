import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import afterPack from '../apps/desktop/build/cli-after-pack.mjs';

const root = resolve(import.meta.dirname, '..');
test('Linux package keeps the native executable and installs an executable entry script', async () => {
  const parent = join(root, 'test-results');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'cli-package-'));
  await mkdir(join(directory, 'resources/cli'), { recursive: true });
  await writeFile(
    join(directory, 'gleech'),
    '#!/bin/sh\nprintf "%s\\n" "runtime=$ELECTRON_RUN_AS_NODE" "$@"\nexit 7\n',
    { mode: 0o755 },
  );
  const wrapper = await readFile(join(root, 'apps/desktop/resources/cli/linux-entry'));
  await writeFile(join(directory, 'resources/cli/linux-entry'), wrapper);
  await writeFile(join(directory, 'resources/cli/gleech'), '#!/bin/sh\n');
  await afterPack({ appOutDir: directory, electronPlatformName: 'linux' });
  assert.deepEqual(await readFile(join(directory, 'gleech')), wrapper);
  assert.match(await readFile(join(directory, 'gleech-bin'), 'utf8'), /runtime=/);
  if (process.platform !== 'win32') {
    for (const args of [
      ['--cli', 'render', 'a b.png', ';literal'],
      ['--no-sandbox', '--cli', '--version'],
    ]) {
      const run = spawnSync(join(directory, 'gleech'), args, { encoding: 'utf8' });
      assert.equal(run.status, 7, run.stderr);
      assert.match(run.stdout, /runtime=1/);
      assert.ok(run.stdout.includes(join(directory, 'resources/cli/gleech.cjs')));
      assert.ok(!run.stdout.includes('--no-sandbox'));
    }
    const run = spawnSync(join(directory, 'gleech'), ['--some-gui-flag', 'a b.gleech'], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    });
    assert.equal(run.status, 7);
    assert.equal(run.stdout, 'runtime=\n--some-gui-flag\na b.gleech\n');
  }
});
