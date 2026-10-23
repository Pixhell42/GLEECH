// All update/install network calls are fixtures; the recovery/renderer/IPC path is real.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';
import { modelUrl } from './effects-reference.mjs';

const model = await import(modelUrl);
const currentVersion = JSON.parse(
  await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
).version;
const nextParts = currentVersion.split('.').map(Number);
nextParts[2]++;
const nextVersion = nextParts.join('.');
const exe = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const output = resolve('test-results/updates');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, `${exe ? 'packaged' : 'built'}-profile-`));
const original = join(profile, 'working-project.gleech');
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: profile,
  GLEECH_TEST_NATIVE_FRAMES: '1',
  GLEECH_SMOKE_GITHUB_CLIENT_ID: '',
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const errors = [];
async function launch() {
  const app = await electron.launch({
    args: [
      ...(exe ? [] : [resolve('apps/desktop')]),
      '--smoke-test',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
    env,
    ...(exe ? { executablePath: resolve(exe) } : {}),
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog, shell }, original) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 820);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: original });
    globalThis.__settingsLinks = [];
    shell.openExternal = async (url) => {
      globalThis.__settingsLinks.push(url);
    };
    shell.openPath = async (path) => {
      globalThis.__settingsLinks.push(path);
      return '';
    };
  }, original);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  return { app, page };
}
let instance = await launch();
try {
  let { app, page } = instance;
  await fileAction(page, 'Settings');
  let settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  assert.deepEqual(await settings.locator('nav button').allTextContents(), [
    'Updates',
    'Donate',
    'Feedback',
    'Community',
    'About',
  ]);
  await settings.getByRole('heading', { name: 'Updates', exact: true }).waitFor();
  assert.equal(await settings.getByRole('switch', { name: 'Automatic updates' }).isChecked(), true);
  await settings.getByRole('switch', { name: 'Automatic updates' }).uncheck();
  await page.waitForFunction(
    async () => (await window.gleech.updateState()).value.automatic === false,
  );
  for (const section of ['Updates', 'Donate', 'Feedback', 'Community', 'About']) {
    await settings.locator('nav').getByRole('button', { name: section, exact: true }).click();
    assert.ok(await settings.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    await captureTestWindow(
      app,
      join(output, `${exe ? 'packaged' : 'built'}-settings-${section.toLowerCase()}.png`),
    );
  }
  await settings.getByRole('button', { name: 'View GitHub repository' }).click();
  for (const name of ['GLEECH license', 'Third-party notices', 'Bundled licenses'])
    await settings.getByRole('button', { name, exact: true }).click();
  assert.equal((await app.evaluate(() => globalThis.__settingsLinks)).length, 4);
  await settings.getByRole('button', { name: 'Close settings' }).click();
  // Seed the actual checkpoint with an embedded source and LFO, as if updating an unsaved file.
  const imported = await page.evaluate(async () => (await window.gleech.openSampleImage()).value);
  const effect = model.createEffect('motion-mosh', 'update-fixture-effect');
  const project = {
    ...model.createProject('Update recovery', 8172),
    source: imported.source,
    timeline: model.createTimeline(),
    effects: [
      {
        ...effect,
        animation: {
          amount: { keys: [], modulators: [{ ...model.createLfo('update-lfo'), shape: 'square' }] },
        },
      },
    ],
  };
  const prepared = await page.evaluate(
    async (project) =>
      window.gleech.prepareUpdateSession(project, null, {
        dirty: true,
        mode: 'timeline',
        playhead: 12,
      }),
    project,
  );
  assert.equal(prepared.ok, true);
  await closeTestApp(app);
  instance = await launch();
  ({ app, page } = instance);
  await page.locator('.timeline-dock').waitFor();
  await page.locator('.image-layer').waitFor();
  await page.locator('[data-parameter-key="amount"] .track-name').click();
  let shapes = page.getByRole('radiogroup', { name: 'Shape', exact: true });
  assert.equal(await shapes.locator('svg').count(), 5);
  assert.deepEqual(await shapes.getByRole('radio').allTextContents(), ['', '', '', '', '']);
  for (const name of ['Sine', 'Triangle', 'Square', 'Saw', 'Random steps']) {
    await shapes.getByRole('radio', { name, exact: true }).click();
    assert.equal(
      await shapes.getByRole('radio', { name, exact: true }).getAttribute('aria-checked'),
      'true',
    );
  }
  await shapes.getByRole('radio', { name: 'Square', exact: true }).click();
  assert.ok(await shapes.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  await captureTestWindow(app, join(output, `${exe ? 'packaged' : 'built'}-lfo-icons.png`));
  await fileAction(page, 'Save project Ctrl+S');
  const originalBytes = await readFile(original);
  await shapes.getByRole('radio', { name: 'Triangle', exact: true }).click();
  const timecode = await page.locator('.timecode').textContent();
  await fileAction(page, 'Settings');
  settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  assert.equal(
    await settings.getByRole('switch', { name: 'Automatic updates' }).isChecked(),
    false,
    'Opt-out survives restart',
  );
  await settings.getByRole('switch', { name: 'Automatic updates' }).check();
  await page.waitForFunction(
    async () => (await window.gleech.updateState()).value.automatic === true,
  );
  await settings.locator('input[aria-label="Automatic updates"]:enabled').waitFor();
  const base = await page.evaluate(async () => (await window.gleech.updateState()).value);
  await app.evaluate(
    ({ ipcMain, BrowserWindow }, { base, nextVersion }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const state = {
        ...base,
        installMode: 'native',
        unavailableReason: null,
        phase: 'idle',
        release: null,
      };
      globalThis.__updateFixtureState = state;
      const send = (patch) => {
        Object.assign(state, patch);
        state.revision++;
        win.webContents.send('updates:changed', structuredClone(state));
        return { ok: true, value: structuredClone(state) };
      };
      const replace = (channel, handler) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
      };
      const release = {
        version: nextVersion,
        notes: 'Fixture update',
        url: `https://github.com/Pixhell42/GLEECH/releases/tag/v${nextVersion}`,
        tag: `v${nextVersion}`,
        asset: `GLEECH-${nextVersion}-x64-setup.exe`,
        downloadUrl: '',
        bytes: 100,
        sha256: 'a'.repeat(64),
      };
      replace('updates:check', () => {
        const result = send({ phase: 'available', release, checkedAt: new Date().toISOString() });
        queueMicrotask(() =>
          send({
            phase: 'downloading',
            progress: { percent: 40, transferred: 40, total: 100, bytesPerSecond: 10 },
          }),
        );
        return result;
      });
      replace('updates:download', () => ({ ok: true, value: structuredClone(state) }));
      replace('updates:dismiss', () => send({ dismissedVersion: release.version }));
      replace('updates:install', (_event, id) => {
        globalThis.__preparedUpdateSession = id;
        send({ phase: 'installing' });
        return { ok: true, value: undefined };
      });
      globalThis.__finishUpdateDownload = () =>
        send({
          phase: 'ready',
          progress: { percent: 100, transferred: 100, total: 100, bytesPerSecond: 0 },
        });
      send({});
    },
    { base, nextVersion },
  );
  await settings
    .getByRole('button', { name: 'Check for updates now' })
    .click({ timeout: 5000 })
    .catch(async (error) => {
      console.log(
        'Fixture state',
        JSON.stringify(await app.evaluate(() => globalThis.__updateFixtureState)),
      );
      console.log('Settings UI', await settings.textContent());
      await captureTestWindow(app, join(output, 'fixture-failure.png'));
      throw error;
    });
  await settings
    .getByRole('status')
    .filter({ hasText: `Downloading ${nextVersion}` })
    .waitFor();
  await settings.getByRole('button', { name: 'Close settings' }).click();
  const notification = page.getByRole('status', { name: 'Software update' });
  await notification.waitFor();
  const bounds = await notification.boundingBox();
  assert.ok(bounds.x < 30 && bounds.y > 400, 'Update notice occupies the lower-left corner');
  await captureTestWindow(
    app,
    join(output, `${exe ? 'packaged' : 'built'}-update-notification.png`),
  );
  await notification.getByRole('button', { name: 'Dismiss update notification' }).click();
  await notification.waitFor({ state: 'hidden' });
  await fileAction(page, 'Settings');
  await settings.getByRole('button', { name: 'Install & Update', exact: true }).click();
  const progress = page.getByRole('dialog', {
    name: `Update GLEECH to ${nextVersion}`,
    exact: true,
  });
  await progress.getByRole('progressbar').waitFor();
  assert.equal(await progress.getByRole('progressbar').getAttribute('value'), '40');
  await captureTestWindow(app, join(output, `${exe ? 'packaged' : 'built'}-update-progress.png`));
  await app.evaluate(() => globalThis.__finishUpdateDownload());
  await page.waitForFunction(async () => (await window.gleech.updateState()).ok); // Wait for IPC responsiveness.
  for (let i = 0; i < 100 && !(await app.evaluate(() => globalThis.__preparedUpdateSession)); i++)
    await new Promise((done) => setTimeout(done, 100));
  const session = JSON.parse(
    await readFile(join(profile, 'update-recovery', 'session.json'), 'utf8'),
  );
  assert.equal(session.id, await app.evaluate(() => globalThis.__preparedUpdateSession));
  assert.equal(session.documentPath, original);
  assert.equal(session.dirty, true);
  assert.equal(session.mode, 'timeline');
  assert.deepEqual(
    await readFile(original),
    originalBytes,
    'Updating does not overwrite the saved project with unsaved edits',
  );
  await closeTestApp(app);
  const preferences = JSON.parse(await readFile(join(profile, 'updates.json'), 'utf8'));
  await writeFile(
    join(profile, 'updates.json'),
    JSON.stringify({
      ...preferences,
      lastSeenVersion: '0.1.2',
      pendingNotes: {
        version: currentVersion,
        notes: 'Fixture notes: restored project and preserved settings.',
      },
    }),
  );
  instance = await launch();
  ({ app, page } = instance);
  const notes = page.getByRole('dialog', {
    name: `What’s new in GLEECH ${currentVersion}`,
    exact: true,
  });
  await notes
    .getByText('Fixture notes: restored project and preserved settings.', { exact: true })
    .waitFor();
  await captureTestWindow(app, join(output, `${exe ? 'packaged' : 'built'}-whats-new.png`));
  await notes.getByRole('button', { name: 'Let’s create', exact: true }).click();
  await page.locator('.timeline-dock').waitFor();
  assert.equal(await page.locator('.timecode').textContent(), timecode);
  await page.locator('[data-parameter-key="amount"] .track-name').click();
  shapes = page.getByRole('radiogroup', { name: 'Shape', exact: true });
  assert.equal(
    await shapes.getByRole('radio', { name: 'Triangle', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  assert.ok(
    (await page.title()).startsWith('• '),
    'Unsaved edits remain unsaved after restoration',
  );
  assert.deepEqual(await readFile(original), originalBytes);
  await assert.rejects(access(join(profile, 'update-recovery', 'session.json')));
  await fileAction(page, 'Save project Ctrl+S');
  assert.notEqual(
    createHash('sha256')
      .update(await readFile(original))
      .digest('hex'),
    createHash('sha256').update(originalBytes).digest('hex'),
    'Save still targets the original working file',
  );
  await closeTestApp(app);
  instance = await launch();
  ({ app, page } = instance);
  const state = await page.evaluate(async () => (await window.gleech.updateState()).value);
  assert.equal(state.whatsNew, null, 'Patch notes are not repeated after acknowledgement');
  assert.equal(state.automatic, true);
  assert.deepEqual(errors, []);
  const result = {
    mode: exe ? 'packaged' : 'built',
    settings: 5,
    lfoIcons: 5,
    defaultAutomatic: true,
    optOutPersisted: true,
    notificationDismissed: true,
    downloadProgress: true,
    unsavedRecovery: true,
    originalDocumentBinding: true,
    notesOncePerVersion: true,
    realInstallPerformed: false,
    errors,
  };
  await writeFile(
    join(output, `${exe ? 'packaged' : 'built'}-result.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await closeTestApp(instance.app);
}
