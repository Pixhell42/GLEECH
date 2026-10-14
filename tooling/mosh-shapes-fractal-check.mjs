import { deleteFirstEffect } from './stack-action.mjs';
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
const output = resolve(root, 'test-results/mosh-shapes-fractal-check');
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
    'Native Motion Mosh/Shapes/Mandelbrot export differs from the shared renderer',
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
  for (const [title, type] of [
    ['Motion Mosh', 'motion-mosh'],
    ['Shapes', 'shapes'],
    ['Mandelbrot', 'mandelbrot'],
  ]) {
    while (await page.locator('.effect-row').count()) await deleteFirstEffect(page);
    await add(title, type);
    if (type === 'motion-mosh') {
      await slider('Block size').fill('8');
      await slider('Travel').fill('30');
      await slider('Trail length').fill('1');
      await slider('Persistence').fill('0.9');
    } else if (type === 'shapes') {
      await choose('Shape', 'triangle');
      await slider('Size').fill('90');
      await slider('Rotation').fill('18');
    } else {
      await slider('Opacity').fill('0.65');
      await choose('Blend mode', 'overlay');
    }
    await state();
    await screenshot(type + '-statue');
  }
}
try {
  await configure();
  if (visualOnly) {
    await inspectStatue();
  } else {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
    await chooseOpen(imagePath);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await status('Opened ' + basename(imagePath));
    await add('Motion Mosh', 'motion-mosh');
    await slider('Block size').fill('8');
    await slider('Density').fill('0.4');
    await slider('Direction').fill('35');
    await slider('Trail length').fill('1');
    await slider('Persistence').fill('0.85');
    await slider('Trail samples').fill('12');
    const before = await state();
    await slider('Travel').dispatchEvent('pointerdown');
    await slider('Travel').fill('20');
    await slider('Travel').fill('30');
    await slider('Travel').dispatchEvent('pointerup');
    await undoRedo(before, await state());
    const seeded = await state();
    const first = await exportExact();
    await page.getByRole('button', { name: 'New pattern', exact: true }).click();
    assert.equal((await state()).effects[0].seedOffset, seeded.effects[0].seedOffset + 1);
    assert.ok(!(await exportExact()).equals(first));
    await undoRedo(seeded, await state());
    await slider('Density').fill('1');
    const denseTrail = await exportExact();
    await slider('Trail length').fill('0');
    assert.ok(!(await exportExact()).equals(denseTrail));
    await slider('Density').fill('0.4');
    await slider('Trail length').fill('1');
    for (const edge of ['extend', 'wrap', 'mirror']) {
      await choose('Edge Handling', edge);
      await exportExact();
    }
    await finishing();
    await screenshot('motion-controls');

    await add('Shapes', 'shapes');
    await slider('Size').fill('90');
    await slider('Scale').fill('1.25');
    await slider('Position X').fill('35');
    await slider('Position Y').fill('65');
    await slider('Edge softness').fill('4');
    for (const primitive of ['triangle', 'square', 'circle', 'ring']) {
      await choose('Shape', primitive);
      if (primitive === 'triangle' || primitive === 'square') await slider('Rotation').fill('35');
      assert.equal(await slider('Ring thickness').isEnabled(), primitive === 'ring');
      if (primitive === 'ring') await slider('Ring thickness').fill('0.4');
      await exportExact();
    }
    for (const operation of ['keep-inside', 'cut-out', 'distort', 'overlay']) {
      await choose('Operation', operation);
      assert.equal(await slider('Content scale').isEnabled(), operation === 'distort');
      if (operation === 'distort') {
        await slider('Content scale').fill('2');
        await slider('Twist').fill('-60');
      }
      if (operation === 'overlay') {
        await page.getByRole('textbox', { name: 'Shape color hex', exact: true }).fill('#e08040');
        await page.getByRole('textbox', { name: 'Shape color hex', exact: true }).press('Enter');
      }
      await exportExact();
    }
    await finishing();
    await choose('Operation', 'distort');
    await screenshot('shapes-controls');

    await add('Mandelbrot', 'mandelbrot');
    assert.equal((await state()).effects.at(-1).params.operation, 'weave');
    await exportExact();
    await slider('Image scale').fill('0.65');
    await slider('Image rotation').fill('45');
    await slider('Abstraction').fill('1');
    await choose('Mirror pieces', 'off');
    await choose('Edge Handling', 'mirror');
    await exportExact();
    const beforeExplore = await state();
    await page.getByRole('button', { name: 'Explore fractal…', exact: true }).click();
    await choose('Fractal location', '1');
    const explorer = page.getByRole('dialog', { name: 'Explore Mandelbrot' });
    const navigator = page.getByRole('img', { name: 'Fractal navigator' });
    await page.waitForFunction(
      () => document.querySelector('.fractal-navigator canvas')?.dataset.ready === 'true',
    );
    await screenshot('fractal-explorer');
    await explorer.getByRole('button', { name: 'Done', exact: true }).click();
    const boundary = await state();
    assert.equal(boundary.effects.at(-1).params.zoom, 34);
    await undoRedo(beforeExplore, boundary);
    await exportExact();
    await page.getByRole('button', { name: 'Explore fractal…', exact: true }).click();
    const box = await navigator.boundingBox();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(300);
    await explorer.getByRole('button', { name: 'Done', exact: true }).click();
    const zoomed = await state();
    assert.ok(zoomed.effects.at(-1).params.zoom > 34);
    await undoRedo(boundary, zoomed);
    await page.getByRole('button', { name: 'Explore fractal…', exact: true }).click();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 10, { steps: 5 });
    await page.mouse.up();
    await explorer.getByRole('button', { name: 'Done', exact: true }).click();
    const panned = await state();
    assert.notEqual(
      panned.effects.at(-1).params.centerReal,
      zoomed.effects.at(-1).params.centerReal,
    );
    await undoRedo(zoomed, panned);
    await page.getByRole('button', { name: 'Explore fractal…', exact: true }).click();
    await explorer.getByRole('button', { name: 'Reset View', exact: true }).click();
    await explorer.locator('summary').click();
    await page.getByRole('textbox', { name: 'Real center', exact: true }).fill('-0.7500001234');
    await page.getByRole('textbox', { name: 'Real center', exact: true }).press('Enter');
    await page.getByRole('textbox', { name: 'Imaginary center', exact: true }).fill('0.1');
    await page.getByRole('textbox', { name: 'Imaginary center', exact: true }).press('Enter');
    await page.keyboard.press('Escape');
    assert.equal((await state()).effects.at(-1).params.centerReal, -0.7500001234);
    await choose('Operation', 'texture');
    const beforeZoom = await state();
    await slider('Fractal zoom').dispatchEvent('pointerdown');
    await slider('Fractal zoom').fill('1.5');
    await slider('Fractal zoom').fill('2.5');
    await slider('Fractal zoom').dispatchEvent('pointerup');
    await undoRedo(beforeZoom, await state());
    await slider('Rotation').fill('25');
    await slider('Iterations').fill('96');
    await slider('Palette cycles').fill('7');
    await slider('Palette offset').fill('0.3');
    for (const name of ['Outside color', 'Inside color']) {
      await page
        .getByRole('textbox', { name: name + ' hex', exact: true })
        .fill(name === 'Outside color' ? '#e09030' : '#102040');
      await page.getByRole('textbox', { name: name + ' hex', exact: true }).press('Enter');
    }
    for (const operation of ['texture', 'keep-set', 'cut-out', 'distort']) {
      await choose('Operation', operation);
      assert.equal(await slider('Palette cycles').isEnabled(), operation === 'texture');
      assert.equal(await slider('Distortion').isEnabled(), operation === 'distort');
      if (operation === 'distort') {
        await slider('Distortion').fill('35');
        await choose('Edge Handling', 'wrap');
      }
      await exportExact();
    }
    await finishing();
    await choose('Fractal set', 'julia');
    await page.getByRole('button', { name: 'Explore fractal…', exact: true }).click();
    await choose('Julia starting shape', '0');
    await page.keyboard.press('Escape');
    for (const operation of ['weave', 'texture', 'distort', 'keep-set', 'cut-out']) {
      await choose('Operation', operation);
      await exportExact();
    }
    await choose('Operation', 'weave');
    await slider('Image scale').fill('0.75');
    await slider('Abstraction').fill('0.95');
    await exportExact();
    await screenshot('mandelbrot-controls');
    const savedRecipe = await state();
    const stacked = await exportExact();
    await chooseSave(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status('Saved ' + basename(projectPath));
    await picker('Presets');
    await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Preset name', exact: true })
      .fill('Mosh shapes fractal');
    await page
      .getByRole('img', { name: 'Statue preset preview', exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole('radio', { name: 'Statue', exact: true }).check();
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await status('Saved preset Mosh shapes fractal');
    const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
    assert.deepEqual(stored.effects, savedRecipe.effects);
    const presetPath = resolve(output, label + '.gleechpreset');
    await chooseSave(presetPath);
    await page
      .getByRole('button', { name: 'Export preset Mosh shapes fractal', exact: true })
      .click();
    await status('Exported preset ' + basename(presetPath));
    await page.keyboard.press('Escape');
    await chooseOpen(presetPath);
    await fileAction(page, 'Import Preset');
    await status('Imported preset Mosh shapes fractal (2)');
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
    await page.getByRole('button', { name: 'Apply Mosh shapes fractal (2)', exact: true }).click();
    await page
      .locator('.preset-flyout')
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    for (const [title, type] of [
      ['Motion Mosh', 'motion-mosh'],
      ['Shapes', 'shapes'],
      ['Mandelbrot', 'mandelbrot'],
    ]) {
      await page.getByRole('button', { name: title, exact: true }).click();
      await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
      assert.deepEqual(
        (await state()).effects.find((e) => e.type === type).params,
        defaults.get(type),
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.deepEqual(await state(), savedRecipe);
    }
    await inspectStatue();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      filters: 3,
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
