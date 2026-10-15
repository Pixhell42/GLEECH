import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
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
const output = resolve(root, 'test-results/solid');
await mkdir(output, { recursive: true });
let profile = await mkdtemp(resolve(output, `${label}-profile-`));
let env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
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
          layerImages: new Map(
            state.effects
              .filter((e) => e.type === 'solid' && e.image)
              .map((e) => [e.image.source.id, layerPixels]),
          ),
        }).pixels,
      ),
    ),
    'Exact RGBA export',
  );
}

const layerPath = resolve(output, `${label}-layer.png`);
const presetPath = resolve(output, `${label}.gleechpreset`);
const layerWidth = 47,
  layerHeight = 23;
const layerBytes = Buffer.from(
  Uint8Array.from({ length: layerWidth * layerHeight * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 29 + 17) % 256,
  ),
);
const layerPixels = {
  width: layerWidth,
  height: layerHeight,
  pixels: Uint8Array.from(layerBytes).buffer,
};
await sharp(layerBytes, { raw: { width: layerWidth, height: layerHeight, channels: 4 } })
  .png()
  .toFile(layerPath);
async function add() {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  const tile = page.locator('.effect-picker').getByRole('button', { name: 'Solid', exact: true });
  await tile.locator('img').evaluate((image) => image.decode());
  await tile.click();
  await settle();
}
async function status(text) {
  await page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
}
try {
  await configure();
  await open(imagePath, 'Open image Ctrl+Shift+O');
  await add();
  await exportExact();
  let panel = page.getByRole('region', { name: 'Solid controls', exact: true });
  await panel.getByRole('slider', { name: 'Opacity', exact: true }).fill('0.4');
  await panel.getByRole('combobox', { name: 'Blend mode', exact: true }).selectOption('multiply');
  await panel.getByRole('combobox', { name: 'Application', exact: true }).selectOption('left');
  await panel.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.6');
  await panel.getByRole('slider', { name: 'Softness', exact: true }).fill('0.5');
  await exportExact();
  await panel.getByRole('combobox', { name: 'Content', exact: true }).selectOption('gradient');
  const ramp = panel.locator('.gradient-stop-editor');
  await ramp.getByRole('button', { name: 'Add stop', exact: true }).click();
  const hex = ramp.getByRole('textbox', { name: 'Fill color stop color hex', exact: true });
  await hex.fill('#00ff00');
  await hex.press('Enter');
  await exportExact();
  await add();
  await panel.getByRole('combobox', { name: 'Content', exact: true }).selectOption('source');
  const sourceState = await recipe();
  assert.equal(sourceState.effects.at(-1).params.content, 'source');
  await exportExact();
  await panel.getByRole('combobox', { name: 'Content', exact: true }).selectOption('image');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, layerPath);
  await panel.getByRole('button', { name: /^Choose image/ }).click();
  await status('Added layer image ');
  await panel.locator('img').evaluate((image) => image.decode());
  const attached = await recipe();
  assert.equal(attached.effects.at(-1).image.source.width, layerWidth);
  for (const placement of ['fit', 'fill', 'stretch']) {
    await panel
      .getByRole('combobox', { name: 'Image placement', exact: true })
      .selectOption(placement);
    await exportExact();
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await recipe()).effects.at(-1).params.placement, 'fill');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal((await recipe()).effects.at(-1).params.placement, 'stretch');
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Portable Solid');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable Solid');
  await savePath(presetPath);
  await page.getByRole('button', { name: 'Export preset Portable Solid', exact: true }).click();
  await status('Exported preset ');
  const portable = JSON.parse(await readFile(presetPath, 'utf8'));
  assert.ok(portable.preset.effects.at(-1).image.png.startsWith('data:image/png;base64,'));
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  await savePath(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ');
  const saved = await recipe();
  await closeTestApp(app);
  await unlink(imagePath);
  await unlink(layerPath);
  app = await launch();
  await configure();
  await open(projectPath, 'Open project Ctrl+O');
  panel = page.getByRole('region', { name: 'Solid controls', exact: true });
  assert.deepEqual(await recipe(), saved);
  await exportExact();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  await panel.getByRole('button', { name: /^Change image/ }).scrollIntoViewIfNeeded();
  await settle();
  assert.ok(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth));
  await captureTestWindow(app, resolve(output, `${label}-controls.png`));
  await closeTestApp(app);
  profile = await mkdtemp(resolve(output, `${label}-transfer-profile-`));
  env = { ...env, GLEECH_SMOKE_USER_DATA: profile };
  app = await launch();
  await configure();
  // The receiving profile starts with a plain canvas and no attached layer images.
  const destinationPath = resolve(output, `${label}-destination.png`);
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(destinationPath);
  await open(destinationPath, 'Open image Ctrl+Shift+O');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, presetPath);
  await fileAction(page, 'Import Preset');
  await status('Imported preset Portable Solid');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Portable Solid', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  await settle();
  await exportExact();
  await page.locator('.effect-lock').first().click();
  const locked = (await recipe()).effects.at(-1);
  assert.equal(locked.locked, true);
  await page.getByRole('button', { name: 'Var', exact: true }).click();
  await page.locator('.variation-grid[aria-busy="false"]').waitFor({ timeout: 60000 });
  assert.equal(await page.locator('.variation-tile:disabled').count(), 0);
  await page.getByRole('button', { name: 'Apply distant variation 3', exact: true }).click();
  await page.locator('.variation-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual((await recipe()).effects.at(-1), locked);
  await exportExact();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify({
      result: 'passed',
      exactExports: exports,
      contentModes: 4,
      placements: 3,
      multiStopGradient: true,
      undoRedo: true,
      projectRestartWithoutSourceFiles: true,
      presetTransfer: true,
      lockedImageVariation: true,
    }),
  );
  console.log(
    `${label}: Solid passed; ${exports} exact exports, embedded project restart and preset transfer.`,
  );
} finally {
  await closeTestApp(app);
}
