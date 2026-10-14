import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import './native-attribution-check.mjs';
import './native-source-review-check.mjs';

const root = resolve(import.meta.dirname, '..');
const [appPath, bundlePath, ...extra] = process.argv.slice(2);
assert.ok(
  appPath && !extra.length,
  'Usage: native-release-check.mjs <unpacked-app> [source-bundle]',
);
const app = resolve(appPath);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(
  await readFile(resolve(root, 'LICENSES/img-sharp-win32-x64/0.35.5/native-binaries.json'), 'utf8'),
);
for (const binary of baseline.binaries) {
  const path = resolve(
    app,
    'resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib',
    binary.file,
  );
  assert.equal(
    sha256(await readFile(path)),
    binary.sha256,
    `Unreviewed native binary: ${binary.file}`,
  );
}
const components = JSON.parse(
  await readFile(resolve(root, 'LICENSES/native-components/inventory.json'), 'utf8'),
);
const runtime = JSON.parse(
  await readFile(resolve(root, 'LICENSES/native-components/runtime-inventory.json'), 'utf8'),
);
const inventory = [...components, ...runtime];
let notices = 0;
for (const component of inventory) {
  for (const notice of component.notices) {
    assert.ok(notice.path.startsWith('LICENSES/'), 'Notice outside license directory.');
    const source = resolve(root, notice.path);
    assert.ok(source.startsWith(resolve(root, 'LICENSES') + sep), 'Notice path escaped directory.');
    assert.equal(
      sha256(await readFile(source)),
      notice.sha256,
      `Changed original notice: ${notice.path}`,
    );
    const packaged = resolve(app, 'resources/licenses', notice.path.slice('LICENSES/'.length));
    assert.equal(
      sha256(await readFile(packaged)),
      notice.sha256,
      `Missing/changed packaged notice: ${notice.path}`,
    );
    notices++;
  }
  if (component.licenseDeclarationFile) {
    assert.ok(
      component.licenseDeclarationFile.startsWith('LICENSES/'),
      'Declaration outside license directory.',
    );
    assert.ok(
      resolve(root, component.licenseDeclarationFile).startsWith(resolve(root, 'LICENSES') + sep),
      'Declaration path escaped directory.',
    );
    const declaration = resolve(
      app,
      'resources/licenses',
      component.licenseDeclarationFile.slice('LICENSES/'.length),
    );
    assert.equal(
      sha256(await readFile(declaration)),
      sha256(await readFile(resolve(root, component.licenseDeclarationFile))),
      `Missing original license declaration: ${component.component}`,
    );
  }
}
let archives = 0;
if (bundlePath) {
  const bundle = resolve(bundlePath);
  const manifest = JSON.parse(await readFile(resolve(bundle, 'manifest.json'), 'utf8'));
  const rust = JSON.parse(await readFile(resolve(bundle, 'rust-source-manifest.json'), 'utf8'));
  const toolchain = JSON.parse(
    await readFile(resolve(bundle, 'toolchain-source-manifest.json'), 'utf8'),
  );
  assert.deepEqual(
    toolchain,
    JSON.parse(
      await readFile(
        resolve(root, 'LICENSES/native-components/toolchain-source-manifest.json'),
        'utf8',
      ),
    ),
    'Source bundle uses an unreviewed toolchain manifest.',
  );
  assert.equal(manifest.complete, true, 'Native source collection incomplete.');
  assert.equal(rust.complete, true, 'Rust source collection incomplete.');
  for (const [directory, entries] of [
    ['archives', [...manifest.repositoryArchives, ...manifest.components]],
    ['rust-crates', rust.crates],
    ['toolchain-archives', toolchain.archives],
  ]) {
    for (const entry of entries) {
      assert.ok(
        !entry.file.includes('/') && !entry.file.includes('\\'),
        'Unsafe archive filename.',
      );
      const bytes = await readFile(resolve(bundle, directory, entry.file));
      assert.equal(sha256(bytes), entry.sha256, `Changed source archive: ${entry.file}`);
      archives++;
    }
  }
}
console.log(
  `Native release material checks passed: ${baseline.binaries.length} pinned binaries; ${notices} notice files${archives ? `; ${archives} source/build archives` : ''}.`,
);
console.log(
  'Rebuild compatibility evidence and original source-package notice omissions are documented separately. Publication requires the reviewed source attachments and exact-release checks.',
);
