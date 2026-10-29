import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream, createWriteStream, watch } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';
import { load as yaml } from 'js-yaml';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import {
  findImageDesktop,
  ownedImageDescendants,
  parseLinuxProcessStat,
} from './linux-updater-processes.mjs';
import { targets } from './published-upgrade-plan.mjs';

// This deliberately uses the default profile and native installation paths.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use disposable native CI runners.');
const key = `${process.platform}-${process.arch}`;
assert.equal(process.env.EXPECTED_TARGET, key);
const target = targets[key];
assert.ok(target);
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'test-results/published-upgrade', key);
const artwork = join(output, 'artwork');
await mkdir(artwork, { recursive: true });
const installed =
  process.platform === 'darwin'
    ? '/Applications/GLEECH.app'
    : join(output, 'installed', process.platform === 'win32' ? 'GLEECH' : target.previous.archive);
const executable =
  process.platform === 'darwin'
    ? join(installed, 'Contents/MacOS/GLEECH')
    : process.platform === 'win32'
      ? join(installed, 'GLEECH.exe')
      : installed;
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
  // The old runtime shares its extraction directory. Retain it until this first
  // update finishes; verify the new runtime without this workaround afterwards.
  env.NO_CLEANUP = '1';
}
const run = promisify(execFile);
const command = (file, args) =>
  run(file, args, { env, shell: false, windowsHide: true, timeout: 180000, maxBuffer: 8e6 });
const require = createRequire(join(root, 'apps/desktop/package.json'));
const sharp = require('sharp');
const asar = require('@electron/asar');
const hash = async (path) => {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(path)) value.update(chunk);
  return value.digest('hex');
};
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
      const result = await fn();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(message + (last ? ': ' + last : ''));
}
const report = {
  target: key,
  from: '0.2.0',
  to: '0.2.1',
  packages: target,
  startedAt: new Date().toISOString(),
  transport:
    'Unmodified public GitHub release API and asset downloads; no network fixtures, routing changes, private receiver or rebuild.',
  checks: [],
  complete: false,
  limitations: [
    'CPU rendering and file-selection fixtures are used; physical GPUs and OS download-trust prompts are not certified.',
    'Saved project, preset, preference, profile, recovery checkpoint and relaunch are checked. Unsaved-state restoration was separately tested before publication.',
    'Windows 0.2.0 uses Settings → Updates for this first hop; its known CLI update defect remains in the old binary.',
    ...(process.platform === 'darwin'
      ? [
          'Finder selection is recorded; ZIP extraction and replacement at the original path are manual, as required for unsigned Mac builds.',
        ]
      : []),
    ...(process.platform === 'linux'
      ? [
          'The old AppImage uses extraction fallback with NO_CLEANUP=1 for its first upgrade. The new image is verified without NO_CLEANUP. FUSE and Omarchy/Wayland are not certified.',
        ]
      : []),
  ],
};
const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
async function check(name, fn) {
  console.log('START', name);
  report.activeCheck = name;
  await save();
  const start = Date.now();
  await fn();
  report.checks.push({ name, passed: true, durationMs: Date.now() - start });
  delete report.activeCheck;
  await save();
  console.log('PASS', name);
}
const base = 'https://github.com/Pixhell42/GLEECH/releases/download/';
const get = async (url) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'GLEECH-Published-Upgrade-Acceptance',
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(600000),
  });
  assert.equal(response.status, 200, `Public request failed: ${url}`);
  return response;
};
let app,
  page,
  profile,
  runtime,
  currentAsset,
  currentRelease,
  owned = false,
  relaunch,
  checkpointObserver;
const errors = [];
const logs = [];
const project = join(artwork, 'existing-project.gleech');
let savedProjectHash, expectedPixels, expectedRecipe, presetId;
const resources = () =>
  process.platform === 'darwin'
    ? join(installed, 'Contents/Resources')
    : join(installed, 'resources');
