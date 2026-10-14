import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((x) => x.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/depth-field');
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
  async function add() {
    await page.getByRole('button', { name: /Add effect/ }).click();
    const tile = page
      .locator('.effect-picker')
      .getByRole('button', { name: 'Depth Field', exact: true });
    await tile.locator('img').evaluate((image) => image.decode());
    await tile.click();
    await settle();
    await page.locator('.depth-field-preview[aria-busy="false"] img').waitFor();
  }
  await add();
  await page.getByRole('combobox', { name: 'Treatment', exact: true }).selectOption('field');
  for (const source of [
    'brightness',
    'linear',
    'radial',
    'perlin',
    'simplex',
    'value',
    'voronoi',
    'shapes',
  ]) {
    await page.getByRole('combobox', { name: 'Field source', exact: true }).selectOption(source);
    await page.locator('.depth-field-preview[aria-busy="false"] img').waitFor();
    await exportExact();
    console.log(label + ': ' + source + ' field exported');
  }
  await page.getByRole('combobox', { name: 'Field shape', exact: true }).selectOption('triangle');
  await page.getByRole('combobox', { name: 'Normalize field', exact: true }).selectOption('on');
  await page.getByRole('slider', { name: 'Field smoothing', exact: true }).fill('2');
  for (const treatment of ['displace', 'contours', 'relief']) {
    await page.getByRole('combobox', { name: 'Treatment', exact: true }).selectOption(treatment);
    await exportExact();
  }
  await page.getByRole('combobox', { name: 'Field source', exact: true }).selectOption('perlin');
  const before = await recipe();
  await page.getByRole('button', { name: 'New field pattern', exact: true }).click();
  assert.equal(
    (await recipe()).effects[0].params.fieldSeed,
    before.effects[0].params.fieldSeed + 1,
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const first = (await recipe()).effects[0];
  const fieldBefore = await page.locator('[data-field-recipe]').getAttribute('data-field-recipe');
  await page.locator('.effect-lock').click();
  await add();
  await page.getByRole('combobox', { name: 'Treatment', exact: true }).selectOption('contours');
  const beforeCopy = await recipe();
  await page
    .getByRole('combobox', { name: 'Copy field from', exact: true })
    .selectOption(first.instanceId);
  await page.locator('.depth-field-preview[aria-busy="false"] img').waitFor();
  assert.equal(
    await page.locator('[data-field-recipe]').getAttribute('data-field-recipe'),
    fieldBefore,
  );
  const copied = await recipe();
  assert.equal(copied.effects[1].params.operation, 'contours');
  assert.deepEqual(copied.effects[0], beforeCopy.effects[0]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), beforeCopy);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), copied);
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.7');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.3');
  await exportExact();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.locator('.depth-field-controls').scrollIntoViewIfNeeded();
  assert.ok(
    await page
      .locator('.depth-field-controls')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  await captureTestWindow(app, resolve(output, `${label}-controls.png`));
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
    resolve(output, `${label}-result.json`),
    JSON.stringify({
      result: 'passed',
      exactExports: exports,
      sources: 8,
      treatments: 4,
      copyFieldUndo: true,
      patterns: true,
      projectRestart: true,
    }),
  );
  console.log(`${label}: depth fields passed, ${exports} exact exports and restart.`);
} finally {
  await closeTestApp(app);
}
