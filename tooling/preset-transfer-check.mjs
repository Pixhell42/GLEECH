import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { installTestIOTracing } from './test-io-tracing.mjs';
import { recordDesktopFailure } from './record-desktop-failure.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/preset-transfer-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const profileA = await mkdtemp(resolve(output, `${label}-source-`));
const profileB = await mkdtemp(resolve(output, `${label}-destination-`));
const width = 129;
const height = 65;
const rgba = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    rgba.set(
      [(x * 17) % 256, (y * 23) % 256, ((x ^ y) * 13) % 256, [0, 1, 64, 128, 254, 255][x % 6]],
      (y * width + x) * 4,
    );
const second = Buffer.from(rgba.map((v, i) => (i % 4 === 3 ? v : 255 - v)));
const imagePath = resolve(output, `${label}-source.png`);
const secondPath = resolve(output, `${label}-destination.png`);
const presetPath = resolve(output, `${label}.gleechpreset`);
const brokenPath = resolve(output, `${label}-broken.gleechpreset`);
for (const [pixels, path] of [
  [rgba, imagePath],
  [second, secondPath],
])
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(path);
const launch = (profile) => {
  const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  return electron.launch({
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    timeout: 30000,
  });
};
let app = await launch(profileA);
let page;
const errors = [];
let exports = 0;
const frame = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function configure() {
  page = await app.firstWindow();
  await installTestIOTracing(app);
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
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((element) => ({
    effects: JSON.parse(element.dataset.renderRecipe),
    seed: Number(element.dataset.renderSeed),
  }));
}
async function chooseOpen(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, selection) => {
      dialog.showOpenDialog = async () => ({
        canceled: selection.canceled,
        filePaths: [selection.path],
      });
    },
    { path, canceled },
  );
}
async function chooseSave(path, canceled = false) {
  await app.evaluate(
    ({ dialog }, selection) => {
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.presetSaveOptions = options;
        return { canceled: selection.canceled, filePath: selection.path };
      };
    },
    { path, canceled },
  );
}
async function open(path) {
  await chooseOpen(path);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(path));
  await settle();
}
async function readyPicker() {
  await page.getByRole('dialog', { name: 'Add an effect' }).waitFor();
  await page.getByText('Loading presets…', { exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.operation-banner').waitFor({ state: 'hidden' });
}
async function picker(tab = 'Presets') {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await readyPicker();
}
const library = async (profile) =>
  JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets;
async function exportExact(input) {
  const state = await recipe();
  const path = resolve(output, `${label}-${++exports}.png`);
  await chooseSave(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const image = { width, height, pixels: Uint8Array.from(input).buffer };
  const expected = Buffer.from(
    renderEffects(image, state.effects, { masterSeed: state.seed, reference: image }).pixels,
  );
  assert.ok(
    (await sharp(path).ensureAlpha().raw().toBuffer()).equals(expected),
    'Transferred preset changed its deterministic output',
  );
}
try {
  await configure();
  await open(imagePath);
  for (const title of ['RGB split', 'Bit crush']) {
    await picker('Effects');
    await page.locator('.effect-picker').getByRole('button', { name: title, exact: true }).click();
    await settle();
  }
  await page.getByRole('combobox', { name: 'Dithering', exact: true }).selectOption('random');
  await page.getByRole('slider', { name: 'Color depth', exact: true }).fill('2');
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('top');
  await page.getByRole('slider', { name: 'Coverage', exact: true }).fill('0.6');
  await page.getByRole('slider', { name: 'Softness', exact: true }).fill('0.8');
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  const saved = await recipe();
  await exportExact(rgba);
  await picker();
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Portable gold');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable gold');
  await readyPicker();
  const original = (await library(profileA))[0];
  const titleBefore = await page.title();
  const bytesBefore = await readFile(resolve(profileA, 'presets.json'), 'utf8');
  await chooseSave(presetPath, true);
  await page.getByRole('button', { name: 'Export preset Portable gold', exact: true }).click();
  await status('Preset export canceled');
  await readyPicker();
  assert.equal(await readFile(resolve(profileA, 'presets.json'), 'utf8'), bytesBefore);
  await chooseSave(presetPath.replace('.gleechpreset', ''));
  await page.getByRole('button', { name: 'Export preset Portable gold', exact: true }).click();
  await status('Exported preset ' + basename(presetPath));
  await readyPicker();
  const options = await app.evaluate(() => globalThis.presetSaveOptions);
  assert.equal(options.defaultPath, 'Portable gold.gleechpreset');
  const portable = JSON.parse(await readFile(presetPath, 'utf8'));
  assert.equal(portable.format, 'gleech-preset');
  assert.deepEqual(portable.preset, original);
  assert.ok(!('source' in portable.preset) && !('snapshots' in portable.preset));
  await chooseOpen(presetPath, true);
  await page.getByRole('button', { name: 'Import preset', exact: true }).click();
  await status('Preset import canceled');
  await readyPicker();
  for (const broken of [
    { ...portable, schemaVersion: 99 },
    { ...portable, preset: { ...original, thumbnail: 'data:image/png;base64,aGVsbG8=' } },
  ]) {
    await writeFile(brokenPath, JSON.stringify(broken));
    await chooseOpen(brokenPath);
    await page.getByRole('button', { name: 'Import preset', exact: true }).click();
    await page.locator('.preset-operation-error').waitFor();
    await readyPicker();
    assert.equal(await readFile(resolve(profileA, 'presets.json'), 'utf8'), bytesBefore);
    await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  }
  await chooseSave(resolve(output, 'missing-directory', 'bad.gleechpreset'));
  await page.getByRole('button', { name: 'Export preset Portable gold', exact: true }).click();
  await page.locator('.preset-operation-error').waitFor();
  await readyPicker();
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await chooseOpen(presetPath);
  await page.getByRole('button', { name: 'Import preset', exact: true }).click();
  await status('Imported preset Portable gold (2)');
  await readyPicker();
  const duplicated = await library(profileA);
  assert.equal(duplicated.length, 2);
  assert.notEqual(duplicated[0].id, original.id);
  assert.deepEqual(duplicated[0].effects, saved.effects);
  assert.deepEqual(await recipe(), saved);
  assert.equal(await page.title(), titleBefore);
  await closeTestApp(app);
  app = await launch(profileB);
  await configure();
  await open(secondPath);
  await chooseSave(resolve(output, `${label}-destination.gleech`));
  await fileAction(page, 'Save project Ctrl+S');
  await status(`Saved ${label}-destination.gleech`);
  const empty = await recipe();
  const cleanTitle = await page.title();
  const historyBefore = {
    undo: await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(),
    redo: await page.getByRole('button', { name: 'Redo', exact: true }).isDisabled(),
  };
  await picker();
  await chooseOpen(presetPath);
  await page.getByRole('button', { name: 'Import preset', exact: true }).click();
  await status('Imported preset Portable gold');
  await readyPicker();
  assert.deepEqual(await recipe(), empty);
  assert.equal(await page.title(), cleanTitle, 'Import dirtied the current project');
  assert.equal(
    await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(),
    historyBefore.undo,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Redo', exact: true }).isDisabled(),
    historyBefore.redo,
  );
  const transferred = (await library(profileB))[0];
  assert.notEqual(transferred.id, original.id);
  assert.deepEqual(transferred.effects, original.effects);
  assert.equal(transferred.thumbnail, original.thumbnail);
  const contentWidth = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(960, 640);
    return window.getContentSize()[0];
  });
  await page.waitForFunction((width) => innerWidth === width, contentWidth);
  for (const name of ['Import preset', 'Save current stack', 'Export preset Portable gold']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const bounds = await button.boundingBox();
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= (await page.evaluate(() => innerWidth)),
      `${name} is clipped`,
    );
    assert.ok((await button.getAttribute('title')).length > 10);
  }
  await page.mouse.move(1, 1);
  await frame();
  const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true }))
      .toPNG()
      .toString('base64'),
  );
  await writeFile(resolve(output, `${label}-library.png`), Buffer.from(screenshot, 'base64'));
  await page.getByRole('button', { name: 'Apply Portable gold', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await recipe(), saved);
  await exportExact(second);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), empty);
  assert.equal(await page.title(), cleanTitle);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), saved);
  await closeTestApp(app);
  app = await launch(profileB);
  await configure();
  await open(secondPath);
  await picker();
  await page.getByRole('button', { name: 'Apply Portable gold', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await recipe(), saved);
  await exportExact(second);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      profiles: 2,
      restart: true,
      cancellation: true,
      duplicateImport: true,
      failedFiles: true,
      result: 'passed',
    }),
  );
} catch (error) {
  await recordDesktopFailure({ app, page, output, label, failure: error, errors }).catch(
    (failure) => console.error(failure.message),
  );
  await writeFile(
    resolve(output, `${label}-ui-failure.json`),
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
