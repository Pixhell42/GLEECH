import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'js-yaml';
import { bundle, fetchAsset, validateArchiveEntries, verifyAsset } from './prepare-ffmpeg.mjs';
import { assertNoFfmpegStaging } from './ffmpeg-package-layout.mjs';

const root = resolve(import.meta.dirname, '..');
const asar = createRequire(import.meta.url)('@electron/asar');
const builderRequire = createRequire(import.meta.url);
const { doMergeConfigs } = builderRequire('app-builder-lib/out/util/config/config.js');
const { getMainFileMatchers } = builderRequire('app-builder-lib/out/fileMatcher.js');

test('effective platform matchers exclude staging, source and local files from the app archive', async () => {
  const builder = load(await readFile(join(root, 'apps/desktop/electron-builder.yml'), 'utf8'));
  const app = join(root, 'apps/desktop');
  const destination = join(root, 'test-results/ffmpeg-matcher');
  const stat = { isDirectory: () => false };
  for (const platform of ['win', 'mac', 'linux']) {
    const config = doMergeConfigs([structuredClone(builder)]);
    const packager = {
      info: {
        projectDir: app,
        buildResourcesDir: 'build',
        config,
        isPrepackedAppAsar: false,
        debugLogger: { isEnabled: false },
      },
    };
    const matchers = getMainFileMatchers(
      app,
      destination,
      (value) => value,
      config[platform],
      packager,
      join(app, 'release'),
      false,
    );
    const included = (path) =>
      matchers.some((matcher) => matcher.createFilter()(join(app, path), stat));
    for (const path of [
      'out/main/index.js',
      'out/preload/index.js',
      'out/renderer/index.html',
      'package.json',
    ])
      assert.equal(included(path), true, `${platform}: missing application file ${path}`);
    for (const path of [
      'src/main/index.ts',
      '.env.local',
      'resources/models/u2netp.onnx',
      ...['win-x64', 'mac-arm64', 'mac-x64', 'linux-x64'].map(
        (target) => `out/ffmpeg/${target}/sources/complete-source.tar.xz`,
      ),
    ])
      assert.equal(included(path), false, `${platform}: unexpected archived file ${path}`);
  }
});

test('packaged ASAR rejects FFmpeg caches for any platform while retaining external resources', async () => {
  for (const staged of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'gleech-ffmpeg-layout-'));
    const application = join(directory, 'application');
    const resources = join(directory, 'resources');
    await mkdir(join(application, 'out/main'), { recursive: true });
    await mkdir(join(resources, 'ffmpeg/sources'), { recursive: true });
    await writeFile(join(application, 'out/main/index.js'), '// application');
    await writeFile(join(resources, 'ffmpeg/sources/complete-source.tar.xz'), 'source');
    if (staged) {
      for (const target of ['win-x64', 'mac-arm64', 'mac-x64', 'linux-x64']) {
        const cache = join(application, 'out/ffmpeg', target);
        await mkdir(cache, { recursive: true });
        await writeFile(join(cache, 'ffmpeg'), 'cached executable');
      }
    }
    await asar.createPackage(application, join(resources, 'app.asar'));
    if (staged) assert.throws(() => assertNoFfmpegStaging(resources), /staging files/);
    else assertNoFfmpegStaging(resources);
    assert.equal(
      await readFile(join(resources, 'ffmpeg/sources/complete-source.tar.xz'), 'utf8'),
      'source',
    );
  }
});

test('all supported targets have immutable GPL binary and complete-source pins', () => {
  assert.deepEqual(Object.keys(bundle.targets).sort(), [
    'darwin-arm64',
    'darwin-x64',
    'linux-x64',
    'win32-x64',
  ]);
  assert.equal(bundle.license, 'GPL-2.0-or-later');
  for (const asset of [bundle.source, ...Object.values(bundle.targets)]) {
    assert.match(asset.url, /\/releases\/download\/v9\.0\.2\//);
    assert.ok(!asset.url.includes('/latest/'));
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(asset.bytes > 0);
  }
  assert.match(bundle.source.file, /corresponding-source\.tar\.xz$/);
});

test('cache verification rejects corrupt or truncated archives before extraction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gleech-ffmpeg-cache-'));
  const path = join(directory, 'archive.zip');
  const asset = {
    file: 'archive.zip',
    bytes: 4,
    sha256: createHash('sha256').update('good').digest('hex'),
  };
  await writeFile(path, 'good');
  await verifyAsset(path, asset);
  assert.equal(await fetchAsset(asset, directory), path);
  await writeFile(path, 'evil');
  await assert.rejects(fetchAsset(asset, directory), /SHA256 mismatch/);
  await writeFile(path, '');
  await assert.rejects(verifyAsset(path, asset), /Unexpected size/);
});

test('binary extraction rejects traversal, absolute paths and multiple roots', () => {
  validateArchiveEntries('ffmpeg/\nffmpeg/bin/ffmpeg.exe\nffmpeg/licenses/COPYING\n');
  for (const listing of [
    'ffmpeg/../escape',
    '/escape',
    'C:/escape',
    'ffmpeg/..\\escape',
    'one/bin\ntwo/bin',
    '',
  ])
    assert.throws(() => validateArchiveEntries(listing));
});

test('every electron-builder target prepares and copies the complete verified bundle', async () => {
  const builder = load(await readFile(join(root, 'apps/desktop/electron-builder.yml'), 'utf8'));
  assert.equal(builder.beforePack, 'build/ffmpeg-before-pack.mjs');
  assert.equal(builder.afterPack, 'build/after-pack.mjs');
  assert.ok(
    builder.extraResources.some(
      (entry) => entry.from === 'out/ffmpeg/${os}-${arch}' && entry.to === 'ffmpeg',
    ),
  );
  const hook = await readFile(join(root, 'apps/desktop/build/ffmpeg-before-pack.mjs'), 'utf8');
  assert.match(hook, /prepareFfmpeg/);
  assert.match(hook, /context\.electronPlatformName/);
  assert.match(hook, /Arch\[context\.arch\]/);
  const afterPack = await readFile(join(root, 'apps/desktop/build/after-pack.mjs'), 'utf8');
  assert.match(afterPack, /cliAfterPack\(context\)/);
  assert.match(afterPack, /verifyPrepared/);
  for (const name of ['macos', 'linux']) {
    const workflow = await readFile(join(root, `.github/workflows/${name}.yml`), 'utf8');
    assert.match(workflow, /node tooling\/ffmpeg-package-check\.mjs/);
    assert.match(workflow, /node tooling\/ffmpeg-check\.mjs/);
  }
});
