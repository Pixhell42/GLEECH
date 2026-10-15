import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = process.cwd(),
  sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe')),
  cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/glyph-font');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const imagePath = resolve(profile, 'source.png'),
  projectPath = resolve(profile, 'font.gleech'),
  presetPath = resolve(profile, 'font.gleechpreset');
const width = 97,
  height = 73,
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4] : (i * 19) % 256,
  );
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
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
const errors = [];
async function setup() {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
}
const status = (text) => page.getByRole('status').filter({ hasText: text }).waitFor();
const settle = () =>
  page.waitForFunction(() => {
    const node = document.querySelector('.image-layer');
    return (
      node?.dataset.renderRevision === node?.dataset.requestedRevision &&
      node?.dataset.previewQuality === 'full' &&
      !document.querySelector('.operation-banner')
    );
  });
async function open(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
}
async function save(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
}
const recipe = () =>
  page.locator('.image-layer').evaluate((node) => ({
    effects: JSON.parse(node.dataset.renderRecipe),
    masterSeed: Number(node.dataset.renderSeed),
  }));
async function verify(name) {
  await settle();
  const current = await recipe(),
    expected = Buffer.from(
      renderEffects({ width, height, pixels: pixels.buffer }, current.effects, {
        masterSeed: current.masterSeed,
      }).pixels,
    );
  const path = resolve(profile, `${name}.png`);
  await save(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ');
  const actual = await sharp(await readFile(path))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.ok(actual.equals(expected), `${name}: preview recipe and native export agree`);
  exports++;
  return actual;
}
async function pick(family = 'Consolas', face = 'Regular') {
  await page.getByRole('combobox', { name: 'Installed font', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose glyph font', exact: true });
  await dialog
    .getByRole('status')
    .filter({ hasText: 'Reading installed fonts' })
    .waitFor({ state: 'hidden' });
  const error = dialog.getByRole('alert');
  if (await error.count()) throw new Error(await error.innerText());
  await dialog.getByRole('searchbox', { name: 'Search installed fonts', exact: true }).fill(family);
  await dialog
    .locator('.glyph-font-list')
    .getByRole('button', { name: new RegExp(`${family}.*${face}$`) })
    .first()
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.glyph-font-picker button')].some(
      (node) => node.textContent === 'Use font' && !node.disabled,
    ),
  );
  assert.ok(await dialog.getByRole('img', { name: /glyph preview/ }).count());
  return dialog;
}
try {
  await setup();
  await open(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened source.png');
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page
    .locator('.effect-picker')
    .getByRole('button', { name: 'Glyph Renderer', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('custom-text');
  await page.getByRole('textbox', { name: 'Custom text', exact: true }).fill('GLEECH Aa012#@');
  const built = await verify('built-in');
  await page.getByRole('combobox', { name: 'Font source', exact: true }).selectOption('installed');
  assert.ok(await page.getByRole('combobox', { name: 'Installed font', exact: true }).isVisible());
  assert.ok(
    await page
      .locator('[data-settings-key="fontSource"]')
      .evaluate((node) => node.nextElementSibling?.classList.contains('glyph-font-controls')),
  );
  let dialog = await pick();
  assert.equal(
    await page
      .locator('.glyph-font-controls .info-tooltip-copy')
      .evaluate((node) => getComputedStyle(node).display),
    'none',
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, resolve(output, `${label}-picker.png`));
  const windowSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  assert.ok(
    await dialog.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return (
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= innerWidth &&
        bounds.bottom <= innerHeight &&
        node.scrollWidth <= node.clientWidth &&
        node.querySelector('input').getBoundingClientRect().width > node.clientWidth * 0.8
      );
    }),
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await captureTestWindow(app, resolve(output, `${label}-minimum-picker.png`));
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height),
    windowSize,
  );
  await page.waitForFunction((size) => innerWidth === size.width, windowSize);
  await dialog.getByRole('button', { name: 'Use font', exact: true }).click();
  await status('Applied glyph font');
  const installed = await verify('consolas');
  assert.ok(!installed.equals(built));
  const firstFont = (await recipe()).effects[0].glyphFont;
  assert.equal(firstFont.family, 'Consolas');
  assert.ok(firstFont.data.length < 1024 * 1024);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  assert.equal((await recipe()).effects[0].glyphFont, undefined);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.ok((await verify('redo')).equals(installed));
  for (const style of [
    'ascii',
    'extended-ascii',
    'unicode',
    'binary',
    'hexadecimal',
    'numbers',
    'terminal',
    'custom-set',
  ]) {
    await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption(style);
    await verify(style);
  }
  await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('emoji');
  assert.equal(await page.getByRole('combobox', { name: 'Font source', exact: true }).count(), 0);
  await verify('emoji');
  await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('custom-text');
  dialog = await pick('Courier New', 'Bold');
  await dialog.getByRole('button', { name: 'Use font', exact: true }).click();
  await status('Applied glyph font');
  await verify('courier-bold');
  await page.getByRole('textbox', { name: 'Custom text', exact: true }).fill('GLEECH λ');
  await page.getByRole('button', { name: 'Update characters', exact: true }).waitFor();
  dialog = await pick('Courier New', 'Bold');
  await dialog.getByRole('button', { name: 'Use font', exact: true }).click();
  await status('Applied glyph font');
  await settle();
  assert.ok((await recipe()).effects[0].glyphFont.characters.includes('λ'));
  await verify('updated-characters');
  await page.getByRole('slider', { name: 'Glyph rotation', exact: true }).fill('18');
  await verify('rotation');
  await page.getByRole('combobox', { name: 'Size falloff', exact: true }).selectOption('on');
  await verify('falloff');
  await save(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved font.gleech');
  const savedRecipe = await recipe();
  await fileAction(page, 'Save Stack as Preset');
  const presetDialog = page.getByRole('dialog', { name: 'Save preset', exact: true });
  await presetDialog
    .getByRole('textbox', { name: 'Preset name', exact: true })
    .fill('Installed glyphs');
  await presetDialog.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Installed glyphs');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await save(presetPath);
  await page.getByRole('button', { name: 'Export preset Installed glyphs', exact: true }).click();
  await status('Exported preset');
  const portable = JSON.parse(await readFile(presetPath, 'utf8'));
  assert.deepEqual(portable.preset.effects[0].glyphFont, savedRecipe.effects[0].glyphFont);
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  console.log(`${label}: local font selection, ${exports} exact exports and preset export passed`);
  await closeTestApp(app);
  app = await launch();
  await setup();
  await page.evaluate(() => {
    window.queryLocalFonts = async () => {
      throw new Error('Font access intentionally unavailable for portability testing');
    };
  });
  await open(projectPath);
  await fileAction(page, 'Open project Ctrl+O');
  await status('Opened font.gleech');
  await settle();
  assert.deepEqual((await recipe()).effects, savedRecipe.effects);
  await verify('reopened-without-font-access');
  await page.getByRole('combobox', { name: 'Installed font', exact: true }).press('ArrowDown');
  await page
    .getByRole('dialog', { name: 'Choose glyph font', exact: true })
    .getByRole('alert')
    .waitFor();
  await page.getByRole('button', { name: 'Close font picker', exact: true }).click();
  assert.deepEqual((await recipe()).effects, savedRecipe.effects);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForFunction(() => innerWidth === 960);
  await page.getByRole('combobox', { name: 'Installed font', exact: true }).click();
  const bounds = await page.locator('.glyph-font-picker').evaluate((node) => {
    const b = node.getBoundingClientRect();
    return {
      fit: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      overflow: node.scrollWidth > node.clientWidth,
    };
  });
  assert.ok(bounds.fit && !bounds.overflow);
  await captureTestWindow(app, resolve(output, `${label}-minimum.png`));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      label,
      exports,
      realWindowsFonts: ['Consolas Regular', 'Courier New Bold'],
      portableProjectAndPreset: true,
      errors,
    }),
  );
} finally {
  await closeTestApp(app);
}
