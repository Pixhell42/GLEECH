import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const sourceCommit = 'fedfad51acc2860b2916a1eef32ba4a500ff31ef';
const sourceSHA256 = 'e27ea3c837e9c660e1a9a2993b673ae93bbb53077330efba8654031e302d4e8e';
const inputs = join(root, 'apps/desktop/build/appimage-runtime');
const staging = join(root, 'test-results/appimage-runtime');
const digest = async (path) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const command = (file, args, cwd) =>
  new Promise((accept, reject) => {
    const child = spawn(file, args, { cwd, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? accept() : reject(new Error(`${file} exited with ${code}`)),
    );
  });

export async function prepareAppImageRuntime() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const files = [
    'Dockerfile',
    'build.sh',
    'relink.sh',
    'extraction-before.txt',
    'extraction-after.txt',
    'cleanup-before.txt',
    'cleanup-after.txt',
  ];
  const inputHashes = Object.fromEntries(
    await Promise.all(files.map(async (f) => [f, await digest(join(inputs, f))])),
  );
  inputHashes.prepare = await digest(fileURLToPath(import.meta.url));
  for (const file of ['musl-COPYRIGHT.txt', 'zlib-LICENSE.txt', 'zstd-BSD.txt', 'mimalloc-MIT.txt'])
    inputHashes['license/' + file] = await digest(join(root, 'LICENSES/appimage-runtime', file));
  const output = join(
    staging,
    createHash('sha256').update(JSON.stringify(inputHashes)).digest('hex'),
  );
  const runtime = join(output, 'runtime-x64');
  const recordPath = join(output, 'provenance.json');
  let record;
  try {
    record = JSON.parse(await readFile(recordPath, 'utf8'));
    assert.deepEqual(record.inputHashes, inputHashes);
    assert.equal(record.sourceCommit, sourceCommit);
    assert.equal(await digest(runtime), record.runtimeSHA256);
    assert.equal(await digest(join(output, 'source-and-relink.tar.gz')), record.relinkSHA256);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    record = undefined;
  }
  if (!record) {
    await mkdir(staging, { recursive: true });
    const archive = join(staging, 'upstream.tar.gz');
    try {
      await access(archive);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const response = await fetch(
        `https://codeload.github.com/AppImage/type2-runtime/tar.gz/${sourceCommit}`,
        { signal: AbortSignal.timeout(120000) },
      );
      assert.equal(response.status, 200);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }));
    }
    assert.equal(await digest(archive), sourceSHA256);
    const source = join(staging, 'source-' + Object.values(inputHashes).join('').slice(0, 24));
    await mkdir(source, { recursive: true });
    await command('tar', ['-xzf', archive, '--strip-components=1', '-C', source], root);
    const sourceFile = join(source, 'src/runtime/runtime.c');
    let patched = await readFile(sourceFile, 'utf8');
    for (const change of ['extraction', 'cleanup']) {
      const before = await readFile(join(inputs, change + '-before.txt'), 'utf8');
      const after = await readFile(join(inputs, change + '-after.txt'), 'utf8');
      assert.equal(
        patched.split(before).length,
        2,
        'The reviewed runtime patch must match once: ' + change,
      );
      patched = patched.replace(before, after);
    }
    await writeFile(sourceFile, patched);
    const dependencies = join(source, 'scripts/common/install-dependencies.sh');
    const installer = await readFile(dependencies, 'utf8');
    assert.ok(installer.includes('    rm -rf "$tmpdir"'));
    await writeFile(
      dependencies,
      installer.replace(
        '    rm -rf "$tmpdir"',
        '    mkdir -p /source-archives\n    cp -a "$tmpdir"/. /source-archives/\n    rm -rf "$tmpdir"',
      ),
    );
    await copyFile(join(inputs, 'Dockerfile'), join(source, 'Dockerfile'));
    await copyFile(join(inputs, 'build.sh'), join(source, 'gleech-build.sh'));
    await copyFile(join(inputs, 'relink.sh'), join(source, 'gleech-relink.sh'));
    await cp(join(root, 'LICENSES/appimage-runtime'), join(source, 'gleech-notices'), {
      recursive: true,
    });
    await command('docker', ['build', '--output', `type=local,dest=${output}`, source], root);
    record = {
      sourceCommit,
      sourceSHA256,
      inputHashes,
      runtimeSHA256: await digest(runtime),
      relinkSHA256: await digest(join(output, 'source-and-relink.tar.gz')),
      extraction: 'mkdtemp-per-invocation',
      toolset: '1.0.3',
    };
    await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
  }
  const require = createRequire(join(root, 'apps/desktop/package.json'));
  const toolset = join(output, 'tools');
  try {
    await access(join(toolset, 'mksquashfs'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const saved = process.env.APPIMAGE_TOOLS_PATH;
    delete process.env.APPIMAGE_TOOLS_PATH;
    const tools = await require('app-builder-lib/out/toolsets/linux.js').getAppImageTools(
      '1.0.3',
      require('builder-util').Arch.x64,
    );
    if (saved !== undefined) process.env.APPIMAGE_TOOLS_PATH = saved;
    await cp(dirname(dirname(tools.runtime)), toolset, { recursive: true });
  }
  await copyFile(runtime, join(toolset, 'runtimes/runtime-x64'));
  await chmod(join(toolset, 'runtimes/runtime-x64'), 0o755);
  process.env.APPIMAGE_TOOLS_PATH = toolset;
  const notices = join(root, 'apps/desktop/out/appimage-runtime-notices');
  await mkdir(notices, { recursive: true });
  await cp(join(output, 'licenses'), join(notices, 'licenses'), { recursive: true });
  for (const f of ['source-and-relink.tar.gz', 'build-packages.txt', 'provenance.json'])
    await copyFile(join(output, f), join(notices, f));
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await prepareAppImageRuntime()));
