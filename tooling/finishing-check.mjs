import { deleteFirstEffect } from './stack-action.mjs';
import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { renderEffects, effectCount } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/finishing-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const visualOnly = process.argv.includes('--visual-only');
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}${visualOnly ? '-visual' : ''}`;
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
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function configure() {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await frame();
}
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 30000 });
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
  if (!data.equals(expected)) {
    const diffs = [];
    for (let i = 0; i < data.length; i++)
      if (data[i] !== expected[i])
        diffs.push({
          index: i,
          x: Math.floor(i / 4) % width,
          y: Math.floor(i / 4 / width),
          channel: i % 4,
          actual: data[i],
          expected: expected[i],
        });
    await writeFile(
      resolve(output, label + '-export-mismatch.json'),
      JSON.stringify({ recipe, differences: diffs.length, first: diffs.slice(0, 30) }, null, 2),
    );
  }
  assert.ok(
    data.equals(expected),
    'Native finishing filter export differs from the shared renderer',
  );
  return data;
}
async function screenshot(name) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await frame();
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true }))
      .toPNG()
      .toString('base64'),
  );
  await writeFile(resolve(output, `${label}-${name}.png`), Buffer.from(png, 'base64'));
}
const defaults = new Map();
const slider = (name) => page.getByRole('slider', { name, exact: true });
const choose = (name, value) =>
  page.getByRole('combobox', { name, exact: true }).selectOption(value);
async function add(title, type) {
  await picker();
  assert.equal(await page.locator('.effect-grid .effect-tile').count(), effectCount);
  const tile = page.locator('.effect-picker').getByRole('button', { name: title, exact: true });
  await tile.scrollIntoViewIfNeeded();
  await tile.locator('img').evaluate((image) => {
    if (!image.complete || image.naturalWidth !== 384) throw new Error('Missing filter thumbnail');
  });
  await tile.click();
  const recipe = await state();
  assert.equal(recipe.effects.at(-1).type, type);
  if (!defaults.has(type)) defaults.set(type, recipe.effects.at(-1).params);
}

async function undoRedo(before, after) {
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), after);
}

async function hex(label, value) {
  const field = page.getByRole('textbox', { name: `${label} hex`, exact: true });
  await field.fill(value);
  await field.press('Enter');
}
async function resetImage() {
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  while (await page.locator('.effect-row').count()) await deleteFirstEffect(page);
}
async function inspectStatue() {
  await chooseOpen(resolve(root, 'apps/desktop/resources/presets/statue.png'));
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened statue.png');
  while (await page.locator('.effect-row').count()) await deleteFirstEffect(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await add('Gradient Map', 'gradient-map');
  await slider('Midpoint').fill('0.4');
  await state();
  await screenshot('statue-gradient-map');
  await add('Hue / Saturation', 'hue-saturation');
  await slider('Hue').fill('105');
  await slider('Saturation').fill('0.6');
  await state();
  await screenshot('statue-hue-saturation');
}
try {
  await configure();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  if (!visualOnly) {
    await resetImage();
    await add('Hue / Saturation', 'hue-saturation');
    assert.ok(
      (await exportExact()).equals(rgba),
      'Neutral hue adjustment must preserve every byte',
    );
    assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 0);
    for (const value of [-180, -120, 53, 120, 180]) {
      await slider('Hue').fill(String(value));
      await exportExact();
    }
    await slider('Hue').fill('0');
    for (const value of [-1, -0.4, 0.5, 1]) {
      await slider('Saturation').fill(String(value));
      await exportExact();
    }
    await slider('Saturation').fill('0');
    for (const value of [-1, -0.3, 0.4, 1]) {
      await slider('Lightness').fill(String(value));
      await exportExact();
    }
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
    assert.deepEqual((await state()).effects.at(-1).params, defaults.get('hue-saturation'));
    const beforeHue = await state();
    const hueSlider = slider('Hue');
    await hueSlider.scrollIntoViewIfNeeded();
    await hueSlider.focus();
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');
    await undoRedo(beforeHue, await state());
    await slider('Hue').fill('73');
    await slider('Saturation').fill('0.27');
    await slider('Lightness').fill('-0.15');
    for (const blend of ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference']) {
      await choose('Blend mode', blend);
      await exportExact();
    }
    await choose('Blend mode', 'normal');
    await choose('Application', 'left');
    await slider('Coverage').fill('0.4');
    await slider('Softness').fill('0.3');
    await slider('Opacity').fill('0.6');
    await exportExact();
    await screenshot('hue-controls');
    await resetImage();
    await add('Gradient Map', 'gradient-map');
    assert.equal(
      await page.getByRole('img', { name: 'Gradient Map tonal ramp', exact: true }).count(),
      1,
    );
    assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 0);
    await hex('Shadows', '#142080');
    const beforeColor = await state();
    await hex('Highlights', '#f68040');
    await undoRedo(beforeColor, await state());
    for (const value of [0.05, 0.3, 0.5, 0.75, 0.95]) {
      await slider('Midpoint').fill(String(value));
      await exportExact();
    }
    await choose('Reverse', 'on');
    await exportExact();
    await slider('Midpoint').fill('0.37');
    for (const blend of ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference']) {
      await choose('Blend mode', blend);
      await exportExact();
    }
    await choose('Blend mode', 'normal');
    await page.getByRole('switch', { name: 'Tint', exact: true }).check();
    await hex('Tint color', '#80c0ff');
    await slider('Tint strength').fill('0.3');
    await exportExact();
    await slider('Opacity').fill('0');
    assert.ok((await exportExact()).equals(rgba));
    await slider('Opacity').fill('0.67');
    await choose('Application', 'top');
    await slider('Coverage').fill('0.65');
    await slider('Softness').fill('0.2');
    await exportExact();
    await screenshot('gradient-controls');
    const beforeReset = await state();
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
    assert.deepEqual((await state()).effects.at(-1).params, defaults.get('gradient-map'));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), beforeReset);
    await add('Hue / Saturation', 'hue-saturation');
    await slider('Hue').fill('-37');
    await slider('Saturation').fill('0.4');
    await slider('Lightness').fill('0.1');
    const savedRecipe = await state();
    const stacked = await exportExact();
    await chooseSave(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status('Saved ' + basename(projectPath));
    await picker('Presets');
    await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Finishing filters');
    await page
      .getByRole('img', { name: 'Statue preset preview', exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole('radio', { name: 'Statue', exact: true }).check();
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await status('Saved preset Finishing filters');
    const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
    assert.deepEqual(stored.effects, savedRecipe.effects);
    const presetPath = resolve(output, label + '.gleechpreset');
    await chooseSave(presetPath);
    await page
      .getByRole('button', { name: 'Export preset Finishing filters', exact: true })
      .click();
    await status('Exported preset ' + basename(presetPath));
    await page.keyboard.press('Escape');
    await chooseOpen(presetPath);
    await fileAction(page, 'Import Preset');
    await status('Imported preset Finishing filters (2)');
    await page.keyboard.press('Escape');
    await closeTestApp(app);
    app = await launch();
    await configure();
    await chooseOpen(projectPath);
    await page.keyboard.press('Control+o');
    await status('Opened ' + basename(projectPath));
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    await resetImage();
    await picker('Presets');
    await page.getByRole('button', { name: 'Apply Finishing filters (2)', exact: true }).click();
    await page
      .locator('.preset-flyout')
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
    assert.deepEqual((await state()).effects.at(-1).params, defaults.get('hue-saturation'));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), savedRecipe);
  }
  await inspectStatue();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      restart: !visualOnly,
      presets: !visualOnly,
      result: 'passed',
    }),
  );
} catch (error) {
  await writeFile(
    resolve(output, label + '-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        errors,
        body: await page
          ?.locator('body')
          .innerText()
          .catch(() => ''),
        recipe: await state().catch(() => null),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
