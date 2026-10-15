import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects, effectCount } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/spatialcrush-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 129;
const height = 65;
const rgba = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    rgba.set(
      [(x * 17) % 256, (y * 23) % 256, ((x ^ y) * 13) % 256, [0, 1, 64, 128, 254, 255][x % 6]],
      (y * width + x) * 4,
    );
const imagePath = resolve(output, `${label}-input.png`);
const projectPath = resolve(output, `${label}.gleech`);
await sharp(rgba, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const launch = () =>
  electron.launch({
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    timeout: 30000,
  });
let app = await launch();
let page;
const errors = [];
let exports = 0;
const frame = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
  });
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await frame();
}
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).first().waitFor({ timeout: 30000 });
async function chooseOpen(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
}
async function chooseSave(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
}
async function settle() {
  await frame();
  await page.waitForFunction(
    () => {
      const data = document.querySelector('.image-layer').dataset;
      return (
        data.renderRevision === data.requestedRevision && !document.querySelector('.detail-loading')
      );
    },
    undefined,
    { timeout: 30000 },
  );
}
async function state() {
  await settle();
  return page.locator('.image-layer').evaluate((element) => ({
    effects: JSON.parse(element.dataset.renderRecipe),
    seed: Number(element.dataset.renderSeed),
  }));
}
async function picker(tab = 'Effects') {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: tab, exact: true }).click();
  if (tab === 'Presets')
    await page.getByText('Loading presets…', { exact: true }).waitFor({ state: 'hidden' });
}
async function exportExact() {
  const recipe = await state();
  const path = resolve(output, `${label}-${++exports}.png`);
  await chooseSave(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const image = { width, height, pixels: Uint8Array.from(rgba).buffer };
  const expected = Buffer.from(
    renderEffects(image, recipe.effects, { masterSeed: recipe.seed, reference: image }).pixels,
  );
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  assert.ok(data.equals(expected), 'Native Spatial Crush export differs from the shared renderer');
  return data;
}
async function screenshot(name) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await frame();
  await captureTestWindow(app, resolve(output, `${label}-${name}.png`));
}
try {
  await configure();
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  await settle();
  const contentWidth = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(960, 640);
    return window.getContentSize()[0];
  });
  await page.waitForFunction((width) => innerWidth === width, contentWidth);
  await picker();
  assert.equal(await page.locator('.effect-grid .effect-tile').count(), effectCount);
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Spatial crush', exact: true })
    .click();
  await page.getByRole('slider', { name: 'Block size', exact: true }).fill('12');
  const sampling = page.getByRole('combobox', { name: 'Sampling', exact: true });
  const slider = (name) => page.getByRole('slider', { name, exact: true });
  const pattern = page.getByRole('button', { name: 'New pattern', exact: true });
  const outputs = new Map();
  for (const mode of ['nearest', 'linear', 'average', 'dirty-nearest', 'random', 'corrupted']) {
    await sampling.selectOption(mode);
    assert.equal(await slider('Grid jitter').count(), Number(mode === 'dirty-nearest'));
    assert.equal(await slider('Sampling errors').count(), Number(mode === 'corrupted'));
    assert.equal(
      await page.getByRole('combobox', { name: 'Edge Handling', exact: true }).count(),
      Number(mode === 'corrupted'),
    );
    assert.equal(
      await pattern.count(),
      Number(['dirty-nearest', 'random', 'corrupted'].includes(mode)),
    );
    outputs.set(mode, await exportExact());
    await screenshot(mode);
  }
  assert.equal(
    new Set([...outputs.values()].map((data) => data.toString('base64'))).size,
    6,
    'Sampling modes should look distinct',
  );
  const before = await state();
  await pattern.click();
  const varied = await state();
  assert.equal(varied.effects[0].seedOffset, before.effects[0].seedOffset + 1);
  assert.ok(!(await exportExact()).equals(outputs.get('corrupted')));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), varied);
  await slider('Sampling errors').fill('0');
  assert.equal(await pattern.count(), 0);
  assert.ok((await exportExact()).equals(outputs.get('nearest')));
  await sampling.selectOption('dirty-nearest');
  await slider('Grid jitter').fill('0');
  assert.equal(await pattern.count(), 0);
  assert.ok((await exportExact()).equals(outputs.get('nearest')));
  await sampling.selectOption('corrupted');
  await slider('Sampling errors').fill('0.85');
  await page.getByRole('combobox', { name: 'Edge Handling', exact: true }).selectOption('wrap');
  await slider('Opacity').fill('0.65');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('left');
  await slider('Coverage').fill('0.7');
  await slider('Softness').fill('0.25');
  const masked = await exportExact();
  const savedRecipe = await state();
  await screenshot('masked-controls');
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ' + basename(projectPath));
  await picker('Presets');
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Corrupted grid');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Corrupted grid');
  assert.deepEqual(
    JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0].effects,
    savedRecipe.effects,
  );
  await closeTestApp(app);
  app = await launch();
  await configure();
  await chooseOpen(projectPath);
  await page.keyboard.press('Control+o');
  await status('Opened ' + basename(projectPath));
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(masked));
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  await picker('Presets');
  await page.getByRole('button', { name: 'Apply Corrupted grid', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(masked));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ mode: label, exports, restart: true, undoRedo: true, result: 'passed' }),
  );
} catch (error) {
  await writeFile(
    resolve(output, `${label}-failure.json`),
    JSON.stringify(
      {
        error: String(error),
        errors,
        body: await page
          ?.locator('body')
          .innerText()
          .catch(() => ''),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
