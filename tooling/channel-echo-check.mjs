import { deleteFirstEffect } from './stack-action.mjs';
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
const output = resolve(root, 'test-results/channel-echo');
await mkdir(output, { recursive: true });
let profile = await mkdtemp(resolve(output, `${label}-profile-`));
let env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let width = 129,
  height = 97;
let pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 1, 128, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const imagePath = resolve(output, `${label}-input.png`);
const projectPath = resolve(output, `${label}.gleech`);
const presetPath = resolve(output, `${label}.gleechpreset`);
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
      const n = document.querySelector('.image-layer');
      return n?.dataset.renderRecipe && n.dataset.renderRevision === n.dataset.requestedRevision;
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
async function open(path, action) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await fileAction(page, action);
  await status(
    action === 'Import Preset'
      ? 'Imported preset Portable Channels and Echo'
      : 'Opened ' + basename(path),
  );
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
  const state = await recipe();
  const path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  const actual = await sharp(path).ensureAlpha().raw().toBuffer();
  assert.ok(
    actual.equals(
      Buffer.from(
        renderEffects({ width, height, pixels: pixels.buffer }, state.effects, {
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
async function add(title) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  const tile = page.locator('.effect-picker').getByRole('button', {
    name: title,
    exact: true,
  });
  await tile.locator('img').evaluate((i) => i.decode());
  assert.equal(await tile.locator('img').evaluate((i) => i.naturalWidth), 384);
  await tile.click();
  await settle();
}
async function undoRedo(before, after) {
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await recipe(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await recipe(), after);
}

async function reset(control) {
  await control.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reset', exact: true }).click();
  await status('Reset ');
  await settle();
}
async function paint() {
  await page.locator('.paint-mask-button').first().click();
  const surface = page.getByRole('application', { name: 'Paint effect mask', exact: true });
  const bounds = await surface.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
async function gradient(label, start, end) {
  await page
    .getByRole('group', { name: label + ' mode', exact: true })
    .getByRole('button', { name: 'Gradient', exact: true })
    .click();
  await page.getByRole('textbox', { name: label + ' hex', exact: true }).fill(start);
  await page.getByRole('textbox', { name: label + ' end hex', exact: true }).fill(end);
  await slider(label + ' direction', '90');
  await page
    .locator('.gradient-color-control')
    .filter({ has: page.getByRole('group', { name: label + ' mode', exact: true }) })
    .getByRole('button', { name: 'Add stop', exact: true })
    .click();
  await page.getByRole('textbox', { name: label + ' stop color hex', exact: true }).fill('#40ff80');
}
async function drag(control, values) {
  const before = await recipe();
  const frames = await page
    .locator('.image-layer')
    .evaluate((n) => Number(n.dataset.interactiveFrames ?? 0));
  await page
    .getByRole('slider', { name: control, exact: true })
    .evaluate(async (slider, values) => {
      slider.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }),
      );
      for (const v of values) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          slider,
          String(v),
        );
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    }, values);
  await page.waitForFunction(
    () => {
      const d = document.querySelector('.image-layer').dataset;
      return d.renderRevision === d.requestedRevision && d.previewQuality === 'full';
    },
    undefined,
    { timeout: 60000 },
  );
  const data = await page.locator('.image-layer').evaluate((n) => ({ ...n.dataset }));
  assert.ok(Number(data.interactiveFrames) > frames + 1, 'Continuous draft previews');
  assert.equal(Number(data.previewWidth), width);
  await undoRedo(before, await recipe());
  await exportExact();
  return {
    frames: Number(data.interactiveFrames) - frames,
    draftMs: Number(data.interactiveRenderMs),
  };
}
try {
  await configure();
  await open(imagePath, 'Open image Ctrl+Shift+O');
  await add('Channel Transform');
  await choose('Editing channel', 'red');
  await exportExact();
  await slider('Red position X', '-12');
  await slider('Red position Y', '7');
  await slider('Red scale', '130');
  await slider('Red rotation', '25');
  await choose('Red mirror', 'horizontal');
  await choose('Red source', 'green');
  await slider('Crossfeed', '0.7');
  await slider('Pivot X', '35');
  const beforeReset = await recipe();
  await reset(page.getByRole('slider', { name: 'Red scale', exact: true }));
  const afterReset = await recipe();
  assert.deepEqual(afterReset.effects[0].params, {
    ...beforeReset.effects[0].params,
    redScale: 100,
  });
  await undoRedo(beforeReset, afterReset);
  await page.getByRole('combobox', { name: 'Red source', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await status('Copied Red source');
  const beforeSelector = await recipe();
  await choose('Editing channel', 'green');
  assert.deepEqual(await recipe(), beforeSelector);
  assert.equal(await page.getByRole('slider', { name: 'Red scale', exact: true }).count(), 0);
  await choose('Green source', 'blue');
  await page
    .getByRole('combobox', { name: 'Green source', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await status('Pasted Green source');
  assert.equal((await recipe()).effects[0].params.greenSource, 'green');
  await slider('Green position Y', '10');
  await slider('Green scale', '90');
  await choose('Editing channel', 'blue');
  await choose('Blue source', 'luma');
  await choose('Blue mirror', 'both');
  await slider('Blue rotation', '-20');
  for (const edges of ['extend', 'wrap', 'mirror']) {
    await choose('Edge Handling', edges);
    await exportExact();
  }
  await page.getByRole('switch', { name: 'Tint', exact: true }).check();
  await slider('Tint strength', '0.25');
  await gradient('Tint color', '#ffcaaa', '#0088ff');
  await slider('Opacity', '0.8');
  await choose('Blend mode', 'screen');
  await choose('Application', 'left');
  await slider('Coverage', '0.65');
  await slider('Softness', '0.2');
  await paint();
  await exportExact();
  console.log(
    `${label}: independent RGB transforms, routing/crossfeed, clipboard, Reset and masked finishing passed`,
  );
  await add('Temporal Echo');
  await slider('Copies', '3');
  await slider('Spacing', '10');
  await slider('Echo opacity', '0.65');
  await slider('Falloff', '0.55');
  await slider('Scale per echo', '0.97');
  await slider('Rotation per echo', '4');
  await slider('Position jitter', '0.3');
  const beforePattern = await recipe();
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  const afterPattern = await recipe();
  assert.equal(afterPattern.effects[1].seedOffset, beforePattern.effects[1].seedOffset + 1);
  await undoRedo(beforePattern, afterPattern);
  await exportExact();
  await choose('Style', 'color-separated');
  await choose('First echo channel', 'green');
  await exportExact();
  await choose('Style', 'silhouette');
  assert.equal(
    await page.getByRole('combobox', { name: 'First echo channel', exact: true }).count(),
    0,
  );
  await gradient('Echo color', '#ffcc80', '#40c0ff');
  await exportExact();
  await choose('Clip copies', 'off');
  for (const edges of ['extend', 'wrap', 'mirror']) {
    await choose('Edge Handling', edges);
    await exportExact();
  }
  await choose('Clip copies', 'on');
  assert.equal(await page.getByRole('combobox', { name: 'Edge Handling', exact: true }).count(), 0);
  const beforeCopiesReset = await recipe();
  await reset(page.getByRole('slider', { name: 'Copies', exact: true }));
  const afterCopiesReset = await recipe();
  assert.equal(afterCopiesReset.effects[1].params.copies, 5);
  await undoRedo(beforeCopiesReset, afterCopiesReset);
  await choose('Blend mode', 'screen');
  await slider('Opacity', '0.7');
  await choose('Application', 'right');
  await slider('Coverage', '0.8');
  await slider('Softness', '0.25');
  await paint();
  await page.locator('.effect-lock').first().click();
  await exportExact();
  const masked = await recipe();
  await page.locator('.effect-select').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await status('Duplicated filter');
  const duplicated = await recipe();
  assert.equal(duplicated.effects.length, 3);
  assert.deepEqual(duplicated.effects[2].params, masked.effects[1].params);
  assert.deepEqual(duplicated.effects[2].paintedMask, masked.effects[1].paintedMask);
  assert.equal(duplicated.effects[2].locked, true);
  await undoRedo(masked, duplicated);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.locator('.effect-lock').first().click();
  await page.locator('.effect-lock').last().click();
  const beforeGleech = await recipe();
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
  assert.deepEqual(generated.effects[0], beforeGleech.effects[0]);
  assert.notDeepEqual(generated.effects[1].params, beforeGleech.effects[1].params);
  await undoRedo(beforeGleech, generated);
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
  await page.getByRole('slider', { name: 'Copies', exact: true }).scrollIntoViewIfNeeded();
  assert.ok(
    await page
      .getByRole('region', { name: 'Temporal Echo controls', exact: true })
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  );
  await captureTestWindow(app, resolve(output, `${label}-echo-controls.png`));
  await page.locator('.effect-select').last().click();
  await choose('Editing channel', 'green');
  await page.getByRole('slider', { name: 'Green scale', exact: true }).scrollIntoViewIfNeeded();
  assert.ok(
    await page
      .getByRole('region', { name: 'Channel Transform controls', exact: true })
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  );
  await captureTestWindow(app, resolve(output, `${label}-channel-controls.png`));
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Portable Channels and Echo');
  await page.getByRole('checkbox', { name: 'Include painted masks', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Portable Channels and Echo');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(presetPath);
  await page
    .getByRole('button', { name: 'Export preset Portable Channels and Echo', exact: true })
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
  await open(presetPath, 'Import Preset');
  await status('Imported preset Portable Channels and Echo');
  await page.getByRole('button', { name: 'Apply Portable Channels and Echo', exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  const imported = await recipe();
  assert.deepEqual(
    imported.effects.map((e) => e.params),
    final.effects.map((e) => e.params),
  );
  assert.deepEqual(
    imported.effects.map((e) => e.paintedMask),
    final.effects.map((e) => e.paintedMask),
  );
  await exportExact();
  console.log(`${label}: both filters, locks, GLEECH/Var, restart and portable presets passed`);
  while (await page.locator('.effect-row').count()) {
    await deleteFirstEffect(page);
    await settle();
  }
  width = 1024;
  height = 768;
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 37 + Math.floor(i / 4) * 19) % 256,
  );
  const largePath = resolve(output, `${label}-large.png`);
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(largePath);
  await open(largePath, 'Open image Ctrl+Shift+O');
  await add('Temporal Echo');
  await slider('Copies', '12');
  await slider('Scale per echo', '0.99');
  await choose('Style', 'color-separated');
  const echoDrag = await drag(
    'Spacing',
    Array.from({ length: 40 }, (_, i) => i / 4),
  );
  await deleteFirstEffect(page);
  await add('Channel Transform');
  await choose('Editing channel', 'red');
  await slider('Red scale', '120');
  await slider('Red rotation', '30');
  const channelDrag = await drag(
    'Red position X',
    Array.from({ length: 40 }, (_, i) => i / 2),
  );
  assert.deepEqual(errors, []);
  const result = {
    result: 'passed',
    exactExports: exports,
    channelDrag,
    echoDrag,
    undoRedo: true,
    masksLocks: true,
    gleechVar: true,
    projectRestart: true,
    presetTransfer: true,
  };
  await writeFile(resolve(output, `${label}-result.json`), JSON.stringify(result));
  console.log(
    `${label}: Channel Transform / Temporal Echo passed; ${exports} exact exports, ${channelDrag.frames} channel frames and ${echoDrag.frames} echo frames.`,
  );
} finally {
  await closeTestApp(app);
}
