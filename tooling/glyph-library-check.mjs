import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, basename } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { effectCount, renderEffects } from './effects-reference.mjs';

const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe')),
  cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`,
  output = resolve('test-results/glyph-library');
await mkdir(output, { recursive: true });
let profile = await mkdtemp(resolve(output, `${label}-profile-`)),
  env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
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
const width = 193,
  height = 145,
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 128, 255, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
  );
const input = resolve(output, `${label}-input.png`),
  project = resolve(output, `${label}.gleech`),
  presetPath = resolve(output, `${label}.gleechpreset`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(input);
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
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
      const d = document.querySelector('.image-layer')?.dataset;
      return d && d.renderRevision === d.requestedRevision && d.previewQuality === 'full';
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
async function exportExact() {
  const recipe = await state(),
    path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  assert.ok(
    (await sharp(path).ensureAlpha().raw().toBuffer()).equals(
      Buffer.from(
        renderEffects({ width, height, pixels: pixels.buffer }, recipe.effects, {
          masterSeed: recipe.masterSeed,
        }).pixels,
      ),
    ),
    'Exact Glyph RGBA export',
  );
}
const choose = (name, value) =>
  page.getByRole('combobox', { name, exact: true }).selectOption(value);
const slider = (name, value) => page.getByRole('slider', { name, exact: true }).fill(String(value));
const dialog = () => page.locator('#effect-catalog');
const effectNames = () => dialog().locator('.effect-tile strong').allTextContents();
const presetNames = async () => {
  // Saving/deleting reopens the picker before its asynchronous library reload.
  // An absent grid is still loading, rather than an empty favorites collection.
  await dialog().locator('.preset-grid').waitFor({ state: 'attached' });
  return dialog().locator('.preset-tile strong').allTextContents();
};
const alphabetical = (names) =>
  [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }));
async function picker(tab = 'effects') {
  await page.getByRole('button', { name: /Add effect/ }).click();
  if (tab === 'presets') {
    await page.getByRole('tab', { name: 'Presets', exact: true }).click();
    await dialog().getByRole('button', { name: 'Apply Analog Afterimage', exact: true }).waitFor();
  }
}
const closePicker = () =>
  page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
const category = (name) =>
  dialog()
    .getByRole('navigation', { name: 'Effect categories' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
try {
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  const empty = await state();
  await picker();
  const initial = await effectNames();
  assert.equal(initial.length, effectCount);
  assert.deepEqual(initial, alphabetical(initial));
  await dialog()
    .getByRole('button', { name: 'Add Wave distortion to favorites', exact: true })
    .click();
  await dialog().getByRole('button', { name: 'Add Blur to favorites', exact: true }).click();
  assert.deepEqual((await effectNames()).slice(0, 2), ['Blur', 'Wave distortion']);
  await category('Favorites');
  assert.deepEqual(await effectNames(), ['Blur', 'Wave distortion']);
  const search = dialog().getByRole('searchbox', { name: 'Search effects', exact: true });
  await search.fill('wave');
  assert.deepEqual(await effectNames(), ['Wave distortion']);
  await search.fill('');
  await dialog().getByRole('button', { name: 'Remove Blur from favorites', exact: true }).click();
  assert.deepEqual(await effectNames(), ['Wave distortion']);
  await category('Distortion');
  assert.equal((await effectNames())[0], 'Wave distortion');
  await closePicker();
  assert.deepEqual(await state(), empty, 'Starring never applies an effect or changes the recipe');
  await picker('presets');
  const names = await presetNames();
  assert.deepEqual(names, alphabetical(names));
  await dialog()
    .getByRole('button', { name: 'Add Spiral Transfer to favorites', exact: true })
    .click();
  await dialog()
    .getByRole('button', { name: 'Add Analog Afterimage to favorites', exact: true })
    .click();
  assert.deepEqual((await presetNames()).slice(0, 2), ['Analog Afterimage', 'Spiral Transfer']);
  await choose('Preset collection', 'favorites');
  assert.deepEqual(await presetNames(), ['Analog Afterimage', 'Spiral Transfer']);
  await dialog().getByRole('searchbox', { name: 'Search presets', exact: true }).fill('spiral');
  assert.deepEqual(await presetNames(), ['Spiral Transfer']);
  await closePicker();
  assert.deepEqual(await state(), empty);
  await closeTestApp(app);
  app = await launch();
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  await picker();
  assert.equal((await effectNames())[0], 'Wave distortion');
  await category('Favorites');
  assert.deepEqual(await effectNames(), ['Wave distortion']);
  await closePicker();
  await picker('presets');
  await choose('Preset collection', 'favorites');
  assert.deepEqual(await presetNames(), ['Analog Afterimage', 'Spiral Transfer']);
  await closePicker();
  // Persistence failures are visible and leave the current favorites unchanged.
  await picker();
  await page.evaluate(() => {
    window.__originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException('Quota', 'QuotaExceededError');
    };
  });
  await dialog().getByRole('button', { name: 'Add Blur to favorites', exact: true }).click();
  await dialog().getByRole('alert').filter({ hasText: 'Could not save favorites' }).waitFor();
  assert.equal(
    await dialog().getByRole('button', { name: 'Add Blur to favorites', exact: true }).count(),
    1,
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__originalStorageSet;
  });
  await dialog().getByRole('button', { name: 'Add Blur to favorites', exact: true }).click();
  assert.equal(await dialog().getByRole('alert').count(), 0);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  assert.ok(await dialog().evaluate((n) => n.scrollWidth <= n.clientWidth));
  await captureTestWindow(app, resolve(output, `${label}-favorites.png`));
  await dialog().getByRole('button', { name: 'Glyph Renderer', exact: true }).click();
  await settle();
  assert.equal((await state()).effects[0].params.colorSource, 'source');
  const styles = [
    'ascii',
    'extended-ascii',
    'unicode',
    'emoji',
    'binary',
    'hexadecimal',
    'numbers',
    'terminal',
    'custom-set',
    'custom-text',
    'braille',
    'blocks',
  ];
  assert.deepEqual(
    await page
      .getByRole('combobox', { name: 'Style', exact: true })
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => o.value)),
    styles,
  );
  for (const style of styles) {
    await choose('Style', style);
    await slider('Cell size', 18);
    await slider('Cell aspect', 1);
    if (style === 'custom-set')
      await page.getByRole('textbox', { name: 'Custom glyph set', exact: true }).fill(' .▲█');
    if (style === 'custom-text') {
      await page.getByRole('textbox', { name: 'Custom text', exact: true }).fill('GLEECH 42!');
      await page.getByRole('textbox', { name: 'Custom text', exact: true }).blur();
    }
    await exportExact();
    console.log(`${label}: ${style} exact export passed`);
  }
  await choose('Style', 'emoji');
  for (const mapping of ['luminance', 'color', 'combined', 'random']) {
    await choose('Emoji mapping', mapping);
    await exportExact();
  }
  for (const palette of ['faces', 'objects', 'symbols', 'nature', 'geometric', 'custom']) {
    await choose('Emoji palette', palette);
    if (palette === 'custom') {
      await page.getByRole('textbox', { name: 'Custom emoji set', exact: true }).fill('❤️⭐🔵');
      await page.getByRole('textbox', { name: 'Custom emoji set', exact: true }).blur();
    }
    await exportExact();
  }
  for (const colors of ['native', 'source', 'monochrome', 'palette']) {
    await choose('Emoji colors', colors);
    await exportExact();
  }
  await page.locator('.emoji-atlas summary').click();
  assert.equal(await page.locator('.emoji-atlas-grid button').count(), 25);
  assert.ok(
    await page.locator('#inspector-panel-controls').evaluate((n) => n.scrollWidth <= n.clientWidth),
    'Emoji atlas fits the minimum-width inspector',
  );
  await page
    .getByRole('button', { name: 'Add Light bulb to custom emoji set', exact: true })
    .click();
  assert.ok((await state()).effects[0].params.emojiSet.includes('💡'));
  await slider('Emoji red offset', 25);
  await slider('Emoji green offset', -20);
  await slider('Glyph rotation', 25);
  await slider('Rotation jitter', 30);
  await slider('Position jitter', 0.12);
  await slider('Missing glyphs', 0.1);
  await slider('Duplicate glyphs', 0.3);
  await slider('Glyph glitches', 0.2);
  await exportExact();
  await choose('Size falloff', 'on');
  await choose('Color falloff', 'on');
  await slider('Starting size', 0.2);
  await slider('Ending size', 1.2);
  await slider('Size start position', 0.15);
  await slider('Size end position', 0.85);
  await slider('Color start position', 0.2);
  await slider('Color end position', 0.8);
  for (const direction of ['horizontal', 'vertical', 'radial', 'square']) {
    await choose('Size direction', direction);
    await choose('Color direction', direction);
    if (['radial', 'square'].includes(direction)) {
      await slider('Size center X', 0.3);
      await slider('Size center Y', 0.6);
      await slider('Color center X', 0.7);
      await slider('Color center Y', 0.4);
    }
    await exportExact();
  }
  await choose('Size invert', 'on');
  await choose('Color invert', 'on');
  await choose('Falloff colors', 'chosen');
  await page.getByRole('textbox', { name: 'Foreground hex', exact: true }).fill('#ff8030');
  await page.getByRole('textbox', { name: 'Ending color hex', exact: true }).fill('#3080ff');
  await exportExact();
  const before = await state();
  await slider('Ending size', 0.7);
  await page.getByRole('slider', { name: 'Ending size', exact: true }).blur();
  const after = await state();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), after);
  // New parameters support the existing context-menu Reset/Copy/Paste path.
  const control = page.locator('[data-settings-key="sizeTo"]');
  await control.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset', exact: true }).click();
  assert.equal((await state()).effects[0].params.sizeTo, 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), after);
  await captureTestWindow(app, resolve(output, `${label}-glyph.png`));
  assert.ok(
    await page.locator('#inspector-panel-controls').evaluate((n) => n.scrollWidth <= n.clientWidth),
    'Glyph controls fit the minimum-width inspector',
  );
  const final = await state();
  await savePath(project);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ');
  await picker('presets');
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Glyph expansion');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Glyph expansion', exact: true }).waitFor();
  await dialog()
    .getByRole('button', { name: 'Add Glyph expansion to favorites', exact: true })
    .click();
  await savePath(presetPath);
  await dialog()
    .getByRole('button', { name: 'Export preset Glyph expansion', exact: true })
    .click();
  await status('Exported preset');
  await closePicker();
  await closeTestApp(app);
  app = await launch();
  await configure();
  await open(project, 'Open project Ctrl+O');
  assert.deepEqual(await state(), final);
  await exportExact();
  await picker('presets');
  await choose('Preset collection', 'favorites');
  assert.ok((await presetNames()).includes('Glyph expansion'));
  await dialog().getByRole('button', { name: 'Edit preset Glyph expansion', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('AAA Glyph favorite');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await dialog().getByRole('button', { name: 'Apply AAA Glyph favorite', exact: true }).waitFor();
  await choose('Preset collection', 'favorites');
  assert.equal((await presetNames())[0], 'AAA Glyph favorite');
  await dialog()
    .getByRole('button', { name: 'Delete preset AAA Glyph favorite', exact: true })
    .click();
  await status('Deleted preset');
  await choose('Preset collection', 'favorites');
  assert.deepEqual(await presetNames(), ['Analog Afterimage', 'Spiral Transfer']);
  await closePicker();
  await closeTestApp(app);
  profile = await mkdtemp(resolve(output, `${label}-transfer-profile-`));
  env = { ...env, GLEECH_SMOKE_USER_DATA: profile };
  app = await launch();
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  await picker();
  await category('Favorites');
  assert.equal(await dialog().locator('.effect-tile').count(), 0);
  await closePicker();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, presetPath);
  await picker('presets');
  await dialog().getByRole('button', { name: 'Import preset', exact: true }).click();
  await status('Imported preset');
  await dialog().getByRole('button', { name: 'Apply Glyph expansion', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  await settle();
  const imported = await state();
  assert.deepEqual(
    imported.effects.map((e) => e.params),
    final.effects.map((e) => e.params),
  );
  assert.equal(imported.masterSeed, final.masterSeed);
  await exportExact();
  await picker('presets');
  await choose('Preset collection', 'favorites');
  assert.equal((await presetNames()).length, 0, 'Favorites are not exported with preset files');
  await closePicker();
  assert.deepEqual(errors, []);
  console.log(
    `${label}: favorites persistence/search/ordering/errors; twelve glyph modes, all emoji palettes/treatments, four falloff directions, undo/reset and saved recipes passed (${exports} exact exports)`,
  );
} finally {
  await closeTestApp(app);
}
