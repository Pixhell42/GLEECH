import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { renderEffects, effectCount } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/tonal-glow-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const visualOnly = process.argv.includes('--visual-only');
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}${visualOnly ? '-visual' : ''}`;
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
    renderEffects(image, recipe.effects, { masterSeed: recipe.seed, reference: image }).pixels,
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
const defaults = new Map();
const slider = (name) => page.getByRole('slider', { name, exact: true });
const choose = (name, value) =>
  page.getByRole('combobox', { name, exact: true }).selectOption(value);
async function add(title, type) {
  await picker();
  assert.equal(await page.locator('.effect-grid .effect-tile').count(), effectCount);
  const tile = page.locator('.effect-picker').getByRole('button', { name: title, exact: true });
  await tile.scrollIntoViewIfNeeded();
  await tile.locator('img').evaluate((image) => {
    if (!image.complete || image.naturalWidth !== 384) throw new Error('Missing filter thumbnail');
  });
  await tile.click();
  const recipe = await state();
  assert.equal(recipe.effects.at(-1).type, type);
  if (!defaults.has(type)) defaults.set(type, recipe.effects.at(-1).params);
}

async function undoRedo(before, after) {
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), after);
}

async function hex(label, value) {
  const field = page.getByRole('textbox', { name: `${label} hex`, exact: true });
  await field.fill(value);
  await field.press('Enter');
}
async function resetImage() {
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  while (await page.locator('.effect-delete').count())
    await page.locator('.effect-delete').first().click();
}
async function inspectStatue() {
  await chooseOpen(resolve(root, 'apps/desktop/resources/presets/statue.png'));
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened statue.png');
  while (await page.locator('.effect-delete').count())
    await page.locator('.effect-delete').first().click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await add('Levels / Curves', 'levels-curves');
  await choose('Mode', 'curves');
  await slider('Curve dark tones').fill('0.12');
  await slider('Curve light tones').fill('0.9');
  await page
    .getByRole('group', { name: 'Tonal curve graph', exact: true })
    .scrollIntoViewIfNeeded();
  await state();
  await screenshot('statue-curves');
  await add('Glow', 'glow');
  await slider('Glow strength').fill('2');
  await slider('Threshold').fill('0.35');
  await slider('Radius').fill('3');
  await slider('Radius').scrollIntoViewIfNeeded();
  await state();
  await screenshot('statue-glow');
}
try {
  await configure();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  if (!visualOnly) {
    await resetImage();
    await add('Levels / Curves', 'levels-curves');
    assert.ok((await exportExact()).equals(rgba));
    assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 0);
    await slider('Input black').fill('0.12');
    await slider('Input white').fill('0.88');
    await slider('Gamma').fill('1.4');
    await slider('Output black').fill('0.08');
    await slider('Output white').fill('0.94');
    for (const channel of ['rgb', 'red', 'green', 'blue']) {
      await choose('Channel', channel);
      await exportExact();
    }
    await choose('Channel', 'rgb');
    const levelSettings = (await state()).effects.at(-1).params;
    await choose('Mode', 'curves');
    assert.equal(await slider('Input black').count(), 0);
    const graph = page.getByRole('group', { name: 'Tonal curve graph', exact: true });
    assert.equal(await graph.count(), 1);
    await slider('Curve dark tones').fill('0.12');
    await slider('Curve light tones').fill('0.85');
    await exportExact();
    await choose('Curve interpolation', 'linear');
    await exportExact();
    await choose('Curve interpolation', 'smooth');
    const beforeDrag = await state();
    const handle = slider('Curve midtones graph handle');
    await handle.scrollIntoViewIfNeeded();
    const bounds = await handle.boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 28, {
      steps: 8,
    });
    await page.mouse.up();
    const afterDrag = await state();
    assert.ok(afterDrag.effects.at(-1).params.curveMid > beforeDrag.effects.at(-1).params.curveMid);
    await undoRedo(beforeDrag, afterDrag);
    const beforeKeys = await state();
    await handle.focus();
    await page.keyboard.down('ArrowUp');
    await frame();
    await page.keyboard.down('ArrowUp');
    await frame();
    await page.keyboard.down('ArrowUp');
    await frame();
    await page.keyboard.up('ArrowUp');
    const afterKeys = await state();
    assert.equal(
      afterKeys.effects.at(-1).params.curveMid,
      Math.round((beforeKeys.effects.at(-1).params.curveMid + 0.03) * 100) / 100,
    );
    await undoRedo(beforeKeys, afterKeys);
    await exportExact();
    await choose('Mode', 'levels');
    const retained = (await state()).effects.at(-1).params;
    for (const key of ['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite'])
      assert.equal(retained[key], levelSettings[key]);
    await slider('Input white').fill('0.2');
    assert.ok(Number(await slider('Input black').getAttribute('max')) < 0.2);
    await slider('Input black').fill('0.19');
    assert.ok(
      (await state()).effects.at(-1).params.inputBlack <
        (await state()).effects.at(-1).params.inputWhite,
    );
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
    assert.deepEqual((await state()).effects.at(-1).params, defaults.get('levels-curves'));
    await choose('Mode', 'curves');
    await slider('Curve dark tones').fill('0.1');
    await slider('Curve light tones').fill('0.9');
    for (const blend of ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference']) {
      await choose('Blend mode', blend);
      await exportExact();
    }
    await choose('Blend mode', 'normal');
    await choose('Application', 'left');
    await slider('Coverage').fill('0.55');
    await slider('Softness').fill('0.3');
    await slider('Opacity').fill('0.7');
    await exportExact();
    await graph.scrollIntoViewIfNeeded();
    await screenshot('compact-curve-controls');
    await resetImage();
    await add('Glow', 'glow');
    await slider('Glow strength').fill('0');
    assert.ok((await exportExact()).equals(rgba));
    await slider('Glow strength').fill('1.6');
    await slider('Threshold').fill('0.25');
    await slider('Highlight softness').fill('0.12');
    for (const radius of [0, 3, 10]) {
      await slider('Radius').fill(String(radius));
      await exportExact();
    }
    for (const edge of ['wrap', 'mirror']) {
      await choose('Edge Handling', edge);
      await exportExact();
    }
    await slider('Radius').fill('5');
    const beforeColor = await state();
    await hex('Halo color', '#e08040');
    await slider('Halo color mix').fill('0.75');
    assert.ok(!(await exportExact()).equals(rgba));
    const colorGroup = page.getByRole('group', { name: 'Halo color mode', exact: true });
    await colorGroup.getByRole('button', { name: 'Gradient', exact: true }).click();
    await hex('Halo color end', '#2080e0');
    await slider('Halo color direction').fill('45');
    await slider('Halo color span').fill('80');
    await exportExact();
    await choose('Blend mode', 'screen');
    await slider('Opacity').fill('0.7');
    await choose('Application', 'top');
    await slider('Coverage').fill('0.65');
    await slider('Softness').fill('0.2');
    await exportExact();
    const beforeReset = await state();
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
    assert.deepEqual((await state()).effects.at(-1).params, defaults.get('glow'));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), beforeReset);
    assert.notDeepEqual(beforeReset, beforeColor);
    await slider('Radius').scrollIntoViewIfNeeded();
    await screenshot('compact-glow-controls');
    await add('Levels / Curves', 'levels-curves');
    await choose('Mode', 'curves');
    await slider('Curve dark tones').fill('0.1');
    await slider('Curve midtones').fill('0.6');
    await slider('Curve light tones').fill('0.9');
    const savedRecipe = await state();
    const stacked = await exportExact();
    await chooseSave(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status('Saved ' + basename(projectPath));
    await picker('Presets');
    await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Tonal and glow');
    await page
      .getByRole('img', { name: 'Statue preset preview', exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole('radio', { name: 'Statue', exact: true }).check();
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await status('Saved preset Tonal and glow');
    const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
    assert.deepEqual(stored.effects, savedRecipe.effects);
    const presetPath = resolve(output, label + '.gleechpreset');
    await chooseSave(presetPath);
    await page.getByRole('button', { name: 'Export preset Tonal and glow', exact: true }).click();
    await status('Exported preset ' + basename(presetPath));
    await page.keyboard.press('Escape');
    await chooseOpen(presetPath);
    await fileAction(page, 'Import Preset');
    await status('Imported preset Tonal and glow (2)');
    await page.keyboard.press('Escape');
    await closeTestApp(app);
    app = await launch();
    await configure();
    await chooseOpen(projectPath);
    await page.keyboard.press('Control+o');
    await status('Opened ' + basename(projectPath));
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    await resetImage();
    await picker('Presets');
    await page.getByRole('button', { name: 'Apply Tonal and glow (2)', exact: true }).click();
    await page
      .locator('.preset-flyout')
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
    assert.deepEqual((await state()).effects.at(-1).params, defaults.get('levels-curves'));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), savedRecipe);
  }
  await inspectStatue();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      restart: !visualOnly,
      presets: !visualOnly,
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
