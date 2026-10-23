import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { collectNativeNotices } from './mac-native-review.mjs';

const root = resolve(import.meta.dirname, '..');
const workflow = load(await readFile(resolve(root, '.github/workflows/linux.yml'), 'utf8'));
const builder = load(await readFile(resolve(root, 'apps/desktop/electron-builder.yml'), 'utf8'));

test('Linux native review uses current ONNX and retains omitted original source notices', async () => {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  const folder = await mkdtemp(resolve(root, 'test-results/linux-notices-'));
  const packages = new Map();
  for (const [name, version] of [
    ['@img/sharp-linux-x64', '0.35.5'],
    ['@img/sharp-libvips-linux-x64', '1.3.4'],
    ['onnxruntime-node', '1.30.0'],
  ]) {
    const path = resolve(folder, name);
    await mkdir(path, { recursive: true });
    await writeFile(resolve(path, 'package.json'), JSON.stringify({ name, version }));
    packages.set(name, path);
  }
  const original = 'Original Linux Sharp notice\r\nPreserve its bytes.\r\n';
  await writeFile(resolve(packages.get('@img/sharp-linux-x64'), 'LICENSE'), original);
  await writeFile(
    resolve(packages.get('@img/sharp-libvips-linux-x64'), 'versions.json'),
    await readFile(resolve(root, 'LICENSES/img-sharp-win32-x64/0.35.5/versions.json')),
  );
  const output = resolve(folder, 'output');
  const result = await collectNativeNotices({
    platform: 'linux',
    arch: 'x64',
    output,
    resolvePackage: (name) => packages.get(name),
  });
  assert.equal(result.packages.length, 3);
  const ort = result.packages.find((entry) => entry.name === 'onnxruntime-node');
  assert.equal(ort.version, '1.30.0');
  assert.equal(ort.retainedFiles.length, 2);
  assert.equal(
    result.packages.find((entry) => entry.name.includes('libvips')).components.length,
    28,
  );
  assert.equal(await readFile(resolve(output, '@img/sharp-linux-x64/LICENSE'), 'utf8'), original);
  await assert.rejects(collectNativeNotices({ platform: 'linux', arch: 'arm64', output }));
  await assert.rejects(collectNativeNotices({ platform: 'win32', arch: 'x64', output }));
});

test('Linux verifier rejects caller-supplied executable and output paths', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'tooling/linux-package-check.mjs'), '../other-app'],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no arguments/);
});

test('Linux artifact upload requires native, advisory, code, actual AppImage and MCP checks', () => {
  assert.equal(workflow.jobs.build['runs-on'], 'ubuntu-22.04');
  const steps = workflow.jobs.build.steps;
  const upload = steps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(upload > 0);
  for (const command of [
    'pnpm audit --prod',
    'pnpm dist:linux',
    'pnpm check',
    'node tooling/linux-package-check.mjs',
    'node tooling/image-check.mjs',
    'node tooling/smoke.mjs',
    'node tooling/mcp-check.mjs',
    'node tooling/mcp-clients-check.mjs',
    'node tooling/cli-check.mjs',
    'node tooling/cli-launcher-check.mjs',
    'node tooling/appimage-check.mjs',
  ]) {
    const index = steps.findIndex((step) => step.run?.includes(command));
    assert.ok(index >= 0 && index < upload, command);
  }
  assert.equal(steps[upload].if, undefined);
  const appimage = steps.find((step) => step.run?.includes('node tooling/appimage-check.mjs'));
  assert.equal(appimage.env.APPIMAGE_EXTRACT_AND_RUN, '1');
  assert.equal(appimage.env.GLEECH_APPIMAGE, '${{ steps.package.outputs.appimage }}');
  assert.ok(appimage.run.includes('mcp-check.mjs "$GLEECH_APPIMAGE" --cpu'));
  const native = steps.findIndex((step) => step.run?.includes('process.arch'));
  assert.ok(native < steps.findIndex((step) => step.run?.includes('pnpm install')));
});

test('Linux CI keeps tokens read-only, actions pinned and uploads only reviewed deliverables', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.build.permissions, undefined);
  const steps = workflow.jobs.build.steps;
  for (const step of steps.filter((step) => step.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const paths = steps
    .find((step) => step.uses?.startsWith('actions/upload-artifact@'))
    .with.path.trim()
    .split('\n');
  assert.deepEqual(paths, [
    '${{ steps.package.outputs.appimage }}',
    'apps/desktop/release/linux-build-x64.json',
    'apps/desktop/release/SHA256SUMS-linux-x64.txt',
    'apps/desktop/release/latest-x64-linux.yml',
    'apps/desktop/release/*.blockmap',
  ]);
});

test('Linux runtime checks and upload follow the verified filename across release versions', async () => {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  const steps = workflow.jobs.build.steps;
  const verify = steps.find((step) => step.id === 'package');
  const script = /node -e "([^"]+)"/.exec(verify.run)?.[1];
  assert.ok(script);
  const appimage = steps.find((step) => step.run?.includes('node tooling/appimage-check.mjs'));
  for (const command of ['smoke', 'mcp-check', 'appimage-check'])
    assert.ok(appimage.run.includes(`tooling/${command}.mjs "$GLEECH_APPIMAGE"`));
  for (const version of ['0.1.1', '0.2.0-beta.3']) {
    const folder = await mkdtemp(resolve(root, 'test-results/linux-version-'));
    await mkdir(resolve(folder, 'apps/desktop/release'), { recursive: true });
    const archive = `GLEECH-${version}-linux-x86_64.AppImage`;
    await writeFile(
      resolve(folder, 'apps/desktop/release/linux-build-x64.json'),
      JSON.stringify({ archive }),
    );
    const output = resolve(folder, 'outputs.txt');
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: folder,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(output, 'utf8'), `appimage=apps/desktop/release/${archive}\n`);
  }
});

test('Linux packages unpack Sharp shared libraries and exclude Intel Mac alias completely', () => {
  assert.ok(builder.asarUnpack.includes('node_modules/@img/**'));
  assert.ok(builder.linux.files.includes('!**/onnxruntime-node-macos-x64/**'));
  assert.ok(builder.linux.files.includes('!**/onnxruntime-node/bin/napi-v6/linux/arm64/**'));
  assert.ok(
    builder.linux.extraResources.some((entry) => entry.from === 'out/linux-native-notices'),
  );
  assert.ok(!builder.extraResources.some((entry) => entry.from.includes('linux-native-notices')));
  assert.ok(
    !builder.win.extraResources?.some((entry) => entry.from.includes('linux-native-notices')),
  );
});
