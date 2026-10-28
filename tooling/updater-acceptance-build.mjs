import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { candidate, targets } from './installed-acceptance-plan.mjs';

assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'Private receiver builds belong on disposable CI runners.',
);
const key = `${process.platform}-${process.arch}`;
const target = targets[key];
assert.ok(target);
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'test-results/builtin-updater', key);
const configPath = join(output, 'fixture.json');
const mode = process.argv[2];
assert.ok(['prepare', 'record'].includes(mode));
const hash = async (path, algorithm = 'sha256', encoding = 'hex') => {
  const value = createHash(algorithm);
  for await (const chunk of createReadStream(path)) value.update(chunk);
  return value.digest(encoding);
};
const save = (value) => writeFile(configPath, JSON.stringify(value, null, 2) + '\n');
if (mode === 'prepare') {
  for (const [path, expected] of [
    ['apps', candidate.appsTree],
    ['packages', candidate.packagesTree],
    ['pnpm-lock.yaml', candidate.lockBlob],
  ])
    assert.equal(
      execFileSync('git', ['rev-parse', `HEAD:${path}`], { cwd: root, encoding: 'utf8' }).trim(),
      expected,
      'Begin with the published application/dependency inputs.',
    );
  await mkdir(join(output, 'download'), { recursive: true });
  const tag = key.startsWith('darwin')
    ? 'macos-alpha-0.2.0'
    : key.startsWith('linux')
      ? 'linux-omarchy-alpha-0.2.0'
      : 'v0.2.0';
  const response = await fetch(
    `https://github.com/Pixhell42/GLEECH/releases/download/${tag}/${target.archive}`,
    { signal: AbortSignal.timeout(600000) },
  );
  assert.equal(response.status, 200);
  const published = join(output, 'download', target.archive);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(published, { flags: 'wx' }));
  assert.equal(await hash(published), target.sha256);
  async function unusedPort() {
    const server = createServer();
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    const port = server.address().port;
    await new Promise((accept, reject) =>
      server.close((error) => (error ? reject(error) : accept())),
    );
    return port;
  }
  const config = {
    target: key,
    baseline: { version: '0.2.0', archive: target.archive, path: published, sha256: target.sha256 },
    version: '0.2.1',
    privateFixtureOnly: true,
    serverPort: await unusedPort(),
    receiverPort: await unusedPort(),
    receiverFile: join(output, 'receiver.json'),
    revealFile: join(output, 'finder-handoff.json'),
  };
  assert.notEqual(config.serverPort, config.receiverPort);
  const packagePath = join(root, 'apps/desktop/package.json');
  const packageInfo = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(packageInfo.version, '0.2.0');
  packageInfo.version = config.version;
  await writeFile(packagePath, JSON.stringify(packageInfo, null, 2) + '\n');
  // Instrument only the private receiver: no updater/controller/recovery code changes.
  // The unchanged, published 0.2.0 binary remains the sender under test.
  const mainPath = join(root, 'apps/desktop/src/main/index.ts');
  const original = await readFile(mainPath, 'utf8');
  const receiver = `import { app as acceptanceReceiver } from 'electron';
import { writeFileSync as acceptanceWrite } from 'node:fs';
acceptanceReceiver.commandLine.appendSwitch('remote-debugging-port', ${JSON.stringify(String(config.receiverPort))});
acceptanceReceiver.commandLine.appendSwitch('disable-gpu');
acceptanceReceiver.commandLine.appendSwitch('disable-software-rasterizer');
const acceptanceFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = String(input);
  return acceptanceFetch(url.startsWith('https://api.github.com/repos/Pixhell42/GLEECH/releases?') ? ${JSON.stringify(`http://127.0.0.1:${config.serverPort}/releases`)} : input, options);
};
void acceptanceReceiver.whenReady().then(() => acceptanceWrite(${JSON.stringify(config.receiverFile)}, JSON.stringify({ pid: process.pid, version: acceptanceReceiver.getVersion(), profile: acceptanceReceiver.getPath('userData'), packaged: acceptanceReceiver.isPackaged, executable: process.execPath, appImage: process.env.APPIMAGE ?? null, args: process.argv })));
`;
  await writeFile(mainPath, receiver + original);
  config.receiverInstrumentation = [
    'private version bump',
    'loopback inspection port and startup receipt',
    'CPU renderer flags',
    'fixture release-list transport',
  ];
  await save(config);
  console.log(`Published ${key} 0.2.0 bytes verified; private 0.2.1 receiver prepared.`);
} else {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const archive = target.archive.replace('0.2.0', config.version);
  const path = join(root, 'apps/desktop/release', archive);
  config.payload = {
    archive,
    path,
    bytes: (await stat(path)).size,
    sha256: await hash(path),
    sha512: await hash(path, 'sha512', 'base64'),
  };
  const suffix =
    process.platform === 'darwin' ? '-mac' : process.platform === 'linux' ? '-linux' : '';
  config.manifest = `latest-${process.arch}${suffix}.yml`;
  const changed = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .sort();
  assert.deepEqual(changed, ['apps/desktop/package.json', 'apps/desktop/src/main/index.ts']);
  config.changedReceiverFiles = changed;
  await save(config);
  console.log(
    `Private fixture recorded: ${archive}, ${config.payload.bytes} bytes, ${config.payload.sha256}`,
  );
}
