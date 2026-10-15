import { deleteFirstEffect } from './stack-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, unlink } from 'node:fs/promises';
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
const output = resolve(root, 'test-results/glyph');
await mkdir(output, { recursive: true });
let profile = await mkdtemp(resolve(output, `${label}-profile-`));
let env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let width = 129,
  height = 97;
let pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const imagePath = resolve(output, `${label}-input.png`);
const projectPath = resolve(output, `${label}.gleech`);
const presetPath = resolve(output, `${label}.gleechpreset`);
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
  await app.evaluate(({ BrowserWindow, dialog, clipboard }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    let text = '';
    clipboard.readText = async () => text;
    clipboard.writeText = async (value) => {
      text = value;
    };
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
}
async function settle() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.waitForFunction(
    () => {
      const n = document.querySelector('.image-layer');
      return n && n.dataset.renderRevision === n.dataset.requestedRevision;
    },
    undefined,
    { timeout: 60000 },
  );
}
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((n) => ({
    effects: JSON.parse(n.dataset.renderRecipe),
    masterSeed: Number(n.dataset.renderSeed),
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
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
async function exportExact() {
  const state = await recipe();
  const path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const actual = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(
    actual.equals(
      Buffer.from(
        renderEffects({ width, height, pixels: pixels.buffer }, state.effects, {
          masterSeed: state.masterSeed,
        }).pixels,
      ),
    ),
    'Exact RGBA export',
  );
}
const choose = (label, value) =>
  page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
const slider = (label, value) => page.getByRole('slider', { name: label, exact: true }).fill(value);
async function add() {
  await page.getByRole('button', { name: /Add effect/ }).click();
  const tile = page.locator('.effect-picker').getByRole('button', {
    name: 'Glyph Renderer',
    exact: true,
  });
  await tile.locator('img').evaluate((i) => i.decode());
  assert.equal(await tile.locator('img').evaluate((i) => i.naturalWidth), 384);
  await tile.click();
  await settle();
}
async function undoRedo(before, after) {
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), after);
}
try {
  await configure();
  await open(imagePath, 'Open image Ctrl+Shift+O');
  await add();
  assert.equal((await recipe()).effects[0].params.style, 'ascii');
  assert.equal(
    await page.getByRole('slider', { name: 'Dot / block threshold', exact: true }).count(),
    0,
  );
  assert.equal(await page.getByRole('textbox', { name: 'Foreground hex', exact: true }).count(), 0);
  await exportExact();
  for (const style of ['ascii', 'braille', 'blocks']) {
    await choose('Style', style);
    await slider('Cell size', '9');
    await slider('Cell aspect', '1.2');
    await slider('Glyph scale', '0.8');
    await slider('Contrast', '1.4');
    await slider('Symbol density', '1.1');
    if (style !== 'ascii') await slider('Dot / block threshold', '0.42');
    await choose('Invert', 'on');
    await choose('Glyph colors', 'source');
    await exportExact();
    await choose('Glyph colors', 'custom');
    await page.getByRole('textbox', { name: 'Foreground hex', exact: true }).fill('#ffcc66');
    await page.getByRole('textbox', { name: 'Background hex', exact: true }).fill('#102030');
    await exportExact();
  }
  await page
    .getByRole('group', { name: 'Foreground mode', exact: true })
    .getByRole('button', { name: 'Gradient', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Background mode', exact: true })
    .getByRole('button', { name: 'Gradient', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Foreground end hex', exact: true }).fill('#ff2060');
  await page.getByRole('textbox', { name: 'Background end hex', exact: true }).fill('#203060');
  await slider('Foreground direction', '90');
  await slider('Background direction', '45');
  await page
    .locator('.gradient-color-control')
    .filter({ has: page.getByRole('group', { name: 'Foreground mode', exact: true }) })
    .getByRole('button', { name: 'Add stop', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Foreground stop color hex', exact: true })
    .fill('#40ff80');
  assert.equal(JSON.parse((await recipe()).effects[0].params.foregroundColorStops).length, 3);
  await slider('Opacity', '0.8');
  await choose('Blend mode', 'screen');
  await choose('Application', 'left');
  await slider('Coverage', '0.65');
  await slider('Softness', '0.3');
  await page.getByRole('switch', { name: 'Tint', exact: true }).check();
  await page.getByRole('textbox', { name: 'Tint color hex', exact: true }).fill('#80c0ff');
  await slider('Tint strength', '0.3');
  await page.locator('.paint-mask-button').first().click();
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  const bounds = await surface.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.effect-lock').first().click();
  await exportExact();
  const masked = await recipe();
  console.log(`${label}: all three styles, gradients, finishing and masks passed`);
  await page.locator('.effect-select').first().click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Copy and paste settings', exact: true })
    .getByRole('menuitem', { name: 'Duplicate', exact: true })
    .click();
  await status('Duplicated filter');
  const duplicated = await recipe();
  assert.equal(duplicated.effects.length, 2);
  assert.deepEqual(duplicated.effects[1].params, masked.effects[0].params);
  assert.deepEqual(duplicated.effects[1].paintedMask, masked.effects[0].paintedMask);
  assert.equal(duplicated.effects[1].locked, true);
  await undoRedo(masked, duplicated);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.locator('.effect-lock').first().click();
  await add();
  await page.locator('.effect-lock').first().click();
  const beforeGleech = await recipe();
  await page.getByRole('button', { name: 'GLEECH', exact: true }).click();
  await page
    .locator('.gleech-dialog')
    .getByRole('button', { name: /^Simple/ })
    .click();
  await page
    .locator('.gleech-dialog')
    .getByRole('button', { name: /^Use Existing Only/ })
    .click();
  const generated = await recipe();
  assert.deepEqual(generated.effects[1], beforeGleech.effects[1]);
  assert.notDeepEqual(generated.effects[0].params, beforeGleech.effects[0].params);
  await undoRedo(beforeGleech, generated);
  await exportExact();
  await page.getByRole('button', { name: 'Var', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.variation-tile img').length === 9,
    undefined,
    { timeout: 60000 },
  );
  await page.locator('.variation-tile img').evaluateAll(async (images) => {
    await Promise.all(images.map((i) => i.decode()));
    if (images.some((i) => !i.naturalWidth)) throw new Error('Invalid variation thumbnail');
  });
  await page.getByRole('button', { name: 'Close variations', exact: true }).click();
  assert.deepEqual(await recipe(), generated);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.getByRole('slider', { name: 'Cell size', exact: true }).scrollIntoViewIfNeeded();
  await settle();
  assert.ok(
    await page
      .getByRole('region', { name: 'Glyph Renderer controls', exact: true })
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  );
  await captureTestWindow(app, resolve(output, `${label}-controls.png`));
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Portable Glyphs');
  await page.getByRole('checkbox', { name: 'Include painted masks', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable Glyphs');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(presetPath);
  await page.getByRole('button', { name: 'Export preset Portable Glyphs', exact: true }).click();
  await status('Exported preset');
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  const final = await recipe();
  await savePath(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ');
  await closeTestApp(app);
  await unlink(imagePath);
  app = await launch();
  await configure();
  await open(projectPath, 'Open project Ctrl+O');
  assert.deepEqual(await recipe(), final);
  await exportExact();
  await closeTestApp(app);
  profile = await mkdtemp(resolve(output, `${label}-transfer-profile-`));
  env = { ...env, GLEECH_SMOKE_USER_DATA: profile };
  app = await launch();
  await configure();
  const destination = resolve(output, `${label}-destination.png`);
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(destination);
  await open(destination, 'Open image Ctrl+Shift+O');
  await open(presetPath, 'Import Preset');
  await status('Imported preset Portable Glyphs');
  await page.getByRole('button', { name: 'Apply Portable Glyphs', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  const imported = await recipe();
  assert.deepEqual(
    imported.effects.map((e) => e.params),
    final.effects.map((e) => e.params),
  );
  assert.deepEqual(
    imported.effects.map((e) => e.paintedMask),
    final.effects.map((e) => e.paintedMask),
  );
  await exportExact();
  console.log(`${label}: project restart and portable preset transfer passed`);
  while (await page.locator('.effect-row').count()) {
    await deleteFirstEffect(page);
    await settle();
  }
  width = 1024;
  height = 768;
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 37 + Math.floor(i / 4) * 19) % 256,
  );
  const largePath = resolve(output, `${label}-large.png`);
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(largePath);
  await open(largePath, 'Open image Ctrl+Shift+O');
  await add();
  const beforeRecipe = await recipe();
  const beforeFrames = await page
    .locator('.image-layer')
    .evaluate((e) => Number(e.dataset.interactiveFrames ?? 0));
  await page.getByRole('slider', { name: 'Cell size', exact: true }).evaluate(async (slider) => {
    slider.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }),
    );
    for (let i = 0; i < 40; i++) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        slider,
        String(8 + i),
      );
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  });
  await page.waitForFunction(
    () => {
      const d = document.querySelector('.image-layer').dataset;
      return d.renderRevision === d.requestedRevision && d.previewQuality === 'full';
    },
    undefined,
    { timeout: 60000 },
  );
  const data = await page.locator('.image-layer').evaluate((e) => ({ ...e.dataset }));
  assert.ok(Number(data.interactiveFrames) > beforeFrames + 1, 'Continuous draft previews');
  assert.equal(Number(data.previewWidth), width);
  await undoRedo(beforeRecipe, await recipe());
  await exportExact();
  assert.deepEqual(errors, []);
  const result = {
    result: 'passed',
    exactExports: exports,
    styles: 3,
    gradients: true,
    masks: true,
    locks: true,
    duplicate: true,
    undoRedo: true,
    gleechVar: true,
    projectRestart: true,
    presetTransfer: true,
    interactiveFrames: Number(data.interactiveFrames) - beforeFrames,
    draftMs: Number(data.interactiveRenderMs),
  };
  await writeFile(resolve(output, `${label}-result.json`), JSON.stringify(result));
  console.log(
    `${label}: Glyph Renderer passed; ${exports} exact exports, three styles, masks/locks, GLEECH/Var, restart/transfer and ${result.interactiveFrames} live draft frames.`,
  );
} finally {
  await closeTestApp(app);
}
