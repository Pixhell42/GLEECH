import { deleteFirstEffect } from './stack-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, unlink } from 'node:fs/promises';
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
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/palette-family');
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
        }).pixels,
      ),
    ),
    'Exact RGBA export',
  );
}

const choose = (label, value) =>
  page.getByRole('combobox', { name: label, exact: true }).selectOption(value);
const slider = (label, value) => page.getByRole('slider', { name: label, exact: true }).fill(value);
const presetPath = resolve(output, `${label}.gleechpreset`);
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
async function settingsMenu(target, action) {
  const previous = await page
    .locator('[data-feedback-id]')
    .evaluateAll((nodes) => nodes[0]?.getAttribute('data-feedback-id') ?? null);
  await target.click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Copy and paste settings', exact: true })
    .getByRole('menuitem', { name: action, exact: true })
    .click();
  await page.waitForFunction(
    ({ previous, action }) => {
      const feedback = document.querySelector('[data-feedback-id]');
      return (
        feedback &&
        feedback.getAttribute('data-feedback-id') !== previous &&
        feedback.textContent.startsWith(action === 'Copy' ? 'Copied' : 'Pasted')
      );
    },
    { previous, action },
  );
  await settle();
  return app.evaluate(async ({ clipboard }) => JSON.parse(await clipboard.readText()));
}
try {
  await configure();
  await open(imagePath, 'Open image Ctrl+Shift+O');
  async function add(title) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    const tile = page.locator('.effect-picker').getByRole('button', { name: title, exact: true });
    await tile.locator('img').evaluate((image) => image.decode());
    assert.equal(await tile.locator('img').evaluate((image) => image.naturalWidth), 384);
    await tile.click();
    await settle();
  }
  async function undoRedo(before, after) {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await recipe(), before);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await recipe(), after);
  }
  async function pattern() {
    const before = await recipe();
    await page.getByRole('button', { name: 'New pattern', exact: true }).click();
    const after = await recipe();
    assert.equal(after.effects.at(-1).seedOffset, before.effects.at(-1).seedOffset + 1);
    await undoRedo(before, after);
  }
  async function ramp(label, key) {
    await page.getByRole('button', { name: 'Add stop', exact: true }).click();
    await page
      .getByRole('textbox', { name: `${label} stop color hex`, exact: true })
      .fill('#ff4080');
    const effect = (await recipe()).effects.at(-1);
    assert.equal(JSON.parse(effect.params[key]).length, 3);
    assert.equal(JSON.parse(effect.params[key])[1].color, '#ff4080');
  }
  await add('Indexed Palette');
  assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 0);
  await slider('Color count', '8');
  for (const palette of [
    'source',
    'rgb332',
    'grayscale',
    'cga',
    'ega',
    'vga',
    'gameboy',
    'monochrome',
    'custom',
  ]) {
    await choose('Palette', palette);
    await exportExact();
  }
  await ramp('Custom palette ramp', 'paletteStartStops');
  const paletteRampPacket = await settingsMenu(page.locator('.gradient-stop-track'), 'Copy');
  assert.equal(JSON.parse(paletteRampPacket.gradient.stops).length, 3);
  for (const dither of ['ordered', 'floyd-steinberg', 'blue-noise', 'random']) {
    await choose('Dithering', dither);
    await exportExact();
  }
  await slider('Color swaps', '0.8');
  await slider('Hue damage', '0.6');
  await slider('Saturation damage', '0.4');
  await slider('Palette drift', '0.5');
  await slider('Drift size', '7');
  await slider('Cell size', '2');
  await pattern();
  await exportExact();
  await page.locator('.effect-lock').first().click();
  await page.locator('.effect-row').first().locator('input[type=checkbox]').first().uncheck();
  console.log(label + ': all nine palettes, five remapping styles and seeded corruption passed');

  await add('Threshold / Photocopy');
  await slider('Input black', '0.15');
  await slider('Input white', '0.9');
  await slider('Gamma', '1.3');
  for (const style of ['threshold', 'bitmap', 'photocopy']) {
    await choose('Style', style);
    if (style === 'bitmap') await slider('Bitmap levels', '6');
    if (style === 'photocopy') {
      await choose('Local threshold', 'on');
      await slider('Local radius', '4');
      await slider('Edge emphasis', '1.2');
      await slider('Photocopy dirt', '0.35');
      await slider('Dirt size', '0.5');
    }
    await exportExact();
  }
  await choose('Invert', 'on');
  await page
    .getByRole('group', { name: 'Paper mode', exact: true })
    .getByRole('button', { name: 'Gradient', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Paper hex', exact: true }).fill('#ffcc80');
  await page.getByRole('textbox', { name: 'Paper end hex', exact: true }).fill('#80c0ff');
  await pattern();
  await exportExact();
  await page.locator('.effect-row').first().locator('input[type=checkbox]').first().uncheck();
  console.log(
    label + ': threshold, bitmap, local means, photocopy, ink/paper gradients and patterns passed',
  );

  await add('Dither');
  for (const algorithm of [
    'none',
    'ordered',
    'floyd-steinberg',
    'atkinson',
    'sierra',
    'jarvis',
    'blue-noise',
    'random',
    'corrupted',
  ]) {
    await choose('Algorithm', algorithm);
    await exportExact();
  }
  await choose('Coloring', 'rgb');
  await slider('Levels per channel', '4');
  await choose('Scan', 'forward');
  await slider('Skipped cells', '0.2');
  await slider('Error displacement', '7');
  await slider('Random direction', '0.6');
  await slider('Block interruptions', '0.3');
  await slider('Interruption size', '8');
  await slider('Channel divergence', '0.7');
  await pattern();
  await exportExact();
  await choose('Coloring', 'ramp');
  await ramp('Dither color ramp', 'rampStartStops');
  const ditherRampPacket = await settingsMenu(page.locator('.gradient-stop-track'), 'Copy');
  assert.equal(JSON.parse(ditherRampPacket.gradient.stops).length, 3);
  const ditherBeforePaste = await recipe();
  await app.evaluate(
    async ({ clipboard }, packet) => clipboard.writeText(JSON.stringify(packet)),
    paletteRampPacket,
  );
  await settingsMenu(page.locator('.gradient-stop-track'), 'Paste');
  const ditherPasted = await recipe();
  assert.equal(ditherPasted.effects[2].params.rampStartStops, paletteRampPacket.gradient.stops);
  assert.equal(ditherPasted.effects[2].params.rampStart, paletteRampPacket.value);
  await undoRedo(ditherBeforePaste, ditherPasted);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page
    .locator(
      `.effect-row[data-effect-id="${ditherBeforePaste.effects[0].instanceId}"] .effect-select`,
    )
    .click();
  await app.evaluate(
    async ({ clipboard }, packet) => clipboard.writeText(JSON.stringify(packet)),
    ditherRampPacket,
  );
  const paletteBeforePaste = await recipe();
  await settingsMenu(page.locator('.gradient-stop-track'), 'Paste');
  const palettePasted = await recipe();
  assert.equal(palettePasted.effects[0].params.paletteStartStops, ditherRampPacket.gradient.stops);
  assert.equal(palettePasted.effects[0].params.paletteStart, ditherRampPacket.value);
  await undoRedo(paletteBeforePaste, palettePasted);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page
    .locator(
      `.effect-row[data-effect-id="${ditherBeforePaste.effects[2].instanceId}"] .effect-select`,
    )
    .click();
  await exportExact();
  await slider('Skipped cells', '1');
  await exportExact();
  assert.ok(
    (
      await sharp(resolve(output, `${label}-${exports}.png`))
        .ensureAlpha()
        .raw()
        .toBuffer()
    ).equals(pixels),
    'Skipping all cells preserves incoming RGBA',
  );
  await slider('Skipped cells', '0.2');
  await slider('Cell size', '3');
  await slider('Coverage', '0.75');
  await slider('Softness', '0.35');
  await slider('Opacity', '0.8');
  await choose('Blend mode', 'screen');
  await page.getByRole('switch', { name: 'Tint', exact: true }).check();
  await page.getByRole('textbox', { name: 'Tint color hex', exact: true }).fill('#80c0ff');
  await slider('Tint strength', '0.3');
  await page.locator('.paint-mask-button').first().click();
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true }),
    bounds = await surface.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.effect-lock').first().click();
  for (const row of await page.locator('.effect-row').all())
    await row.locator('input[type=checkbox]').first().check();
  await exportExact();
  const masked = await recipe();
  await page.locator('.effect-select').first().click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Copy and paste settings', exact: true })
    .getByRole('menuitem', { name: 'Duplicate', exact: true })
    .click();
  await status('Duplicated filter');
  const duplicated = await recipe();
  assert.equal(duplicated.effects.length, 4);
  assert.deepEqual(duplicated.effects[3].params, masked.effects[2].params);
  assert.deepEqual(duplicated.effects[3].paintedMask, masked.effects[2].paintedMask);
  assert.equal(duplicated.effects[3].locked, true);
  await undoRedo(masked, duplicated);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), masked);
  await page.getByRole('button', { name: 'GLEECH', exact: true }).click();
  await page
    .locator('.gleech-dialog')
    .getByRole('button', { name: /^Simple/ })
    .click();
  await page
    .locator('.gleech-dialog')
    .getByRole('button', { name: /^Use Existing Only/ })
    .click();
  const generated = await recipe();
  for (const e of masked.effects.filter((e) => e.locked))
    assert.deepEqual(
      generated.effects.find((n) => n.instanceId === e.instanceId),
      e,
    );
  assert.equal(generated.effects.length, 3);
  await undoRedo(masked, generated);
  await exportExact();
  await page.getByRole('button', { name: 'Var', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.variation-tile img').length === 9,
    undefined,
    { timeout: 60000 },
  );
  await page.locator('.variation-tile img').evaluateAll(async (images) => {
    await Promise.all(images.map((i) => i.decode()));
    if (images.some((i) => !i.naturalWidth)) throw new Error('Invalid variation thumbnail');
  });
  await page.getByRole('button', { name: 'Close variations', exact: true }).click();
  assert.deepEqual(await recipe(), generated);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.getByRole('slider', { name: 'Cell size', exact: true }).scrollIntoViewIfNeeded();
  await settle();
  assert.ok(
    await page
      .getByRole('region', { name: 'Dither controls', exact: true })
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  );
  await captureTestWindow(app, resolve(output, `${label}-controls.png`));
  console.log(
    label +
      ': nine dither algorithms, corrupted paths, ramps, masks, locks, duplicate, GLEECH/Var and Undo passed',
  );
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Portable Color Damage');
  await page.getByRole('checkbox', { name: 'Include painted masks', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable Color Damage');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(presetPath);
  await page
    .getByRole('button', { name: 'Export preset Portable Color Damage', exact: true })
    .click();
  await status('Exported preset');
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  const final = await recipe();
  await savePath(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ');
  await closeTestApp(app);
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
  await status('Imported preset Portable Color Damage');
  await page.getByRole('button', { name: 'Apply Portable Color Damage', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  await exportExact();
  // Exercise the final worker's draft/refinement path with an actually large source.
  while (await page.locator('.effect-row').count()) {
    await deleteFirstEffect(page);
    await settle();
  }
  const largeWidth = 1024,
    largeHeight = 768;
  const largePixels = Uint8Array.from({ length: largeWidth * largeHeight * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 37 + Math.floor(i / 4) * 19) % 256,
  );
  const largePath = resolve(output, `${label}-large.png`);
  await sharp(largePixels, { raw: { width: largeWidth, height: largeHeight, channels: 4 } })
    .png()
    .toFile(largePath);
  await open(largePath, 'Open image Ctrl+Shift+O');
  const livePreviews = [];
  for (const [title, control, start, end] of [
    ['Indexed Palette', 'Color count', 4, 32],
    ['Threshold / Photocopy', 'Threshold', 0.25, 0.75],
    ['Dither', 'Levels per channel', 2, 8],
  ]) {
    await add(title);
    const beforeRecipe = await recipe();
    const before = await page
      .locator('.image-layer')
      .evaluate((e) => Number(e.dataset.interactiveFrames ?? 0));
    await page.getByRole('slider', { name: control, exact: true }).evaluate(
      async (slider, [start, end]) => {
        slider.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }),
        );
        for (let i = 0; i < 40; i++) {
          const raw = start + ((end - start) * i) / 39;
          const value = Number(slider.step) >= 1 ? Math.round(raw) : raw;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
            slider,
            String(value),
          );
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      },
      [start, end],
    );
    await page.waitForFunction(
      () => {
        const d = document.querySelector('.image-layer').dataset;
        return d.renderRevision === d.requestedRevision && d.previewQuality === 'full';
      },
      undefined,
      { timeout: 60000 },
    );
    const data = await page.locator('.image-layer').evaluate((e) => ({ ...e.dataset }));
    assert.ok(
      Number(data.interactiveFrames) > before + 1,
      `${title} did not paint continuous draft previews`,
    );
    assert.equal(Number(data.previewWidth), largeWidth);
    livePreviews.push({
      title,
      frames: Number(data.interactiveFrames) - before,
      draftMs: Number(data.interactiveRenderMs),
    });
    const afterRecipe = await recipe();
    await undoRedo(beforeRecipe, afterRecipe);
    const largeExport = resolve(output, `${label}-large-${++exports}.png`);
    await savePath(largeExport);
    await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
    await status('Exported ' + basename(largeExport));
    const actual = await sharp(largeExport).ensureAlpha().raw().toBuffer();
    const expected = Buffer.from(
      renderEffects(
        { width: largeWidth, height: largeHeight, pixels: largePixels.buffer },
        afterRecipe.effects,
        { masterSeed: afterRecipe.masterSeed },
      ).pixels,
    );
    assert.ok(actual.equals(expected), `${title} draft refinement changed the full-size export`);
    await deleteFirstEffect(page);
    await settle();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify({
      result: 'passed',
      exactExports: exports,
      filterTypes: 3,
      palettes: 9,
      algorithms: 9,
      customRamps: true,
      rampClipboard: true,
      duplicate: true,
      patterns: true,
      masks: true,
      undoRedo: true,
      projectRestart: true,
      presetTransfer: true,
      livePreviews,
    }),
  );
  console.log(
    `${label}: Color reduction passed; ${exports} exact exports, three filters and nine algorithms, masks/locks/Undo and portable restart/transfer.`,
  );
} finally {
  await closeTestApp(app);
}
