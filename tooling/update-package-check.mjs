import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { load } from 'js-yaml';

const [resourcesArgument, releaseArgument] = process.argv.slice(2);
assert.ok(
  resourcesArgument && releaseArgument,
  'Usage: node tooling/update-package-check.mjs <resources> <release-directory>',
);
const resources = resolve(resourcesArgument),
  releaseDirectory = resolve(releaseArgument);
const version = JSON.parse(
  await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
).version;
const config = load(await readFile(join(resources, 'app-update.yml'), 'utf8'));
assert.equal(config.provider, 'github');
assert.equal(config.owner, 'Pixhell42');
assert.equal(config.repo, 'GLEECH');
assert.equal(config.channel, `latest-${process.arch}`);
const platform =
  process.platform === 'darwin' ? '-mac' : process.platform === 'linux' ? '-linux' : '';
const manifestName = `latest-${process.arch}${platform}.yml`;
const manifest = load(await readFile(join(releaseDirectory, manifestName), 'utf8'));
assert.equal(manifest.version, version);
assert.equal(manifest.files.length, 1);
const file = manifest.files[0];
const suffix =
  process.platform === 'darwin'
    ? `mac-${process.arch}.zip`
    : process.platform === 'linux'
      ? `linux-${process.arch === 'x64' ? 'x86_64' : process.arch}.AppImage`
      : `${process.arch}-setup.exe`;
assert.equal(file.url, `GLEECH-${version}-${suffix}`);
const path = join(releaseDirectory, file.url);
assert.equal((await stat(path)).size, file.size);
const hash = createHash('sha512');
for await (const bytes of createReadStream(path)) hash.update(bytes);
assert.equal(hash.digest('base64'), file.sha512);
console.log(
  JSON.stringify({
    version,
    manifest: manifestName,
    archive: file.url,
    sha512Verified: true,
    automaticPublishing: false,
  }),
);
