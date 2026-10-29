import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream, watch } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, chromium } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import { targets as publishedTargets } from './installed-acceptance-plan.mjs';
import {
  startUpdateFixture,
  installUpdateRouting,
  writeCliUpdateFixture,
} from './updater-acceptance-fixtures.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use disposable native CI runners.');
const key = `${process.platform}-${process.arch}`;
const published = publishedTargets[key];
assert.ok(published);
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'test-results/builtin-updater', key);
const config = JSON.parse(await readFile(join(output, 'fixture.json'), 'utf8'));
assert.equal(config.target, key);
assert.equal(config.privateFixtureOnly, true);
assert.equal(config.version, '0.2.2');
assert.equal(config.privateSenderOnly, true);
const senderArchive = published.archive.replace('0.2.0', '0.2.1');
const baselinePath = join(output, 'sender', senderArchive);
assert.match(config.baseline.sha256, /^[a-f0-9]{64}$/);
assert.deepEqual(config.baseline, {
  version: '0.2.1',
  archive: senderArchive,
  path: baselinePath,
  sha256: config.baseline.sha256,
});
const artwork = join(output, 'artwork');
await mkdir(artwork, { recursive: true });
const installed =
  process.platform === 'darwin'
    ? '/Applications/GLEECH.app'
    : join(output, 'installed', process.platform === 'win32' ? 'GLEECH' : senderArchive);
const executable =
  process.platform === 'darwin'
    ? join(installed, 'Contents/MacOS/GLEECH')
    : process.platform === 'win32'
      ? join(installed, 'GLEECH.exe')
      : installed;
const resources =
  process.platform === 'darwin'
    ? join(installed, 'Contents/Resources')
    : join(installed, 'resources');
const env = { ...process.env, GLEECH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' };
for (const name of [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'GLEECH_SMOKE_USER_DATA',
  'GLEECH_USER_DATA',
  'NODE_OPTIONS',
  'GH_TOKEN',
  'GITHUB_TOKEN',
])
  delete env[name];
if (process.platform === 'linux') {
  env.APPIMAGE_EXTRACT_AND_RUN = '1';
  delete env.NO_CLEANUP;
}
const run = promisify(execFile);
const command = (file, args) =>
  run(file, args, { env, shell: false, windowsHide: true, timeout: 180000, maxBuffer: 8e6 });
const sha = async (path) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};
async function poll(fn, message, timeout = 180000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(message + (last ? ': ' + last : ''));
}
const fixture = await startUpdateFixture(config);
const routing = {
  ...config,
  origin: fixture.origin,
  installedExecutable: executable,
  childLog: join(output, 'terminal-child.log'),
};
const cliHook = join(output, 'cli-network.cjs');
await writeCliUpdateFixture(cliHook, routing);
const report = {
  sender: config.baseline,
  receiver: config.payload,
  receiverVersion: config.version,
  target: key,
  startedAt: new Date().toISOString(),
  publishedSenderUnmodified: false,
  privateSenderOnly: true,
  sourceInputs: config.sourceInputs,
  privateReceiverOnly: true,
  checks: [],
  complete: false,
  knownIssues: [],
  limitations: [
    'Release-list and download transport use a loopback fixture; updater IPC, checksum verification, recovery, installers and shutdown remain real.',
    'The private 0.2.2 receiver adds only inspection/startup receipts and fixture discovery routing, in addition to its version bump.',
    'CPU rendering and file-picker fixtures are used; physical GPUs and unsigned-download OS prompts are not certified.',
    'Full download fallback is exercised; differential-download optimization is not certified.',
    ...(process.platform === 'darwin'
      ? [
          'Finder selection is recorded; app replacement is manual, as documented for unsigned Mac builds.',
        ]
      : []),
    ...(process.platform === 'linux'
      ? [
          'AppImage uses extraction fallback under Xvfb; FUSE and Omarchy/Wayland are not certified.',
        ]
      : []),
  ],
};
const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
async function check(name, fn) {
  console.log('START', name);
  report.activeCheck = name;
  await save();
  const time = Date.now();
  let timer;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Acceptance check timed out: ' + name)), 480000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  report.checks.push({ name, passed: true, durationMs: Date.now() - time });
  delete report.activeCheck;
  await save();
  console.log('PASS', name);
}
let app,
  browser,
  page,
  profile,
  receiver,
  owned = false;
