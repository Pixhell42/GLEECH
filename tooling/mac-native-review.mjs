import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export async function retainedMacOnnxNotices(version) {
  const noticeHashes = {
    '1.22.0': 'e9e90971a8e75a9a8ac0c6412e29c1202d079998389915aa485f46c816c3b4cc',
    '1.30.0': '143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3',
  };
  assert.ok(Object.hasOwn(noticeHashes, version), 'Unreviewed Mac ONNX runtime version.');
  const retainedFiles = [];
  for (const [name, expected] of [
    ['LICENSE', '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c'],
    ['ThirdPartyNotices.txt', noticeHashes[version]],
  ]) {
    const file = `LICENSES/onnxruntime/${version}/${name}`;
    const bytes = await readFile(resolve(root, file));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256, expected, `Changed original ONNX ${version} ${name}.`);
    retainedFiles.push({ file, sha256 });
  }
  return { retainedFiles };
}

export async function collectMacNativeNotices({ arch, output, resolvePackage }) {
  assert.ok(['arm64', 'x64'].includes(arch), 'Unsupported Mac architecture.');
  await mkdir(output, { recursive: true });
  const packages = [
    `@img/sharp-darwin-${arch}`,
    `@img/sharp-libvips-darwin-${arch}`,
    arch === 'x64' ? 'onnxruntime-node-macos-x64' : 'onnxruntime-node',
  ];
  const inventory = [];
  for (const name of packages) {
    const packageRoot = resolvePackage(name);
    const metadata = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
    const files = [];
    async function collect(folder, inNoticeDirectory = false) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
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
    let retained = null;
    if (name.startsWith('@img/sharp-libvips-darwin-')) {
      assert.equal(metadata.name, name);
      retained = await retainedMacLibvipsNotices(
        JSON.parse(await readFile(resolve(packageRoot, 'versions.json'), 'utf8')),
      );
    } else if (name.startsWith('onnxruntime-node')) {
      assert.equal(metadata.name, 'onnxruntime-node');
      assert.equal(metadata.version, arch === 'x64' ? '1.22.0' : '1.30.0');
      retained = await retainedMacOnnxNotices(metadata.version);
    }
    assert.ok(
      files.some(({ file }) => /licen[sc]e/i.test(file)) || retained?.retainedFiles.length,
      `No original license for ${name}.`,
    );
    inventory.push({
      installedAs: name,
      name: metadata.name,
      version: metadata.version,
      license: metadata.license,
      repository: metadata.repository,
      files: files.sort((a, b) => a.file.localeCompare(b.file)),
      ...(retained
        ? {
            upstreamPackageOmitsNotices: !files.some(({ file }) => /licen[sc]e/i.test(file)),
            ...retained,
          }
        : {}),
    });
  }
  const result = { arch, packages: inventory };
  await writeFile(resolve(output, 'inventory.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

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
