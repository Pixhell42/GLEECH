import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { targets } from './installed-acceptance-plan.mjs';

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
assert.ok(['prepare-sender', 'record-sender', 'prepare-receiver', 'record'].includes(mode));
const hash = async (path, algorithm = 'sha256', encoding = 'hex') => {
  const value = createHash(algorithm);
  for await (const chunk of createReadStream(path)) value.update(chunk);
  return value.digest(encoding);
};
const save = (value) => writeFile(configPath, JSON.stringify(value, null, 2) + '\n');
if (mode === 'prepare-sender') {
  await mkdir(join(output, 'sender'), { recursive: true });
  const sourceInputs = Object.fromEntries(
    ['apps', 'packages', 'pnpm-lock.yaml'].map((path) => [
      path,
      execFileSync('git', ['rev-parse', `HEAD:${path}`], { cwd: root, encoding: 'utf8' }).trim(),
    ]),
  );
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
    sourceInputs,
    senderVersion: '0.2.1',
    version: '0.2.2',
    privateSenderOnly: true,
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
  packageInfo.version = config.senderVersion;
  await writeFile(packagePath, JSON.stringify(packageInfo, null, 2) + '\n');
  await save(config);
  console.log(`Current ${key} source recorded; private 0.2.1 sender prepared.`);
} else if (mode === 'record-sender') {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const archive = target.archive.replace('0.2.0', '0.2.1');
  const path = join(output, 'sender', archive);
  await copyFile(join(root, 'apps/desktop/release', archive), path);
  config.baseline = { version: '0.2.1', archive, path, sha256: await hash(path) };
  await save(config);
  console.log(`Private sender retained: ${archive}, ${config.baseline.sha256}`);
} else if (mode === 'prepare-receiver') {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const packagePath = join(root, 'apps/desktop/package.json');
  const packageInfo = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(packageInfo.version, '0.2.1');
  packageInfo.version = config.version;
  await writeFile(packagePath, JSON.stringify(packageInfo, null, 2) + '\n');
  // Instrument only the private receiver: no updater/controller/recovery code changes.
  // The private sender contains the real production fixes and no inspection hook.
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
  console.log(`Private ${key} 0.2.2 receiver prepared.`);
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
