import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((x) => x.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/field-consumers');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 129,
  height = 97;
const pixels = Buffer.from(
  Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
  ),
);
const imagePath = resolve(output, `${label}-input.png`);
const projectPath = resolve(output, `${label}.gleech`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const launch = () =>
  electron.launch({
    args: [
      ...(exe ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    ...(exe ? { executablePath: resolve(exe) } : {}),
  });
let app = await launch(),
  page,
  exports = 0;
const errors = [];
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
}
async function settle() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.waitForFunction(
    () => {
      const node = document.querySelector('.image-layer');
      return node && node.dataset.renderRevision === node.dataset.requestedRevision;
    },
    undefined,
    { timeout: 60000 },
  );
}
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((node) => ({
    effects: JSON.parse(node.dataset.renderRecipe),
    masterSeed: Number(node.dataset.renderSeed),
  }));
}
async function open(path, action) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await fileAction(page, action);
  await settle();
}
async function savePath(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
}
async function exportExact() {
  const state = await recipe();
  const path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page
    .getByRole('status')
    .filter({ hasText: 'Exported ' + basename(path) })
    .waitFor({ timeout: 60000 });
  const actual = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(
    actual.equals(
      Buffer.from(
        renderEffects({ width, height, pixels: Uint8Array.from(pixels).buffer }, state.effects, {
          masterSeed: state.masterSeed,
        }).pixels,
      ),
    ),
    'Exact RGBA export',
  );
}
try {
  await configure();
  await open(imagePath, 'Open image Ctrl+Shift+O');
  const choose = (label, value) =>
    page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
  const slider = (label, value) =>
    page.getByRole('slider', { name: label, exact: true }).fill(value);
  const preview = () => page.locator('.depth-field-preview[aria-busy="false"] img').waitFor();
  async function add(title) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.locator('.effect-picker').getByRole('button', { name: title, exact: true }).click();
    await settle();
  }
  await add('Depth Field');
  await choose('Field source', 'perlin');
  await slider('Field scale', '12');
  await choose('Treatment', 'relief');
  await preview();
  await page.locator('.effect-lock').click();
  const depth = (await recipe()).effects[0];
  const field = await page.locator('[data-field-recipe]').getAttribute('data-field-recipe');
  await add('Blur');
  await choose('Style', 'depth');
  await preview();
  await slider('Radius', '4');
  await slider('Focus position', '0.55');
  await slider('Focus range', '0.15');
  await slider('Focus falloff', '0.25');
  const before = await recipe();
  await choose('Copy field from', depth.instanceId);
  await preview();
  assert.equal(await page.locator('[data-field-recipe]').getAttribute('data-field-recipe'), field);
  const copied = await recipe();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), copied);
  await exportExact();
  await slider('Focus range', '1');
  await slider('Focus position', '0.5');
  await exportExact();
  await choose('Field source', 'brightness');
  await slider('Focus range', '0.1');
  await preview();
  await exportExact();
  await choose('Copy field from', depth.instanceId);
  await preview();
  const blur = (await recipe()).effects[1];
  await add('Recursive Space');
  assert.equal(await page.locator('.depth-field-controls').count(), 0);
  await choose('Depth field', 'on');
  await choose('Copy field from', blur.instanceId);
  await preview();
  assert.equal(await page.locator('[data-field-recipe]').getAttribute('data-field-recipe'), field);
  await slider('Field repetition', '0.65');
  await slider('Field image scale', '0.3');
  await slider('Field distortion', '8');
  for (const style of ['tunnel', 'spiral', 'lattice']) {
    await choose('Style', style);
    await exportExact();
  }
  const enabled = await recipe();
  await choose('Depth field', 'off');
  assert.equal(await page.locator('.depth-field-controls').count(), 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), enabled);
  await choose('Invert field', 'on');
  const recursive = (await recipe()).effects[2];
  const inverse = await page.locator('[data-field-recipe]').getAttribute('data-field-recipe');
  await page.getByRole('button', { name: 'Blur', exact: true }).click();
  await choose('Copy field from', recursive.instanceId);
  await preview();
  assert.equal(
    await page.locator('[data-field-recipe]').getAttribute('data-field-recipe'),
    inverse,
  );
  const final = await recipe();
  assert.equal(final.effects[1].params.radius, blur.params.radius);
  assert.equal(final.effects[1].params.focusRange, blur.params.focusRange);
  assert.deepEqual(final.effects[0], depth);
  await slider('Coverage', '0.7');
  await slider('Softness', '0.3');
  await exportExact();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  assert.ok(
    await page
      .locator('.depth-field-controls')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  await captureTestWindow(app, resolve(output, label + '-controls.png'));
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, resolve(output, label + '-controls.png'));
  const saved = await recipe();
  await savePath(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await page.getByRole('status').filter({ hasText: 'Saved ' }).waitFor();
  await closeTestApp(app);
  app = await launch();
  await configure();
  await open(projectPath, 'Open project Ctrl+O');
  assert.deepEqual(await recipe(), saved);
  await exportExact();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, label + '-result.json'),
    JSON.stringify({
      result: 'passed',
      exactExports: exports,
      fieldReuse: true,
      focusControls: true,
      recursiveStyles: 3,
      copyUndo: true,
      projectRestart: true,
    }),
  );
  console.log(label + ': depth consumers passed, ' + exports + ' exact exports and restart.');
} finally {
  await closeTestApp(app);
}
