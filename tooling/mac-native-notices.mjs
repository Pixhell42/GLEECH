import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

assert.equal(process.platform, 'darwin', 'Create Mac packages on a native macOS runner.');
assert.ok(['arm64', 'x64'].includes(process.arch), 'Unsupported Mac architecture.');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/desktop/package.json'));
const output = resolve(root, 'apps/desktop/out/mac-native-notices');
// Only this generated directory is replaced; source notices remain untouched.
assert.equal(relative(root, output).replaceAll('\\', '/'), 'apps/desktop/out/mac-native-notices');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const packages = [
  `@img/sharp-darwin-${process.arch}`,
  `@img/sharp-libvips-darwin-${process.arch}`,
  process.arch === 'x64' ? 'onnxruntime-node-macos-x64' : 'onnxruntime-node',
];
const inventory = [];
for (const name of packages) {
  const metadataPath = require.resolve(
    `${name}/${name.startsWith('@img/') ? 'package' : 'package.json'}`,
  );
  const packageRoot = dirname(metadataPath);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const files = [];
  async function collect(folder, inNoticeDirectory = false) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const source = resolve(folder, entry.name);
      const noticeName = /^(?:licen[sc]e|copying|notice|third[-_ ]?party)/i.test(entry.name);
      if (entry.isDirectory()) await collect(source, inNoticeDirectory || noticeName);
      else if (
        entry.isFile() &&
        (inNoticeDirectory || noticeName || entry.name === 'versions.json')
      ) {
        const file = relative(packageRoot, source).replaceAll('\\', '/');
        const bytes = await readFile(source);
        const target = resolve(output, name, file);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
        files.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  await collect(packageRoot);
  assert.ok(
    files.some(({ file }) => /licen[sc]e/i.test(file)),
    `No original license for ${name}.`,
  );
  inventory.push({
    installedAs: name,
    name: metadata.name,
    version: metadata.version,
    license: metadata.license,
    repository: metadata.repository,
    files: files.sort((a, b) => a.file.localeCompare(b.file)),
  });
}
await writeFile(
  resolve(output, 'inventory.json'),
  JSON.stringify({ arch: process.arch, packages: inventory }, null, 2) + '\n',
);
console.log(`Original native Mac notices collected for ${process.arch}: ${packages.join(', ')}.`);
