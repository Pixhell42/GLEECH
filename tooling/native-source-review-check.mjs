import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'LICENSES/native-components');
const load = async (name) => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
const manifest = await load('toolchain-source-manifest.json');
const runtime = await load('runtime-inventory.json');
const rebuild = await load('rebuild-review.json');
assert.equal(manifest.complete, true);
assert.equal(manifest.archives.length, 14);
assert.equal(new Set(manifest.archives.map((entry) => entry.file)).size, 14);
assert.equal(runtime.length, 5);
assert.equal(rebuild.status, 'passed');
for (const entry of manifest.archives) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  assert.ok(entry.bytes > 0 && !/[\\/]/.test(entry.file));
  assert.equal(new URL(entry.url).protocol, 'https:');
}
let count = 0;
for (const component of runtime) {
  if (['llvm', 'rust', 'mingw-w64'].includes(component.component)) {
    const source = manifest.archives.find((entry) => entry.component === component.component);
    assert.ok(source);
    assert.equal(component.sourceSHA256, source.sha256);
    assert.equal(component.sourceArchive, source.file);
    assert.equal(source.role, 'runtime-source-and-build-tool');
  }
  assert.ok(component.notices.length, `No notices for ${component.component}`);
  for (const notice of component.notices) {
    assert.ok(notice.path.startsWith('LICENSES/native-components/'));
    const path = resolve(root, notice.path);
    assert.ok(path.startsWith(directory + sep), 'Notice escaped license directory.');
    const bytes = await readFile(path);
    assert.equal(bytes.length, notice.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), notice.sha256, notice.path);
    count++;
  }
}
console.log(
  `Native source review verified: 14 toolchain archives recorded; ${count} original/supplemental runtime notices.`,
);
