import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const root = resolve(import.meta.dirname, '..');
const workflow = load(await readFile(resolve(root, '.github/workflows/macos.yml'), 'utf8'));
const builder = load(await readFile(resolve(root, 'apps/desktop/electron-builder.yml'), 'utf8'));
const workspace = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

test('Mac packages use independent native architecture jobs', () => {
  const targets = workflow.jobs.build.strategy.matrix.include;
  assert.equal(targets.length, 2);
  assert.deepEqual(new Set(targets.map((t) => t.arch)), new Set(['arm64', 'x64']));
  for (const target of targets) {
    assert.equal(target.runner, target.arch === 'x64' ? 'macos-15-intel' : 'macos-15');
    assert.equal(
      target.app,
      `apps/desktop/release/${target.arch === 'x64' ? 'mac' : 'mac-arm64'}/GLEECH.app`,
    );
  }
  const install = workflow.jobs.build.steps.findIndex((step) => step.run?.includes('pnpm install'));
  const native = workflow.jobs.build.steps.findIndex((step) => step.run?.includes('process.arch'));
  assert.ok(
    native >= 0 && native < install,
    'Check native Node architecture before installing platform dependencies.',
  );
});

test('Mac upload follows advisory, native package and runtime checks', () => {
  const steps = workflow.jobs.build.steps;
  const upload = steps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(upload > 0);
  for (const command of [
    'pnpm audit --prod',
    'pnpm check',
    'pnpm dist:mac',
    'node tooling/mac-package-check.mjs',
    'node tooling/smoke.mjs',
    'node tooling/image-check.mjs',
    'node tooling/mcp-check.mjs',
    'node tooling/mcp-clients-check.mjs',
  ]) {
    const check = steps.findIndex((step) => step.run?.includes(command));
    assert.ok(check >= 0 && check < upload, `Missing pre-upload check: ${command}`);
  }
  assert.equal(steps[upload].if, undefined, 'Artifacts must require successful earlier steps.');
  assert.equal(workflow.jobs.build.strategy['fail-fast'], false);
});

test('Mac workflow keeps permissions read-only and uploads only package deliverables', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs.build;
  assert.equal(job.permissions, undefined);
  const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
  const paths = upload.with.path.trim().split('\n');
  assert.equal(paths.length, 3);
  for (const path of paths) {
    assert.ok(path.startsWith('apps/desktop/release/'));
    assert.match(path, /(?:\.zip|\.json|\.txt)$/);
    assert.ok(!path.includes('**'), 'Do not upload profiles, dependency trees or diagnostics.');
  }
  assert.equal(upload.with['if-no-files-found'], 'error');
  for (const step of job.steps.filter((step) => step.uses))
    assert.match(step.uses, /@[a-f0-9]{40}$/, 'Pin actions to complete commit SHAs.');
});

test('Mac original notices stay platform-scoped and Intel install helpers stay patched', () => {
  assert.ok(!builder.extraResources.some((entry) => entry.from.includes('mac-native-notices')));
  assert.ok(builder.mac.extraResources.some((entry) => entry.from === 'out/mac-native-notices'));
  assert.ok(builder.asarUnpack.includes('node_modules/onnxruntime-node-macos-x64/bin/**'));
  assert.ok(builder.win.files.includes('!**/onnxruntime-node-macos-x64/**'));
  assert.equal(workspace.pnpm.overrides['onnxruntime-node@1.22.0>adm-zip'], '0.6.1');
  assert.equal(workspace.pnpm.overrides['onnxruntime-node@1.22.0>global-agent'], '4.1.3');
});
