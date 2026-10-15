import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, basename } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffectsAsync, effectCount } from './effects-reference.mjs';
import { recompressJpeg } from './jpeg-reference.mjs';

const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve('test-results/datamosh-extensions');
await mkdir(output, { recursive: true });
let profile = await mkdtemp(resolve(output, `${label}-profile-`));
let env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 257,
  height = 193;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 128, 255, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const input = resolve(output, `${label}-input.png`);
const referencePath = resolve(output, `${label}-reference.png`);
const projectPath = resolve(output, `${label}.gleech`);
const presetPath = resolve(output, `${label}.gleechpreset`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(input);
await sharp({ create: { width, height, channels: 4, background: '#2e80fa' } })
  .png()
  .toFile(referencePath);
const launch = () =>
  electron.launch({
    args: [
      ...(exe ? [] : [resolve('apps/desktop')]),
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
  page.setDefaultTimeout(25000);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog, clipboard }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    let text = '';
    clipboard.readText = () => text;
    clipboard.writeText = (value) => {
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
      const d = document.querySelector('.image-layer')?.dataset;
      return (
        d &&
        d.renderRevision === d.requestedRevision &&
        d.previewQuality === 'full' &&
        JSON.parse(d.renderRecipe).length === document.querySelectorAll('.effect-row').length
      );
    },
    undefined,
    { timeout: 60000 },
  );
}
async function state() {
  await settle();
  return page.locator('.image-layer').evaluate((n) => ({
    effects: JSON.parse(n.dataset.renderRecipe),
    masterSeed: Number(n.dataset.renderSeed),
  }));
}
const slider = (name, value) => page.getByRole('slider', { name, exact: true }).fill(String(value));
const choose = (name, value) =>
  page.getByRole('combobox', { name, exact: true }).selectOption(value);
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
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
async function add(name) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  assert.equal(await page.locator('.effect-picker .effect-tile').count(), effectCount);
  const tile = page.locator('.effect-picker').getByRole('button', { name, exact: true });
  await tile.locator('img').evaluate((image) => image.decode());
  assert.equal(await tile.locator('img').evaluate((image) => image.naturalWidth), 384);
  await tile.click();
  await settle();
}
async function exportExact() {
  const recipe = await state();
  const path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const layers = new Map();
  for (const effect of recipe.effects)
    for (const image of [effect.image, effect.directionImage].filter(Boolean)) {
      // Canvas metadata deliberately omits embedded PNG bytes. Decode the known
      // independent fixtures rather than relying on the app's rendered pixels.
      const fixture =
        image === effect.directionImage
          ? resolve('apps/desktop/resources/vector-maps/pinwheel-sectors.png')
          : referencePath;
      assert.equal(
        image.source.name,
        image === effect.directionImage ? 'Pinwheel Sectors.png' : basename(referencePath),
      );
      const raw = await sharp(fixture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      layers.set(image.source.id, {
        width: raw.info.width,
        height: raw.info.height,
        pixels: Uint8Array.from(raw.data).buffer,
      });
    }
  const expected = await renderEffectsAsync(
    { width, height, pixels: pixels.buffer },
    recipe.effects,
    {
      masterSeed: recipe.masterSeed,
      layerImages: layers,
      recompressJpeg,
      yieldControl: async () => {},
    },
  );
  const actual = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(actual.equals(Buffer.from(expected.pixels)), `Exact export ${exports}`);
  console.log(`${label}: exact export ${exports} passed`);
}
async function reset(name) {
  await page.getByRole('slider', { name, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset', exact: true }).click();
  await settle();
}
try {
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  await add('Motion Mosh');
  await choose('Direction field', 'spiral');
  await slider('Coherence', 0.4);
  const beforePattern = await state();
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  assert.notDeepEqual(await state(), beforePattern);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), beforePattern);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await exportExact();
  await page
    .locator('.direction-field-controls')
    .getByRole('button', { name: 'Starter Maps', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Starter vector maps', exact: true })
    .getByRole('button', { name: /Pinwheel Sectors/ })
    .click();
  await status('Added direction map');
  await exportExact();
  await add('Reference / Cross-image Mosh');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, referencePath);
  await page.getByRole('button', { name: 'Choose image…', exact: true }).click();
  await slider('Progression', 1);
  await slider('Replacement density', 0);
  await exportExact();
  await slider('Replacement density', 0.4);
  await exportExact();
  await reset('Replacement density');
  assert.equal((await state()).effects.at(-1).params.replacementDensity, 1);
  await slider('Replacement density', 0.4);
  await add('JPEG Recompression');
  await slider('Quality', 21);
  await slider('Generations', 4);
  await slider('Quality loss per generation', 5);
  await choose('Chroma subsampling', '444');
  await exportExact();
  // Supersede many JPEG renders in one slider gesture, then verify the final recipe/export.
  await page.getByRole('slider', { name: 'Quality', exact: true }).evaluate(async (node) => {
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    for (const value of [60, 7, 40, 8, 65, 11]) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        node,
        String(value),
      );
      node.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((done) => setTimeout(done, 30));
    }
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  });
  assert.equal((await state()).effects.at(-1).params.quality, 11);
  await exportExact();
  await reset('Quality');
  assert.equal((await state()).effects.at(-1).params.quality, 18);
  await slider('Opacity', 0.6);
  await choose('Application', 'left');
  await slider('Coverage', 0.65);
  await slider('Softness', 0.3);
  await page.locator('.paint-mask-button').first().click();
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  const bounds = await surface.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await exportExact();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  assert.ok(
    await page.locator('.effect-detail').evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
  );
  await captureTestWindow(app, resolve(output, `${label}-jpeg-controls.png`));
  const final = await state();
  await savePath(projectPath);
  await fileAction(page, 'Save project as… Ctrl+Shift+S');
  await status('Saved ');
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Datamosh Extensions');
  await page.getByRole('checkbox', { name: 'Include painted masks', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Datamosh Extensions');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(presetPath);
  await page
    .getByRole('button', { name: 'Export preset Datamosh Extensions', exact: true })
    .click();
  await status('Exported preset');
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  await closeTestApp(app);
  app = await launch();
  await configure();
  await open(projectPath, 'Open project Ctrl+O');
  assert.deepEqual(await state(), final);
  await exportExact();
  await closeTestApp(app);
  profile = await mkdtemp(resolve(output, `${label}-transfer-profile-`));
  env = { ...env, GLEECH_SMOKE_USER_DATA: profile };
  app = await launch();
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  await open(presetPath, 'Import Preset');
  await status('Imported preset Datamosh Extensions');
  await page.getByRole('button', { name: 'Apply Datamosh Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  const applied = await state();
  assert.deepEqual(
    applied.effects.map((effect) => effect.params),
    final.effects.map((effect) => effect.params),
  );
  assert.ok(applied.effects.at(-1).paintedMask);
  await exportExact();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify(
      { effects: effectCount, exactExports: exports, restart: true, presetTransfer: true, errors },
      null,
      2,
    ),
  );
  console.log(`${label}: datamosh controls, JPEG cancellation, masks and storage passed`);
} finally {
  await closeTestApp(app);
}
