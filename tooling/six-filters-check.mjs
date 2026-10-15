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
const output = resolve(root, 'test-results/six-filters');
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
      return n && n.dataset.renderRevision === n.dataset.requestedRevision;
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
const specs = [
  ['bit-damage', 'Advanced Bit Damage', 'Damage density'],
  ['freeze-dropout', 'Freeze / Dropout', 'Failure density'],
  ['photo-adjustments', 'Photo Adjustments', 'Exposure'],
  ['detail', 'Detail / Sharpen / Clarity', 'Sharpen'],
  ['halation', 'Halation', 'Halo strength'],
  ['vignette', 'Vignette', 'Vignette strength'],
];
try {
  await configure();
  await open(imagePath, 'Open image Ctrl+Shift+O');
  for (const [type, title] of specs) {
    await add(title);
    console.log(`${label}: checking ${title}`);
    if (type === 'bit-damage') {
      await slider('Damage density', '1');
      await slider('Low bit', '3');
      for (const operation of ['flip', 'clear', 'set', 'shift', 'rotate', 'scramble', 'isolate']) {
        await choose('Operation', operation);
        if (['shift', 'rotate'].includes(operation)) await slider('Bit shift', '-2');
        await exportExact();
      }
      await choose('Target', 'alpha');
      await exportExact();
      await choose('Visualize planes', 'on');
      await exportExact();
      assert.equal(await page.getByRole('combobox', { name: 'Operation', exact: true }).count(), 0);
      await choose('Visualize planes', 'off');
      await choose('Target', 'rgb');
      await choose('Operation', 'scramble');
      await slider('Damage density', '0.45');
      await slider('Cell size', '12');
      const before = await recipe();
      console.log(`${label}: checking bit reset`);
      await reset(page.getByRole('slider', { name: 'Cell size', exact: true }));
      const after = await recipe();
      assert.equal(after.effects[0].params.cellSize, 8);
      await undoRedo(before, after);
      const pattern = await recipe();
      console.log(`${label}: checking bit pattern`);
      await page.getByRole('button', { name: 'New pattern', exact: true }).click();
      assert.equal((await recipe()).effects[0].seedOffset, pattern.effects[0].seedOffset + 1);
    } else if (type === 'freeze-dropout') {
      await slider('Patch size', '8');
      await slider('Failure density', '0.5');
      await slider('Grid position X', '7');
      await slider('Grid position Y', '-9');
      for (const style of ['freeze', 'duplicate', 'blank', 'noise']) {
        await choose('Style', style);
        if (style === 'freeze') {
          await slider('Simulated steps', '12');
          await slider('Hold age', '9');
        }
        if (style === 'duplicate') {
          await slider('Scatter', '0.5');
          for (const edges of ['extend', 'wrap', 'mirror']) {
            await choose('Edge Handling', edges);
            await exportExact();
          }
        }
        if (style === 'blank') {
          await gradient('Dropout color', '#ff0044', '#00aaff');
          await exportExact();
          await choose('Clear transparency', 'on');
          await exportExact();
          assert.equal(
            await page.getByRole('textbox', { name: 'Dropout color hex', exact: true }).count(),
            0,
          );
          await choose('Clear transparency', 'off');
        }
        await exportExact();
      }
      await choose('Style', 'freeze');
      await slider('Hold age', '4');
      const pattern = await recipe();
      await page.getByRole('button', { name: 'New pattern', exact: true }).click();
      assert.equal(
        (await recipe()).effects.at(-1).seedOffset,
        pattern.effects.at(-1).seedOffset + 1,
      );
    } else if (type === 'photo-adjustments') {
      await slider('Exposure', '0.7');
      await slider('Contrast', '0.3');
      await slider('Highlights', '-0.4');
      await slider('Shadows', '0.35');
      await slider('Vibrance', '0.45');
      await slider('Temperature', '0.25');
      await slider('White balance tint', '-0.2');
      await exportExact();
      const before = await recipe();
      await reset(page.getByRole('slider', { name: 'Exposure', exact: true }));
      const after = await recipe();
      assert.equal(after.effects.at(-1).params.exposure, 0.25);
      await undoRedo(before, after);
      await page.getByRole('slider', { name: 'Exposure', exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
      await status('Copied Exposure');
      await slider('Exposure', '-0.5');
      await page.getByRole('slider', { name: 'Exposure', exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
      await status('Pasted Exposure');
      assert.equal((await recipe()).effects.at(-1).params.exposure, 0.25);
    } else if (type === 'detail') {
      await slider('Sharpen', '1.5');
      await slider('Sharpen radius', '3');
      await slider('Detail threshold', '0.02');
      await slider('Clarity', '0.5');
      await slider('Clarity radius', '4');
      for (const edges of ['extend', 'wrap', 'mirror']) {
        await choose('Edge Handling', edges);
        await exportExact();
      }
      await slider('Sharpen', '0');
      assert.equal(
        await page.getByRole('slider', { name: 'Sharpen radius', exact: true }).count(),
        0,
      );
      await slider('Sharpen', '0.8');
    } else if (type === 'halation') {
      await slider('Halo strength', '3');
      await slider('Halo radius', '3');
      await slider('Highlight threshold', '0.4');
      await slider('Highlight softness', '0.2');
      await slider('Dark-side bias', '0.65');
      await gradient('Halo color', '#ff3300', '#9900ff');
      for (const edges of ['extend', 'wrap', 'mirror']) {
        await choose('Edge Handling', edges);
        await exportExact();
      }
    } else {
      await slider('Vignette strength', '0.8');
      await slider('Size', '1.2');
      await slider('Feather', '0');
      await slider('Roundness', '0.4');
      await slider('Center X', '35');
      await slider('Center Y', '65');
      await slider('Rotation', '25');
      await choose('Invert', 'on');
      await gradient('Vignette color', '#220044', '#ffcc88');
      await exportExact();
      await choose('Invert', 'off');
      await slider('Feather', '0.7');
      await exportExact();
    }
    await slider('Opacity', '0.8');
    console.log(`${label}: checking ${title} finishing`);
    await choose('Blend mode', 'screen');
    await page.getByRole('switch', { name: 'Tint', exact: true }).check();
    await slider('Tint strength', '0.15');
    await gradient('Tint color', '#ffeecc', '#aaddff');
    await choose('Application', 'left');
    await slider('Coverage', '0.75');
    await slider('Softness', '0.25');
    await paint();
    await exportExact();
    const before = await recipe();
    await page.locator('.effect-lock').first().click();
    await page.locator('.effect-select').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    await status('Duplicated filter');
    const duplicated = await recipe();
    assert.deepEqual(duplicated.effects.at(-1).params, before.effects.at(-1).params);
    assert.deepEqual(duplicated.effects.at(-1).paintedMask, before.effects.at(-1).paintedMask);
    assert.equal(duplicated.effects.at(-1).locked, true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settle();
    await page.locator('.effect-lock').first().click();
    console.log(`${label}: ${title} controls, rendering, masks, duplication and finishing passed`);
  }
  // Keep one filter locked while GLEECH varies the other five.
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
  for (let i = 1; i < 6; i++)
    assert.notDeepEqual(generated.effects[i].params, beforeGleech.effects[i].params);
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
  for (const [, title] of specs) {
    await page.locator('.effect-select').filter({ hasText: title }).click();
    await settle();
    assert.ok(
      await page
        .getByRole('region', { name: title + ' controls', exact: true })
        .evaluate((n) => n.scrollWidth <= n.clientWidth),
    );
    await captureTestWindow(
      app,
      resolve(output, `${label}-${title.split(' ')[0].toLowerCase()}-controls.png`),
    );
  }
  await fileAction(page, 'Save Stack as Preset');
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Portable Six Filters');
  await page.getByRole('checkbox', { name: 'Include painted masks', exact: true }).check();
  // Including masks regenerates the thumbnails before Save becomes enabled.
  await page
    .getByRole('img', { name: 'Current image preset preview', exact: true })
    .waitFor({ timeout: 180000 });
  await page.getByRole('button', { name: 'Save preset', exact: true }).click({ timeout: 180000 });
  await status('Saved preset Portable Six Filters');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await savePath(presetPath);
  await page
    .getByRole('button', { name: 'Export preset Portable Six Filters', exact: true })
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
  await status('Imported preset Portable Six Filters');
  await page.getByRole('button', { name: 'Apply Portable Six Filters', exact: true }).click();
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
  const drags = {};
  for (const [type, title, control] of specs) {
    await add(title);
    if (type === 'bit-damage') await choose('Operation', 'scramble');
    const values = Array.from({ length: 40 }, (_, i) =>
      type === 'photo-adjustments'
        ? -0.5 + i / 40
        : type === 'detail'
          ? 0.2 + i / 40
          : type === 'halation'
            ? 0.5 + i / 20
            : 0.1 + i / 50,
    );
    drags[type] = await drag(control, values);
    await deleteFirstEffect(page);
    await settle();
  }
  assert.deepEqual(errors, []);
  const result = {
    result: 'passed',
    exactExports: exports,
    drags,
    undoRedo: true,
    masksLocks: true,
    gleechVar: true,
    projectRestart: true,
    presetTransfer: true,
  };
  await writeFile(resolve(output, `${label}-result.json`), JSON.stringify(result));
  console.log(
    `${label}: all six filters passed; ${exports} exact exports. ${JSON.stringify(drags)}`,
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await closeTestApp(app);
}
