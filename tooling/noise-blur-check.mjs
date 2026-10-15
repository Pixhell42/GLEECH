import { deleteFirstEffect } from './stack-action.mjs';
import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { renderEffects, effectCount } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/noise-blur-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const blurOnly = process.argv.includes('--blur-only');
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}${blurOnly ? '-blur-only' : ''}`;
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let width = 129;
let height = 65;
let rgba = Buffer.alloc(width * height * 4);
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
let subjectMask;
const frame = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function configure() {
  page = await app.firstWindow();
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
    renderEffects(image, recipe.effects, { masterSeed: recipe.seed, reference: image, subjectMask })
      .pixels,
  );
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  if (!data.equals(expected)) {
    const diffs = [];
    for (let i = 0; i < data.length; i++)
      if (data[i] !== expected[i])
        diffs.push({
          index: i,
          x: Math.floor(i / 4) % width,
          y: Math.floor(i / 4 / width),
          channel: i % 4,
          actual: data[i],
          expected: expected[i],
        });
    await writeFile(
      resolve(output, label + '-export-mismatch.json'),
      JSON.stringify({ recipe, differences: diffs.length, first: diffs.slice(0, 30) }, null, 2),
    );
  }
  assert.ok(
    data.equals(expected),
    'Native finishing filter export differs from the shared renderer',
  );
  return data;
}
async function screenshot(name) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await frame();
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayAwake: true }))
      .toPNG()
      .toString('base64'),
  );
  await writeFile(resolve(output, `${label}-${name}.png`), Buffer.from(png, 'base64'));
}

const slider = (name) => page.getByRole('slider', { name, exact: true });
const choose = (name, value) =>
  page.getByRole('combobox', { name, exact: true }).selectOption(value);
async function add(title) {
  await picker();
  assert.equal(await page.locator('.effect-grid .effect-tile').count(), effectCount);
  const tile = page.locator('.effect-picker').getByRole('button', { name: title, exact: true });
  await tile.scrollIntoViewIfNeeded();
  await tile.locator('img').evaluate((image) => {
    if (!image.complete || image.naturalWidth !== 384) throw new Error('Missing thumbnail');
  });
  await tile.click();
  await state();
}
async function open(path) {
  await chooseOpen(path);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(path));
  while (await page.locator('.effect-row').count()) await deleteFirstEffect(page);
  subjectMask = undefined;
}
async function undoRedo(before, after) {
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), after);
}
async function hex(label, value) {
  const field = page.getByRole('textbox', { name: label + ' hex', exact: true });
  await field.fill(value);
  await field.press('Enter');
}
async function detect(path) {
  await chooseOpen(path);
  const cached = await page.evaluate(async () => {
    const imported = await window.gleech.openImage();
    if (!imported.ok || !imported.value) throw new Error('Mask fixture failed');
    const mask = await window.gleech.subjectMask(imported.value.source.id);
    if (!mask.ok) throw new Error(mask.error);
    await window.gleech.releaseImage(imported.value.source.id);
    return {
      width: mask.value.width,
      height: mask.value.height,
      values: Array.from(new Uint8Array(mask.value.values)),
    };
  });
  subjectMask = {
    width: cached.width,
    height: cached.height,
    values: Uint8Array.from(cached.values).buffer,
  };
}
try {
  await configure();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 800));
  await open(imagePath);
  await add('Noise / Grain');
  if (!blurOnly) {
    await slider('Intensity').fill('0.6');
    for (const style of [
      'white',
      'gaussian',
      'speckle',
      'film',
      'perlin',
      'simplex',
      'voronoi',
      'value',
    ]) {
      await choose('Style', style);
      assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 1);
      await exportExact();
    }
    await choose('Style', 'voronoi');
    for (const mode of ['cells', 'borders']) {
      await choose('Cell pattern', mode);
      await exportExact();
    }
    await choose('Style', 'simplex');
    await slider('Detail / Octaves').fill('6');
    await slider('Roughness').fill('0.75');
    for (const variant of ['turbulence', 'ridged']) {
      await choose('Variant', variant);
      await exportExact();
    }
    await choose('Noise colors', 'color');
    await exportExact();
    await choose('Noise colors', 'ramp');
    await hex('Noise color', '#e07040');
    await page
      .getByRole('group', { name: 'Noise color mode', exact: true })
      .getByRole('button', { name: 'Gradient', exact: true })
      .click();
    await hex('Noise color end', '#2060f0');
    await exportExact();
    const beforeVary = await state();
    await page.getByRole('button', { name: 'New pattern', exact: true }).click();
    const afterVary = await state();
    assert.notDeepEqual(afterVary, beforeVary);
    await undoRedo(beforeVary, afterVary);
    await choose('Application', 'left');
    await slider('Coverage').fill('0.6');
    await slider('Softness').fill('0.3');
    await slider('Opacity').fill('0.7');
    for (const blend of ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference']) {
      await choose('Blend mode', blend);
      await exportExact();
    }
    await screenshot('noise-controls');
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  }
  await add('Blur');
  await slider('Radius').fill('6');
  for (const style of [
    'gaussian',
    'motion',
    'radial',
    'lens',
    'surface',
    'box',
    'grainy',
    'shape',
    'field',
    'tilt-shift',
    'spin',
    'zoom',
    'smart',
  ]) {
    await choose('Style', style);
    assert.equal(
      await page.getByRole('button', { name: 'New pattern', exact: true }).count(),
      style === 'grainy' ? 1 : 0,
    );
    if (style === 'motion') await slider('Angle').fill('37');
    if (style === 'lens') await slider('Highlight response').fill('1.5');
    if (style === 'box') await slider('Aspect').fill('2');
    if (style === 'smart') await slider('Sensitivity').fill('0.3');
    if (style === 'shape') await choose('Footprint', 'triangle');
    if (style === 'grainy') {
      const before = await state();
      await page.getByRole('button', { name: 'New pattern', exact: true }).click();
      const after = await state();
      assert.notDeepEqual(after, before);
      await undoRedo(before, after);
    }
    await exportExact();
  }
  await choose('Style', 'shape');
  for (const shape of ['square', 'polygon', 'ring', 'circle']) {
    await choose('Footprint', shape);
    await exportExact();
  }
  await choose('Style', 'gaussian');
  for (const edge of ['wrap', 'mirror']) {
    await choose('Edge Handling', edge);
    await exportExact();
  }
  for (const blend of ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference']) {
    await choose('Blend mode', blend);
    await exportExact();
  }
  await choose('Blend mode', 'normal');
  assert.equal(await slider('Tint strength').isEnabled(), false);
  await page.getByRole('switch', { name: 'Tint', exact: true }).check();
  await hex('Tint color', '#f0a050');
  await slider('Tint strength').fill('0.3');
  await exportExact();
  await page.getByRole('switch', { name: 'Tint', exact: true }).uncheck();
  await choose('Style', 'field');
  const beforeDrag = await state();
  const handle = slider('Field point 1');
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 18, bounds.y + bounds.height / 2 - 12, {
    steps: 8,
  });
  await page.mouse.up();
  const afterDrag = await state();
  assert.notDeepEqual(afterDrag, beforeDrag);
  await undoRedo(beforeDrag, afterDrag);
  await handle.focus();
  const beforeKeys = await state();
  await page.keyboard.down('ArrowRight');
  await frame();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  const afterKeys = await state();
  assert.equal(
    afterKeys.effects.at(-1).params.point0X,
    beforeKeys.effects.at(-1).params.point0X + 2,
  );
  await undoRedo(beforeKeys, afterKeys);
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await slider('Point radius').fill('5');
  assert.equal((await state()).effects.at(-1).params.pointCount, 3);
  const beforeRemove = await state();
  await page.getByRole('button', { name: 'Remove point', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), beforeRemove);
  await choose('Style', 'box');
  await choose('Style', 'field');
  assert.equal((await state()).effects.at(-1).params.pointCount, 3);
  await screenshot('field-controls');
  while ((await state()).effects.at(-1).params.pointCount < 8)
    await page.getByRole('button', { name: 'Add point', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Add point', exact: true }).isEnabled(),
    false,
  );
  assert.equal(
    await page
      .getByRole('group', { name: 'Blur field graph', exact: true })
      .getByRole('slider')
      .count(),
    8,
  );
  const savedRecipe = await state(),
    stacked = await exportExact();
  await page.getByRole('button', { name: 'Capture snapshot', exact: true }).click();
  await page.getByRole('textbox', { name: 'Snapshot name' }).fill('Noise blur field');
  await page
    .locator('.stage-dialog')
    .getByRole('button', { name: 'Capture stage', exact: true })
    .click();
  await status('Captured Noise blur field');
  await chooseSave(projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await status('Saved ' + basename(projectPath));
  await picker('Presets');
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Noise blur field');
  await page
    .getByRole('img', { name: 'Statue preset preview', exact: true })
    .waitFor({ timeout: 60000 });
  await page.getByRole('radio', { name: 'Statue', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await status('Saved preset Noise blur field');
  const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
  assert.deepEqual(stored.effects, savedRecipe.effects);
  const presetPath = resolve(output, label + '.gleechpreset');
  await chooseSave(presetPath);
  await page.getByRole('button', { name: 'Export preset Noise blur field', exact: true }).click();
  await status('Exported preset ' + basename(presetPath));
  await page.keyboard.press('Escape');
  await chooseOpen(presetPath);
  await fileAction(page, 'Import Preset');
  await status('Imported preset Noise blur field (2)');
  await page.keyboard.press('Escape');
  await closeTestApp(app);
  app = await launch();
  await configure();
  await chooseOpen(projectPath);
  await page.keyboard.press('Control+o');
  await status('Opened ' + basename(projectPath));
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(stacked));
  await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  if (await page.getByRole('button', { name: 'Expand stages', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Expand stages', exact: true }).click();
  await page.getByRole('button', { name: 'Restore recipe Noise blur field', exact: true }).click();
  await status('Restored Noise blur field');
  assert.deepEqual(await state(), savedRecipe);
  await open(imagePath);
  await picker('Presets');
  await page.getByRole('button', { name: 'Apply Noise blur field (2)', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), savedRecipe);
  assert.ok((await exportExact()).equals(stacked));
  const photo = resolve(root, 'tooling/fixtures/astronaut.png');
  await open(photo);
  const decoded = await sharp(photo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  width = decoded.info.width;
  height = decoded.info.height;
  rgba = decoded.data;
  await add('Blur');
  await slider('Radius').fill('3');
  await choose('Style', 'background');
  await state();
  await detect(photo);
  assert.ok(new Uint8Array(subjectMask.values).some((v) => v > 180));
  await slider('Mask softness').fill('1.5');
  await slider('Subject refinement').fill('0.1');
  await exportExact();
  await choose('Application', 'top');
  await slider('Coverage').fill('0.7');
  await slider('Softness').fill('0.2');
  await choose('Blend mode', 'screen');
  await exportExact();
  await slider('Radius').scrollIntoViewIfNeeded();
  await screenshot('background-blur');
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      styles: blurOnly ? 14 : 22,
      fieldPointCount: 8,
      fieldGestures: true,
      project: true,
      snapshots: true,
      presets: true,
      subjectDetection: true,
      result: 'passed',
    }),
  );
} catch (error) {
  await writeFile(
    resolve(output, label + '-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        errors,
        body: await page
          ?.locator('body')
          .innerText()
          .catch(() => ''),
        recipe: await state().catch(() => null),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
