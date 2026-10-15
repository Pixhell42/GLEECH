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
const output = resolve(root, 'test-results/wave-check');
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
  assert.ok(
    data.equals(expected),
    'Native Wave distortion export differs from the shared renderer',
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
    .getByRole('button', { name: 'Wave distortion', exact: true });
  await tile.scrollIntoViewIfNeeded();
  await tile.locator('img').evaluate((image) => {
    if (!image.complete || image.naturalWidth !== 384)
      throw new Error('Wave thumbnail is not bundled');
  });
  await screenshot('picker');
  await tile.click();
  await settle();
  assert.equal((await state()).effects[0].type, 'wave-distortion');
  for (const name of ['Strength', 'Frequency', 'Direction', 'Opacity', 'Coverage', 'Softness'])
    assert.ok(await page.getByRole('slider', { name, exact: true }).isEnabled());
  assert.ok(await page.getByRole('button', { name: 'New pattern', exact: true }).isVisible());
  await page.getByRole('slider', { name: 'Strength', exact: true }).fill('15');
  await page.getByRole('slider', { name: 'Frequency', exact: true }).fill('2.5');
  const edgeControl = () => page.getByRole('combobox', { name: 'Edge Handling', exact: true });
  assert.equal(await edgeControl().inputValue(), 'extend');
  const extendedWave = await exportExact();
  for (const mode of ['wrap', 'mirror']) {
    const before = await state();
    await edgeControl().selectOption(mode);
    const changed = await state();
    assert.equal(changed.effects[0].params.edgeHandling, mode);
    assert.ok(!(await exportExact()).equals(extendedWave));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), before);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), changed);
  }
  await edgeControl().selectOption('wrap');
  for (const angle of [0, 90, 45]) {
    await page.getByRole('slider', { name: 'Direction', exact: true }).fill(String(angle));
    assert.ok(!(await exportExact()).equals(rgba));
  }
  assert.equal(
    await page
      .getByRole('slider', { name: 'Direction', exact: true })
      .locator('..')
      .locator('output')
      .textContent(),
    '45' + String.fromCharCode(176),
  );
  assert.equal(
    await page
      .getByRole('slider', { name: 'Frequency', exact: true })
      .locator('..')
      .locator('output')
      .textContent(),
    '2.5 cycles',
  );
  const beforePattern = await state();
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  const varied = await state();
  assert.equal(varied.effects[0].seedOffset, beforePattern.effects[0].seedOffset + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), beforePattern);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), varied);
  await page.getByRole('button', { name: 'Random seed', exact: true }).click();
  assert.notEqual((await state()).seed, varied.seed);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), varied);
  const slider = page.getByRole('slider', { name: 'Strength', exact: true });
  await slider.dispatchEvent('pointerdown');
  await slider.fill('10');
  await slider.fill('12');
  await slider.dispatchEvent('pointerup');
  const gesture = await state();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), varied);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), gesture);
  await slider.fill('0');
  assert.ok((await exportExact()).equals(rgba));
  await slider.fill('15');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('top');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.5');
  const hard = await exportExact();
  const untouched = Math.ceil(height / 2) * width * 4;
  assert.ok(hard.subarray(untouched).equals(rgba.subarray(untouched)));
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.7');
  const soft = await exportExact();
  assert.ok(!soft.equals(hard));
  await screenshot('controls');
  console.log(label + ': controls, angles, zero strength, masks, seeds and undo passed');
  await picker();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'RGB split', exact: true })
    .click();
  await page.getByRole('slider', { name: 'Horizontal shift', exact: true }).fill('10');
  await page.getByRole('slider', { name: 'Vertical shift', exact: true }).fill('10');
  const extendedRgb = await exportExact();
  for (const mode of ['wrap', 'mirror']) {
    await edgeControl().selectOption(mode);
    assert.ok(!(await exportExact()).equals(extendedRgb));
  }
  await picker();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Block corruption', exact: true })
    .click();
  await page.getByRole('slider', { name: 'Density', exact: true }).fill('1');
  await page.getByRole('slider', { name: 'Displacement', exact: true }).fill('25');
  const extendedBlock = await exportExact();
  for (const mode of ['mirror', 'wrap']) {
    await edgeControl().selectOption(mode);
    assert.ok(!(await exportExact()).equals(extendedBlock));
  }
  const savedRecipe = await state();
  const stacked = await exportExact();
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ' + basename(projectPath));
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await picker('Presets');
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Flowing waves');
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
  await status('Saved preset Flowing waves');
  await page.getByRole('button', { name: 'Apply Flowing waves', exact: true }).waitFor();
  const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
  assert.deepEqual(stored.effects, savedRecipe.effects);
  assert.equal(stored.masterSeed, savedRecipe.seed);
  assert.equal(stored.thumbnailSource, 'statue');
  const presetPath = resolve(output, label + '.gleechpreset');
  await chooseSave(presetPath);
  await page.getByRole('button', { name: 'Export preset Flowing waves', exact: true }).click();
  await status('Exported preset ' + basename(presetPath));
  assert.deepEqual(
    JSON.parse(await readFile(presetPath, 'utf8')).preset.effects,
    savedRecipe.effects,
  );
  await page.keyboard.press('Escape');
  await chooseOpen(presetPath);
  await fileAction(page, 'Import Preset');
  await status('Imported preset Flowing waves (2)');
  await page.getByRole('button', { name: 'Apply Flowing waves (2)', exact: true }).waitFor();
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
  await page.getByRole('button', { name: 'Apply Flowing waves (2)', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(stacked));
  await page.getByRole('button', { name: 'Wave distortion', exact: true }).click();
  await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  const reset = await state();
  assert.deepEqual(reset.effects[0].params, {
    amount: 1,
    strength: 5,
    frequency: 3,
    direction: 0,
    edgeHandling: 'extend',
    directionSource: 'native',
    directionInfluence: 1,
    directionX: 50,
    directionY: 50,
    directionScale: 100,
    directionRotation: 0,
    directionTwist: 0.5,
    directionSeed: 0,
    directionInvert: 'off',
    blendMode: 'normal',
    color: '#ffffff',
    colorMode: 'solid',
    colorEnd: '#4080e0',
    colorStops: '[]',
    colorAngle: 0,
    colorCenterX: 50,
    colorCenterY: 50,
    colorSpan: 100,
    tintStrength: 0,
    tintEnabled: 'off',
  });
  assert.deepEqual(reset.effects[0].application, { region: 'all', coverage: 1, softness: 0 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), savedRecipe);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      restart: true,
      undoRedo: true,
      presets: 'save/statue/export/import/apply',
      result: 'passed',
    }),
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
