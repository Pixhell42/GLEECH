import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const load = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const manifest = await load('assets/asset-inventory.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reviewed = new Map(manifest.files.map((file) => [file.path, file]));
assert.equal(reviewed.size, manifest.files.length, 'Duplicate asset records.');
assert.equal(manifest.schemaVersion, 1);
const groups = new Set(manifest.groups.map((group) => group.id));
for (const entry of manifest.files) {
  const path = resolve(root, entry.path);
  assert.ok(path.startsWith(root + sep), 'Asset path escaped source directory.');
  assert.ok(groups.has(entry.group), 'Asset has no reviewed provenance group.');
  const bytes = await readFile(path);
  assert.equal(bytes.length, entry.bytes, `Changed asset size: ${entry.path}`);
  assert.equal(hash(bytes), entry.sha256, `Changed asset: ${entry.path}`);
}
const paths = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);
const media =
  /\.(png|jpe?g|webp|svg|ico|onnx|woff2?|ttf|otf|mp4|gif|gleech-shader|wgsl|glsl|isf)$/i;
for (const path of paths.filter((path) => media.test(path))) {
  assert.ok(reviewed.has(path), `Unreviewed media: ${path}`);
  assert.ok(!/\.(woff2?|ttf|otf|mp4)$/i.test(path), `Recheck bundled font/video rights: ${path}`);
}
const maps = new Set();
for (const kind of ['depth', 'vector']) {
  const directory = `apps/desktop/resources/${kind}-maps`;
  const catalog = await load(`${directory}/catalog.json`);
  assert.ok(reviewed.has(`${directory}/catalog.json`));
  for (const entry of catalog.maps) {
    const record = reviewed.get(`${directory}/${entry.id}.png`);
    assert.ok(record, `Map missing from reviewed inventory: ${entry.id}`);
    assert.equal(record.sha256, entry.sha256, `Changed map catalog hash: ${entry.id}`);
    maps.add(record.sha256);
  }
}
let embedded = 0;
function visit(value) {
  if (Array.isArray(value)) value.forEach(visit);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'png') {
        assert.ok(typeof child === 'string' && child.startsWith('data:image/png;base64,'));
        assert.ok(
          maps.has(hash(Buffer.from(child.slice(child.indexOf(',') + 1), 'base64'))),
          'Preset embeds an unreviewed image.',
        );
        embedded++;
      }
      if (key === 'fontSource') assert.equal(child, 'builtin', 'Preset embeds an installed font.');
      assert.ok(
        !['shaderPackage', 'importedShader', 'installedFont'].includes(key),
        'Recheck new embedded preset assets.',
      );
      visit(child);
    }
  }
}
visit(await load('apps/desktop/resources/presets/built-in.json'));
assert.equal(embedded, manifest.reviewedEmbeddedPresetMaps);
const shader = await load('apps/desktop/resources/shaders/prism-weave.gleech-shader');
assert.equal(shader.license.expression, 'MIT');
assert.deepEqual(
  shader.authors.map((author) => author.name),
  ['GLEECH'],
);
console.log(
  `Asset review verified: ${reviewed.size} media/catalog records; ${embedded} embedded preset maps match original sources.`,
);
