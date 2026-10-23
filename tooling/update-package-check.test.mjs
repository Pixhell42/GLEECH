import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { verifyUpdatePackage } from './update-package-check.mjs';

const folders = [];
const output = resolve('test-results');
afterEach(async () => {
  for (const path of folders.splice(0)) {
    assert.ok(path.startsWith(join(output, 'update-package-test-')));
    await rm(path, { recursive: true, force: true });
  }
});

async function fixture() {
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(join(output, 'update-package-test-'));
  folders.push(root);
  const resources = join(root, 'resources');
  const release = join(root, 'release');
  await mkdir(resources);
  await mkdir(release);
  const { version } = JSON.parse(await readFile('apps/desktop/package.json', 'utf8'));
  const platform =
    process.platform === 'darwin' ? '-mac' : process.platform === 'linux' ? '-linux' : '';
  const suffix =
    process.platform === 'darwin'
      ? `mac-${process.arch}.zip`
      : process.platform === 'linux'
        ? `linux-${process.arch === 'x64' ? 'x86_64' : process.arch}.AppImage`
        : `${process.arch}-setup.exe`;
  const asset = `GLEECH-${version}-${suffix}`;
  const bytes = Buffer.from('verified package fixture');
  const manifest = {
    version,
    files: [
      {
        url: asset,
        size: bytes.length,
        sha512: createHash('sha512').update(bytes).digest('base64'),
      },
    ],
  };
  const manifestPath = join(release, `latest-${process.arch}${platform}.yml`);
  await writeFile(
    join(resources, 'app-update.yml'),
    JSON.stringify({
      provider: 'github',
      owner: 'Pixhell42',
      repo: 'GLEECH',
      channel: `latest-${process.arch}`,
    }),
  );
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(release, asset), bytes);
  return { resources, release, asset, bytes, manifest, manifestPath };
}

test('verifies workspace artifacts against the exact expected asset and SHA512', async () => {
  const f = await fixture();
  assert.equal((await verifyUpdatePackage(f.resources, f.release)).sha512Verified, true);
  await writeFile(join(f.release, f.asset), Buffer.alloc(f.bytes.length));
  await assert.rejects(verifyUpdatePackage(f.resources, f.release), /Expected values/);
});

test('refuses directories outside the workspace', async () => {
  const f = await fixture();
  await assert.rejects(verifyUpdatePackage(tmpdir(), f.release), /inside this workspace/);
  await assert.rejects(verifyUpdatePackage(f.resources, tmpdir()), /inside this workspace/);
});

test('rejects manifest paths before reading the archive', async () => {
  const f = await fixture();
  for (const url of ['../outside.AppImage', '/outside.AppImage', '..\\outside.exe']) {
    f.manifest.files[0].url = url;
    await writeFile(f.manifestPath, JSON.stringify(f.manifest));
    await assert.rejects(verifyUpdatePackage(f.resources, f.release), /Expected values/);
  }
});

test(
  'refuses an archive symlink outside its artifact directory',
  { skip: process.platform === 'win32' },
  async () => {
    const f = await fixture();
    const outside = await fixture();
    const path = join(f.release, f.asset);
    await rm(path);
    await symlink(join(outside.release, outside.asset), path);
    await assert.rejects(
      verifyUpdatePackage(f.resources, f.release),
      /outside its artifact directory/,
    );
  },
);
