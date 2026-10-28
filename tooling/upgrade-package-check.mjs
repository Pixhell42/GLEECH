import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';
import { targets } from './upgrade-acceptance-plan.mjs';

// Default-profile and OS registration checks belong on disposable native runners.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run this check on a disposable GitHub runner.');
const key = `${process.platform}-${process.arch}`;
const target = targets[key];
assert.ok(target);
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'test-results/upgrade-acceptance', key);
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
const resources =
  process.platform === 'darwin'
    ? join(installed, 'Contents/Resources')
    : process.platform === 'win32'
      ? join(installed, 'resources')
      : null;
const stable =
  process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA, 'GLEECH/bin/gleech.cmd')
    : join(homedir(), '.local/bin/gleech');
const env = { ...process.env, GLEECH_NO_UPDATE_NOTIFIER: '1', SHELL: '/bin/bash', NO_COLOR: '1' };
for (const name of [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'GLEECH_SMOKE_USER_DATA',
  'GLEECH_USER_DATA',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'NODE_OPTIONS',
])
  delete env[name];
if (process.platform === 'linux') env.APPIMAGE_EXTRACT_AND_RUN = '1';
const run = promisify(execFile);
const report = {
  from: '0.1.2',
  to: '0.2.0',
  target: key,
  startedAt: new Date().toISOString(),
  packages: target,
  installed,
  normalMode: true,
  defaultProfile: true,
  checks: [],
  complete: false,
  limitations: [
    '0.1.2 has no built-in updater: this verifies the manual first upgrade, not an automatic 0.1.2 update.',
    'Native dialogs use file-selection fixtures; OS download-approval prompts and physical GPU hardware are not certified.',
    ...(process.platform === 'linux'
      ? [
          'AppImage uses the documented extraction fallback under Xvfb; FUSE and Omarchy/Wayland are not certified.',
        ]
      : []),
  ],
};
const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const hash = async (path) => {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(path)) value.update(chunk);
  return value.digest('hex');
};
const command = (file, args) =>
  run(file, args, { env, shell: false, windowsHide: true, timeout: 180000, maxBuffer: 8e6 });
async function check(name, fn) {
  console.log('START', name);
  const started = Date.now();
  await fn();
  report.checks.push({ name, passed: true, durationMs: Date.now() - started });
  await save();
  console.log('PASS', name);
}
async function install(release) {
  const artifact = join(output, 'download', release.archive);
  assert.equal(await hash(artifact), release.sha256);
  await mkdir(dirname(installed), { recursive: true });
  if (process.platform === 'win32')
    await command(artifact, ['/S', '/currentuser', '/D=' + installed]);
  else if (process.platform === 'darwin') {
    const expanded = join(output, 'expanded-' + release.version);
    await command('ditto', ['-x', '-k', artifact, expanded]);
    if (release.version === '0.2.0') {
      assert.equal(report.runtime012.version, '0.1.2');
      assert.equal((await lstat(installed)).isSymbolicLink(), false);
      await rm('/Applications/GLEECH.app', { recursive: true });
    }
    await command('ditto', [join(expanded, 'GLEECH.app'), installed]);
  } else {
    await copyFile(artifact, installed);
    await chmod(installed, 0o755);
  }
  await access(executable);
}
async function cli(args, managed = true) {
  const file = managed
    ? stable
    : process.platform === 'linux'
      ? installed
      : join(resources, 'cli', process.platform === 'win32' ? 'gleech.cmd' : 'gleech');
  if (process.platform === 'win32') {
    const parts = [file, ...args].map((value) => {
      assert.match(value, /^[a-zA-Z0-9_./:\\ ()-]+$/);
      return '"' + value + '"';
    });
    return (
      await run('cmd.exe', ['/d', '/s', '/c', '"' + parts.join(' ') + '"'], {
        env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 180000,
        maxBuffer: 8e6,
      })
    ).stdout;
  }
  if (process.platform !== 'linux' || managed) return (await command(file, args)).stdout;
  return new Promise((accept, reject) => {
    const child = spawn(file, ['--cli', ...args], {
      env: { ...env, GLEECH_CLI_RESTORE_STDOUT: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
      timeout: 180000,
    });
    let stdout = '',
      stderr = '';
    child.stdio[3].on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? accept(stdout) : reject(new Error(stderr))));
  });
}
let app,
  page,
  profile,
  owned = false,
  cliInstalled = false,
  originalPath;
