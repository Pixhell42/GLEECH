import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { collectMacNativeNotices } from './mac-native-review.mjs';

assert.equal(process.platform, 'darwin', 'Create Mac packages on a native macOS runner.');
assert.ok(['arm64', 'x64'].includes(process.arch), 'Unsupported Mac architecture.');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/desktop/package.json'));
const output = resolve(root, 'apps/desktop/out/mac-native-notices');
// Only this generated directory is replaced; source notices remain untouched.
assert.equal(relative(root, output).replaceAll('\\', '/'), 'apps/desktop/out/mac-native-notices');
await rm(output, { recursive: true, force: true });
const result = await collectMacNativeNotices({
  arch: process.arch,
  output,
  resolvePackage: (name) =>
    dirname(require.resolve(`${name}/${name.startsWith('@img/') ? 'package' : 'package.json'}`)),
});
console.log(
  `Original native Mac notices collected for ${process.arch}: ${result.packages.map((p) => p.installedAs).join(', ')}.`,
);
