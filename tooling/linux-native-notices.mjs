import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { collectNativeNotices } from './mac-native-review.mjs';

assert.equal(process.platform, 'linux', 'Create Linux packages on a native Linux runner.');
assert.equal(process.arch, 'x64', 'Only Linux x64 is currently supported.');
assert.equal(process.argv.length, 2, 'No arguments accepted.');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(resolve(root, 'apps/desktop/package.json'));
const output = resolve(root, 'apps/desktop/out/linux-native-notices');
assert.equal(relative(root, output).replaceAll('\\', '/'), 'apps/desktop/out/linux-native-notices');
await rm(output, { recursive: true, force: true });
const result = await collectNativeNotices({
  platform: 'linux',
  arch: 'x64',
  output,
  resolvePackage: (name) =>
    dirname(require.resolve(`${name}/${name.startsWith('@img/') ? 'package' : 'package.json'}`)),
});
console.log(`Original Linux native notices collected: ${result.packages.length} packages.`);