async function close() {
  if (!app) return;
  const closing = app;
  app = null;
  let timer;
  try {
    await Promise.race([
      closeTestApp(closing),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Application cleanup timed out.')), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function launch(version) {
  app = await electron.launch({
    executablePath: executable,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    env,
    timeout: 60000,
  });
  app.on('console', (message) => logs.push(message.text()));
  page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  runtime = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    profile: app.getPath('userData'),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    executable: process.execPath,
    resources: process.resourcesPath,
    args: process.argv,
    appImage: process.env.APPIMAGE ?? null,
  }));
  assert.equal(runtime.version, version);
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.platform + '-' + runtime.arch, key);
  assert.ok(!runtime.args.includes('--smoke-test'));
  if (profile) assert.equal(runtime.profile, profile);
  else profile = runtime.profile;
  // Observe requests, passing original arguments and responses through unchanged.
  // Only Finder's selection boundary is recorded instead of opening an OS window.
  await app.evaluate(({ net, shell }) => {
    globalThis.__publicUpgradeRequests = [];
    const observe = (url) => {
      if (/^https:\/\/(?:api\.github\.com|github\.com)\//.test(url))
        globalThis.__publicUpgradeRequests.push(url);
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      observe(String(input));
      return originalFetch(input, options);
    };
    const originalRequest = net.request.bind(net);
    net.request = (options) => {
      observe(
        typeof options === 'string'
          ? options
          : (options.url ??
              `${options.protocol ?? 'https:'}//${options.hostname ?? options.host}${options.port ? ':' + options.port : ''}${options.path ?? '/'}`),
      );
      return originalRequest(options);
    };
    shell.showItemInFolder = (path) => {
      globalThis.__publicUpgradeFinderSelection = path;
    };
  });
  if (version === '0.2.1') {
    const beforeChanges = await page.evaluate(() => window.gleech.updateState());
    assert.equal(beforeChanges.ok, true);
    assert.equal(
      beforeChanges.value.automatic,
      false,
      'The stored update preference must survive before the test changes it.',
    );
    report.preferencePreservedBeforeTestChanges = true;
  }
  const init = await page.evaluate(
    async (version) => ({
      preference: await window.gleech.setAutomaticUpdates(false),
      notes: await window.gleech.acknowledgeReleaseNotes(version),
      state: await window.gleech.updateState(),
    }),
    version,
  );
  assert.equal(init.preference.ok, true);
  assert.equal(init.notes.ok, true);
  assert.equal(init.state.value.installMode, process.platform === 'darwin' ? 'finder' : 'native');
  await page.getByRole('dialog', { name: /What’s new/ }).waitFor({ state: 'hidden' });
}
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
const recipe = () =>
  page.locator('.image-layer').evaluate((element) => ({
    effects: JSON.parse(element.dataset.renderRecipe),
    seed: Number(element.dataset.renderSeed),
  }));
