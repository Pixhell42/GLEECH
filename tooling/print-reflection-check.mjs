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
const output = resolve(root, 'test-results/print-reflection-check');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const visualOnly = process.argv.includes('--visual-only');
const colorTintOnly = process.argv.includes('--color-tint-only');
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}${colorTintOnly ? '-color-tint' : visualOnly ? '-visual' : ''}`;
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
    'Native print/reflection export differs from the shared renderer',
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
async function color(name, value) {
  if (name === 'Tint color') await page.getByRole('switch', { name: 'Tint', exact: true }).check();
  const control = page.getByLabel(name, { exact: true });
  assert.equal(await control.getAttribute('type'), 'color');
  await control.evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
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
async function maskAndAmount() {
  const recipe = await state();
  await slider('Opacity').fill('0');
  const noEffect = await exportExact();
  const source = { width, height, pixels: Uint8Array.from(rgba).buffer };
  const expected = Buffer.from(
    renderEffects(source, recipe.effects.slice(0, -1), {
      masterSeed: recipe.seed,
      reference: source,
    }).pixels,
  );
  assert.ok(noEffect.equals(expected));
  await slider('Opacity').fill('0.7');
  await choose('Application', 'top');
  await slider('Coverage').fill('0.5');
  const hard = await exportExact();
  await slider('Softness').fill('0.7');
  assert.ok(!(await exportExact()).equals(hard));
}
async function placementControls() {
  const original = await state();
  const content = original.effects.at(-1).params;
  for (const alignment of [
    'center',
    'top',
    'bottom',
    'left',
    'right',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
    'none',
  ]) {
    await choose('Output alignment', alignment);
    const params = (await state()).effects.at(-1).params;
    for (const key of ['axis', 'positionX', 'positionY', 'centerX', 'centerY', 'rotation', 'zoom'])
      if (key in content) assert.equal(params[key], content[key]);
    await exportExact();
  }
  await choose('Output alignment', 'center');
  const before = await state();
  await slider('Output offset X').dispatchEvent('pointerdown');
  await slider('Output offset X').fill('-7.5');
  await slider('Output offset X').fill('12.5');
  await slider('Output offset X').dispatchEvent('pointerup');
  const after = await state();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await state(), before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(await state(), after);
  await slider('Output offset Y').fill('-8.5');
  await exportExact();
}
async function inspectStatueFilters() {
  // Inspect each actual filter on the clean statue, rather than its generated tile.
  // Keep an alpha channel with all-opaque pixels: file metadata must not suppress
  // subject detection, including after a project or baked stage is reopened.
  const photoPath = resolve(output, `${label}-opaque-rgba-statue.png`);
  await sharp(resolve(root, 'apps/desktop/resources/presets/statue.png'))
    .ensureAlpha()
    .png()
    .toFile(photoPath);
  assert.equal((await sharp(photoPath).metadata()).hasAlpha, true);
  for (const [title, type] of [
    ['Halftone', 'halftone'],
    ['Mirroring', 'mirroring'],
    ['Kaleidoscope', 'kaleidoscope'],
  ]) {
    await chooseOpen(photoPath);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await status('Opened ' + basename(photoPath));
    await settle();
    await page.getByRole('button', { name: 'Edited', exact: true }).click();
    while (await page.locator('.effect-row').count()) await deleteFirstEffect(page);
    await add(title, type);
    assert.equal((await state()).effects.length, 1);
    await settle();
    await screenshot(type + '-statue');
    if (type !== 'halftone') {
      await choose('Output alignment', 'center');
      await slider('Output offset X').fill('7.5');
      await slider('Output offset Y').fill('-5');
      // An opaque ordinary photo must request a detected subject for alignment.
      await settle();
      const recipe = await state();
      const mask = await page.evaluate(async () => {
        const imported = await window.gleech.openImage();
        if (!imported.ok || !imported.value) throw new Error('Statue import failed');
        const id = imported.value.source.id;
        try {
          const result = await window.gleech.subjectMask(id);
          if (!result.ok) throw new Error(result.error);
          return {
            width: result.value.width,
            height: result.value.height,
            values: Array.from(new Uint8Array(result.value.values)),
          };
        } finally {
          await window.gleech.releaseImage(id);
        }
      });
      const source = await sharp(resolve(root, 'apps/desktop/resources/presets/statue.png'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const expected = Buffer.from(
        renderEffects(
          {
            width: source.info.width,
            height: source.info.height,
            pixels: Uint8Array.from(source.data).buffer,
          },
          recipe.effects,
          {
            masterSeed: recipe.seed,
            subjectMask: { ...mask, values: Uint8Array.from(mask.values).buffer },
          },
        ).pixels,
      );
      const path = resolve(output, `${label}-${type}-aligned-statue-export.png`);
      await chooseSave(path);
      await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
      await status('Exported ' + basename(path));
      const actual = await sharp(path).ensureAlpha().raw().toBuffer();
      assert.ok(
        actual.equals(expected),
        'Photo output alignment differs from rendered subject bounds',
      );
      assert.equal(await page.getByRole('alert').count(), 0);
      await screenshot(type + '-aligned-statue');
      assert.equal(recipe.effects[0].params.outputAlignment, 'center');
      await picker('Presets');
      await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
      await page
        .getByRole('img', { name: 'Statue preset preview', exact: true })
        .waitFor({ timeout: 30000 });
      const preview = await page
        .getByRole('img', { name: 'Current image preset preview', exact: true })
        .getAttribute('src');
      const previewPixels = await sharp(Buffer.from(preview.split(',')[1], 'base64'))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const expectedPreview = await sharp(expected, {
        raw: { width: source.info.width, height: source.info.height, channels: 4 },
      })
        .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
        .raw()
        .toBuffer();
      assert.ok(
        previewPixels.equals(expectedPreview),
        'Opaque RGBA photo preset preview differs from aligned output',
      );
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.keyboard.press('Escape');
    }
  }
}
async function inspectColorTintControls() {
  await chooseOpen(imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await status('Opened ' + basename(imagePath));
  let colors = 0;
  let tintFilters = 0;
  for (const [title, type, labels] of [
    ['RGB split', 'rgb-split', ['Tint color']],
    ['Block corruption', 'block-corruption', ['Tint color']],
    ['Spatial crush', 'spatial-crush', ['Tint color']],
    ['Bit crush', 'bit-crush', ['Tint color']],
    ['Wave distortion', 'wave-distortion', ['Tint color']],
    ['Mirroring', 'mirroring', ['Tint color']],
    ['Kaleidoscope', 'kaleidoscope', ['Tint color']],
    ['Halftone', 'halftone', ['Ink color', 'Paper color']],
    ['Scanlines', 'scanlines', ['Line color']],
  ]) {
    while (await page.locator('.effect-row').count()) await deleteFirstEffect(page);
    await add(title, type);
    const tint = page.getByRole('switch', { name: 'Tint', exact: true });
    if (type !== 'halftone' && type !== 'scanlines') {
      tintFilters++;
      assert.ok(!(await tint.isChecked()));
      assert.ok(await slider('Tint strength').isDisabled());
    }
    for (const name of labels) {
      const hex = page.getByRole('textbox', { name: name + ' hex', exact: true });
      const swatch = page.getByLabel(name, { exact: true });
      assert.equal(await hex.evaluate((input) => input.readOnly), false);
      const before = await state();
      await hex.fill('#204080');
      await hex.fill('4080e0');
      assert.equal(await swatch.inputValue(), '#4080e0');
      await hex.press('Enter');
      const after = await state();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.deepEqual(await state(), before);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      assert.deepEqual(await state(), after);
      assert.equal(await hex.inputValue(), '#4080E0');
      colors++;
      if (type === 'rgb-split') {
        await hex.fill('#abc');
        await hex.press('Enter');
        assert.equal(await swatch.inputValue(), '#aabbcc');
        await hex.fill('not a color');
        assert.equal(await hex.getAttribute('aria-invalid'), 'true');
        await hex.press('Tab');
        assert.equal(await hex.inputValue(), '#AABBCC');
        await hex.fill('#112233');
        await hex.press('Escape');
        assert.equal(await swatch.inputValue(), '#aabbcc');
        await color(name, '#804020');
        assert.equal(await hex.inputValue(), '#804020');
        await tint.uncheck();
      }
    }
    if (type !== 'halftone' && type !== 'scanlines') {
      await tint.check();
      assert.ok(await slider('Tint strength').isEnabled());
      await slider('Tint strength').fill('0.65');
      const on = await state();
      await tint.uncheck();
      assert.ok(await slider('Tint strength').isDisabled());
      assert.equal((await state()).effects[0].params.tintStrength, 0.65);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.deepEqual(await state(), on);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      if (type === 'kaleidoscope') {
        const untinted = await exportExact();
        await tint.check();
        assert.ok(!(await exportExact()).equals(untinted));
        await tint.uncheck();
        assert.ok((await exportExact()).equals(untinted));
        await tint.check();
        await screenshot('tint-controls');
        const saved = await state();
        await chooseSave(projectPath);
        await fileAction(page, 'Save project Ctrl+S');
        await status('Saved ' + basename(projectPath));
        await chooseOpen(projectPath);
        await page.keyboard.press('Control+o');
        await status('Opened ' + basename(projectPath));
        assert.deepEqual(await state(), saved);
        await page.getByRole('button', { name: 'Kaleidoscope', exact: true }).click();
        assert.ok(await page.getByRole('switch', { name: 'Tint', exact: true }).isChecked());
        assert.ok(await slider('Tint strength').isEnabled());
        const legacyEffects = saved.effects.map((effect) => {
          const params = { ...effect.params };
          delete params.tintEnabled;
          return { ...effect, params };
        });
        const presetPath = resolve(output, label + '-legacy-tint.gleechpreset');
        await writeFile(
          presetPath,
          JSON.stringify({
            format: 'gleech-preset',
            schemaVersion: 1,
            rendererVersion: 1,
            preset: {
              schemaVersion: 1,
              id: 'legacy-tint',
              name: 'Legacy tint',
              createdAt: new Date().toISOString(),
              effects: legacyEffects,
              masterSeed: saved.seed,
              thumbnail: 'data:image/png;base64,' + (await readFile(imagePath)).toString('base64'),
            },
          }),
        );
        await chooseOpen(presetPath);
        await fileAction(page, 'Import Preset');
        await status('Imported preset Legacy tint');
        await page.getByRole('button', { name: 'Apply Legacy tint', exact: true }).click();
        await page
          .locator('.preset-flyout')
          .getByRole('button', { name: 'Replace All', exact: true })
          .click();
        assert.deepEqual((await state()).effects, legacyEffects);
        assert.ok(await page.getByRole('switch', { name: 'Tint', exact: true }).isChecked());
        const legacyPixels = await exportExact();
        await page.getByRole('switch', { name: 'Tint', exact: true }).uncheck();
        assert.ok(!(await exportExact()).equals(legacyPixels));
      }
    } else {
      assert.equal(await tint.count(), 0);
      await exportExact();
    }
  }
  return { colors, tintFilters };
}
try {
  await configure();
  if (colorTintOnly) {
    const result = await inspectColorTintControls();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mode: label, ...result, exports, result: 'passed' }));
  } else if (visualOnly) {
    await inspectStatueFilters();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mode: label, filters: 3, visualOnly: true, result: 'passed' }));
  } else {
    await inspectColorTintControls();
    while (await page.locator('.effect-row').count()) await deleteFirstEffect(page);
    await chooseOpen(imagePath);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await status('Opened ' + basename(imagePath));
    await settle();
    const contentWidth = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(960, 640);
      return window.getContentSize()[0];
    });
    await page.waitForFunction((width) => innerWidth === width, contentWidth);
    await add('Halftone', 'halftone');
    await slider('Spacing').fill('6');
    await slider('Rotation').fill('0');
    const dots = await exportExact();
    await choose('Style', 'lines');
    const lines = await exportExact();
    assert.ok(!dots.equals(lines));
    await slider('Rotation').fill('90');
    assert.ok(!(await exportExact()).equals(lines));
    await slider('Rotation').fill('35');
    await slider('Contrast').fill('1.75');
    assert.equal(
      await slider('Contrast').locator('..').locator('output').textContent(),
      '1.75\u00d7',
    );
    const beforeSize = await state();
    await slider('Size').dispatchEvent('pointerdown');
    await slider('Size').fill('0.6');
    await slider('Size').fill('0.85');
    await slider('Size').dispatchEvent('pointerup');
    const afterSize = await state();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), beforeSize);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), afterSize);
    await color('Ink color', '#204080');
    await color('Paper color', '#f0b040');
    for (const mode of ['normal', 'multiply', 'screen', 'add', 'overlay', 'difference']) {
      await choose('Blend mode', mode);
      await exportExact();
    }
    await choose('Style', 'dots');
    await choose('Blend mode', 'normal');
    await maskAndAmount();
    await screenshot('halftone-controls');
    console.log(label + ': halftone dots/lines, controls, six blends, colors and masks passed');

    await add('Mirroring', 'mirroring');
    assert.ok(await slider('Position X').isEnabled());
    assert.ok(await slider('Position Y').isDisabled());
    assert.ok(await slider('Rotation').isDisabled());
    await slider('Position X').fill('30');
    const left = await exportExact();
    await choose('Source side', 'opposite');
    assert.ok(!(await exportExact()).equals(left));
    await choose('Source side', 'first');
    await choose('Axis', 'horizontal');
    assert.ok(await slider('Position X').isDisabled());
    assert.ok(await slider('Position Y').isEnabled());
    await slider('Position Y').fill('65');
    await exportExact();
    await choose('Axis', 'angled');
    assert.ok(await slider('Rotation').isEnabled());
    assert.ok(await slider('Position X').isEnabled());
    assert.ok(await slider('Position Y').isEnabled());
    await slider('Rotation').fill('37');
    for (const mode of ['extend', 'wrap', 'mirror']) {
      await choose('Edge Handling', mode);
      await exportExact();
    }
    await placementControls();
    await color('Tint color', '#e08040');
    await slider('Tint strength').fill('0.4');
    await choose('Blend mode', 'screen');
    await maskAndAmount();
    await screenshot('mirroring-controls');
    console.log(label + ': reflection axes, source sides, positions, edges, tint and masks passed');

    await add('Kaleidoscope', 'kaleidoscope');
    await slider('Segments').fill('8');
    await slider('Rotation').fill('27');
    await slider('Center X').fill('40');
    await slider('Center Y').fill('65');
    const beforeZoom = await state();
    await slider('Zoom').dispatchEvent('pointerdown');
    await slider('Zoom').fill('1.5');
    await slider('Zoom').fill('2');
    await slider('Zoom').dispatchEvent('pointerup');
    assert.equal(await slider('Zoom').locator('..').locator('output').textContent(), '2.00\u00d7');
    const afterZoom = await state();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), beforeZoom);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), afterZoom);
    await exportExact();
    await slider('Zoom').fill('0.5');
    for (const mode of ['extend', 'wrap', 'mirror']) {
      await choose('Edge Handling', mode);
      await exportExact();
    }
    await placementControls();
    await color('Tint color', '#40a0f0');
    await slider('Tint strength').fill('0.65');
    await choose('Blend mode', 'difference');
    await maskAndAmount();
    await screenshot('kaleidoscope-controls');
    const beforeOrder = await state();
    const originalOrder = await exportExact();
    await page.getByRole('button', { name: 'Reorder Kaleidoscope 1', exact: true }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    const afterOrder = await state();
    assert.notDeepEqual(
      afterOrder.effects.map((effect) => effect.type),
      beforeOrder.effects.map((effect) => effect.type),
    );
    assert.ok(!(await exportExact()).equals(originalOrder));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), beforeOrder);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), afterOrder);
    console.log(
      label +
        ': kaleidoscope sectors, rotation, centers, zoom, edges, tint, masks and reordering passed',
    );
    const savedRecipe = await state();
    const stacked = await exportExact();
    await chooseSave(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status('Saved ' + basename(projectPath));
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await picker('Presets');
    await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Preset name', exact: true })
      .fill('Print reflection test');
    await page
      .getByRole('img', { name: 'Statue preset preview', exact: true })
      .waitFor({ timeout: 30000 });
    const preview = await page
      .getByRole('img', { name: 'Current image preset preview', exact: true })
      .getAttribute('src');
    assert.ok(
      (
        await sharp(Buffer.from(preview.split(',')[1], 'base64'))
          .raw()
          .toBuffer()
      ).equals(stacked),
    );
    await page.getByRole('radio', { name: 'Statue', exact: true }).check();
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await status('Saved preset Print reflection test');
    await page.getByRole('button', { name: 'Apply Print reflection test', exact: true }).waitFor();
    const stored = JSON.parse(await readFile(resolve(profile, 'presets.json'), 'utf8')).presets[0];
    assert.deepEqual(stored.effects, savedRecipe.effects);
    assert.equal(stored.thumbnailSource, 'statue');
    const presetPath = resolve(output, label + '.gleechpreset');
    await chooseSave(presetPath);
    await page
      .getByRole('button', { name: 'Export preset Print reflection test', exact: true })
      .click();
    await status('Exported preset ' + basename(presetPath));
    assert.deepEqual(
      JSON.parse(await readFile(presetPath, 'utf8')).preset.effects,
      savedRecipe.effects,
    );
    await page.keyboard.press('Escape');
    await chooseOpen(presetPath);
    await fileAction(page, 'Import Preset');
    await status('Imported preset Print reflection test (2)');
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
    await page
      .getByRole('button', { name: 'Apply Print reflection test (2)', exact: true })
      .click();
    await page
      .locator('.preset-flyout')
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    assert.deepEqual(await state(), savedRecipe);
    assert.ok((await exportExact()).equals(stacked));
    for (const [title, type] of [
      ['Halftone', 'halftone'],
      ['Mirroring', 'mirroring'],
      ['Kaleidoscope', 'kaleidoscope'],
    ]) {
      await page.getByRole('button', { name: title, exact: true }).click();
      await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
      assert.deepEqual(
        (await state()).effects.find((effect) => effect.type === type).params,
        defaults.get(type),
      );
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.deepEqual(await state(), savedRecipe);
    }
    await inspectStatueFilters();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        mode: label,
        exports,
        filters: 3,
        restart: true,
        undoRedo: true,
        presets: 'save/statue/export/import/apply',
        result: 'passed',
      }),
    );
  }
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
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await closeTestApp(app);
}
