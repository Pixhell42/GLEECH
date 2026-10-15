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
const output = resolve(root, 'test-results/bitcrush-check');
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
async function exportExact(preserveAlpha = true) {
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
  assert.ok(data.equals(expected), 'Native Bit Crush export differs from the shared renderer');
  if (preserveAlpha)
    for (let i = 3; i < rgba.length; i += 4)
      assert.equal(data[i], rgba[i], 'Bit Crush changed alpha');
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
  const tile = page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Bit crush', exact: true });
  await tile.scrollIntoViewIfNeeded();
  await tile.locator('img').evaluate((image) => {
    if (!image.complete || image.naturalWidth !== 384)
      throw new Error('Bit Crush thumbnail is not bundled');
  });
  await screenshot('picker');
  await tile.click();
  await settle();
  assert.equal((await state()).effects[0].type, 'bit-crush');
  assert.ok(await page.getByRole('slider', { name: 'Dither strength', exact: true }).isDisabled());
  assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 0);
  await page.getByRole('slider', { name: 'Color depth', exact: true }).fill('2');
  const clean = await exportExact();
  assert.equal(new Set([...clean].filter((_, i) => i % 4 === 0)).size, 4);
  await page.getByRole('combobox', { name: 'Dithering', exact: true }).selectOption('ordered');
  assert.ok(await page.getByRole('slider', { name: 'Dither strength', exact: true }).isEnabled());
  await page.getByRole('slider', { name: 'Dither strength', exact: true }).fill('1');
  const ordered = await exportExact();
  assert.ok(!ordered.equals(clean));
  await page.getByRole('combobox', { name: 'Dithering', exact: true }).selectOption('random');
  const random = await exportExact();
  assert.ok(!random.equals(ordered));
  const before = await state();
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  const varied = await state();
  assert.equal(varied.effects[0].seedOffset, before.effects[0].seedOffset + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), varied);
  await page.getByRole('slider', { name: 'Color depth', exact: true }).fill('8');
  assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 0);
  assert.ok((await exportExact()).equals(rgba), '8-bit output must preserve every byte');
  await page.getByRole('slider', { name: 'Color depth', exact: true }).fill('2');
  const linked = await state();
  assert.equal(
    await page.getByRole('switch', { name: 'Link RGB depths', exact: true }).isChecked(),
    true,
  );
  await page.getByRole('switch', { name: 'Link RGB depths', exact: true }).uncheck();
  const unlinked = await state();
  for (const channel of ['Red', 'Green', 'Blue'])
    assert.equal(
      await page.getByRole('slider', { name: `${channel} depth`, exact: true }).inputValue(),
      '2',
    );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), linked);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), unlinked);
  await page.getByRole('slider', { name: 'Red depth', exact: true }).fill('3');
  await page.getByRole('slider', { name: 'Green depth', exact: true }).fill('5');
  await page.getByRole('combobox', { name: 'Dithering', exact: true }).selectOption('none');
  await exportExact();
  await page.getByRole('slider', { name: 'Alpha depth', exact: true }).fill('2');
  const alphaCrushed = await exportExact(false);
  assert.equal(new Set([...alphaCrushed].filter((_, i) => i % 4 === 3)).size, 4);
  await page.getByRole('slider', { name: 'Alpha depth', exact: true }).fill('8');
  await screenshot('channel-controls');
  console.log('Independent RGB and alpha exports verified');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('top');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.5');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.7');
  await page.getByRole('slider', { name: 'Opacity', exact: true }).fill('0.8');
  const savedRecipe = await state();
  const masked = await exportExact();
  for (const label of ['Red depth', 'Dither strength']) {
    const info = page.getByRole('button', { name: `About ${label}`, exact: true });
    await info.hover();
    const tip = info.locator('..').getByRole('tooltip');
    assert.ok(await tip.isVisible());
    assert.equal(await tip.evaluate((element) => getComputedStyle(element).pointerEvents), 'none');
    const bounds = await tip.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= (await page.evaluate(() => innerWidth)),
      `${label} tooltip is clipped`,
    );
  }
  await screenshot('controls');
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ' + basename(projectPath));
  await picker('Presets');
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Soft crushed colors');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Soft crushed colors');
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
  await page.getByRole('button', { name: 'Apply Soft crushed colors', exact: true }).click();
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
