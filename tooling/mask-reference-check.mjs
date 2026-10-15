import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { renderEffects } from './effects-reference.mjs';
const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const cpu = process.argv.includes('--cpu');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve('test-results/mask-reference');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, label + '-profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let width = 129,
  height = 97;
let pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : (i * 13) % 256,
);
const refPixels = Uint8Array.from(pixels, (v, i) => (i % 4 === 3 ? 255 : 255 - v));
const input = resolve(output, label + '-input.png'),
  reference = resolve(output, label + '-reference.png');
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(input);
await sharp(refPixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(reference);
const app = await electron.launch({
  args: [
    ...(exe ? [] : [resolve('apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
  ...(exe ? { executablePath: resolve(exe) } : {}),
});
const page = await app.firstWindow();
page.setDefaultTimeout(25000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let exports = 0;
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
async function recipe() {
  await settle();
  return page.locator('.image-layer').evaluate((n) => ({
    effects: JSON.parse(n.dataset.renderRecipe),
    masterSeed: Number(n.dataset.renderSeed),
  }));
}
const slider = (name, value) => page.getByRole('slider', { name, exact: true }).fill(String(value));
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
async function open(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await settle();
}
async function exportExact() {
  const state = await recipe();
  const layers = new Map(
    state.effects
      .filter((e) => e.image)
      .map((e) => [e.image.source.id, { width: 129, height: 97, pixels: refPixels.buffer }]),
  );
  const expected = renderEffects({ width, height, pixels: pixels.buffer }, state.effects, {
    masterSeed: state.masterSeed,
    layerImages: layers,
  });
  const path = resolve(output, `${label}-${++exports}.png`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const actual = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(actual.equals(Buffer.from(expected.pixels)), `Exact export ${exports}`);
}
async function add(name) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
  await settle();
}
try {
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await open(input);
  await add('Reference / Cross-image Mosh');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, reference);
  await page.getByRole('button', { name: 'Choose image…', exact: true }).click();
  await settle();
  const spacing = await page.locator('.solid-image-control').evaluate((n) => {
    const heading = n.querySelector('.input-image-heading').getBoundingClientRect(),
      image = n.querySelector('img').getBoundingClientRect();
    return image.top - heading.bottom;
  });
  // Collapsible headings use the shared six-pixel bottom margin. The older
  // standalone heading had ten pixels; verify the current layout's actual rule.
  assert.ok(
    spacing >= 6 - 0.01,
    `Input preview respects the collapsible heading spacing (actual ${spacing}px)`,
  );
  await slider('Progression', 1);
  for (const placement of ['fit', 'fill', 'stretch']) {
    await page
      .getByRole('combobox', { name: 'Reference placement', exact: true })
      .selectOption(placement);
    await slider('Reference position X', 25);
    await slider('Reference position Y', -25);
    await exportExact();
  }
  await page
    .getByRole('slider', { name: 'Reference position X', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset', exact: true }).click();
  assert.equal((await recipe()).effects[0].params.referenceX, 0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await recipe()).effects[0].params.referenceX, 25);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.locator('.input-image-heading').scrollIntoViewIfNeeded();
  await captureTestWindow(app, resolve(output, label + '-reference-controls.png'));
  const large = resolve(output, label + '-large.png');
  width = 1600;
  height = 1200;
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 7) % 256,
  );
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(large);
  await open(large);
  await add('Hue / Saturation');
  await slider('Lightness', 0.7);
  await page.locator('.paint-mask-button').first().click();
  const controls = page.getByRole('region', { name: 'Mask painting controls' });
  const before = await recipe();
  await controls.getByRole('button', { name: 'Invert', exact: true }).waitFor();
  const iconStyles = await controls.locator('.info-icon').evaluateAll((icons) =>
    icons.map((icon) => {
      const style = getComputedStyle(icon);
      return {
        padding: style.padding,
        fontSize: style.fontSize,
        width: style.width,
        height: style.height,
      };
    }),
  );
  assert.ok(iconStyles.length >= 5);
  assert.ok(
    iconStyles.every(
      (style) =>
        style.padding === '0px' &&
        style.fontSize === '9px' &&
        style.width === '14px' &&
        style.height === '14px',
    ),
  );
  await slider('Brush size', 20);
  await slider('Mask opacity', 0.5);
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  await surface.scrollIntoViewIfNeeded();
  const bounds = await surface.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6, {
    steps: 25,
  });
  await page.waitForFunction(
    () => document.querySelector('.image-layer')?.dataset.previewQuality === 'interactive',
  );
  await page.evaluate(() => new Promise((done) => setTimeout(done, 260)));
  assert.equal(
    await page.locator('.image-layer').getAttribute('data-preview-quality'),
    'interactive',
    'Holding a stroke does not launch full-detail refinement',
  );
  await page.mouse.up();
  const painted = await recipe();
  assert.equal(painted.effects.at(-1).paintedMask.strokes.length, 1);
  await controls.getByRole('button', { name: 'Invert', exact: true }).click();
  assert.equal((await recipe()).effects.at(-1).paintedMask.inverted, true);
  await controls.getByRole('button', { name: 'Done', exact: true }).click();
  await exportExact();
  await page.locator('.paint-mask-button').first().click();
  await controls.getByRole('button', { name: 'Invert', exact: true }).click();
  await controls.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal((await recipe()).effects.at(-1).paintedMask.inverted, false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await recipe()).effects.at(-1).paintedMask.inverted, true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), painted);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.locator('.paint-mask-button').first().click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.locator('.mask-controls-heading').scrollIntoViewIfNeeded();
  assert.ok(
    await controls.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    'Mask controls fit the minimum window width',
  );
  assert.ok(
    await page.locator('.stack-panel').evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    'Mask layer actions do not overflow',
  );
  await captureTestWindow(app, resolve(output, label + '-mask-controls.png'));
  assert.deepEqual(errors, []);
  const report = {
    mode: label,
    exactExports: exports,
    referencePosition: true,
    spacing: true,
    maskIcons: iconStyles,
    invert: true,
    heldStroke: true,
    history: true,
    errors,
  };
  await writeFile(resolve(output, label + '-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await closeTestApp(app);
}
