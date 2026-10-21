import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
export const bundle = JSON.parse(await readFile(join(root, 'LICENSES/ffmpeg/bundle.json'), 'utf8'));

export async function fileSha256(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

export async function verifyAsset(path, asset) {
  assert.equal((await stat(path)).size, asset.bytes, `Unexpected size: ${asset.file}`);
  assert.equal(await fileSha256(path), asset.sha256, `SHA256 mismatch: ${asset.file}`);
}

export async function fetchAsset(asset, cache) {
  const destination = join(cache, asset.file);
  try {
    await verifyAsset(destination, asset);
    return destination;
  } catch (error) {
    // A corrupt cache is an error, not permission to silently replace an input.
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(cache, { recursive: true });
  const temporary = `${destination}.${randomUUID()}.partial`;
  try {
    console.log(`Downloading pinned FFmpeg input: ${asset.file}`);
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    assert.ok(response.ok && response.body, `Download failed (${response.status}): ${asset.url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
    await verifyAsset(temporary, asset);
    await copyFile(temporary, destination);
    return destination;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export function validateArchiveEntries(listing) {
  const names = listing.trim().split(/\r?\n/);
  const roots = new Set();
  for (const name of names) {
    assert.ok(name && !/^[\\/]|[\\:]|(^|\/)\.\.(\/|$)/.test(name), `Unsafe archive entry: ${name}`);
    roots.add(name.split('/')[0]);
  }
  assert.equal(roots.size, 1, 'FFmpeg archive must have exactly one root directory.');
}

export async function verifyPayload(directory, target) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.ffmpeg.version, bundle.version);
  assert.equal(manifest.licensing.gpl, true);
  assert.equal(manifest.licensing.nonfree, false);
  assert.equal(manifest.provenance.corresponding_source, bundle.source.file);
  assert.equal(
    await fileSha256(join(directory, 'licenses/versions.lock')),
    manifest.provenance.versions_lock_sha256,
  );
  const expectedOs = { win32: 'windows', darwin: 'macos', linux: 'linux' }[target.split('-')[0]];
  assert.equal(manifest.platform.os, expectedOs);
  assert.equal(manifest.platform.arch, target.endsWith('-x64') ? 'x86_64' : 'arm64');
  assert.ok(
    Object.keys(manifest.artifacts_sha256).length >= 2,
    'Missing FFmpeg runtime inventory.',
  );
  for (const [path, hash] of Object.entries(manifest.artifacts_sha256)) {
    assert.ok(
      /^(bin|lib)\//.test(path) && !path.includes('..') && !/[\\:]/.test(path),
      `Unsafe runtime path: ${path}`,
    );
    assert.equal(await fileSha256(join(directory, path)), hash, `Changed runtime: ${path}`);
  }
  for (const name of [
    'ffmpeg/COPYING.GPLv2',
    'ffmpeg/LICENSE.md',
    'x264/COPYING',
    'x265/COPYING',
    'LICENSING.md',
  ])
    assert.ok((await stat(join(directory, 'licenses', name))).size > 0, `Missing notice: ${name}`);
  const configure = await readFile(
    join(directory, 'share/tas-ffmpeg/configure-command.txt'),
    'utf8',
  );
  for (const flag of ['--enable-gpl', '--enable-libx264', '--enable-libx265', '--enable-libwebp'])
    assert.ok(configure.includes(flag), `Missing FFmpeg capability: ${flag}`);
  assert.ok(
    !/(?:^|\s)--enable-nonfree(?:\s|$)/.test(configure),
    'Nonfree FFmpeg is not redistributable.',
  );
  return manifest;
}

export async function verifyPrepared(directory, target) {
  const record = JSON.parse(await readFile(join(directory, 'GLEECH-FFMPEG.json'), 'utf8'));
  assert.deepEqual(record.pin, bundle);
  assert.equal(record.target, target);
  for (const [path, hash] of Object.entries(record.files)) {
    assert.ok(
      !path.startsWith('/') && !/[\\:]|(^|\/)\.\.(\/|$)/.test(path),
      'Unsafe prepared path.',
    );
    assert.equal(
      await fileSha256(join(directory, path)),
      hash,
      `Changed packaged FFmpeg file: ${path}`,
    );
  }
  await verifyAsset(join(directory, 'sources', bundle.source.file), bundle.source);
  await verifyPayload(directory, target);
}

export async function prepareFfmpeg(target = `${process.platform}-${process.arch}`) {
  const asset = bundle.targets[target];
  assert.ok(asset, `No pinned GPL FFmpeg build for ${target}.`);
  const builderOs = { win32: 'win', darwin: 'mac', linux: 'linux' }[target.split('-')[0]];
  const outputRoot = join(root, 'apps/desktop/out/ffmpeg');
  const destination = join(outputRoot, `${builderOs}-${target.split('-')[1]}`);
  try {
    await verifyPrepared(destination, target);
    console.log(`Verified bundled GPL FFmpeg ${bundle.version} for ${target}.`);
    return destination;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const cache = join(root, 'public-release/ffmpeg-cache');
  const binaryArchive = await fetchAsset(asset, cache);
  const sourceArchive = await fetchAsset(bundle.source, cache);
  const { stdout } = await run('tar', ['-tf', binaryArchive], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  validateArchiveEntries(stdout);
  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(join(outputRoot, `${target}-`));
  try {
    await run('tar', ['-xf', binaryArchive, '--strip-components=1', '-C', staging], {
      windowsHide: true,
    });
    await verifyPayload(staging, target);
    // Keep all upstream notices, shared libraries and build records unchanged.
    await mkdir(join(staging, 'sources'));
    await copyFile(sourceArchive, join(staging, 'sources', bundle.source.file));
    await cp(join(root, 'LICENSES/ffmpeg/README.md'), join(staging, 'README.GLEECH.md'));
    const files = {};
    for (const entry of await readdir(staging, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const absolute = join(entry.parentPath, entry.name);
      const path = absolute
        .slice(staging.length + 1)
        .split(sep)
        .join('/');
      files[path] = await fileSha256(absolute);
    }
    await writeFile(
      join(staging, 'GLEECH-FFMPEG.json'),
      JSON.stringify({ target, pin: bundle, files }, null, 2) + '\n',
    );
    await verifyPrepared(staging, target);
    // Both paths are derived solely from the fixed, supported target inventory.
    assert.ok(destination.startsWith(outputRoot + sep) && staging.startsWith(outputRoot + sep));
    await rm(destination, { recursive: true, force: true });
    await cp(staging, destination, { recursive: true, verbatimSymlinks: true });
    if (!target.startsWith('win32-')) {
      await chmod(join(destination, 'bin/ffmpeg'), 0o755);
      await chmod(join(destination, 'bin/ffprobe'), 0o755);
    }
    console.log(
      `Prepared GPL FFmpeg ${bundle.version}, notices and complete source for ${target}.`,
    );
    return destination;
  } finally {
    assert.ok(staging.startsWith(outputRoot + sep));
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1, 'Usage: node tooling/prepare-ffmpeg.mjs [platform-arch]');
  await prepareFfmpeg(args[0]);
}
