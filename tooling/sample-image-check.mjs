import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = process.cwd();
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/sample-image');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const samplePath = exe
  ? resolve(dirname(exe), 'resources/presets/statue.png')
  : resolve(root, 'apps/desktop/resources/presets/statue.png');
const sampleBytes = await readFile(samplePath);
assert.ok(
  sampleBytes.equals(await readFile(resolve(root, 'apps/desktop/resources/presets/statue.png'))),
);
const original = await sharp(sampleBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const projectPath = resolve(profile, 'statue.gleech');
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const launch = () =>
  electron.launch({
    ...(exe ? { executablePath: resolve(exe) } : {}),
    args: [
      ...(exe ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
  });
let app = await launch(),
  page;
const errors = [];
async function setup() {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    globalThis.samplePrompts = 0;
    dialog.showOpenDialog = async () => {
      throw new Error('Sample image must not open a file picker.');
    };
    dialog.showMessageBox = async () => {
      globalThis.samplePrompts++;
      return { response: 1, checkboxChecked: false };
    };
  });
}
const status = (text) => page.getByRole('status').filter({ hasText: text }).waitFor();
const settle = () =>
  page.waitForFunction(() => {
    const node = document.querySelector('.image-layer');
    return (
      !node.hidden &&
      node.dataset.renderRevision === node.dataset.requestedRevision &&
      node.dataset.previewQuality === 'full' &&
      !document.querySelector('.operation-banner')
    );
  });
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((node) => ({
    effects: JSON.parse(node.dataset.renderRecipe),
    masterSeed: Number(node.dataset.renderSeed),
  }));
}
async function save(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
}
async function verify(name) {
  const current = await recipe();
  const expected = Buffer.from(
    renderEffects(
      {
        width: original.info.width,
        height: original.info.height,
        pixels: Uint8Array.from(original.data).buffer,
      },
      current.effects,
      { masterSeed: current.masterSeed },
    ).pixels,
  );
  const path = resolve(profile, `${name}.png`);
  await save(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status(`Exported ${name}.png`);
  const actual = await sharp(await readFile(path))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.ok(actual.equals(expected), `${name}: bundled sample pixels survive rendering/export`);
}
try {
  await setup();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, resolve(output, `${label}-welcome.png`));
  await page.getByRole('button', { name: 'Try sample image', exact: true }).click();
  await status('Opened statue.png');
  assert.deepEqual((await recipe()).effects, []);
  assert.equal(await app.evaluate(() => globalThis.samplePrompts), 0);
  await verify('original');
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'RGB split', exact: true })
    .click();
  const edited = await recipe();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      globalThis.samplePrompts++;
      return { response: 2, checkboxChecked: false };
    };
  });
  await fileAction(page, 'Open sample image');
  await status('Canceled');
  assert.deepEqual(await recipe(), edited);
  assert.equal(await app.evaluate(() => globalThis.samplePrompts), 1);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      globalThis.samplePrompts++;
      return { response: 1, checkboxChecked: false };
    };
  });
  await fileAction(page, 'Open sample image');
  await status('Opened statue.png');
  assert.deepEqual(await recipe(), edited);
  assert.equal(await app.evaluate(() => globalThis.samplePrompts), 2);
  await verify('edited');
  await save(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved statue.gleech');
  await fileAction(page, 'Open sample image');
  await status('Opened statue.png');
  assert.equal(await app.evaluate(() => globalThis.samplePrompts), 2);
  await closeTestApp(app);
  app = await launch();
  await setup();
  await app.evaluate(({ ipcMain, dialog }, path) => {
    ipcMain.removeHandler('image:open-sample');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectPath);
  await fileAction(page, 'Open project Ctrl+O');
  await status('Opened statue.gleech');
  assert.deepEqual(await recipe(), edited);
  await verify('reopened');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      label,
      sample: `${original.info.width}×${original.info.height}`,
      pixelExactExports: 3,
      welcomeAndMenu: true,
      unsavedWorkGuard: true,
      embeddedProject: true,
      errors,
    }),
  );
} finally {
  await closeTestApp(app);
}
