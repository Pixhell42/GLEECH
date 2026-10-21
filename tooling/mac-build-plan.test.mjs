import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  collectMacNativeNotices,
  macBuildTarget,
  retainedMacLibvipsNotices,
  retainedMacOnnxNotices,
} from './mac-native-review.mjs';

const root = resolve(import.meta.dirname, '..');
const workflow = load(await readFile(resolve(root, '.github/workflows/macos.yml'), 'utf8'));
const builder = load(await readFile(resolve(root, 'apps/desktop/electron-builder.yml'), 'utf8'));
const workspace = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

test('Mac verifier derives fixed native paths and rejects arbitrary executable/path arguments', () => {
  assert.equal(macBuildTarget('arm64').app, 'mac-arm64/GLEECH.app');
  assert.equal(macBuildTarget('x64').app, 'mac/GLEECH.app');
  for (const input of ['../other.app', 'x64/../../', undefined, 'ia32'])
    assert.throws(() => macBuildTarget(input));
  const rejected = spawnSync(
    process.execPath,
    [resolve(root, 'tooling/mac-package-check.mjs'), '../other.app', 'x64'],
    { encoding: 'utf8' },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /no arguments accepted/);
});

for (const arch of ['arm64', 'x64']) {
  test(`notice collection accepts real-world missing license layouts on ${arch}`, async () => {
    const parent = resolve(root, 'test-results');
    await mkdir(parent, { recursive: true });
    const folder = await mkdtemp(resolve(parent, 'mac-notices-'));
    const roots = new Map();
    const sharp = `@img/sharp-darwin-${arch}`;
    const vips = `@img/sharp-libvips-darwin-${arch}`;
    const onnx = arch === 'x64' ? 'onnxruntime-node-macos-x64' : 'onnxruntime-node';
    for (const [name, version] of [
      [sharp, '0.35.5'],
      [vips, '1.3.4'],
      [onnx, arch === 'x64' ? '1.22.0' : '1.30.0'],
    ]) {
      const target = resolve(folder, 'packages', name);
      await mkdir(target, { recursive: true });
      await writeFile(
        resolve(target, 'package.json'),
        JSON.stringify({
          name: name === onnx ? 'onnxruntime-node' : name,
          version,
          license: 'MIT',
          repository: 'https://example.invalid/native-fixture',
        }),
      );
      roots.set(name, target);
    }
    const original = 'Original fixture license\r\nPreserve these bytes.\r\n';
    await writeFile(resolve(roots.get(sharp), 'LICENSE'), original);
    await writeFile(
      resolve(roots.get(vips), 'versions.json'),
      await readFile(resolve(root, 'LICENSES/img-sharp-win32-x64/0.35.5/versions.json')),
    );
    const output = resolve(folder, 'output');
    const result = await collectMacNativeNotices({
      arch,
      output,
      resolvePackage: (name) => roots.get(name),
    });
    assert.equal(result.packages.length, 3);
    const ort = result.packages.find((entry) => entry.installedAs === onnx);
    assert.equal(ort.files.length, 0);
    assert.equal(ort.retainedFiles.length, 2);
    assert.equal(ort.upstreamPackageOmitsNotices, true);
    assert.equal(
      result.packages.find((entry) => entry.installedAs === vips).retainedFiles.length,
      74,
    );
    assert.equal(await readFile(resolve(output, sharp, 'LICENSE'), 'utf8'), original);
    assert.deepEqual(JSON.parse(await readFile(resolve(output, 'inventory.json'), 'utf8')), result);
  });
}

test('both Mac ONNX runtimes retain their exact reviewed upstream license and notice texts', async () => {
  for (const version of ['1.22.0', '1.30.0']) {
    const result = await retainedMacOnnxNotices(version);
    assert.equal(result.retainedFiles.length, 2);
    assert.ok(
      result.retainedFiles.every((file) =>
        file.file.startsWith(`LICENSES/onnxruntime/${version}/`),
      ),
    );
  }
  await assert.rejects(retainedMacOnnxNotices('0.0.0'));
});

test('Mac libvips missing notices require matching reviewed source versions and original hashes', async () => {
  const versions = JSON.parse(
    await readFile(resolve(root, 'LICENSES/img-sharp-win32-x64/0.35.5/versions.json'), 'utf8'),
  );
  const review = await retainedMacLibvipsNotices(versions);
  assert.equal(review.components.length, Object.keys(versions).length);
  assert.ok(review.retainedFiles.some((file) => file.file === 'LICENSES/gnu/LGPL-3.0.txt'));
  assert.ok(review.retainedFiles.some((file) => file.file.includes('/mozjpeg/')));
  await assert.rejects(retainedMacLibvipsNotices({ ...versions, vips: '0.0.0' }));
  await assert.rejects(retainedMacLibvipsNotices({ ...versions, extraCodec: '1.0.0' }));
  const missing = { ...versions };
  delete missing.vips;
  await assert.rejects(retainedMacLibvipsNotices(missing));
});

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
    'node tooling/cli-check.mjs',
    'node tooling/cli-launcher-check.mjs',
    'node tooling/timeline-check.mjs',
    'node tooling/timeline-media-check.mjs',
  ]) {
    const check = steps.findIndex((step) => step.run?.includes(command));
    assert.ok(check >= 0 && check < upload, `Missing pre-upload check: ${command}`);
  }
  assert.equal(steps[upload].if, undefined, 'Artifacts must require successful earlier steps.');
  assert.equal(workflow.jobs.build.strategy['fail-fast'], false);
});

test('Mac timeline checks target each native app, require codecs and run on source changes', () => {
  const step = workflow.jobs.build.steps.find(
    (entry) => entry.name === 'Test packaged timeline and media',
  );
  assert.equal(step.env.GLEECH_MAC_APP, '${{ matrix.app }}');
  assert.ok(step.run.includes('$GLEECH_MAC_APP/Contents/MacOS/GLEECH'));
  for (const name of ['timeline', 'timeline-media'])
    assert.ok(
      step.run.includes(
        `node tooling/${name}-check.mjs "$gleech_executable" --cpu --require-ffmpeg`,
      ),
    );
  for (const path of [
    'apps/desktop/src/**',
    'packages/*/src/**',
    'tooling/timeline-*.mjs',
    'tooling/file-action.mjs',
  ])
    assert.ok(workflow.on.pull_request.paths.includes(path), `Missing native coverage for ${path}`);
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