const errors = [];
async function launch(version) {
  app = await electron.launch({
    executablePath: executable,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  const runtime = await app.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    profile: app.getPath('userData'),
    arch: process.arch,
    platform: process.platform,
    executable: process.execPath,
    appimage: process.env.APPIMAGE ?? null,
    args: process.argv,
  }));
  assert.equal(runtime.version, version);
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.platform + '-' + runtime.arch, key);
  assert.ok(!runtime.args.includes('--smoke-test'));
  assert.ok(!runtime.args.some((arg) => arg.startsWith('--user-data-dir')));
  if (profile) assert.equal(runtime.profile, profile);
  else profile = runtime.profile;
  if (process.platform === 'linux') assert.equal(runtime.appimage, installed);
  else assert.equal(resolve(runtime.executable).toLowerCase(), executable.toLowerCase());
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  if (version === '0.2.0') {
    const result = await page.evaluate(async () => ({
      preferences: await window.gleech.setAutomaticUpdates(false),
      notes: await window.gleech.acknowledgeReleaseNotes('0.2.0'),
      state: await window.gleech.updateState(),
    }));
    assert.equal(result.preferences.ok, true);
    assert.equal(result.notes.ok, true);
    assert.equal(result.state.ok, true);
    assert.equal(
      result.state.value.installMode,
      process.platform === 'darwin' ? 'finder' : 'native',
    );
    await page.getByRole('dialog', { name: /What’s new/ }).waitFor({ state: 'hidden' });
    report.updater020 = {
      currentVersion: result.state.value.currentVersion,
      installMode: result.state.value.installMode,
    };
  }
  return runtime;
}
async function close() {
  if (app) {
    const closing = app;
    app = null;
    await closeTestApp(closing);
  }
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
async function action(version, name) {
  if (version === '0.2.0') return fileAction(page, name);
  const toggle = page.getByRole('button', { name: 'File menu', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const group = name.startsWith('Save project')
    ? 'Save'
    : name.startsWith('Quick PNG')
      ? 'Export'
      : null;
  if (group)
    await page
      .locator('.file-menu-items')
      .getByRole('button', { name: group, exact: true })
      .click();
  await page.locator('.file-menu-items').getByRole('button', { name, exact: true }).click();
  await page.locator('.operation-banner').waitFor({ state: 'hidden', timeout: 180000 });
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
    { timeout: 180000 },
  );
}
async function recipe() {
  await settle();
  return page
    .locator('.image-layer')
    .evaluate((element) => ({
      effects: JSON.parse(element.dataset.renderRecipe),
      seed: Number(element.dataset.renderSeed),
    }));
}
const sharp = createRequire(join(root, 'apps/desktop/package.json'))('sharp');
async function exported(version, name) {
  const path = join(artwork, name);
  await choose('save', path);
  await action(version, 'Quick PNG Export Ctrl+Shift+E');
  await page
    .getByRole('status')
    .filter({ hasText: 'Exported ' + name })
    .waitFor();
  return sharp(path).ensureAlpha().raw().toBuffer();
}
const project = join(artwork, 'created-in-0.1.2.gleech');
let oldRecipe, oldPixels, oldProjectHash, launcherHash, presetId, shaderId, presetHash, shaderHash;
try {
  await assert.rejects(access(installed), { code: 'ENOENT' });
  await assert.rejects(access(stable), { code: 'ENOENT' });
  if (process.platform === 'win32')
    originalPath = (await command('reg.exe', ['query', 'HKCU\\Environment', '/v', 'Path'])).stdout;
  await check('install-and-launch-published-0.1.2', async () => {
    owned = true;
    await install(target.previous);
    report.runtime012 = await launch('0.1.2');
    report.defaultUserData = profile;
    assert.equal(await page.evaluate(() => typeof window.gleech.updateState), 'undefined');
    report.automaticUpgradeFrom012 = false;
  });
  await check('create-real-0.1.2-project-preset-shader-and-preferences', async () => {
    const input = join(artwork, 'original.png');
    const pixels = Buffer.alloc(97 * 65 * 4);
    for (let i = 0; i < pixels.length; i += 4)
      pixels.set([(i * 13) % 256, (i * 17 + 41) % 256, (i * 23 + 87) % 256, 255], i);
    await sharp(pixels, { raw: { width: 97, height: 65, channels: 4 } })
      .png()
      .toFile(input);
    await choose('open', input);
    await action('0.1.2', 'Open image Ctrl+Shift+O');
    await page.getByRole('status').filter({ hasText: 'Opened original.png' }).waitFor();
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page
      .locator('.effect-picker')
      .getByRole('button', { name: 'RGB split', exact: true })
      .click();
    await page.getByRole('spinbutton', { name: 'Master seed' }).fill('123456789');
    oldRecipe = await recipe();
    assert.equal(oldRecipe.effects.length, 1);
    oldPixels = await exported('0.1.2', 'before-upgrade.png');
    await choose('save', project);
    await action('0.1.2', 'Save project Ctrl+S');
    await page
      .getByRole('status')
      .filter({ hasText: 'Saved ' + basename(project) })
      .waitFor();
    oldProjectHash = await hash(project);
    assert.ok((await readFile(project)).subarray(0, 8).equals(Buffer.from('GLEECH02')));
    const thumbnail =
      'data:image/png;base64,' +
      (
        await sharp({ create: { width: 16, height: 16, channels: 4, background: '#80baff' } })
          .png()
          .toBuffer()
      ).toString('base64');
    const shader = {
      format: 'gleech-shader',
      schemaVersion: 1,
      id: 'upgrade.fixture',
      version: '1.0.0',
      name: 'Upgrade fixture shader',
      description: 'Synthetic upgrade acceptance fixture.',
      authors: [{ name: 'GLEECH test fixture' }],
      license: { expression: 'MIT' },
      kind: 'image',
      language: 'wgsl',
      entryPoint: 'gleechShade',
      controls: [],
      source: 'fn gleechShade(context: GleechShaderContext) -> vec4f { return context.source; }',
    };
    const stored = await page.evaluate(
      async ({ recipe, thumbnail, shader }) => ({
        preset: await window.gleech.storePreset(
          { masterSeed: recipe.seed, effects: recipe.effects },
          'Upgrade from 0.1.2',
          thumbnail,
          'image',
        ),
        shader: await window.gleech.storeShader(shader, thumbnail),
      }),
      { recipe: oldRecipe, thumbnail, shader },
    );
    assert.equal(stored.preset.ok, true, JSON.stringify(stored.preset));
    assert.equal(stored.shader.ok, true, JSON.stringify(stored.shader));
    presetId = stored.preset.value.id;
    shaderId = stored.shader.value.id;
    await page.evaluate(() => {
      localStorage.setItem('gleech.ui.color', '#80baff');
      localStorage.setItem('gleech.ui.panel-growth', JSON.stringify({ left: 42, right: 37 }));
    });
    await writeFile(join(profile, 'keep-upgrade-profile.txt'), 'preserve default profile\n');
    await close();
    presetHash = await hash(join(profile, 'presets.json'));
    shaderHash = await hash(join(profile, 'shaders.json'));
    report.artwork = {
      projectSHA256: oldProjectHash,
      pixelsSHA256: createHash('sha256').update(oldPixels).digest('hex'),
      presetId,
      shaderId,
    };
  });
  await check('original-managed-cli-installed-on-0.1.2', async () => {
    assert.equal((await cli(['--version'], false)).trim(), '0.1.2');
    await cli(['install-cli'], false);
    cliInstalled = true;
    assert.equal((await cli(['--version'])).trim(), '0.1.2');
    launcherHash = await hash(stable);
  });
  await check('manual-upgrade-over-existing-installation', async () => {
    await install(target.current);
    report.runtime020 = await launch('0.2.0');
    assert.equal(
      await hash(stable),
      launcherHash,
      'Upgrade must not rewrite the existing terminal launcher.',
    );
    assert.equal(await hash(project), oldProjectHash);
  });
  await check('default-profile-libraries-and-preferences-retained', async () => {
    const state = await page.evaluate(async () => ({
      color: localStorage.getItem('gleech.ui.color'),
      panels: localStorage.getItem('gleech.ui.panel-growth'),
      accent: document.documentElement.style.getPropertyValue('--color-accent'),
      presets: await window.gleech.listPresets(),
      shaders: await window.gleech.listShaders(),
      recents: await window.gleech.listRecentProjects(),
    }));
    assert.equal(state.color, '#80baff');
    assert.equal(state.accent, '#80baff');
    assert.deepEqual(JSON.parse(state.panels), { left: 42, right: 37 });
    assert.equal(state.presets.ok, true);
    assert.ok(
      state.presets.value.some((p) => p.id === presetId && p.name === 'Upgrade from 0.1.2'),
    );
    assert.equal(state.shaders.ok, true);
    assert.ok(
      state.shaders.value.some((s) => s.id === shaderId && s.package.id === 'upgrade.fixture'),
    );
    assert.equal(state.recents.ok, true);
    assert.ok(state.recents.value.some((p) => p.path === project));
    assert.equal(await hash(join(profile, 'presets.json')), presetHash);
    assert.equal(await hash(join(profile, 'shaders.json')), shaderHash);
  });
  await check('0.1.2-project-opens-and-exports-identical-pixels-in-0.2.0', async () => {
    await choose('open', project);
    await action('0.2.0', 'Open project Ctrl+O');
    await page
      .getByRole('status')
      .filter({ hasText: 'Opened ' + basename(project) })
      .waitFor();
    assert.deepEqual(await recipe(), oldRecipe);
    assert.ok((await exported('0.2.0', 'after-upgrade.png')).equals(oldPixels));
    await choose('save', join(artwork, 'saved-in-0.2.0.gleech'));
    await action('0.2.0', 'Save project as… Ctrl+Shift+S');
    await page.getByRole('status').filter({ hasText: 'Saved saved-in-0.2.0.gleech' }).waitFor();
    assert.equal(await hash(project), oldProjectHash);
    await captureTestWindow(app, join(output, 'upgraded-0.2.0.png'));
    await close();
  });
  await check('original-cli-launcher-now-runs-and-renders-with-0.2.0', async () => {
    assert.equal((await cli(['--version'])).trim(), '0.2.0');
    assert.equal(await hash(stable), launcherHash);
    const path = join(artwork, 'terminal-after-upgrade.png');
    await cli(['render', project, '--renderer', 'cpu', '-o', path]);
    assert.ok((await sharp(path).ensureAlpha().raw().toBuffer()).equals(oldPixels));
  });
  await check('0.2.0-restart-retains-recents-and-reads-saved-project', async () => {
    await launch('0.2.0');
    await choose('open', join(artwork, 'saved-in-0.2.0.gleech'));
    await action('0.2.0', 'Open project Ctrl+O');
    await settle();
    assert.deepEqual(await recipe(), oldRecipe);
    await close();
  });
  assert.deepEqual(errors, []);
  report.complete = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  try {
    await close();
    if (cliInstalled) {
      await cli(['uninstall-cli'], false);
      await assert.rejects(access(stable), { code: 'ENOENT' });
      if (process.platform === 'win32')
        assert.equal(
          (await command('reg.exe', ['query', 'HKCU\\Environment', '/v', 'Path'])).stdout,
          originalPath,
        );
    }
    if (owned) {
      assert.equal((await lstat(installed)).isSymbolicLink(), false);
      if (process.platform === 'win32') {
        await command(join(installed, 'Uninstall GLEECH.exe'), ['/S']);
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          try {
            await access(executable);
          } catch (error) {
            assert.equal(error.code, 'ENOENT');
            break;
          }
          await new Promise((done) => setTimeout(done, 250));
        }
      } else if (process.platform === 'darwin')
        await rm('/Applications/GLEECH.app', { recursive: true });
      else {
        assert.equal(installed, join(output, 'installed', target.previous.archive));
        await rm(installed);
      }
      await assert.rejects(access(executable), { code: 'ENOENT' });
      if (oldProjectHash) {
        assert.equal(await hash(project), oldProjectHash);
        assert.equal(
          await readFile(join(profile, 'keep-upgrade-profile.txt'), 'utf8'),
          'preserve default profile\n',
        );
        assert.equal(await hash(join(profile, 'presets.json')), presetHash);
        assert.equal(await hash(join(profile, 'shaders.json')), shaderHash);
      }
    }
    report.cleanup = 'passed';
  } catch (error) {
    report.complete = false;
    report.cleanupError = String(error.stack ?? error);
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await save();
}
console.log(
  JSON.stringify({
    target: key,
    passed: report.complete,
    checks: report.checks.length,
    automaticUpgradeFrom012: false,
    cleanup: report.cleanup,
  }),
);