async function exportPixels(name) {
  const path = join(artwork, name);
  await choose('save', path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await poll(() => exists(path), 'The PNG export was not written.');
  return sharp(path).ensureAlpha().raw().toBuffer();
}
async function linuxProcesses() {
  const records = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const directory = '/proc/' + entry;
      const stat = await readFile(join(directory, 'stat'), 'utf8');
      let executable = null;
      try {
        executable = await readlink(join(directory, 'exe'));
      } catch (error) {
        if (!['ENOENT', 'EACCES', 'EPERM', 'ESRCH'].includes(error.code)) throw error;
      }
      records.push(parseLinuxProcessStat(Number(entry), stat, executable));
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM', 'ESRCH'].includes(error.code)) throw error;
    }
  }
  return records;
}
async function windowsDesktopPid() {
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"name='GLEECH.exe'\" | Where-Object { $_.ExecutablePath -eq $env:GLEECH_ACCEPTANCE_EXECUTABLE -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }",
    ],
    {
      env: { ...env, GLEECH_ACCEPTANCE_EXECUTABLE: executable },
      windowsHide: true,
      timeout: 15000,
    },
  );
  const pids = stdout.trim().split(/\s+/).filter(Boolean).map(Number);
  assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 1));
  assert.ok(pids.length <= 1);
  return pids[0];
}
async function stopNativeRelaunch() {
  if (!relaunch) return;
  if (process.platform === 'win32')
    await command('taskkill.exe', ['/pid', String(relaunch.pid), '/t', '/f']);
  else {
    const record = (await linuxProcesses()).find(
      (value) => value.pid === relaunch.pid && value.start === relaunch.start,
    );
    if (record) process.kill(record.pid, 'SIGTERM');
  }
  relaunch = null;
  await new Promise((done) => setTimeout(done, 1500));
}
async function waitWindowsInstaller() {
  if (process.platform !== 'win32') return;
  await poll(async () => {
    for (const name of [target.previous.archive, target.current.archive]) {
      const { stdout } = await command('tasklist.exe', [
        '/FI',
        'IMAGENAME eq ' + name,
        '/FO',
        'CSV',
        '/NH',
      ]);
      if (stdout.toLowerCase().includes(name.toLowerCase())) return false;
    }
    return exists(join(installed, 'Uninstall GLEECH.exe'));
  }, 'NSIS did not finish writing the owned installation.');
}
async function installedVersion() {
  if (process.platform === 'linux') return (await hash(installed)) === target.current.sha256;
  const archive = join(resources(), 'app.asar');
  asar.uncache(archive);
  return JSON.parse(asar.extractFile(archive, 'package.json')).version === '0.2.1';
}
async function observeCheckpoint() {
  const folder = join(profile, 'update-recovery');
  await mkdir(folder, { recursive: true });
  await assert.rejects(access(join(folder, 'session.json')), { code: 'ENOENT' });
  let watcher, timer;
  const result = new Promise((accept, reject) => {
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const session = JSON.parse(await readFile(join(folder, 'session.json'), 'utf8'));
        assert.match(session.id, /^[a-f0-9-]{36}$/);
        assert.equal(session.hasProject, true);
        assert.equal(session.documentPath, project);
        await copyFile(
          join(folder, session.id + '.gleech'),
          join(artwork, 'update-checkpoint.gleech'),
        );
        watcher.close();
        clearTimeout(timer);
        accept(session);
      } catch (error) {
        reading = false;
        if (error.code !== 'ENOENT') reject(error);
      }
    };
    watcher = watch(folder, () => {
      void read();
    });
    timer = setTimeout(() => {
      watcher.close();
      reject(new Error('The update did not save a recovery checkpoint.'));
    }, 120000);
  });
  // Preserve the rejection for the awaited result without an unhandled event if
  // a separate native action fails before this promise is awaited.
  result.catch(() => {});
  return {
    result,
    stop() {
      watcher.close();
      clearTimeout(timer);
    },
  };
}
async function stopOwnedLinuxLaunches() {
  if (!owned || process.platform !== 'linux') return;
  const selected = ownedImageDescendants(await linuxProcesses(), installed).reverse();
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const current = await linuxProcesses();
    for (const record of selected)
      if (
        record.pid > 1 &&
        record.pid !== process.pid &&
        current.some((value) => value.pid === record.pid && value.start === record.start)
      ) {
        try {
          process.kill(record.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    if (signal === 'SIGTERM') await new Promise((done) => setTimeout(done, 1000));
  }
}
try {
  await check('published-metadata-and-original-0.2.0-package-match-pinned-hashes', async () => {
    for (const release of Object.values(target)) {
      const data = await (
        await get('https://api.github.com/repos/Pixhell42/GLEECH/releases/tags/' + release.tag)
      ).json();
      assert.equal(data.draft, false);
      assert.equal(data.tag_name, release.tag);
      const asset = data.assets.find((value) => value.name === release.archive);
      assert.ok(asset);
      assert.equal(asset.digest, 'sha256:' + release.sha256);
      assert.equal(asset.browser_download_url, base + release.tag + '/' + release.archive);
      if (release.version === '0.2.1') {
        currentAsset = asset;
        currentRelease = data;
      }
    }
    const download = join(output, 'download');
    await mkdir(download);
    const path = join(download, target.previous.archive);
    const response = await get(base + target.previous.tag + '/' + target.previous.archive);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: 'wx' }));
    assert.equal(await hash(path), target.previous.sha256);
    report.originalPackageVerified = true;
  });
  await check('install-unmodified-0.2.0-with-default-profile-and-real-updater', async () => {
    await assert.rejects(access(installed), { code: 'ENOENT' });
    owned = true;
    await mkdir(dirname(installed), { recursive: true });
    const path = join(output, 'download', target.previous.archive);
    if (process.platform === 'win32')
      await command(path, ['/S', '/currentuser', '/D=' + installed]);
    else if (process.platform === 'darwin') {
      const expanded = join(output, 'original-expanded');
      await command('ditto', ['-x', '-k', path, expanded]);
      await command('ditto', [join(expanded, 'GLEECH.app'), installed]);
    } else {
      await copyFile(path, installed);
      await chmod(installed, 0o755);
    }
    await launch('0.2.0');
    report.originalRuntime = runtime;
  });
  await check('existing-project-preset-and-preference-persisted-before-upgrade', async () => {
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
    await choose('save', project);
    await fileAction(page, 'Save project Ctrl+S');
    await page
      .getByRole('status')
      .filter({ hasText: 'Saved ' + basename(project) })
      .waitFor();
    savedProjectHash = await hash(project);
    await settle();
    expectedRecipe = await recipe();
    expectedPixels = await exportPixels('before-update.png');
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
          'Published upgrade preset',
          thumbnail,
          'image',
        ),
      { recipe: expectedRecipe, thumbnail },
    );
    assert.equal(stored.ok, true);
    presetId = stored.value.id;
    await page.evaluate(() => localStorage.setItem('gleech.ui.color', '#80baff'));
    await writeFile(
      join(profile, 'keep-published-upgrade-profile.txt'),
      'preserve published upgrade profile\n',
      { flag: 'wx' },
    );
  });
  await check('installed-0.2.0-selects-the-real-public-0.2.1-release-and-manifest', async () => {
    const result = await page.evaluate(() => window.gleech.checkForUpdates());
    assert.equal(result.ok, true);
    const state = result.value;
    assert.equal(state.phase, 'available', JSON.stringify(state));
    assert.equal(state.release.version, '0.2.1');
    assert.equal(state.release.tag, target.current.tag);
    assert.equal(state.release.asset, target.current.archive);
    assert.equal(state.release.sha256, target.current.sha256);
    assert.equal(state.release.bytes, currentAsset.size);
    assert.equal(state.release.downloadUrl, currentAsset.browser_download_url);
    const manifestName = `latest-${process.arch}${process.platform === 'darwin' ? '-mac' : process.platform === 'linux' ? '-linux' : ''}.yml`;
    const manifestAsset = currentRelease.assets.find((asset) => asset.name === manifestName);
    assert.ok(manifestAsset);
    const bytes = Buffer.from(
      await (await get(base + target.current.tag + '/' + manifestName)).arrayBuffer(),
    );
    const manifestSHA256 = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    assert.equal(manifestSHA256, manifestAsset.digest);
    const manifest = yaml(bytes.toString('utf8'));
    assert.equal(manifest.version, '0.2.1');
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].url, target.current.archive);
    assert.equal(manifest.files[0].size, currentAsset.size);
    report.publicDiscovery = {
      release: state.release,
      manifest: manifestName,
      manifestSHA256,
    };
  });
  await check(
    'real-updater-downloads-and-verifies-published-package-without-routing-fixtures',
    async () => {
      const result = await page.evaluate(async () => (await window.gleech.downloadUpdate()).value);
      assert.equal(result.phase, 'ready', JSON.stringify(result));
      assert.equal(result.release.sha256, target.current.sha256);
      report.readyState = result;
      report.publicRequests = await app.evaluate(() => globalThis.__publicUpgradeRequests);
      assert.ok(
        report.publicRequests.some((url) =>
          url.startsWith('https://api.github.com/repos/Pixhell42/GLEECH/releases?'),
        ),
      );
      assert.ok(report.publicRequests.some((url) => url === currentAsset.browser_download_url));
    },
  );
  await check(
    'settings-installs-upgrade-at-original-path-and-saves-recovery-checkpoint',
    async () => {
      const senderPid = runtime.pid;
      const observed = [];
      checkpointObserver = await observeCheckpoint();
      if (process.platform === 'darwin') {
        // Record Finder's real selected ZIP before app.quit destroys inspection.
        await app.evaluate(
          ({ shell }, receipt) => {
            shell.showItemInFolder = (path) =>
              process.getBuiltinModule('fs').writeFileSync(receipt, JSON.stringify({ path }));
          },
          join(output, 'finder-handoff.json'),
        );
      }
      const closed =
        process.platform === 'linux' ? null : app.waitForEvent('close', { timeout: 180000 });
      await fileAction(page, 'Settings');
      await page
        .getByRole('dialog', { name: 'Settings', exact: true })
        .getByRole('button', { name: 'Install & Update', exact: true })
        .click();
      report.recoveryCheckpoint = await checkpointObserver.result;
      checkpointObserver.stop();
      checkpointObserver = null;
      if (closed) await closed;
      else
        await poll(() => {
          try {
            process.kill(senderPid, 0);
            return false;
          } catch (error) {
            if (error.code === 'ESRCH') return true;
            throw error;
          }
        }, 'The old Electron desktop did not exit.');
      app = null;
      if (process.platform === 'darwin') {
        const handoff = JSON.parse(await readFile(join(output, 'finder-handoff.json'), 'utf8'));
        assert.equal(basename(handoff.path), target.current.archive);
        assert.equal(await hash(handoff.path), target.current.sha256);
        assert.equal((await lstat(installed)).isSymbolicLink(), false);
        await rm('/Applications/GLEECH.app', { recursive: true });
        const expanded = join(output, 'current-expanded');
        await command('ditto', ['-x', '-k', handoff.path, expanded]);
        await command('ditto', [join(expanded, 'GLEECH.app'), installed]);
        report.finderHandoff = {
          ...handoff,
          sha256: target.current.sha256,
          manualSamePathReplacement: true,
        };
      }
      await poll(installedVersion, 'The published 0.2.1 package was not installed.');
      await waitWindowsInstaller();
      if (process.platform !== 'darwin') {
        relaunch = await poll(async () => {
          if (process.platform === 'win32') {
            const pid = await windowsDesktopPid();
            return pid && { pid, executable };
          }
          const desktop = findImageDesktop(await linuxProcesses(), installed);
          if (desktop) observed.push(desktop);
          return desktop;
        }, 'The native updater did not relaunch the new desktop.');
        report.automaticRelaunch = relaunch;
        report.linuxRelaunchObservations = observed;
        await stopNativeRelaunch();
      }
      assert.equal(await hash(project), savedProjectHash);
      report.sameInstallationPath = installed;
    },
  );
  await check(
    'published-0.2.1-retains-default-profile-project-preset-and-preferences',
    async () => {
      delete env.NO_CLEANUP;
      await launch('0.2.1');
      report.currentRuntime = runtime;
      assert.equal(runtime.profile, report.originalRuntime.profile);
      assert.equal(
        await readFile(join(profile, 'keep-published-upgrade-profile.txt'), 'utf8'),
        'preserve published upgrade profile\n',
      );
      const values = await page.evaluate(async () => ({
        color: localStorage.getItem('gleech.ui.color'),
        presets: await window.gleech.listPresets(),
        state: await window.gleech.updateState(),
      }));
      assert.equal(values.color, '#80baff');
      assert.ok(values.presets.value.some((preset) => preset.id === presetId));
      assert.equal(values.state.value.currentVersion, '0.2.1');
      assert.equal(values.state.value.automatic, false);
      if (process.platform !== 'linux') {
        const result = await run(
          executable,
          [join(runtime.resources, 'cli/gleech.cjs'), '--version'],
          {
            env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
            shell: false,
            windowsHide: true,
            timeout: 60000,
          },
        );
        assert.equal(result.stdout.trim(), '0.2.1');
        report.embeddedCliVersion = result.stdout.trim();
      }
      await choose('open', project);
      await fileAction(page, 'Open project Ctrl+O');
      await settle();
      assert.deepEqual(await recipe(), expectedRecipe);
      assert.ok((await exportPixels('after-update.png')).equals(expectedPixels));
      assert.equal(await hash(project), savedProjectHash);
      report.projectProof = {
        originalSHA256: savedProjectHash,
        afterUpgradeSHA256: await hash(project),
        pixelSHA256: createHash('sha256').update(expectedPixels).digest('hex'),
        presetId,
      };
      await page.screenshot({ path: join(output, 'published-upgrade.png') });
    },
  );
  await check('published-0.2.1-does-not-offer-itself-again', async () => {
    const result = await page.evaluate(() => window.gleech.checkForUpdates());
    assert.equal(result.ok, true);
    assert.equal(result.value.phase, 'idle', JSON.stringify(result.value));
    assert.equal(result.value.release, null);
    assert.equal(result.value.error, null);
  });
  if (process.platform === 'linux')
    await check(
      'new-appimage-keeps-sibling-extraction-intact-and-cleans-its-own-directory',
      async () => {
        assert.equal(env.NO_CLEANUP, undefined);
        const path = join(runtime.resources, 'app-update.yml');
        assert.equal(await exists(path), true);
        const result = await command(installed, ['--cli', '--version']);
        assert.equal(result.stdout.trim(), '0.2.1');
        assert.equal(await exists(path), true);
        const provenance = JSON.parse(
          await readFile(
            join(runtime.resources, 'appimage-runtime-notices/provenance.json'),
            'utf8',
          ),
        );
        assert.equal(provenance.extraction, 'mkdtemp-per-invocation');
        const extracted = dirname(runtime.resources);
        assert.match(basename(extracted), /^appimage_extracted_[A-Za-z0-9]{6}$/);
        await close();
        await poll(
          async () => !(await exists(extracted)),
          'The new AppImage extraction was not cleaned.',
        );
        report.linuxExtraction = {
          noCleanupUnset: true,
          siblingPreserved: true,
          cleanedAfterExit: true,
          extracted,
        };
      },
    );
  assert.deepEqual(errors, []);
  report.complete = true;
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
    checkpointObserver?.stop();
    await close();
    await stopNativeRelaunch();
    await stopOwnedLinuxLaunches();
    if (owned && (await exists(installed))) {
      assert.equal((await lstat(installed)).isSymbolicLink(), false);
      if (process.platform === 'win32') {
        await waitWindowsInstaller();
        await command(join(installed, 'Uninstall GLEECH.exe'), ['/S']);
        await poll(async () => !(await exists(installed)), 'Owned installation was not removed.');
      } else if (process.platform === 'darwin')
        await rm('/Applications/GLEECH.app', { recursive: true });
      else {
        assert.equal(installed, join(output, 'installed', target.previous.archive));
        await rm(installed);
      }
    }
    if (savedProjectHash) assert.equal(await hash(project), savedProjectHash);
    if (profile)
      assert.equal(
        await readFile(join(profile, 'keep-published-upgrade-profile.txt'), 'utf8'),
        'preserve published upgrade profile\n',
      );
    report.cleanup = 'passed';
  } catch (error) {
    report.cleanupError = String(error.stack ?? error);
    report.complete = false;
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'application.log'), logs.join('\n') + '\n');
  await save();
}
console.log(
  JSON.stringify({
    target: key,
    passed: report.complete,
    checks: report.checks.length,
    cleanup: report.cleanup,
  }),
);
