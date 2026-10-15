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
const output = resolve(root, 'test-results/scanlines-check');
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
  assert.ok(data.equals(expected), 'Native Scanlines export differs from the shared renderer');
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
    .getByRole('button', { name: 'Scanlines', exact: true });
  await tile.scrollIntoViewIfNeeded();
  await tile.locator('img').evaluate((image) => {
    if (!image.complete || image.naturalWidth !== 384)
      throw new Error('Scanlines thumbnail is not bundled');
  });
  await screenshot('picker');
  await tile.click();
  await settle();
  assert.equal((await state()).effects[0].type, 'scanlines');
  const control = (name) => page.getByRole('slider', { name, exact: true });
  const style = () => page.getByRole('combobox', { name: 'Style', exact: true });
  const field = () => page.getByRole('combobox', { name: 'Field', exact: true });
  for (const name of [
    'Frequency',
    'Thickness',
    'Intensity',
    'Rotation',
    'Offset',
    'Opacity',
    'Coverage',
    'Softness',
  ])
    assert.ok(await control(name).isEnabled());
  assert.ok(await field().isDisabled());
  assert.ok(await page.getByRole('combobox', { name: 'Edge Handling', exact: true }).isDisabled());
  assert.ok(await control('Glow size').isDisabled());
  assert.ok(await control('Error strength').isDisabled());
  assert.ok(await control('Error position X').isDisabled());
  assert.ok(await control('Error position Y').isDisabled());
  assert.equal(await page.getByLabel('Line color', { exact: true }).getAttribute('type'), 'color');
  await control('Frequency').fill('8');
  await control('Thickness').fill('0.5');
  await control('Intensity').fill('0.8');
  const monitor = await state();
  await style().selectOption('tv');
  const tv = await state();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), monitor);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), tv);
  const images = [];
  for (const value of ['monitor', 'tv', 'interlaced', 'grille']) {
    await style().selectOption(value);
    assert.equal(await field().isEnabled(), value === 'interlaced');
    const rendered = await exportExact();
    for (let i = 3; i < rgba.length; i += 4) assert.equal(rendered[i], rgba[i]);
    assert.ok(!rendered.equals(rgba));
    for (const other of images) assert.ok(!rendered.equals(other));
    images.push(rendered);
    if (value === 'interlaced') {
      await field().selectOption('odd');
      assert.ok(!(await exportExact()).equals(rendered));
    }
  }
  await control('Rotation').fill('37');
  await control('Offset').fill('0.23');
  assert.ok(!(await exportExact()).equals(images[3]));
  const beforeGesture = await state();
  await control('Frequency').dispatchEvent('pointerdown');
  await control('Frequency').fill('12');
  await control('Frequency').fill('14');
  await control('Frequency').dispatchEvent('pointerup');
  const gesture = await state();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), beforeGesture);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), gesture);
  await control('Intensity').fill('0');
  assert.ok((await exportExact()).equals(rgba));
  await control('Intensity').fill('0.8');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('top');
  await control('Coverage').fill('0.5');
  const hard = await exportExact();
  const untouched = Math.ceil(height / 2) * width * 4;
  assert.ok(hard.subarray(untouched).equals(rgba.subarray(untouched)));
  await control('Softness').fill('0.7');
  assert.ok(!(await exportExact()).equals(hard));
  await style().selectOption('interlaced');
  await field().selectOption('odd');
  await control('Rotation').fill('17');
  const choose = (name, value) =>
    page.getByRole('combobox', { name, exact: true }).selectOption(value);
  await page.getByLabel('Line color', { exact: true }).evaluate((input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '#4080e0');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal((await state()).effects[0].params.color, '#4080e0');
  const appearance = [];
  for (const mode of ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference']) {
    await choose('Blend mode', mode);
    const rendered = await exportExact();
    for (const other of appearance) assert.ok(!rendered.equals(other));
    appearance.push(rendered);
  }
  const beforeInvert = await state();
  await choose('Invert lines', 'on');
  const inverted = await state();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), beforeInvert);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), inverted);
  await choose('Blend mode', 'screen');
  const noGlow = await exportExact();
  await control('Glow').fill('0.6');
  assert.ok(await control('Glow size').isEnabled());
  await control('Glow size').fill('2');
  assert.ok(!(await exportExact()).equals(noGlow));
  for (const failure of ['jitter', 'sync-loss', 'tear', 'dropout']) {
    await choose('Signal error', failure);
    assert.ok(await control('Error strength').isEnabled());
    await control('Error strength').fill('0.7');
    assert.ok(await page.getByRole('button', { name: 'New pattern', exact: true }).isVisible());
    assert.equal(
      await page.getByRole('combobox', { name: 'Edge Handling', exact: true }).isEnabled(),
      failure !== 'dropout',
    );
    const beforePosition = await state();
    const fixed = await exportExact();
    assert.ok(await control('Error position X').isEnabled());
    assert.ok(await control('Error position Y').isEnabled());
    await control('Error position X').dispatchEvent('pointerdown');
    await control('Error position X').fill('15');
    await control('Error position X').fill('25');
    await control('Error position X').dispatchEvent('pointerup');
    const movedX = await state();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), beforePosition);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), movedX);
    await control('Error position Y').fill('-20');
    assert.ok(!(await exportExact()).equals(fixed));
    await control('Error position X').fill('0');
    await control('Error position Y').fill('0');
  }
  await control('Rotation').fill('0');
  assert.ok(await control('Error position X').isDisabled());
  assert.ok(await control('Error position Y').isEnabled());
  await control('Rotation').fill('90');
  assert.ok(await control('Error position X').isEnabled());
  assert.ok(await control('Error position Y').isDisabled());
  await control('Rotation').fill('17');
  await control('Error position X').fill('25');
  await control('Error position Y').fill('-20');
  await choose('Signal error', 'sync-loss');
  await choose('Edge Handling', 'wrap');
  const beforePattern = await state();
  const beforePatternPixels = await exportExact();
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  const variedPattern = await state();
  assert.equal(variedPattern.effects[0].seedOffset, beforePattern.effects[0].seedOffset + 1);
  assert.ok(!(await exportExact()).equals(beforePatternPixels));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), beforePattern);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), variedPattern);
  await page.getByRole('combobox', { name: 'Signal error', exact: true }).scrollIntoViewIfNeeded();
  await screenshot('failures');
  await page.getByLabel('Line color', { exact: true }).scrollIntoViewIfNeeded();
  await screenshot('appearance');
  await field().scrollIntoViewIfNeeded();
  await screenshot('controls');
  console.log(label + ': four styles, fields, masks, rotation, alpha and undo passed');
  for (const [title, mode] of [
    ['RGB split', 'multiply'],
    ['Block corruption', 'screen'],
    ['Spatial crush', 'add'],
    ['Bit crush', 'overlay'],
    ['Wave distortion', 'difference'],
  ]) {
    await picker();
    await page.locator('.effect-picker').getByRole('button', { name: title, exact: true }).click();
    assert.equal(
      await page.getByLabel('Tint color', { exact: true }).getAttribute('type'),
      'color',
    );
    const beforeFinish = await state();
    const neutral = await exportExact();
    await choose('Blend mode', mode);
    const blended = await state();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), beforeFinish);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), blended);
    await page.getByLabel('Tint color', { exact: true }).evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        input,
        '#e09040',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.getByRole('switch', { name: 'Tint', exact: true }).check();
    const beforeTintGesture = await state();
    await control('Tint strength').dispatchEvent('pointerdown');
    await control('Tint strength').fill('0.3');
    await control('Tint strength').fill('0.65');
    await control('Tint strength').dispatchEvent('pointerup');
    const finished = await state();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), beforeTintGesture);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), finished);
    assert.equal(finished.effects.at(-1).params.color, '#e09040');
    assert.equal(finished.effects.at(-1).params.tintStrength, 0.65);
    assert.ok(!(await exportExact()).equals(neutral));
  }
  await screenshot('image-finish');
  const savedRecipe = await state();
  const stacked = await exportExact();
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ' + basename(projectPath));
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await picker('Presets');
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Raster test');
  await page
    .getByRole('img', { name: 'Statue preset preview', exact: true })
    .waitFor({ timeout: 30000 });
  const preview = await page
    .getByRole('img', { name: 'Current image preset preview', exact: true })
    .getAttribute('src');
  assert.ok(
    (
      await sharp(Buffer.from(preview.split(',')[1], 'base64'))
        .raw()
        .toBuffer()
    ).equals(stacked),
  );
  await page.getByRole('radio', { name: 'Statue', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Raster test');
  await page.getByRole('button', { name: 'Apply Raster test', exact: true }).waitFor();
  const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
  assert.deepEqual(stored.effects, savedRecipe.effects);
  assert.equal(stored.thumbnailSource, 'statue');
  const presetPath = resolve(output, label + '.gleechpreset');
  await chooseSave(presetPath);
  await page.getByRole('button', { name: 'Export preset Raster test', exact: true }).click();
  await status('Exported preset ' + basename(presetPath));
  assert.deepEqual(
    JSON.parse(await readFile(presetPath, 'utf8')).preset.effects,
    savedRecipe.effects,
  );
  await page.keyboard.press('Escape');
  await chooseOpen(presetPath);
  await fileAction(page, 'Import Preset');
  await status('Imported preset Raster test (2)');
  await closeTestApp(app);
  app = await launch();
  await configure();
  await chooseOpen(projectPath);
  await page.keyboard.press('Control+o');
  await status('Opened ' + basename(projectPath));
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(stacked));
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  await picker('Presets');
  await page.getByRole('button', { name: 'Apply Raster test (2)', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(stacked));
  await page.getByRole('button', { name: 'Scanlines', exact: true }).click();
  await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  const reset = await state();
  assert.deepEqual(reset.effects[0].params, {
    amount: 1,
    style: 'monitor',
    frequency: 80,
    thickness: 0.35,
    intensity: 0.65,
    rotation: 0,
    offset: 0,
    field: 'even',
    blendMode: 'normal',
    color: '#000000',
    colorMode: 'solid',
    colorEnd: '#4080e0',
    colorStops: '[]',
    colorAngle: 0,
    colorCenterX: 50,
    colorCenterY: 50,
    colorSpan: 100,
    invert: 'off',
    glow: 0,
    glowSize: 0.5,
    signalError: 'none',
    errorStrength: 0.35,
    errorPositionX: 0,
    errorPositionY: 0,
    edgeHandling: 'extend',
  });
  assert.ok(await field().isDisabled());
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), savedRecipe);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      styles: 4,
      imageFinishes: 5,
      errorPositions: 2,
      restart: true,
      undoRedo: true,
      presets: 'save/statue/export/import/apply',
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
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
