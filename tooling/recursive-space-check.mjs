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
const output = resolve(root, 'test-results/recursive-space-check');
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
    'Native Recursive Space export differs from the shared renderer',
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
async function finishing() {
  assert.ok(!(await page.getByRole('switch', { name: 'Tint', exact: true }).isChecked()));
  assert.ok(await slider('Tint strength').isDisabled());
  await page.getByRole('textbox', { name: 'Tint color hex', exact: true }).fill('#4080e0');
  await page.getByRole('textbox', { name: 'Tint color hex', exact: true }).press('Enter');
  await page.getByRole('switch', { name: 'Tint', exact: true }).check();
  await slider('Tint strength').fill('0.5');
  for (const mode of ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference']) {
    await choose('Blend mode', mode);
    await exportExact();
  }
  await choose('Blend mode', 'normal');
  await page.getByRole('switch', { name: 'Tint', exact: true }).uncheck();
  await choose('Application', 'top');
  await slider('Coverage').fill('0.4');
  await slider('Softness').fill('0');
  const hardMask = await exportExact();
  await slider('Softness').fill('0.5');
  assert.ok(!(await exportExact()).equals(hardMask));
  await choose('Application', 'all');
  await slider('Coverage').fill('1');
}

async function inspectStatue() {
  await chooseOpen(resolve(root, 'apps/desktop/resources/presets/statue.png'));
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened statue.png');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  while (await page.locator('.effect-delete').count())
    await page.locator('.effect-delete').first().click();
  await add('Recursive Space', 'recursive-space');
  for (const style of ['tunnel', 'spiral', 'lattice']) {
    await choose('Style', style);
    await state();
    await screenshot(style + '-statue');
  }
}
try {
  await configure();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  if (!visualOnly) {
    await chooseOpen(imagePath);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await status('Opened ' + basename(imagePath));
    await add('Recursive Space', 'recursive-space');
    assert.ok(await slider('Twist').isDisabled());
    assert.ok(await slider('Repeats').isDisabled());
    const original = await exportExact();
    await slider('Opacity').fill('0');
    assert.ok((await exportExact()).equals(rgba));
    await slider('Opacity').fill('1');
    const before = await state();
    await slider('Depth').dispatchEvent('pointerdown');
    await slider('Depth').fill('2');
    await slider('Depth').fill('3');
    await slider('Depth').dispatchEvent('pointerup');
    const shallow = await state();
    await undoRedo(before, shallow);
    assert.ok(!(await exportExact()).equals(original));
    for (const [name, value] of [
      ['Repetition scale', '0.7'],
      ['Perspective', '0.8'],
      ['Vanishing point X', '35'],
      ['Vanishing point Y', '60'],
      ['Rotation', '20'],
      ['Image scale', '1.3'],
    ]) {
      await slider(name).fill(value);
      await exportExact();
    }
    const styles = new Set();
    for (const style of ['tunnel', 'spiral', 'lattice']) {
      await choose('Style', style);
      assert.equal(await slider('Twist').isEnabled(), style !== 'tunnel');
      assert.equal(await slider('Repeats').isEnabled(), style !== 'tunnel');
      if (style !== 'tunnel') {
        await slider('Twist').fill('-45');
        await slider('Repeats').fill('9');
      }
      styles.add((await exportExact()).toString('base64'));
      await screenshot(style + '-controls');
    }
    assert.equal(styles.size, 3);
    for (const mirror of ['off', 'on']) {
      await choose('Mirror copies', mirror);
      await exportExact();
    }
    await slider('Image scale').fill('0.25');
    for (const edge of ['extend', 'wrap', 'mirror']) {
      await choose('Edge Handling', edge);
      await exportExact();
    }
    await slider('Image scale').fill('1.3');
    await finishing();
    const savedRecipe = await state();
    const stacked = await exportExact();
    await chooseSave(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status('Saved ' + basename(projectPath));
    await picker('Presets');
    await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Recursive space');
    await page
      .getByRole('img', { name: 'Statue preset preview', exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole('radio', { name: 'Statue', exact: true }).check();
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await status('Saved preset Recursive space');
    const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
    assert.deepEqual(stored.effects, savedRecipe.effects);
    const presetPath = resolve(output, label + '.gleechpreset');
    await chooseSave(presetPath);
    await page.getByRole('button', { name: 'Export preset Recursive space', exact: true }).click();
    await status('Exported preset ' + basename(presetPath));
    await page.keyboard.press('Escape');
    await chooseOpen(presetPath);
    await fileAction(page, 'Import Preset');
    await status('Imported preset Recursive space (2)');
    await page.keyboard.press('Escape');
    await closeTestApp(app);
    app = await launch();
    await configure();
    await chooseOpen(projectPath);
    await page.keyboard.press('Control+o');
    await status('Opened ' + basename(projectPath));
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    await chooseOpen(imagePath);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await status('Opened ' + basename(imagePath));
    await picker('Presets');
    await page.getByRole('button', { name: 'Apply Recursive space (2)', exact: true }).click();
    await page
      .locator('.preset-flyout')
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
    assert.deepEqual((await state()).effects[0].params, defaults.get('recursive-space'));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), savedRecipe);
  }
  await inspectStatue();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      filters: 1,
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
