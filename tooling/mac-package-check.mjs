import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { macBuildTarget } from './mac-native-review.mjs';

assert.equal(
  process.argv.length,
  2,
  'mac-package-check.mjs uses fixed native build outputs; no arguments accepted.',
);
assert.equal(process.platform, 'darwin');
const target = macBuildTarget(process.arch);
const { arch } = target;
const root = resolve(import.meta.dirname, '..');
const app = resolve(root, 'apps/desktop/release', target.app);
const resources = resolve(app, 'Contents/Resources');
const executable = resolve(app, 'Contents/MacOS/GLEECH');
const machoArch = arch === 'x64' ? 'x86_64' : 'arm64';
const binaryArch = (path) => execFileSync('lipo', ['-archs', path], { encoding: 'utf8' }).trim();
assert.equal(binaryArch(executable), machoArch, 'Wrong executable architecture.');
const metadata = JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8'));
const plist = (key) =>
  execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', resolve(app, 'Contents/Info.plist')], {
    encoding: 'utf8',
  }).trim();
assert.equal(plist('CFBundleIdentifier'), 'com.gleech.desktop');
assert.equal(plist('CFBundleShortVersionString'), metadata.version);
const noticeRoot = resolve(resources, 'mac-native-notices');
const notices = JSON.parse(await readFile(resolve(noticeRoot, 'inventory.json'), 'utf8'));
assert.equal(notices.arch, arch);
for (const entry of notices.packages) {
  for (const file of entry.files) {
    const bytes = await readFile(resolve(noticeRoot, entry.installedAs, file.file));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      file.sha256,
      `Missing/changed original notice: ${entry.installedAs}/${file.file}`,
    );
  }
  for (const file of entry.retainedFiles ?? []) {
    assert.ok(file.file.startsWith('LICENSES/'));
    const bytes = await readFile(
      resolve(resources, 'licenses', file.file.slice('LICENSES/'.length)),
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      file.sha256,
      `Missing/changed retained upstream notice: ${file.file}`,
    );
  }
}
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const packaged = asar
  .listPackage(resolve(resources, 'app.asar'))
  .map((p) => p.replaceAll('\\', '/'));
assert.ok(
  !packaged.some((p) => /onnxruntime-node(?:-macos-x64)?\/bin\/napi-v6\/(?:win32|linux)\//.test(p)),
  'Other-platform ONNX binaries leaked into the Mac package.',
);
const nativeProbe = `
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const requireApp = createRequire(process.argv[1]);
const sharp = requireApp('sharp');
(async () => {
 const output = await sharp({create:{width:8,height:8,channels:4,background:'#e3b641'}}).png().toBuffer();
 assert.equal((await sharp(output).metadata()).width,8);
 const intel=process.arch==='x64';
 const ort=requireApp(intel?'onnxruntime-node-macos-x64':'onnxruntime-node');
 const model=process.argv[2];
 const session=await ort.InferenceSession.create(model,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1});
 const result=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',new Float32Array(3*320*320),[1,3,320,320])});
 assert.equal(result[session.outputNames[0]].data.length,320*320);
 console.log('Packaged Sharp and ONNX inference passed on '+process.arch+'.');
 await session.release();
})().catch(error=>{console.error(error);process.exitCode=1;});
`;
const probe = execFileSync(
  executable,
  [
    '-e',
    nativeProbe,
    resolve(resources, 'app.asar/package.json'),
    resolve(resources, 'models/u2netp.onnx'),
  ],
  { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 120000 },
);
process.stdout.write(probe);
const archiveName = `GLEECH-${metadata.version}-mac-${arch}.zip`;
const archive = resolve(root, 'apps/desktop/release', archiveName);
execFileSync('unzip', ['-tqq', archive]);
const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
const report = {
  version: metadata.version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: 'darwin',
  arch,
  archive: archiveName,
  sha256,
  experimental: true,
  signed: false,
  notarized: false,
  verified: [
    'native executable architecture',
    'original native notices',
    'packaged Sharp',
    'packaged CPU subject inference',
    'ZIP integrity',
  ],
  nativePackages: notices.packages.map(({ installedAs, name, version, license }) => ({
    installedAs,
    name,
    version,
    license,
  })),
};
await writeFile(
  resolve(root, 'apps/desktop/release', target.report),
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile(
  resolve(root, 'apps/desktop/release', target.checksum),
  `${sha256}  ${archiveName}\n`,
);
console.log(`Mac ${arch} alpha package checks passed: ${archiveName}.`);
