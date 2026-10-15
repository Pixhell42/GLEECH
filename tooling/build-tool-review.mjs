import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { load } from 'js-yaml';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const builderPath = require.resolve('app-builder-lib/package.json');
const builderRequire = createRequire(builderPath);
const getPath = builderRequire.resolve('@electron/get');
const getRequire = createRequire(getPath);
const gotPath = getRequire.resolve('got');
const gotRequire = createRequire(gotPath);
const cacheRequire = createRequire(gotRequire.resolve('cacheable-request'));
const proxyPath = getRequire.resolve('global-agent/package.json');
const proxyRequire = createRequire(proxyPath);
const formatterPath = proxyRequire.resolve('roarr/package.json');
const formatterRequire = createRequire(formatterPath);
const versions = {};
for (const [name, parent, version] of [
  ['app-builder-lib', require, '26.15.3'],
  ['@electron/get', builderRequire, '3.1.0'],
  ['got', getRequire, '11.8.6'],
  ['cacheable-request', gotRequire, '7.0.4'],
  ['http-cache-semantics', cacheRequire, '4.2.0'],
  ['global-agent', getRequire, '3.0.0'],
  ['roarr', proxyRequire, '2.15.4'],
  ['sprintf-js', formatterRequire, '1.1.3'],
]) {
  const metadata = JSON.parse(await readFile(parent.resolve(`${name}/package.json`), 'utf8'));
  assert.equal(
    metadata.version,
    version,
    `${name} changed: repeat the advisory reachability review.`,
  );
  versions[name] = metadata.version;
}

// Electron's downloaded-file cache is separate from Got's HTTP response cache.
const got = getRequire('got');
assert.ok(!got.defaults.options.cache, 'HTTP response caching requires a new advisory review.');
const config = load(await readFile(resolve(root, 'apps/desktop/electron-builder.yml'), 'utf8'));
assert.ok(!config.electronDownload?.downloadOptions?.cache, 'Do not enable HTTP response caching.');
const workflow = load(await readFile(resolve(root, '.github/workflows/windows.yml'), 'utf8'));
assert.equal(workflow.env.ROARR_LOG, 'false');
for (const job of Object.values(workflow.jobs)) {
  const jobLogging = job.env?.ROARR_LOG ?? workflow.env.ROARR_LOG;
  assert.equal(jobLogging, 'false');
  for (const step of job.steps ?? []) assert.equal(step.env?.ROARR_LOG ?? jobLogging, 'false');
}
assert.ok(
  !formatterRequire('boolean').boolean(process.env.ROARR_LOG ?? ''),
  'Disable ROARR_LOG during the reviewed packaging workflow.',
);

// Proxy URLs and errors are context data, never attacker-controlled format strings.
const digests = [];
let literalLogCalls = 0;
async function inspect(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (entry.isFile() && path.endsWith('.js')) {
      const source = await readFile(path, 'utf8');
      digests.push({
        file: relative(dirname(proxyPath), path).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(source).digest('hex'),
      });
      const tree = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'log' &&
          ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(node.expression.name.text)
        ) {
          const first = node.arguments[0];
          const literal = (arg) =>
            arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg));
          const format = literal(first) ? first : node.arguments[1];
          assert.ok(literal(format), 'Proxy logger format changed: repeat the sprintf-js review.');
          literalLogCalls++;
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
}
await inspect(resolve(dirname(proxyPath), 'dist'));
assert.ok(literalLogCalls > 0, 'No proxy log calls inspected.');

let packagedModulesAbsent;
if (process.argv[2]) {
  const { listPackage } = require('@electron/asar');
  const files = listPackage(resolve(process.argv[2], 'resources/app.asar')).map((path) =>
    path.replaceAll('\\', '/'),
  );
  for (const name of ['electron-builder', 'app-builder-lib', 'http-cache-semantics', 'sprintf-js'])
    assert.ok(
      !files.some((path) => path.includes(`/node_modules/${name}/`)),
      `${name} bundled in app.`,
    );
  packagedModulesAbsent = true;
}
const output = resolve(root, 'test-results');
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, 'build-tool-review.json'),
  JSON.stringify(
    { versions, httpResponseCacheEnabled: false, literalLogCalls, digests, packagedModulesAbsent },
    null,
    2,
  ) + '\n',
);
console.log(
  `Build-tool scope checks passed: HTTP caching off; ${literalLogCalls} literal proxy log formats${packagedModulesAbsent ? '; flagged build modules absent from package' : ''}.`,
);
console.log(
  'Upstream advisories remain unpatched; this check verifies the documented configuration, not a library fix.',
);
