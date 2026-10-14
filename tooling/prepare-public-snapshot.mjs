import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, writeFile, access, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const canonicalRoot = await realpath(root);
const target = resolve(root, process.argv[2] ?? 'public-release/candidate');
const inside = relative(root, target);
if (!inside.startsWith(`public-release${sep}`) || inside.split(sep).includes('..'))
  throw new Error('Snapshot destination must be a new directory inside ignored public-release/.');
let ancestor = dirname(target);
for (;;) {
  try {
    const canonicalAncestor = await realpath(ancestor);
    if (canonicalAncestor !== canonicalRoot && !canonicalAncestor.startsWith(canonicalRoot + sep))
      throw new Error('Snapshot destination resolves outside the workspace.');
    break;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ancestor = dirname(ancestor);
  }
}
try {
  await access(target);
  throw new Error('Destination already exists; create a new candidate instead of overwriting it.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
execFileSync(process.execPath, ['tooling/public-content-check.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
const paths = [
  ...new Set(
    execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
    }).split('\0'),
  ),
].filter(Boolean);
const roots = new Set(['apps', 'assets', 'packages', 'tooling', 'docs', 'LICENSES', '.github']);
const rootFiles = new Set([
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.node-version',
  '.npmrc',
  '.prettierignore',
  '.prettierrc.json',
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'vitest.config.ts',
  'eslint.config.mjs',
]);
const manifest = [];
let nativeNoticePaths = new Set();
try {
  const components = JSON.parse(
    await readFile(resolve(root, 'LICENSES/native-components/inventory.json'), 'utf8'),
  );
  const runtime = JSON.parse(
    await readFile(resolve(root, 'LICENSES/native-components/runtime-inventory.json'), 'utf8'),
  );
  const inventory = [...components, ...runtime];
  nativeNoticePaths = new Set(
    inventory.flatMap((component) => component.notices.map((notice) => notice.path)),
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const path of paths.sort()) {
  const source = resolve(root, path);
  try {
    await access(source);
  } catch {
    continue;
  }
  if (!(await realpath(source)).startsWith(canonicalRoot + sep))
    throw new Error(`Publication source resolves outside the workspace: ${path}`);
  if (!(await lstat(source)).isFile())
    throw new Error(`Publication files must be regular files: ${path}`);
  if (
    path
      .split('/')
      .some(
        (part) =>
          ['node_modules', 'out', 'release', 'test-results', '.git', 'public-release'].includes(
            part,
          ) &&
          !(
            part === 'release' &&
            path.startsWith('LICENSES/native-components/') &&
            nativeNoticePaths.has(path)
          ),
      )
  )
    throw new Error(`Generated/private output is not publishable: ${path}`);
  if (!roots.has(path.split('/')[0]) && !rootFiles.has(path))
    throw new Error(`Unreviewed publication path: ${path}`);
  const destination = resolve(target, path);
  if (!destination.startsWith(target + sep)) throw new Error('Snapshot path escaped destination.');
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const data = await readFile(source),
    copied = await readFile(destination);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  if (hash(data) !== hash(copied)) throw new Error(`Copy mismatch: ${path}`);
  manifest.push({ path, bytes: data.length, sha256: hash(data) });
}
await writeFile(
  `${target}-manifest.json`,
  JSON.stringify(
    {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      workingTreeDirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
      ),
      files: manifest,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Copied and hash-verified ${manifest.length} reviewed files to ${target}.`);
console.log('No Git history, remote, dependency folders or build/test output was copied.');
