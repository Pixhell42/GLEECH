import { deleteFirstEffect } from './stack-action.mjs';
import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { renderEffects, effectCount } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/color-gradient-check');
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
  assert.ok(data.equals(expected), 'Native color gradient export differs from the shared renderer');
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

const panel = (label) => page.getByRole('group', { name: `${label} mode`, exact: true });
const mode = (label, value) =>
  panel(label).getByRole('button', { name: value, exact: true }).click();
async function hex(label, value) {
  const field = page.getByRole('textbox', { name: `${label} hex`, exact: true });
  await field.fill(value);
  await field.press('Enter');
}
async function gradient(label, spatial = true) {
  assert.equal(
    await panel(label)
      .getByRole('button', { name: 'Solid', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await hex(label, '#e04080');
  const before = await state();
  await mode(label, 'Gradient');
  const after = await state();
  await undoRedo(before, after);
  await hex(`${label} end`, '#2080e0');
  assert.equal(
    await page.getByRole('img', { name: `${label} gradient preview`, exact: true }).count(),
    1,
  );
  if (spatial) {
    assert.ok(await slider(`${label} position Y`).isDisabled());
    await slider(`${label} direction`).fill('90');
    assert.ok(await slider(`${label} position X`).isDisabled());
    assert.ok(await slider(`${label} position Y`).isEnabled());
    await slider(`${label} direction`).fill('35');
    await slider(`${label} position X`).fill('32');
    await slider(`${label} position Y`).fill('61');
    await slider(`${label} span`).fill('75');
  } else {
    assert.equal(await slider(`${label} direction`).count(), 0);
  }
  const gradientRecipe = await state();
  const rendered = await exportExact();
  await mode(label, 'Solid');
  assert.equal(
    await page.getByRole('textbox', { name: `${label} end hex`, exact: true }).count(),
    0,
  );
  const solid = await exportExact();
  assert.ok(!solid.equals(rendered), `${label} gradient did not change the render`);
  await mode(label, 'Gradient');
  assert.deepEqual(await state(), gradientRecipe);
  assert.ok((await exportExact()).equals(rendered));
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
  await add('Shapes', 'shapes');
  await choose('Operation', 'overlay');
  await choose('Layout', 'tiled');
  await choose('Shape', 'polygon');
  await slider('Spacing').fill('25');
  await slider('Size').fill('85');
  await mode('Shape color', 'Gradient');
  await hex('Shape color', '#f6d36c');
  await hex('Shape color end', '#e04080');
  await slider('Shape color direction').fill('35');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await slider('Shape color direction').scrollIntoViewIfNeeded();
  await state();
  assert.equal(
    await panel('Shape color')
      .getByRole('button', { name: 'About Shape color mode', exact: true })
      .evaluate((icon) => getComputedStyle(icon).padding),
    '0px',
  );
  await screenshot('statue-gradient');
}
try {
  await configure();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  if (!visualOnly) {
    await resetImage();
    await add('Bit crush', 'bit-crush');
    await slider('Color depth').fill('8');
    await mode('Tint color', 'Gradient');
    await hex('Tint color end', '#2080e0');
    assert.ok(!(await page.getByRole('switch', { name: 'Tint', exact: true }).isChecked()));
    assert.ok((await exportExact()).equals(rgba));
    await mode('Tint color', 'Solid');
    await page.getByRole('switch', { name: 'Tint', exact: true }).check();
    await slider('Tint strength').fill('0.7');
    await gradient('Tint color');
    const before = await state();
    const span = slider('Tint color span');
    await span.scrollIntoViewIfNeeded();
    await span.focus();
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight');
    const after = await state();
    await undoRedo(before, after);
    for (const blend of ['multiply', 'screen', 'add', 'overlay', 'difference']) {
      await choose('Blend mode', blend);
      await exportExact();
    }
    await choose('Blend mode', 'normal');
    await choose('Application', 'left');
    await slider('Coverage').fill('0.4');
    await slider('Softness').fill('0.3');
    await exportExact();
    await screenshot('tint-controls');
    await resetImage();
    await add('Scanlines', 'scanlines');
    await slider('Intensity').fill('1');
    await slider('Thickness').fill('0.7');
    await slider('Glow').fill('0.4');
    await gradient('Line color');
    await choose('Invert lines', 'on');
    await exportExact();
    await resetImage();
    await add('Halftone', 'halftone');
    await gradient('Ink color');
    await gradient('Paper color');
    await resetImage();
    await add('Shapes', 'shapes');
    assert.ok(
      await panel('Shape color')
        .getByRole('button', { name: 'Gradient', exact: true })
        .isDisabled(),
    );
    await choose('Operation', 'overlay');
    await gradient('Shape color');
    await choose('Layout', 'tiled');
    await choose('Shape', 'polygon');
    await choose('Tile pattern', 'radial');
    await slider('Start sides').fill('8');
    await choose('Polygon style', 'linear');
    await slider('End sides').fill('3');
    await exportExact();
    await add('Mandelbrot', 'mandelbrot');
    assert.ok(
      await panel('Outside color')
        .getByRole('button', { name: 'Gradient', exact: true })
        .isDisabled(),
    );
    await choose('Operation', 'texture');
    await gradient('Outside color', false);
    assert.equal(await panel('Inside color').count(), 0);
    const savedRecipe = await state();
    const stacked = await exportExact();
    await chooseSave(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status('Saved ' + basename(projectPath));
    await picker('Presets');
    await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Color gradients');
    await page
      .getByRole('img', { name: 'Statue preset preview', exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole('radio', { name: 'Statue', exact: true }).check();
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await status('Saved preset Color gradients');
    const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
    assert.deepEqual(stored.effects, savedRecipe.effects);
    const presetPath = resolve(output, label + '.gleechpreset');
    await chooseSave(presetPath);
    await page.getByRole('button', { name: 'Export preset Color gradients', exact: true }).click();
    await status('Exported preset ' + basename(presetPath));
    await page.keyboard.press('Escape');
    await chooseOpen(presetPath);
    await fileAction(page, 'Import Preset');
    await status('Imported preset Color gradients (2)');
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
    await page.getByRole('button', { name: 'Apply Color gradients (2)', exact: true }).click();
    await page
      .locator('.preset-flyout')
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
    assert.deepEqual((await state()).effects.at(-1).params, defaults.get('mandelbrot'));
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
