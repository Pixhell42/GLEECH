import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const workspace = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
function workspaceDirectory(argument) {
  const path = realpathSync(resolve(argument));
  if (path === workspace) return workspace;
  if (!path.startsWith(`${workspace}${sep}`))
    throw new Error('Package verification only reads build artifacts inside this workspace.');
  return path;
}
function packageFile(folder, name) {
  const path = realpathSync(resolve(folder, name));
  if (!path.startsWith(`${folder}${sep}`))
    throw new Error('The package file is outside its artifact directory.');
  return path;
}

export async function verifyUpdatePackage(resourcesArgument, releaseArgument) {
  assert.ok(
    resourcesArgument && releaseArgument,
    'Usage: node tooling/update-package-check.mjs <resources> <release-directory>',
  );
  const resources = workspaceDirectory(resourcesArgument);
  const releaseDirectory = workspaceDirectory(releaseArgument);
  const version = JSON.parse(
    await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
  ).version;
  const config = load(await readFile(packageFile(resources, 'app-update.yml'), 'utf8'));
  assert.equal(config.provider, 'github');
  assert.equal(config.owner, 'Pixhell42');
  assert.equal(config.repo, 'GLEECH');
  assert.equal(config.channel, `latest-${process.arch}`);
  const platform =
    process.platform === 'darwin' ? '-mac' : process.platform === 'linux' ? '-linux' : '';
  const manifestName = `latest-${process.arch}${platform}.yml`;
  const manifest = load(await readFile(packageFile(releaseDirectory, manifestName), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.files.length, 1);
  const file = manifest.files[0];
  const suffix =
    process.platform === 'darwin'
      ? `mac-${process.arch}.zip`
      : process.platform === 'linux'
        ? `linux-${process.arch === 'x64' ? 'x86_64' : process.arch}.AppImage`
        : `${process.arch}-setup.exe`;
  const asset = `GLEECH-${version}-${suffix}`;
  assert.equal(file.url, asset);
  const path = packageFile(releaseDirectory, asset);
  const info = await stat(path);
  assert.ok(info.isFile(), 'The update archive must be a regular file.');
  assert.equal(info.size, file.size);
  const hash = createHash('sha512');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  assert.equal(hash.digest('base64'), file.sha512);
  return {
    version,
    manifest: manifestName,
    archive: asset,
    sha512Verified: true,
    automaticPublishing: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await verifyUpdatePackage(...process.argv.slice(2))));
