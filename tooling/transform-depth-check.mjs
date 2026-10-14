import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((x) => x.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const quick = process.argv.includes('--quick');
const catalog = JSON.parse(
  await readFile(resolve(root, 'apps/desktop/resources/depth-maps/catalog.json'), 'utf8'),
).maps;
const additions = catalog.slice(20);
const testedMaps = quick ? [additions[0], additions.at(-1)] : additions;
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/transform-depth');
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
  await add('Transform');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  assert.ok(
    await page
      .getByRole('region', { name: 'Transform controls', exact: true })
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  await slider('Scale', '70');
  await slider('Position X', '12');
  await slider('Rotation', '27');
  await choose('Alignment', 'top-right');
  await exportExact();
  await choose('Outside edges', 'wrap');
  await exportExact();
  await choose('Outside edges', 'mirror');
  await exportExact();
  await choose('Outside edges', 'extend');
  await slider('Opacity', '0.5');
  await exportExact();
  await add('Depth Field');
  await choose('Treatment', 'field');
  await page.getByRole('button', { name: 'Starter maps...', exact: true }).click();
  await page.locator('.depth-map-grid button').nth(39).waitFor();
  assert.equal(await page.locator('.depth-map-grid button').count(), 40);
  await page
    .locator('.depth-map-grid img')
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await page
    .getByRole('combobox', { name: 'Depth map category', exact: true })
    .selectOption('Structure');
  assert.equal(
    await page.locator('.depth-map-grid button').count(),
    catalog.filter((map) => map.category === 'Structure').length,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  assert.ok(
    await page
      .locator('.depth-map-picker')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  );
  assert.ok(
    await page
      .getByRole('textbox', { name: 'Search depth maps' })
      .evaluate((node) => node.clientWidth > 150),
  );
  await settle();
  await captureTestWindow(app, resolve(output, `${label}-maps.png`));
  await page
    .locator('.depth-map-grid')
    .getByRole('button', { name: 'Torus Structure', exact: true })
    .click();
  await settle();
  await rememberMap();
  await exportExact();
  // Exercise each addition through the real chooser and renderer, including search,
  // single-step Undo/Redo, and cancellation without changing the recipe.
  for (const [index, map] of testedMaps.entries()) {
    const before = await recipe();
    await page.getByRole('button', { name: 'Starter maps...', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search depth maps' }).fill(map.name);
    await page
      .locator('.depth-map-grid')
      .getByRole('button', { name: `${map.name} ${map.category}`, exact: true })
      .click();
    await settle();
    assert.equal((await recipe()).effects.at(-1).fieldImage.source.id, `depth-map-v1:${map.id}`);
    await rememberMap();
    await exportExact();
    if (index === 0) {
      const selected = await recipe();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.deepEqual(await recipe(), before);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      assert.deepEqual(await recipe(), selected);
      await page.getByRole('button', { name: 'Starter maps...', exact: true }).click();
      await page.getByRole('button', { name: 'Close depth maps', exact: true }).click();
      assert.deepEqual(await recipe(), selected);
    }
  }
  await choose('Invert field', 'on');
  await slider('Field rotation', '31');
  await exportExact();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, mapPath);
  await page.getByRole('button', { name: 'Import map...', exact: true }).click();
  await status('Added depth map');
  await settle();
  await rememberMap();
  await choose('Treatment', 'displace');
  await exportExact();
  // Save/transfer a newly bundled map, rather than relying on its installed file.
  await page.getByRole('button', { name: 'Starter maps...', exact: true }).click();
  await page
    .locator('.depth-map-grid')
    .getByRole('button', { name: 'Truchet Channels Complex', exact: true })
    .click();
  await settle();
  await rememberMap();
  await exportExact();
  const depth = (await recipe()).effects.at(-1);
  await add('Blur');
  await choose('Style', 'depth');
  await choose('Copy field from', depth.instanceId);
  await settle();
  assert.deepEqual((await recipe()).effects.at(-1).fieldImage, depth.fieldImage);
  await exportExact();
  const saved = await recipe();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  assert.equal((await recipe()).effects.at(-1).fieldImage, undefined);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), saved);
  await add('Recursive Space');
  await choose('Depth field', 'on');
  await choose('Copy field from', depth.instanceId);
  await exportExact();
  assert.deepEqual((await recipe()).effects.at(-1).fieldImage, depth.fieldImage);
  await captureTestWindow(app, resolve(output, `${label}-controls.png`));
  const dimensions = await page.locator('.depth-field-controls').evaluate((node) => ({
    width: node.clientWidth,
    scroll: node.scrollWidth,
    children: [...node.children].map((child) => ({
      tag: child.tagName,
      width: child.getBoundingClientRect().width,
      scroll: child.scrollWidth,
    })),
  }));
  assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions));
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Portable Depth');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable Depth');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(presetPath);
  await page.getByRole('button', { name: 'Export preset Portable Depth', exact: true }).click();
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
  await status('Imported preset Portable Depth');
  await page.getByRole('button', { name: 'Apply Portable Depth', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  const transferred = await recipe();
  const withoutInstanceIds = (effects) =>
    effects.map((effect) => {
      const copy = { ...effect };
      delete copy.instanceId;
      return copy;
    });
  assert.deepEqual(withoutInstanceIds(transferred.effects), withoutInstanceIds(final.effects));
  assert.equal(transferred.masterSeed, final.masterSeed);
  await exportExact();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify({
      result: 'passed',
      exactExports: exports,
      maps: catalog.length,
      additionsRendered: testedMaps.map((map) => map.id),
      fieldConsumers: 3,
      projectRestart: true,
      presetTransfer: true,
    }),
  );
  console.log(
    `${label}: Transform/imported depth passed; ${exports} exact exports, ${catalog.length} starter maps (${testedMaps.length} additions rendered), portable restart/transfer.`,
  );
} finally {
  await closeTestApp(app);
}
