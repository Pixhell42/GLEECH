import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/vector-maps');
await mkdir(output, { recursive: true });
const catalog = JSON.parse(
  await readFile(resolve(root, 'apps/desktop/resources/vector-maps/catalog.json'), 'utf8'),
).maps;
const mapCases = process.argv.includes('--quick') ? [catalog[0], catalog.at(-1)] : catalog;
const width = 129,
  height = 97;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const input = resolve(output, `${label}-input.png`),
  project = resolve(output, `${label}.gleech`),
  preset = resolve(output, `${label}.gleechpreset`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(input);
let profile = await mkdtemp(resolve(output, `${label}-profile-`));
let env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
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
const errors = [],
  layers = new Map();
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
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
      const d = document.querySelector('.image-layer')?.dataset;
      return d?.renderRecipe && d.renderRevision === d.requestedRevision;
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
  await page
    .getByRole('status')
    .filter({
      hasText:
        action === 'Import Preset'
          ? 'Imported preset Portable Vector Field'
          : 'Opened ' + basename(path),
    })
    .waitFor();
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
  const state = await recipe(),
    path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const expected = renderEffects({ width, height, pixels: pixels.buffer }, state.effects, {
    masterSeed: state.masterSeed,
    layerImages: layers,
  });
  const actual = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(
    actual.equals(Buffer.from(expected.pixels)),
    'Exact RGBA export with selected numeric map',
  );
}
async function picker() {
  await page.getByRole('button', { name: 'Starter vector maps…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Starter vector maps', exact: true });
  await dialog.locator('.depth-map-grid button').first().waitFor();
  return dialog;
}
async function add(title) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  await page.locator('.effect-picker').getByRole('button', { name: title, exact: true }).click();
  await settle();
}
try {
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  await add('Motion Transfer');
  await page.getByRole('combobox', { name: 'Map encoding', exact: true }).selectOption('gradient');
  await page.getByRole('slider', { name: 'Map scale', exact: true }).fill('70');
  await page.getByRole('slider', { name: 'Map position X', exact: true }).fill('20');
  await page.getByRole('slider', { name: 'Map rotation', exact: true }).fill('31');
  const before = await recipe();
  let modal = await picker();
  assert.equal(await modal.locator('.depth-map-grid button').count(), 40);
  await modal
    .getByRole('combobox', { name: 'Vector map category', exact: true })
    .selectOption('Swirl');
  assert.equal(
    await modal.locator('.depth-map-grid button').count(),
    catalog.filter((map) => map.category === 'Swirl').length,
  );
  await modal.getByRole('textbox', { name: 'Search vector maps', exact: true }).fill('spiral');
  assert.equal(
    await modal.locator('.depth-map-grid button').count(),
    catalog.filter(
      (map) =>
        map.category === 'Swirl' &&
        `${map.name} ${map.description}`.toLowerCase().includes('spiral'),
    ).length,
  );
  await modal.getByRole('textbox', { name: 'Search vector maps', exact: true }).fill('not-a-map');
  await modal.getByText('No matching maps.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(await recipe(), before, 'Cancel does not mutate the stack');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  modal = await picker();
  await modal.locator('img').evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
  });
  assert.equal(
    await modal.evaluate((n) => n.scrollWidth <= n.clientWidth),
    true,
    'No horizontal overflow',
  );
  await captureTestWindow(app, resolve(output, `${label}-chooser.png`));
  await page.waitForTimeout(200);
  await captureTestWindow(app, resolve(output, `${label}-chooser.png`));
  await modal.getByRole('button', { name: 'Close vector maps', exact: true }).click();
  for (const map of mapCases) {
    const data = await sharp(resolve(root, `apps/desktop/resources/vector-maps/${map.id}.png`))
      .ensureAlpha()
      .raw()
      .toBuffer();
    layers.clear();
    layers.set(`vector-map-v1:${map.id}`, {
      width: 2048,
      height: 2048,
      pixels: Uint8Array.from(data).buffer,
    });
    modal = await picker();
    await modal.getByRole('button', { name: `${map.name} ${map.category}`, exact: true }).click();
    await status('Added vector map ' + map.name);
    const state = await recipe(),
      effect = state.effects[0];
    assert.equal(effect.image.source.id, `vector-map-v1:${map.id}`);
    assert.deepEqual(
      [
        effect.params.encoding,
        effect.params.mapScale,
        effect.params.mapX,
        effect.params.mapY,
        effect.params.mapRotation,
      ],
      ['rg', 100, 50, 50, 0],
    );
    if (map.id === 'horizontal-flow') {
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.deepEqual(await recipe(), before);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      assert.deepEqual(await recipe(), state, 'Map selection is one Undo step');
    }
    await exportExact();
    console.log(`${label}: ${map.name} selection and exact export passed`);
  }
  await page.getByRole('combobox', { name: 'Edges', exact: true }).selectOption('wrap');
  await page.getByRole('slider', { name: 'Map rotation', exact: true }).fill('37');
  await page.getByRole('slider', { name: 'Map scale', exact: true }).fill('130');
  await page.getByRole('slider', { name: 'Map position X', exact: true }).fill('42');
  await exportExact();
  await page
    .getByRole('button', { name: 'Starter vector maps…', exact: true })
    .scrollIntoViewIfNeeded();
  await settle();
  await captureTestWindow(app, resolve(output, `${label}-controls.png`));
  await page.waitForTimeout(200);
  await captureTestWindow(app, resolve(output, `${label}-controls.png`));
  const rejected = await page.evaluate(() =>
    window.gleech.chooseVectorMap('../depth-maps/radial-dome'),
  );
  assert.equal(rejected.ok, false);
  // Reused picker keeps the existing scalar depth library intact.
  await add('Depth Field');
  await page.getByRole('button', { name: 'Starter maps...', exact: true }).click();
  const depth = page.getByRole('dialog', { name: 'Starter depth maps', exact: true });
  await depth.locator('.depth-map-grid button').first().waitFor();
  assert.equal(await depth.locator('.depth-map-grid button').count(), 40);
  await depth.getByRole('button', { name: 'Close depth maps', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  const final = await recipe();
  await savePath(project);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ');
  await fileAction(page, 'Save Stack as Preset');
  await page
    .getByRole('textbox', { name: 'Preset name', exact: true })
    .fill('Portable Vector Field');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable Vector Field');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(preset);
  await page
    .getByRole('button', { name: 'Export preset Portable Vector Field', exact: true })
    .click();
  await status('Exported preset');
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  await closeTestApp(app);
  app = await launch();
  await configure();
  await open(project, 'Open project Ctrl+O');
  assert.deepEqual(await recipe(), final);
  await exportExact();
  await closeTestApp(app);
  profile = await mkdtemp(resolve(output, `${label}-transfer-profile-`));
  env = { ...env, GLEECH_SMOKE_USER_DATA: profile };
  app = await launch();
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  await open(preset, 'Import Preset');
  await status('Imported preset Portable Vector Field');
  await page.getByRole('button', { name: 'Apply Portable Vector Field', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  const transferred = await recipe();
  assert.deepEqual(transferred.effects[0].image, final.effects[0].image);
  assert.deepEqual(transferred.effects[0].params, final.effects[0].params);
  await exportExact();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify(
      {
        maps: 40,
        checkedMaps: mapCases.length,
        exactExports: exports,
        chooser: true,
        cancel: true,
        history: true,
        projectRestart: true,
        portablePreset: true,
        depthPickerRegression: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `${label}: ${exports} exact exports; ${mapCases.length}/40 fields, chooser, history, restart and portable presets passed`,
  );
} finally {
  await closeTestApp(app);
}
