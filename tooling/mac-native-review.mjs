import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

// The Mac libvips npm packages omit original license texts. Reuse retained
// upstream texts only after matching the complete native component version list.
export async function retainedMacLibvipsNotices(versions) {
  const baseline = JSON.parse(
    await readFile(resolve(root, 'LICENSES/img-sharp-win32-x64/0.35.5/versions.json'), 'utf8'),
  );
  assert.deepEqual(
    versions,
    baseline,
    'Mac libvips component versions changed: repeat the original source/notice review.',
  );
  const inventory = JSON.parse(
    await readFile(resolve(root, 'LICENSES/native-components/inventory.json'), 'utf8'),
  );
  const files = new Map();
  const components = [];
  for (const [component, version] of Object.entries(versions)) {
    const entry = inventory.find((row) => row.component === component && row.version === version);
    assert.ok(
      entry && entry.notices.length,
      `No reviewed source notices for ${component} ${version}.`,
    );
    components.push({
      component,
      version,
      sourceArchive: entry.sourceArchive,
      sourceSHA256: entry.sourceSHA256,
    });
    for (const notice of entry.notices) {
      assert.ok(notice.path.startsWith('LICENSES/native-components/'));
      const bytes = await readFile(resolve(root, notice.path));
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        notice.sha256,
        `Changed original upstream notice: ${notice.path}`,
      );
      files.set(notice.path, { file: notice.path, sha256: notice.sha256 });
    }
  }
  for (const name of ['GPL-3.0.txt', 'LGPL-3.0.txt']) {
    const file = `LICENSES/gnu/${name}`;
    const bytes = await readFile(resolve(root, file));
    files.set(file, { file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return {
    components,
    retainedFiles: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)),
  };
}
