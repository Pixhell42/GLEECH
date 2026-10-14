import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/filter-completion-check');
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
  app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
  });
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await frame();
}
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).first().waitFor({ timeout: 30000 });
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
    renderEffects(image, recipe.effects, {
      masterSeed: recipe.seed,
      reference: image,
      layerImages: new Map(
        recipe.effects.flatMap((effect) =>
          [effect.application.depthImage, effect.fieldImage]
            .filter(Boolean)
            .map((asset) => [asset.source.id, image]),
        ),
      ),
    }).pixels,
  );
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  assert.ok(
    data.equals(expected),
    'Native feature-completion export differs from the shared renderer',
  );
  return data;
}
async function screenshot(name) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await frame();
  await captureTestWindow(app, resolve(output, `${label}-${name}.png`));
}
const slider = (name) => page.getByRole('slider', { name, exact: true });
const choose = (name, value) =>
  page.getByRole('combobox', { name, exact: true }).selectOption(value);
async function add(name) {
  await picker();
  await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
}
async function previews() {
  const control = page.getByRole('combobox', { name: 'Depth preview', exact: true });
  const before = await state();
  await control.selectOption('false-color');
  await page.getByRole('img', { name: 'Depth field preview: false-color', exact: true }).waitFor();
  await screenshot('false-color');
  await control.selectOption('overlay');
  await page.getByRole('img', { name: 'Depth field preview: overlay', exact: true }).waitFor();
  await control.selectOption('hidden');
  assert.ok(await page.locator('.depth-field-preview').isHidden());
  await control.selectOption('grayscale');
  await page.getByRole('img', { name: 'Depth field preview: grayscale', exact: true }).waitFor();
  assert.deepEqual(await state(), before, 'Presentation-only preview modes changed the recipe');
}
try {
  await configure();
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  await add('Advanced Bit Damage');
  await slider('Damage density').fill('1');
  await slider('Low bit').fill('0');
  await slider('High bit').fill('7');
  await choose('Target', 'red');
  await slider('Cell size').fill('1');
  for (const operation of [
    'flip',
    'clear',
    'set',
    'shift',
    'rotate',
    'scramble',
    'isolate',
    'swap',
    'xor',
    'and',
    'or',
    'inject',
    'byte-scramble',
    'crossfeed',
  ]) {
    await choose('Operation', operation);
    if (['xor', 'and', 'or'].includes(operation)) await slider('Operand').fill('170');
    if (operation === 'swap') {
      await slider('First swap bit').fill('2');
      await slider('Second swap bit').fill('7');
    }
    if (operation === 'byte-scramble') await slider('Burst length').fill('8');
    if (operation === 'crossfeed') await choose('Source channel', 'blue');
    await exportExact();
  }
  await choose('Bit selection', 'custom');
  for (const bit of [1, 2, 4, 5, 6])
    await page.getByRole('checkbox', { name: `Bit ${bit}`, exact: true }).uncheck();
  assert.equal((await state()).effects[0].params.bitMask, 137);
  assert.equal(await slider('Low bit').count(), 0);
  await choose('Operation', 'xor');
  await slider('Operand').fill('170');
  await page.locator('[data-settings-key="operand"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset', exact: true }).click();
  assert.equal((await state()).effects[0].params.operand, 128);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await state()).effects[0].params.operand, 170);
  await screenshot('custom-planes');
  await exportExact();
  await choose('Operation', 'inject');
  await slider('Bit probability').fill('0.6');
  await slider('Damage density').fill('0.65');
  await slider('Damage clustering').fill('0.75');
  const patternBefore = await state();
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  assert.equal((await state()).effects[0].seedOffset, patternBefore.effects[0].seedOffset + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), patternBefore);
  for (const region of [
    'highlights',
    'midtones',
    'shadows',
    'content-edges',
    'flat-areas',
    'high-detail',
    'low-detail',
    'alpha',
    'horizontal-bands',
    'vertical-bands',
    'depth-near',
    'depth-mid',
    'depth-far',
    'depth-band',
  ]) {
    await choose('Application', region);
    await slider('Softness').fill('0.15');
    if (region === 'depth-band') {
      await slider('Range start').fill('0.2');
      await slider('Range end').fill('0.8');
    }
    await exportExact();
  }
  await choose('Mask Field source', 'image');
  await chooseOpen(imagePath);
  await page.getByRole('button', { name: 'Import map...', exact: true }).click();
  await page.getByRole('img', { name: 'Depth field preview: grayscale', exact: true }).waitFor();
  assert.ok((await state()).effects[0].application.depthImage);
  await previews();
  await exportExact();
  await add('Subject / Depth / Hybrid Cutout');
  await choose('Cutout source', 'depth');
  await choose('Field source', 'linear');
  await slider('Near').fill('0.25');
  await slider('Far').fill('0.75');
  await choose('Fill holes', 'on');
  await slider('Remove specks').fill('0.2');
  await slider('Cleanup smoothing').fill('0.5');
  await slider('Expand / Contract').fill('1');
  await slider('Spatial feather').fill('1');
  const cutout = await exportExact();
  for (const backdrop of ['checkerboard', 'black', 'white', 'overlay', 'custom']) {
    await choose('Preview backdrop', backdrop);
    assert.equal(
      await page.locator('.image-layer').getAttribute('data-preview-backdrop'),
      backdrop,
    );
    if (backdrop === 'custom')
      await page.getByRole('textbox', { name: 'Backdrop color hex', exact: true }).fill('#164080');
    assert.ok((await exportExact()).equals(cutout), 'Backdrop changed exported pixels');
  }
  await screenshot('cutout-controls');
  await add('Depth Parallax / Push-Pull');
  await choose('Style', 'push-pull');
  await choose('Field source', 'linear');
  await slider('Near push strength').fill('0.4');
  await slider('Far pull strength').fill('1.3');
  await exportExact();
  await add('Blur');
  await choose('Style', 'depth');
  await choose('Field source', 'linear');
  await slider('Radius').fill('4');
  await slider('Near blur strength').fill('0.3');
  await slider('Far blur strength').fill('1.6');
  const finalOutput = await exportExact();
  await previews();
  assert.ok((await exportExact()).equals(finalOutput));
  const savedRecipe = await state();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  await screenshot('minimum-window');
  assert.ok(
    await page
      .locator('.effect-detail')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  );
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ' + basename(projectPath));
  await picker('Presets');
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Feature completion');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Feature completion');
  const preset = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
  assert.ok(preset.effects[0].application.depthImage.png.startsWith('data:image/png;base64,'));
  await closeTestApp(app);
  app = await launch();
  await configure();
  await chooseOpen(projectPath);
  await page.keyboard.press('Control+o');
  await status('Opened ' + basename(projectPath));
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(finalOutput));
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  await picker('Presets');
  await page.getByRole('button', { name: 'Apply Feature completion', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(finalOutput));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      allFourBatches: true,
      projectAndPresetRestart: true,
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
