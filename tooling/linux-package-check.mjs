import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

assert.equal(process.argv.length, 2, 'linux-package-check.mjs accepts no arguments.');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
const root = resolve(import.meta.dirname, '..');
const app = resolve(root, 'apps/desktop/release/linux-unpacked');
const resources = resolve(app, 'resources');
const executable = resolve(app, 'gleech-bin');
assert.match(await readFile(resolve(app, 'gleech'), 'utf8'), /gleech-bin/);
assert.match(execFileSync('readelf', ['-h', executable], { encoding: 'utf8' }), /X86-64/);
const metadata = JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8'));
const noticeRoot = resolve(resources, 'linux-native-notices');
const notices = JSON.parse(await readFile(resolve(noticeRoot, 'inventory.json'), 'utf8'));
assert.equal(notices.arch, 'x64');
assert.deepEqual(
  notices.packages.map((entry) => entry.installedAs),
  ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64', 'onnxruntime-node'],
);
for (const entry of notices.packages) {
  for (const file of entry.files) {
    const bytes = await readFile(resolve(noticeRoot, entry.installedAs, file.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  for (const file of entry.retainedFiles ?? []) {
    assert.ok(file.file.startsWith('LICENSES/'));
    const bytes = await readFile(
      resolve(resources, 'licenses', file.file.slice('LICENSES/'.length)),
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
}
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const entries = asar
  .listPackage(resolve(resources, 'app.asar'))
  .map((p) => p.replaceAll('\\', '/'));
assert.ok(!entries.some((p) => p.includes('onnxruntime-node-macos-x64/')));
assert.ok(!entries.some((p) => /onnxruntime-node\/bin\/napi-v6\/(?:win32|darwin)\//.test(p)));
assert.ok(!entries.some((p) => p.includes('onnxruntime-node/bin/napi-v6/linux/arm64/')));
const nativeProbe = `
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const req = createRequire(process.argv[1]);
(async () => {
 const sharp = req('sharp');
 const output = await sharp({create:{width:8,height:8,channels:4,background:'#e3b641'}}).png().toBuffer();
 assert.equal((await sharp(output).metadata()).width,8);
 const ort = req('onnxruntime-node');
 const session = await ort.InferenceSession.create(process.argv[2],{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1});
 const result = await session.run({[session.inputNames[0]]:new ort.Tensor('float32',new Float32Array(3*320*320),[1,3,320,320])});
 assert.equal(result[session.outputNames[0]].data.length,320*320);
 await session.release();
 console.log('Packaged Linux Sharp and ONNX inference passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
`;
process.stdout.write(
  execFileSync(
    executable,
    [
      '-e',
      nativeProbe,
      resolve(resources, 'app.asar/package.json'),
      resolve(resources, 'models/u2netp.onnx'),
    ],
    { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 120000 },
  ),
);
const archiveName = `GLEECH-${metadata.version}-linux-x86_64.AppImage`;
const archive = resolve(root, 'apps/desktop/release', archiveName);
assert.match(execFileSync('readelf', ['-h', archive], { encoding: 'utf8' }), /X86-64/);
assert.ok((await stat(archive)).mode & 0o100);
const hash = createHash('sha256');
for await (const chunk of createReadStream(archive)) hash.update(chunk);
const sha256 = hash.digest('hex');
const report = {
  version: metadata.version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: 'linux',
  arch: 'x64',
  archive: archiveName,
  sha256,
  experimental: true,
  signed: false,
  verified: [
    'native executable architecture',
    'original native notices',
    'packaged Sharp',
    'packaged CPU subject inference',
    'platform binary exclusions',
  ],
  nativePackages: notices.packages.map(({ installedAs, name, version, license }) => ({
    installedAs,
    name,
    version,
    license,
  })),
};
await writeFile(
  resolve(root, 'apps/desktop/release/linux-build-x64.json'),
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile(
  resolve(root, 'apps/desktop/release/SHA256SUMS-linux-x64.txt'),
  `${sha256}  ${archiveName}\n`,
);
console.log(`Linux x64 alpha package checks passed: ${archiveName}.`);