const errors = [];
async function installBase() {
  assert.equal(await sha(baselinePath), config.baseline.sha256);
  await assert.rejects(access(installed), { code: 'ENOENT' });
  owned = true;
  await mkdir(dirname(installed), { recursive: true });
  if (process.platform === 'win32')
    await command(baselinePath, ['/S', '/currentuser', '/D=' + installed]);
  else if (process.platform === 'darwin') {
    const expanded = join(output, 'base-expanded');
    if (!(await exists(expanded))) await command('ditto', ['-x', '-k', baselinePath, expanded]);
    await command('ditto', [join(expanded, 'GLEECH.app'), installed]);
  } else {
    await copyFile(baselinePath, installed);
    await chmod(installed, 0o755);
  }
}
async function stopReceiver() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  if (!receiver) return;
  assert.equal(receiver.version, '0.2.2');
  assert.equal(receiver.packaged, true);
  assert.ok(Number.isSafeInteger(receiver.pid) && receiver.pid > 1);
  if (process.platform === 'linux') assert.equal(receiver.appImage, installed);
  else assert.equal(resolve(receiver.executable).toLowerCase(), executable.toLowerCase());
  try {
    process.kill(receiver.pid, 0);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    receiver = null;
    return;
  }
  try {
    if (process.platform === 'win32')
      await command('taskkill.exe', ['/pid', String(receiver.pid), '/t', '/f']);
    else process.kill(receiver.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  receiver = null;
  await new Promise((done) => setTimeout(done, 1000));
}
async function removeInstallation() {
  if (!owned || !(await exists(installed))) return;
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  if (process.platform === 'win32') {
    await command(join(installed, 'Uninstall GLEECH.exe'), ['/S']);
    await poll(
      async () => !(await exists(executable)),
      'Uninstaller did not remove the owned installation.',
    );
  } else if (process.platform === 'darwin')
    await rm('/Applications/GLEECH.app', { recursive: true });
  else {
    assert.equal(installed, join(output, 'installed', config.baseline.archive));
    await rm(installed);
  }
  owned = false;
}
async function closeSender() {
  if (app) {
    const closing = app;
    app = null;
    let timer;
    try {
      await Promise.race([
        closeTestApp(closing),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Sender cleanup timed out.')), 30000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
async function launchSender() {
  app = await electron.launch({
    executablePath: executable,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    env,
    timeout: 60000,
  });
  app.on('console', (message) => console.log('[sender]', message.text()));
  page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  const runtime = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    profile: app.getPath('userData'),
    packaged: app.isPackaged,
    args: process.argv,
    platform: process.platform,
    arch: process.arch,
    resources: process.resourcesPath,
    pid: process.pid,
  }));
  assert.equal(runtime.version, '0.2.1');
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.platform + '-' + runtime.arch, key);
  assert.ok(!runtime.args.includes('--smoke-test'));
  if (profile) assert.equal(runtime.profile, profile);
  else profile = runtime.profile;
  await app.evaluate(installUpdateRouting, routing);
  const init = await page.evaluate(async () => ({
    preference: await window.gleech.setAutomaticUpdates(false),
    notes: await window.gleech.acknowledgeReleaseNotes('0.2.1'),
    state: await window.gleech.updateState(),
  }));
  assert.equal(init.preference.ok, true);
  assert.equal(init.notes.ok, true);
  assert.equal(init.state.value.installMode, process.platform === 'darwin' ? 'finder' : 'native');
  await page.getByRole('dialog', { name: /What’s new/ }).waitFor({ state: 'hidden' });
  report.senderRuntime = runtime;
}
async function cli(args) {
  if (process.platform !== 'linux')
    return run(executable, ['--require', cliHook, join(resources, 'cli/gleech.cjs'), ...args], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      shell: false,
      windowsHide: true,
      timeout: 240000,
      maxBuffer: 8e6,
    });
  assert.ok(!/\s/.test(cliHook), 'Use the ordinary hosted workspace path for the preload.');
  return new Promise((accept, reject) => {
    const child = spawn(installed, ['--cli', ...args], {
      env: { ...env, NODE_OPTIONS: '--require=' + cliHook, GLEECH_CLI_RESTORE_STDOUT: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
      timeout: 240000,
    });
    let stdout = '',
      stderr = '';
    child.stdio[3].on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) accept({ stdout, stderr });
      else {
        const error = new Error(stderr);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}
const getState = () => page.evaluate(async () => (await window.gleech.updateState()).value);
const discover = () => page.evaluate(async () => (await window.gleech.checkForUpdates()).value);
async function choose(kind, path) {
  await app.evaluate(
    ({ dialog }, { kind, path }) => {
      if (kind === 'open')
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      else dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    },
    { kind, path },
  );
}
async function settle() {
  await page.waitForFunction(
    () => {
      const data = document.querySelector('.image-layer')?.dataset;
      return (
        data &&
        data.renderRevision === data.requestedRevision &&
        !document.querySelector('.detail-loading')
      );
    },
    undefined,
    { timeout: 120000 },
  );
}
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((element) => ({
    effects: JSON.parse(element.dataset.renderRecipe),
    seed: Number(element.dataset.renderSeed),
  }));
}
const sharp = createRequire(join(root, 'apps/desktop/package.json'))('sharp');
const asar = createRequire(join(root, 'apps/desktop/package.json'))('@electron/asar');
async function receiverInstalled() {
  // Inspect package bytes without repeatedly starting the executable while NSIS
  // is waiting for old processes to release it.
  if (process.platform === 'linux') return (await sha(installed)) === config.payload.sha256;
  const archive = join(resources, 'app.asar');
  asar.uncache(archive);
  const packageInfo = JSON.parse(asar.extractFile(archive, 'package.json'));
  return packageInfo.version === config.version;
}
async function exportPixels(name, sender = true) {
  const path = join(artwork, name);
  if (sender) await choose('save', path);
  else throw new Error('Use the CLI to validate receiver pixels after saving.');
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  // Timeline mode hides the image-mode notice; verify the actual exported file.
  await poll(() => exists(path), 'The PNG export was not written.');
  return sharp(path).ensureAlpha().raw().toBuffer();
}
const original = join(artwork, 'working-project.gleech');
let savedHash, expectedRecipe, expectedPixels, timecode, presetId;
async function checkpointObserver() {
  const folder = join(profile, 'update-recovery');
  await mkdir(folder, { recursive: true });
  let watching, timer;
  const result = new Promise((accept, reject) => {
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const session = await load(join(folder, 'session.json'));
        assert.match(session.id, /^[a-f0-9-]{36}$/);
        await copyFile(
          join(folder, session.id + '.gleech'),
          join(artwork, 'update-checkpoint.gleech'),
        );
        await writeFile(join(output, 'checkpoint.json'), JSON.stringify(session, null, 2) + '\n');
        watching.close();
        clearTimeout(timer);
        accept(session);
      } catch (error) {
        reading = false;
        if (error.code !== 'ENOENT') reject(error);
      }
    };
    watching = watch(folder, () => {
      void read();
    });
    timer = setTimeout(() => {
      watching.close();
      reject(new Error('The real update did not save a checkpoint.'));
    }, 120000);
  });
  return {
    result,
    stop() {
      watching.close();
      clearTimeout(timer);
    },
  };
}
async function manualMacReplacement() {
  const handoff = await poll(
    async () => ((await exists(config.revealFile)) ? load(config.revealFile) : null),
    'Finder handoff was not recorded.',
  );
  assert.equal(basename(handoff.path), config.payload.archive);
  assert.equal(await sha(handoff.path), config.payload.sha256);
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  await rm('/Applications/GLEECH.app', { recursive: true });
  const expanded = join(output, 'receiver-expanded');
  if (!(await exists(expanded))) await command('ditto', ['-x', '-k', handoff.path, expanded]);
  await command('ditto', [join(expanded, 'GLEECH.app'), installed]);
  const child = spawn(executable, [], { env, stdio: 'ignore', detached: true });
  child.unref();
  report.finderHandoff = handoff;
}
async function attachReceiver() {
  receiver = await poll(
    async () => ((await exists(config.receiverFile)) ? load(config.receiverFile) : null),
    'The installed receiver did not start.',
    180000,
  );
  assert.equal(receiver.version, '0.2.2');
  assert.equal(receiver.packaged, true);
  assert.equal(receiver.profile, profile);
  if (process.platform === 'linux') {
    assert.equal(receiver.appImage, installed);
    assert.equal(await sha(installed), config.payload.sha256);
  }
  browser = await poll(async () => {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${config.receiverPort}`, {
        timeout: 2000,
      });
    } catch {
      return null;
    }
  }, 'Receiver inspection port did not open.');
  page = await poll(
    () => browser.contexts()[0]?.pages()[0],
    'The installed receiver has no desktop window.',
  );
  page.setDefaultTimeout(60000);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  const notes = page.getByRole('dialog', { name: 'What’s new in GLEECH 0.2.2', exact: true });
  await notes.getByText('Private updater acceptance fixture notes.', { exact: true }).waitFor();
  await notes.getByRole('button', { name: 'Let’s create', exact: true }).click();
  const result = await page.evaluate(async () => ({
    preference: await window.gleech.setAutomaticUpdates(false),
    state: await window.gleech.updateState(),
  }));
  assert.equal(result.preference.ok, true);
  assert.equal(result.state.value.currentVersion, '0.2.2');
  return receiver;
}
try {
  await check('private-fixed-sender-installed-with-real-updater-enabled', async () => {
    await installBase();
    await launchSender();
  });
  await check('desktop-rejects-draft-older-current-wrong-arch-and-missing-metadata', async () => {
    for (const kind of ['draft', 'older', 'same', 'wrong-arch', 'missing-manifest']) {
      fixture.state.kind = kind;
      const state = await discover();
      assert.equal(state.phase, 'idle', kind);
      assert.equal(state.release, null, kind);
      assert.equal(state.error, null);
    }
    fixture.state.kind = 'valid';
  });
  if (process.platform !== 'darwin')
    await check('native-manifest-mismatch-is-rejected-before-download', async () => {
      fixture.state.kind = 'invalid-manifest';
      const state = await discover();
      assert.equal(state.phase, 'error');
      assert.match(state.error, /manifest does not match/);
      fixture.state.kind = 'valid';
    });
  await check('real-cli-discovers-update-and-refuses-install-while-desktop-is-open', async () => {
    const resourcesBefore =
      process.platform === 'linux'
        ? await exists(join(report.senderRuntime.resources, 'app-update.yml'))
        : true;
    assert.equal(
      resourcesBefore,
      true,
      'The installed sender must include its updater configuration.',
    );
    const value = JSON.parse((await cli(['update', '--check', '--json'])).stdout);
    assert.equal(value.currentVersion, '0.2.1');
    assert.equal(value.version, '0.2.2');
    assert.equal(value.available, true);
    await assert.rejects(cli(['update', '--yes']), (error) =>
      /Save and close the GLEECH desktop/.test(error.stderr ?? error.message),
    );
    assert.equal((await getState()).currentVersion, '0.2.1');
    if (process.platform === 'linux') {
      const resourcesAfter = await exists(join(report.senderRuntime.resources, 'app-update.yml'));
      report.linuxExtractionConcurrency = { resourcesBefore, resourcesAfter };
      assert.equal(resourcesAfter, true, 'A sibling CLI removed the desktop extraction.');
      assert.equal(env.NO_CLEANUP, undefined);
      const duplicate = await command(installed, []);
      assert.equal(typeof duplicate.stdout, 'string');
      assert.equal(await exists(join(report.senderRuntime.resources, 'app-update.yml')), true);
      const runtime = await load(
        join(report.senderRuntime.resources, 'appimage-runtime-notices/provenance.json'),
      );
      assert.equal(runtime.extraction, 'mkdtemp-per-invocation');
      report.linuxRuntime = runtime;
      report.linuxWorkaroundEnabled = false;
    }
  });
  await check('automatic-download-can-be-disabled-and-cancelled', async () => {
    fixture.state.slow = true;
    const enabled = await page.evaluate(() => window.gleech.setAutomaticUpdates(true));
    assert.equal(enabled.ok, true);
    await poll(
      async () => {
        const state = await getState();
        return state.phase === 'downloading' && state.progress.transferred > 0;
      },
      'Automatic download did not transfer bytes.',
      120000,
    );
    const disabled = await page.evaluate(() => window.gleech.setAutomaticUpdates(false));
    assert.equal(disabled.ok, true);
    await poll(
      async () => {
        const state = await getState();
        return state.phase === 'available' && !state.automatic && state.error === null;
      },
      'Automatic cancellation did not settle safely.',
      120000,
    );
    fixture.state.slow = false;
  });
  await check('bad-github-digest-is-rejected-without-installing', async () => {
    fixture.state.badDigest = true;
    assert.equal((await discover()).phase, 'available');
    const downloaded = await page.evaluate(
      async () => (await window.gleech.downloadUpdate()).value,
    );
    assert.equal(downloaded.phase, 'error');
    assert.match(downloaded.error, /integrity check/);
    assert.equal((await getState()).currentVersion, '0.2.1');
    assert.equal(await exists(config.receiverFile), false);
    fixture.state.badDigest = false;
  });
  await check('retry-download-verifies-real-native-payload', async () => {
    assert.equal((await discover()).phase, 'available');
    const state = await page.evaluate(async () => (await window.gleech.downloadUpdate()).value);
    assert.equal(state.phase, 'ready', JSON.stringify(state));
    assert.equal(state.progress.percent, 100);
    assert.equal(state.release.sha256, config.payload.sha256);
    assert.ok(fixture.state.bytesServed >= config.payload.bytes);
  });
  await check('notification-dismissal-preserves-settings-install-access', async () => {
    await page.evaluate(() => window.gleech.setAutomaticUpdates(true));
    const notice = page.getByRole('status', { name: 'Software update' });
    await notice.waitFor();
    await notice.getByRole('button', { name: 'Dismiss update notification' }).click();
    await notice.waitFor({ state: 'hidden' });
    assert.equal((await getState()).dismissedVersion, '0.2.2');
  });
  await check('real-unsaved-project-and-timeline-prepared-for-update', async () => {
    const input = join(artwork, 'input.png');
    const pixels = Buffer.alloc(97 * 65 * 4);
    for (let i = 0; i < pixels.length; i += 4)
      pixels.set([(i * 13) % 256, (i * 17 + 41) % 256, (i * 23 + 87) % 256, 255], i);
    await sharp(pixels, { raw: { width: 97, height: 65, channels: 4 } })
      .png()
      .toFile(input);
    await choose('open', input);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await settle();
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page
      .locator('.effect-picker')
      .getByRole('button', { name: 'RGB split', exact: true })
      .click();
    await choose('save', original);
    await fileAction(page, 'Save project Ctrl+S');
    await page
      .getByRole('status')
      .filter({ hasText: 'Saved ' + basename(original) })
      .waitFor();
    savedHash = await sha(original);
    await page.getByRole('spinbutton', { name: 'Master seed' }).fill('8172');
    await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
    await page.locator('.timeline-dock').waitFor();
    expectedRecipe = await recipe();
    expectedPixels = await exportPixels('unsaved-before-update.png');
    timecode = await page.locator('.timecode').textContent();
    const thumbnail =
      'data:image/png;base64,' +
      (
        await sharp({ create: { width: 16, height: 16, channels: 4, background: '#80baff' } })
          .png()
          .toBuffer()
      ).toString('base64');
    const stored = await page.evaluate(
      ({ recipe, thumbnail }) =>
        window.gleech.storePreset(
          { masterSeed: recipe.seed, effects: recipe.effects },
          'Updater acceptance preset',
          thumbnail,
          'image',
        ),
      { recipe: expectedRecipe, thumbnail },
    );
    assert.equal(stored.ok, true);
    presetId = stored.value.id;
    await page.evaluate(() => localStorage.setItem('gleech.ui.color', '#80baff'));
    await writeFile(join(profile, 'keep-updater-profile.txt'), 'preserve updater profile\n');
    assert.ok((await page.title()).startsWith('•'));
    report.defaultUserData = profile;
  });
  await check('desktop-installs-through-real-engine-and-saves-recovery-checkpoint', async () => {
    const observer = await checkpointObserver();
    try {
      // The extraction runtime/relaunched AppImage can retain the launcher's
      // inherited pipes. Verify the Electron sender PID, rather than waiting
      // for Playwright's wrapper streams to close before inspecting its receiver.
      const closed =
        process.platform === 'linux' ? null : app.waitForEvent('close', { timeout: 180000 });
      await fileAction(page, 'Settings');
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.getByRole('button', { name: 'Install & Update', exact: true }).click();
      const checkpoint = await observer.result;
      assert.equal(checkpoint.dirty, true);
      assert.equal(checkpoint.documentPath, original);
      assert.equal(checkpoint.mode, 'timeline');
      report.checkpoint = checkpoint;
      if (closed) await closed;
      else
        await poll(() => {
          try {
            process.kill(report.senderRuntime.pid, 0);
            return false;
          } catch (error) {
            if (error.code === 'ESRCH') return true;
            throw error;
          }
        }, 'The Electron sender did not exit for installation.');
      report.senderExitObserved = true;
      app = null;
      assert.equal(await sha(original), savedHash);
      if (process.platform === 'darwin') await manualMacReplacement();
      report.desktopReceiver = await attachReceiver();
    } finally {
      observer.stop();
    }
  });
  await check('new-version-restores-unsaved-timeline-and-original-save-binding', async () => {
    await page.locator('.timeline-dock').waitFor();
    assert.equal(await page.locator('.timecode').textContent(), timecode);
    assert.deepEqual(await recipe(), expectedRecipe);
    assert.ok((await page.title()).startsWith('•'));
    assert.equal(await sha(original), savedHash);
    const values = await page.evaluate(async () => ({
      color: localStorage.getItem('gleech.ui.color'),
      presets: await window.gleech.listPresets(),
    }));
    assert.equal(values.color, '#80baff');
    assert.ok(values.presets.value.some((p) => p.id === presetId));
    await assert.rejects(access(join(profile, 'update-recovery/session.json')), { code: 'ENOENT' });
    await fileAction(page, 'Save project Ctrl+S');
    await poll(
      async () => (await sha(original)) !== savedHash,
      'Save did not update the original project binding.',
    );
    assert.notEqual(await sha(original), savedHash);
    report.projectProof = {
      originalSavedSHA256: savedHash,
      savedAfterRestoreSHA256: await sha(original),
      checkpointSHA256: await sha(join(artwork, 'update-checkpoint.gleech')),
      restoredPixelSHA256: createHash('sha256').update(expectedPixels).digest('hex'),
      presetId,
    };
    await page.screenshot({ path: join(output, 'desktop-recovered.png') });
    const same = await discover();
    assert.equal(same.phase, 'idle');
    assert.equal(same.release, null);
    await copyFile(config.receiverFile, join(output, 'receiver-desktop.json'));
    await stopReceiver();
    const cliImage = join(artwork, 'receiver-cli.png');
    await cli(['render', original, '--renderer', 'cpu', '-o', cliImage]);
    assert.ok((await sharp(cliImage).ensureAlpha().raw().toBuffer()).equals(expectedPixels));
  });
  await check('real-cli-installs-after-its-own-exit-without-premature-relaunch', async () => {
    await removeInstallation();
    await rm(config.receiverFile, { force: true });
    await rm(config.revealFile, { force: true });
    await installBase();
    await writeFile(
      join(profile, 'updates.json'),
      JSON.stringify({
        automatic: false,
        dismissedVersion: null,
        lastSeenVersion: '0.2.1',
        pendingNotes: null,
      }),
    );
    assert.equal((await cli(['--version'])).stdout.trim(), '0.2.1');
    const result = await cli(['update', '--yes']);
    report.terminalCommand = { stdout: result.stdout, stderr: result.stderr };
    assert.match(result.stdout, /Download verified/);
    assert.match(result.stderr, /Downloading and verifying GLEECH 0.2.2/);
    if (process.platform === 'darwin') await manualMacReplacement();
    else {
      await poll(receiverInstalled, 'The real CLI updater did not install 0.2.2.');
      assert.equal((await cli(['--version'])).stdout.trim(), '0.2.2');
      assert.equal(
        await exists(config.receiverFile),
        false,
        'Terminal install must not unexpectedly open the desktop.',
      );
      const child = spawn(executable, [], { env, stdio: 'ignore', detached: true });
      child.unref();
    }
    report.terminalReceiver = await attachReceiver();
    assert.equal((await cli(['--version'])).stdout.trim(), '0.2.2');
    await copyFile(config.receiverFile, join(output, 'receiver-terminal.json'));
    await page.screenshot({ path: join(output, 'terminal-installed.png') });
    await stopReceiver();
  });
  if (process.platform === 'linux')
    await check('private-extractions-are-isolated-and-cleaned-after-exit', async () => {
      const trace = (await readFile(routing.childLog, 'utf8'))
        .split('\n')
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
        .filter((event) => event.event === 'helper-started');
      assert.ok(trace.length >= 2);
      const paths = [
        report.senderRuntime.resources,
        ...trace.map((event) => event.resources),
        dirname(report.desktopReceiver.executable),
        dirname(report.terminalReceiver.executable),
      ].map((path) => (path.endsWith('/resources') ? dirname(path) : path));
      assert.equal(new Set(paths).size, paths.length, 'Each launch must own a unique extraction.');
      for (const path of paths) {
        assert.match(basename(path), /^appimage_extracted_[A-Za-z0-9]{6}$/);
        await poll(async () => !(await exists(path)), 'Extraction was not cleaned: ' + path);
      }
      report.linuxExtractionCleanup = {
        paths,
        noCleanupUnset: env.NO_CLEANUP === undefined,
        passed: true,
      };
    });
  assert.deepEqual(errors, []);
  report.complete = true;
  report.unqualifiedPass = report.knownIssues.length === 0;
} catch (error) {
  report.error = String(error.stack ?? error);
  console.error(report.error);
  process.exitCode = 1;
  try {
    if (page && !page.isClosed())
      await page.screenshot({ path: join(output, 'failure.png'), timeout: 5000 });
  } catch {
    /* Preserve the original failure. */
  }
} finally {
  try {
    await closeSender();
    await stopReceiver();
    await removeInstallation();
    if (profile && (await exists(join(profile, 'keep-updater-profile.txt'))))
      assert.equal(
        await readFile(join(profile, 'keep-updater-profile.txt'), 'utf8'),
        'preserve updater profile\n',
      );
    report.cleanup = 'passed';
  } catch (error) {
    report.cleanupError = String(error.stack ?? error);
    report.complete = false;
    process.exitCode = 1;
  }
  report.transport = { requests: fixture.state.requests, bytesServed: fixture.state.bytesServed };
  await fixture.close();
  report.finishedAt = new Date().toISOString();
  await save();
}
console.log(
  JSON.stringify({
    target: key,
    passed: report.complete,
    unqualifiedPass: report.unqualifiedPass ?? false,
    knownIssues: report.knownIssues.length,
    checks: report.checks.length,
    cleanup: report.cleanup,
  }),
);
