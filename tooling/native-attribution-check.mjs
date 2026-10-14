import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const review = JSON.parse(
  await readFile(resolve(root, 'LICENSES/native-components/eight-package-review.json'), 'utf8'),
);
const inventory = JSON.parse(
  await readFile(resolve(root, 'LICENSES/native-components/inventory.json'), 'utf8'),
);
const versions = JSON.parse(
  await readFile(resolve(root, 'LICENSES/img-sharp-win32-x64/0.35.5/versions.json'), 'utf8'),
);
assert.equal(versions.rsvg, '2.63.2', 'Recheck attribution for the new librsvg version.');
assert.equal(review.target, 'x86_64-pc-windows-gnullvm');
assert.equal(review.packages.length, 8);
assert.equal(new Set(review.packages.map((entry) => entry.name)).size, 8);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const evidence of review.evidence) {
  const file = resolve(root, evidence.file);
  assert.ok(file.startsWith(resolve(root, 'LICENSES/native-components/target-review') + sep));
  assert.equal(sha256(await readFile(file)), evidence.sha256, `Changed evidence: ${evidence.file}`);
}
const tree = await readFile(
  resolve(root, 'LICENSES/native-components/target-review/windows-library.txt'),
  'utf8',
);
const graph = new Map(
  [...tree.matchAll(/^([\w-]+) v([^\s]+)/gm)].map((match) => [match[1], match[2]]),
);
for (const entry of review.packages) {
  const source = inventory.find(
    (component) => component.rust && component.component === entry.name,
  );
  assert.ok(source, `Missing reviewed package: ${entry.name}`);
  assert.equal(source.version, entry.version);
  assert.equal(source.sourceSHA256, entry.sourceSHA256, `Changed source: ${entry.name}`);
  assert.equal(entry.includedInResolvedWindowsGraph, graph.has(entry.name));
  assert.equal(entry.includedInResolvedWindowsGraph, entry.name === 'selectors');
  for (const notice of source.notices) {
    const file = resolve(root, notice.path);
    assert.ok(file.startsWith(resolve(root, 'LICENSES') + sep));
    assert.equal(sha256(await readFile(file)), notice.sha256, `Changed notice: ${notice.path}`);
  }
}
console.log('Eight-package attribution evidence verified: seven excluded, selectors included.');
console.log(
  'Source-graph evidence does not replace independent compilation and DLL compatibility tests.',
);
