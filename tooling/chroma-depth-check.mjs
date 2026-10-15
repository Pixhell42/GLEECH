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
const output = resolve(root, 'test-results/chroma-depth');
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
          layerImages: layers,
        }).pixels,
      ),
    ),
    'Exact RGBA export',
  );
}

const layers = new Map();
const choose = (label, value) =>
  page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
const slider = (label, value) => page.getByRole('slider', { name: label, exact: true }).fill(value);
const presetPath = resolve(output, `${label}.gleechpreset`);
const mapPath = resolve(output, `${label}-map.png`);
const mapBytes = Buffer.from(
  Uint8Array.from({ length: 47 * 23 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : ((Math.floor(i / 4) % 47) / 46) * 255,
  ),
);
await sharp(mapBytes, { raw: { width: 47, height: 23, channels: 4 } })
  .png()
  .toFile(mapPath);
async function add(title) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  const tile = page.locator('.effect-picker').getByRole('button', { name: title, exact: true });
  await tile.locator('img').evaluate((image) => image.decode());
  await tile.click();
  await settle();
}
async function rememberMap() {
  const e = (await recipe()).effects.findLast((e) => e.fieldImage);
  if (e.fieldImage.source.id.startsWith('depth-map-v1:')) {
    const id = e.fieldImage.source.id.slice('depth-map-v1:'.length);
    const bytes = await sharp(resolve(root, `apps/desktop/resources/depth-maps/${id}.png`))
      .ensureAlpha()
      .raw()
      .toBuffer();
    layers.set(e.fieldImage.source.id, {
      width: 2048,
      height: 2048,
      pixels: Uint8Array.from(bytes).buffer,
    });
  } else
    layers.set(e.fieldImage.source.id, {
      width: 47,
      height: 23,
      pixels: Uint8Array.from(mapBytes).buffer,
    });
}
async function status(text) {
  await page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
}
try {
  await configure();
  await open(imagePath, 'Open image Ctrl+Shift+O');
  await add('Chroma Mosh');
  await exportExact();
  await slider('Chroma size', '6');
  await slider('Color travel', '23');
  await slider('Direction', '36');
  for (const style of ['smear', 'blocks', 'trails']) {
    await choose('Style', style);
    if (style === 'smear') {
      assert.equal(await page.getByRole('slider', { name: 'Density', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 0);
    } else await slider('Density', '0.65');
    if (style === 'trails') {
      await slider('Persistence', '0.85');
      await slider('Trail samples', '9');
    }
    await choose('Edge Handling', style === 'blocks' ? 'mirror' : 'wrap');
    await exportExact();
  }
  const before = await recipe();
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  assert.equal((await recipe()).effects[0].seedOffset, before.effects[0].seedOffset + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await slider('Coverage', '0.7');
  await slider('Softness', '0.3');
  await slider('Opacity', '0.8');
  await choose('Blend mode', 'screen');
  await page.getByRole('switch', { name: 'Tint', exact: true }).check();
  await page.getByRole('textbox', { name: 'Tint color hex', exact: true }).fill('#80c0ff');
  await slider('Tint strength', '0.25');
  await exportExact();
  await page.locator('.paint-mask-button').click();
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  const bounds = await surface.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.effect-lock').click();
  await exportExact();
  console.log(label + ': Chroma styles, alpha, masks, patterns and Undo passed');
  await add('Depth Field');
  await choose('Field source', 'radial');
  await choose('Treatment', 'contours');
  await slider('Contour count', '17');
  await slider('Contour width', '0.4');
  await slider('Contour offset', '0.35');
  await slider('Contour softness', '0.7');
  await slider('Displacement', '4');
  await page.getByRole('textbox', { name: 'Contour color hex', exact: true }).fill('#00c8ff');
  await exportExact();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, mapPath);
  await page.getByRole('button', { name: 'Import map...', exact: true }).click();
  await status('Added depth map');
  await rememberMap();
  await exportExact();
  await choose('Treatment', 'terraces');
  assert.equal(
    await page.getByRole('slider', { name: 'Contour softness', exact: true }).count(),
    0,
  );
  await slider('Contour count', '7');
  await slider('Terrace bevel', '0.3');
  await slider('Light angle', '105');
  await slider('Light elevation', '22');
  await slider('Ambient light', '0.15');
  await slider('Relief highlights', '0.4');
  await slider('Relief strength', '2');
  await exportExact();
  const terraces = await recipe();
  await slider('Terrace bevel', '0.8');
  await settle();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), terraces);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await choose('Treatment', 'relief');
  assert.equal(await page.getByRole('slider', { name: 'Terrace bevel', exact: true }).count(), 0);
  await exportExact();
  await choose('Treatment', 'terraces');
  await page.locator('.effect-lock').first().click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  await slider('Light elevation', '35');
  await settle();
  assert.ok(
    await page
      .getByRole('region', { name: 'Depth Field controls', exact: true })
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  );
  await captureTestWindow(app, resolve(output, `${label}-controls.png`));
  console.log(label + ': expanded contours, imported-map terraces, lighting and Undo passed');
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Portable Chroma Depth');
  await page.getByRole('checkbox', { name: 'Include painted masks', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable Chroma Depth');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(presetPath);
  await page
    .getByRole('button', { name: 'Export preset Portable Chroma Depth', exact: true })
    .click();
  await status('Exported preset');
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  const final = await recipe();
  await savePath(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ');
  await closeTestApp(app);
  await unlink(mapPath);
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
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, presetPath);
  await fileAction(page, 'Import Preset');
  await status('Imported preset Portable Chroma Depth');
  await page.getByRole('button', { name: 'Apply Portable Chroma Depth', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  await exportExact();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify({
      result: 'passed',
      exactExports: exports,
      chromaStyles: 3,
      depthTreatments: 3,
      patterns: true,
      masks: true,
      undoRedo: true,
      projectRestart: true,
      presetTransfer: true,
    }),
  );
  console.log(
    `${label}: Chroma Mosh/expanded Depth Field passed; ${exports} exact exports, three chroma styles, contours/terraces/lighting and portable restart/transfer.`,
  );
} finally {
  await closeTestApp(app);
}
