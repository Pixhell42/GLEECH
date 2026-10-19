import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { fileAction } from './file-action.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/painted-mask');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, label + '-profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let width = 512,
  height = 384;
function fixture(width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      rgba.set(
        [
          (x * 17 + y * 7) % 256,
          (y * 23 + x * 3) % 256,
          ((x ^ y) * 13) % 256,
          [0, 1, 64, 128, 254, 255][x % 6],
        ],
        (y * width + x) * 4,
      );
  return rgba;
}
let rgba = fixture(width, height);
const original = Buffer.from(rgba);
const imagePath = resolve(output, label + '-input.png');
const portraitPath = resolve(output, label + '-portrait.png');
const smallPath = resolve(output, label + '-small.png');
const projectPath = resolve(output, label + '.gleech');
await sharp(rgba, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
await sharp(fixture(384, 512), { raw: { width: 384, height: 512, channels: 4 } })
  .png()
  .toFile(portraitPath);
await sharp(fixture(128, 96), { raw: { width: 128, height: 96, channels: 4 } })
  .png()
  .toFile(smallPath);
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
let app = await launch(),
  page;
const errors = [];
let exports = 0;
async function configure() {
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
}
async function settle() {
  await app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
  });
  await page.waitForFunction(
    () => {
      const d = document.querySelector('.image-layer').dataset;
      return d.renderRevision === d.requestedRevision && !document.querySelector('.detail-loading');
    },
    undefined,
    { timeout: 60000 },
  );
}
async function state() {
  await settle();
  return page.locator('.image-layer').evaluate((e) => ({
    effects: JSON.parse(e.dataset.renderRecipe),
    masterSeed: Number(e.dataset.renderSeed),
  }));
}
const slider = (name) => page.getByRole('slider', { name, exact: true });
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
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
async function open(path) {
  await chooseOpen(path);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(path));
  await settle();
}
async function picker(tab = 'Effects') {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: tab, exact: true }).click();
  if (tab === 'Presets')
    await page.getByText('Loading presets…', { exact: true }).waitFor({ state: 'hidden' });
}
async function exportExact() {
  const recipe = await state(),
    path = resolve(output, `${label}-${++exports}.png`);
  await chooseSave(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const expected = Buffer.from(
    renderEffects({ width, height, pixels: Uint8Array.from(rgba).buffer }, recipe.effects, {
      masterSeed: recipe.masterSeed,
    }).pixels,
  );
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [width, height]);
  assert.ok(data.equals(expected), 'Painted-mask export differs from the shared renderer');
  return data;
}
async function paint(points, cancel = false) {
  await app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
  });
  // View transforms are applied on animation frames; capturePage alone can
  // complete before a queued zoom update, leaving the pointer coordinates stale.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  const rect = await surface.boundingBox();
  assert.ok(rect);
  await page.mouse.move(rect.x + points[0][0] * rect.width, rect.y + points[0][1] * rect.height);
  await page.mouse.down();
  for (const [x, y] of points.slice(1))
    await page.mouse.move(rect.x + x * rect.width, rect.y + y * rect.height, { steps: 8 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
}
async function editMask() {
  await page.locator('.paint-mask-button').first().click();
  await page.getByRole('region', { name: 'Mask painting controls' }).waitFor();
}
async function done() {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await settle();
}
async function screenshot(name) {
  await page.mouse.move(1, 1);
  await captureTestWindow(app, resolve(output, `${label}-${name}.png`));
}
async function savePreset(name, include) {
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
  const option = page.getByRole('checkbox', { name: 'Include painted masks', exact: true });
  assert.equal(await option.isChecked(), false);
  if (include) await option.check();
  await page
    .getByRole('img', { name: 'Statue preset preview', exact: true })
    .waitFor({ timeout: 60000 });
  await page.getByRole('radio', { name: 'Statue', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset ' + name);
  await page.keyboard.press('Escape');
  return JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets.find(
    (p) => p.name === name,
  );
}
try {
  await configure();
  await open(imagePath);
  await picker();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Hue / Saturation', exact: true })
    .click();
  await slider('Lightness').fill('0.7');
  await settle();
  const unmasked = await exportExact();
  await editMask();
  await slider('Brush size').fill('36');
  await slider('Mask hardness').fill('0.3');
  const empty = await state();
  assert.equal(empty.effects[0].paintedMask.strokes.length, 0);
  const transform = await page.locator('.image-layer').getAttribute('style');
  await paint([
    [0.18, 0.2],
    [0.6, 0.3],
    [0.64, 0.7],
  ]);
  const painted = await state();
  assert.equal(painted.effects[0].paintedMask.strokes.length, 1);
  assert.ok(painted.effects[0].paintedMask.strokes[0].points.length > 4);
  assert.equal(
    await page.locator('.image-layer').getAttribute('style'),
    transform,
    'Painting panned the image',
  );
  await screenshot('painting');
  await done();
  const masked = await exportExact();
  assert.ok(!masked.equals(unmasked));
  assert.ok(!masked.equals(rgba));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), empty);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), painted);
  await editMask();
  await page.getByRole('checkbox', { name: 'Show mask overlay', exact: true }).uncheck();
  assert.equal(await page.locator('.mask-overlay-canvas').isVisible(), false);
  await page.getByRole('checkbox', { name: 'Show mask overlay', exact: true }).check();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  assert.deepEqual(await state(), empty);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), painted);
  await page.getByRole('button', { name: 'Remove mask', exact: true }).click();
  assert.equal((await state()).effects[0].paintedMask, undefined);
  assert.equal(await page.getByRole('application', { name: 'Paint effect mask' }).count(), 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), painted);
  await editMask();
  await page.getByRole('combobox', { name: 'Brush shape', exact: true }).selectOption('diamond');
  await page.getByRole('combobox', { name: 'Mask falloff', exact: true }).selectOption('gaussian');
  await paint([[0.3, 0.75]]);
  assert.equal((await state()).effects[0].paintedMask.strokes.at(-1).shape, 'diamond');
  assert.equal((await state()).effects[0].paintedMask.strokes.at(-1).falloff, 'gaussian');
  await slider('Mask hardness').fill('1');
  assert.equal(
    await page.getByRole('combobox', { name: 'Mask falloff', exact: true }).isEnabled(),
    false,
  );
  await page.getByRole('combobox', { name: 'Brush shape', exact: true }).selectOption('square');
  await paint([[0.8, 0.75]]);
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await paint([
    [0.5, 0.35],
    [0.55, 0.55],
  ]);
  assert.equal((await state()).effects[0].paintedMask.strokes.at(-1).mode, 'erase');
  await page.getByRole('button', { name: 'Invert', exact: true }).click();
  await page.getByRole('button', { name: 'Paint', exact: true }).click();
  await paint([[0.82, 0.2]]);
  assert.equal(
    (await state()).effects[0].paintedMask.strokes.at(-1).mode,
    'erase',
    'Painting on an inverted mask must reveal the effect',
  );
  const beforePan = await state();
  await page.getByRole('application', { name: 'Paint effect mask', exact: true }).focus();
  await page.keyboard.down('Space');
  const box = await page.locator('.image-layer').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 15, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  assert.deepEqual(await state(), beforePan);
  assert.notEqual(await page.locator('.image-layer').getAttribute('style'), transform);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await paint([[0.4, 0.6]]);
  const last = (await state()).effects[0].paintedMask.strokes.at(-1);
  assert.ok(
    Math.abs(last.points[0].x - 0.4) < 0.01 && Math.abs(last.points[0].y - 0.6) < 0.01,
    'Zoom changed mask coordinates',
  );
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const beforeCancel = await state();
  await paint(
    [
      [0.15, 0.8],
      [0.3, 0.8],
    ],
    true,
  );
  assert.deepEqual(await state(), beforeCancel);
  await done();
  await page.getByRole('button', { name: 'Mask', exact: true }).click();
  const toggle = page.getByRole('switch', {
    name: 'Enable painted mask',
    exact: true,
  });
  await toggle.uncheck();
  assert.ok((await exportExact()).equals(unmasked));
  await toggle.check();
  await done();
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('top');
  await slider('Coverage').fill('0.7');
  await slider('Softness').fill('0.2');
  await exportExact();
  const saved = await state(),
    savedPixels = await exportExact();
  await page.getByRole('button', { name: 'Capture snapshot', exact: true }).click();
  await page.getByRole('textbox', { name: 'Snapshot name' }).fill('Painted');
  await page.getByRole('button', { name: 'Capture stage', exact: true }).click();
  await status('Captured Painted');
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ' + basename(projectPath));
  const cleanPreset = await savePreset('No painted mask', false);
  assert.ok(cleanPreset.effects.every((e) => !e.paintedMask));
  const withMask = await savePreset('Painted mask', true);
  assert.deepEqual(withMask.effects, saved.effects);
  await picker('Presets');
  const presetPath = resolve(output, label + '.gleechpreset');
  await chooseSave(presetPath);
  await page.getByRole('button', { name: 'Export preset Painted mask', exact: true }).click();
  await status('Exported preset ' + basename(presetPath));
  await page.keyboard.press('Escape');
  await chooseOpen(presetPath);
  await fileAction(page, 'Import Preset');
  await status('Imported preset Painted mask (2)');
  await page.keyboard.press('Escape');
  await open(portraitPath);
  width = 384;
  height = 512;
  rgba = fixture(width, height);
  await picker('Presets');
  await page.getByRole('button', { name: 'Apply Painted mask (2)', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), saved);
  await exportExact();
  await closeTestApp(app);
  app = await launch();
  await configure();
  await chooseOpen(projectPath);
  await page.keyboard.press('Control+o');
  await status('Opened ' + basename(projectPath));
  width = 512;
  height = 384;
  rgba = original;
  assert.deepEqual(await state(), saved);
  assert.ok((await exportExact()).equals(savedPixels));
  assert.equal(await page.getByRole('application', { name: 'Paint effect mask' }).count(), 0);
  await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  if (await page.getByRole('button', { name: 'Expand stages', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Expand stages', exact: true }).click();
  await page.getByRole('button', { name: 'Restore recipe Painted', exact: true }).click();
  await status('Restored Painted');
  assert.deepEqual(await state(), saved);
  await page.getByRole('button', { name: 'Bake and continue', exact: true }).click();
  await page.getByRole('textbox', { name: 'Snapshot name' }).fill('Baked mask');
  await page.getByRole('button', { name: 'Bake stage', exact: true }).click();
  await status('Baked Baked mask');
  assert.equal((await state()).effects.length, 0);
  rgba = savedPixels;
  assert.ok((await exportExact()).equals(savedPixels));
  await screenshot('baked');
  await open(smallPath);
  width = 128;
  height = 96;
  rgba = fixture(width, height);
  await picker();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Hue / Saturation', exact: true })
    .click();
  await slider('Lightness').fill('0.7');
  await editMask();
  const smallSurface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  const smallBounds = await smallSurface.boundingBox();
  await page.mouse.move(
    smallBounds.x + smallBounds.width * 0.2,
    smallBounds.y + smallBounds.height * 0.4,
  );
  await page.mouse.down();
  await page.mouse.move(
    smallBounds.x + smallBounds.width * 0.7,
    smallBounds.y + smallBounds.height * 0.6,
    { steps: 10 },
  );
  await page.waitForFunction(
    () => document.querySelector('.image-layer').dataset.previewQuality === 'interactive',
  );
  await page.mouse.up();
  await settle();
  await done();
  await exportExact();
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
  const report = {
    mode: label,
    exports,
    mousePainting: true,
    smallImagePainting: true,
    groupedUndo: true,
    brushShapes: true,
    hardnessFalloff: true,
    invertErase: true,
    panZoom: true,
    cancellation: true,
    maskToggle: true,
    application: true,
    snapshotsBake: true,
    projectRestart: true,
    optionalPortableMasks: true,
    result: 'passed',
  };
  await writeFile(resolve(output, label + '-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
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
        state: await state().catch(() => null),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
