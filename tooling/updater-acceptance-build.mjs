import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
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
    releaseCandidateSender: true,
    privateFixtureOnly: true,
    serverPort: await unusedPort(),
    receiverPort: await unusedPort(),
    receiverFile: join(output, 'receiver.json'),
    revealFile: join(output, 'finder-handoff.json'),
  };
  assert.notEqual(config.serverPort, config.receiverPort);
  const packagePath = join(root, 'apps/desktop/package.json');
  const packageInfo = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(packageInfo.version, config.senderVersion);
  assert.equal(
    execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim(),
    '',
  );
  await save(config);
  console.log(`Current ${key} source recorded; unmodified 0.2.1 release candidate prepared.`);
} else if (mode === 'record-sender') {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const archive = target.archive.replace('0.2.0', '0.2.1');
  const app = join(
    root,
    'apps/desktop/release',
    process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'mac-arm64/GLEECH.app'
        : 'mac/GLEECH.app'
      : process.platform === 'linux'
        ? 'linux-unpacked'
        : 'win-unpacked',
  );
  const resources = join(app, process.platform === 'darwin' ? 'Contents/Resources' : 'resources');
  const verify = (script, args = []) =>
    execFileSync(process.execPath, [join(root, 'tooling', script), ...args], {
      cwd: root,
      stdio: 'inherit',
      timeout: 180000,
    });
  if (process.platform === 'darwin') verify('mac-package-check.mjs');
  else if (process.platform === 'linux') verify('linux-package-check.mjs');
  else verify('native-release-check.mjs', [app]);
  verify('ffmpeg-package-check.mjs', [resources]);
  verify('update-package-check.mjs', [resources, join(root, 'apps/desktop/release')]);
  verify('runtime-security-check.mjs', [
    join(
      app,
      process.platform === 'darwin'
        ? 'Contents/MacOS/GLEECH'
        : process.platform === 'linux'
          ? 'gleech-bin'
          : 'GLEECH.exe',
    ),
  ]);
  const path = join(output, 'sender', archive);
  await rename(join(root, 'apps/desktop/release', archive), path);
  config.baseline = { version: '0.2.1', archive, path, sha256: await hash(path) };
  config.candidatePayload = {
    ...config.baseline,
    bytes: (await stat(path)).size,
    sha512: await hash(path, 'sha512', 'base64'),
  };
  const candidateDirectory = join(output, 'release-candidate');
  await mkdir(candidateDirectory, { recursive: true });
  await copyFile(path, join(candidateDirectory, archive));
  for (const probe of await readdir(join(root, 'test-results/runtime-security'), {
    withFileTypes: true,
  })) {
    if (!probe.isDirectory() || !probe.name.startsWith('probe-')) continue;
    const report = JSON.parse(
      await readFile(
        join(root, 'test-results/runtime-security', probe.name, 'report.json'),
        'utf8',
      ),
    );
    assert.equal(report.passed, true);
    assert.equal(report.versions.electron, '45.1.0');
    await writeFile(
      join(candidateDirectory, 'runtime-security-' + key + '.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  if (process.platform === 'linux') {
    const runtimeNotices = join(resources, 'appimage-runtime-notices');
    const provenance = JSON.parse(await readFile(join(runtimeNotices, 'provenance.json'), 'utf8'));
    assert.equal(
      await hash(join(runtimeNotices, 'source-and-relink.tar.gz')),
      provenance.relinkSHA256,
    );
    await copyFile(
      join(runtimeNotices, 'source-and-relink.tar.gz'),
      join(candidateDirectory, 'GLEECH-0.2.1-appimage-runtime-source-and-relink.tar.gz'),
    );
    await copyFile(
      join(runtimeNotices, 'provenance.json'),
      join(candidateDirectory, 'appimage-runtime-provenance.json'),
    );
  }
  for (const entry of await readdir(join(root, 'apps/desktop/release'), { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (/^latest-(?:arm64|x64)(?:-mac|-linux)?\.yml$/.test(entry.name) ||
        entry.name === archive + '.blockmap' ||
        /^(?:mac|linux)-build-(?:arm64|x64)\.json$/.test(entry.name) ||
        /^SHA256SUMS-(?:mac|linux)-(?:arm64|x64)\.txt$/.test(entry.name))
    )
      await copyFile(
        join(root, 'apps/desktop/release', entry.name),
        join(candidateDirectory, entry.name),
      );
  }
  await writeFile(
    join(candidateDirectory, 'candidate-inputs.json'),
    JSON.stringify(
      {
        version: config.senderVersion,
        target: key,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        sourceInputs: config.sourceInputs,
        archive,
        bytes: config.candidatePayload.bytes,
        sha256: config.baseline.sha256,
        privateInstrumentation: false,
      },
      null,
      2,
    ) + '\n',
  );
  await save(config);
  console.log(`Release candidate retained: ${archive}, ${config.baseline.sha256}`);
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
