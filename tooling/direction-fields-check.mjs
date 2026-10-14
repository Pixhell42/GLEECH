import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { createEffect, renderEffects, modelUrl } from './effects-reference.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
const { DIRECTION_CONSUMERS, EFFECT_DEFINITIONS, directionFieldParams } = await import(modelUrl);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  output = resolve(root, 'test-results/direction-fields');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu'),
  label = cpu ? 'cpu' : 'gpu',
  executablePath = process.argv.slice(2).find((x) => x.endsWith('.exe'));
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const width = 83,
  height = 61,
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4] : (i * 37) % 256,
  ),
  image = { width, height, pixels: pixels.buffer };
const path = resolve(output, `${label}-input.png`),
  projectPath = resolve(output, `${label}.gleech`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(path);
const mapBytes = Uint8Array.from([
  255, 128, 128, 255, 128, 255, 128, 255, 0, 128, 128, 255, 128, 0, 128, 255,
]);
const mapPng = await sharp(mapBytes, { raw: { width: 2, height: 2, channels: 4 } })
  .png()
  .toBuffer();
const map = {
    source: {
      id: 'test-vector',
      name: 'test-vector.png',
      width: 2,
      height: 2,
      format: 'png',
      hasAlpha: true,
    },
    png: 'data:image/png;base64,' + mapPng.toString('base64'),
  },
  decoded = { width: 2, height: 2, pixels: mapBytes.buffer };
const worker = (await readdir(resolve(root, 'apps/desktop/out/renderer/assets'))).find((x) =>
  /^effect-worker-.*\.js$/.test(x),
);
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, `${label}-profile-`)),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  args: [
    ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
});
let cases = 0;
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640);
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1 });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  for (const type of DIRECTION_CONSUMERS) {
    const base = createEffect(type, 'direction-native');
    for (const source of [
      'native',
      'linear',
      'radial',
      'toward',
      'circular',
      'spiral',
      'perspective',
      'flow',
      'depth-gradient',
      'image',
    ]) {
      const effect = {
        ...base,
        ...(source === 'image' ? { directionImage: map } : {}),
        application: { region: 'left', coverage: 0.8, softness: 0.3 },
        params: {
          ...base.params,
          ...(type === 'glyph' ? { cellSize: 9 } : {}),
          ...(type === 'pixel-sort'
            ? { thresholdStart: 0, thresholdEnd: 1, length: 100, density: 1, breakup: 0 }
            : {}),
          directionSource: source,
          directionSeed: 123,
          directionRotation: 27,
        },
      };
      const actual = await page.evaluate(
        async ({ worker, effect, width, height, pixels, mapBytes }) => {
          const instance = (window.__directionWorker ??= new Worker(
            new URL(worker, location.href),
            { type: 'module' },
          ));
          const reply = await new Promise((resolve, reject) => {
            instance.onmessage = (e) => resolve(e.data);
            instance.onerror = (e) => reject(new Error(e.message));
            instance.postMessage({
              kind: 'render',
              id: 1,
              image: { width, height, pixels: Uint8Array.from(pixels).buffer },
              effects: [effect],
              layerImages: effect.directionImage
                ? [
                    {
                      id: 'test-vector',
                      image: { width: 2, height: 2, pixels: Uint8Array.from(mapBytes).buffer },
                    },
                  ]
                : [],
              masterSeed: 8172,
              reference: { width, height },
              purpose: 'export',
            });
          });
          if (reply.kind !== 'success') throw new Error(reply.error);
          return [...new Uint8Array(reply.image.pixels)];
        },
        {
          worker: `assets/${worker}`,
          effect,
          width,
          height,
          pixels: [...pixels],
          mapBytes: [...mapBytes],
        },
      );
      const expected = new Uint8Array(
        renderEffects(image, [effect], {
          masterSeed: 8172,
          layerImages: new Map([['test-vector', decoded]]),
        }).pixels,
      );
      assert.deepEqual(actual, [...expected], `${type}/${source}`);
      cases++;
    }
    console.log(JSON.stringify({ type, cases }));
  }
  async function settle() {
    await page.waitForFunction(() => {
      const n = document.querySelector('.image-layer');
      return (
        n?.dataset.renderRevision === n?.dataset.requestedRevision &&
        JSON.parse(n?.dataset.renderRecipe ?? '[]').length ===
          document.querySelectorAll('.effect-row').length &&
        !document.querySelector('.detail-loading')
      );
    });
  }
  async function state() {
    await settle();
    return page.locator('.image-layer').evaluate((n) => JSON.parse(n.dataset.renderRecipe));
  }
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened ' + basename(path) })
    .waitFor();
  for (const type of DIRECTION_CONSUMERS) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.getByRole('tab', { name: 'Effects', exact: true }).click();
    await page
      .locator('.effect-picker')
      .getByRole('button', { name: EFFECT_DEFINITIONS[type].title, exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Direction field', exact: true })
      .selectOption('spiral');
    await page.getByRole('slider', { name: 'Spiral twist', exact: true }).fill('0.7');
    await page.getByRole('slider', { name: 'Field position X', exact: true }).fill('37');
    const size = await page
      .locator('.effect-detail')
      .evaluate((n) => ({ width: n.clientWidth, scroll: n.scrollWidth }));
    assert.ok(size.scroll <= size.width + 1);
    await settle();
  }
  const copy = page.getByRole('combobox', { name: 'Copy direction field from', exact: true });
  assert.equal(await copy.locator('option').count(), DIRECTION_CONSUMERS.length);
  await copy.selectOption({ index: 1 });
  let effects = await state();
  assert.equal(effects.length, DIRECTION_CONSUMERS.length);
  const copied = directionFieldParams(effects.at(-1).params);
  assert.equal(copied.directionX, 37);
  assert.equal(copied.directionSource, 'spiral');
  await page.getByRole('slider', { name: 'Field position X', exact: true }).fill('62');
  effects = await state();
  assert.equal(effects.at(-1).params.directionX, 62);
  assert.equal(effects[0].params.directionX, 37);
  const mapActions = page.locator('.direction-field-controls .depth-map-actions');
  assert.equal(await mapActions.getByRole('button', { name: 'Import', exact: true }).count(), 1);
  assert.ok(
    await mapActions
      .locator('button')
      .evaluateAll((buttons) =>
        buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
      ),
    'Direction map button labels fit at minimum window size',
  );
  await mapActions.getByRole('button', { name: 'Starter Maps', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Starter vector maps', exact: true });
  await picker.locator('.depth-map-grid button').first().waitFor();
  assert.equal(await picker.locator('.depth-map-grid button').count(), 40);
  await picker.getByRole('button', { name: /Pinwheel Sectors/ }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Added direction map Pinwheel Sectors.png' })
    .waitFor();
  await settle();
  assert.equal((await state()).at(-1).directionImage.source.name, 'Pinwheel Sectors.png');
  await page.waitForFunction(
    (id) => {
      const canvas = document.querySelector('.direction-field-preview');
      if (!(canvas instanceof HTMLCanvasElement) || canvas.dataset.mapId !== id) return false;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let arrows = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 100 && pixels[i + 1] > 80 && pixels[i + 2] < pixels[i + 1]) arrows++;
      return arrows > 100;
    },
    (await state()).at(-1).directionImage.source.id,
  );
  await page.getByRole('button', { name: /Undo/ }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector('.image-layer')?.dataset.renderRecipe ?? '[]').at(-1)
        ?.params.directionSource === 'spiral',
  );
  await settle();
  assert.equal((await state()).at(-1).params.directionSource, 'spiral');
  await page.getByRole('button', { name: /Redo/ }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector('.image-layer')?.dataset.renderRecipe ?? '[]').at(-1)
        ?.params.directionSource === 'image',
  );
  await settle();
  assert.equal((await state()).at(-1).params.directionSource, 'image');
  const before = await state();
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await page
    .getByRole('status')
    .filter({ hasText: 'Saved ' + basename(projectPath) })
    .waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectPath);
  await fileAction(page, 'Open project Ctrl+O');
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened ' + basename(projectPath) })
    .waitFor();
  assert.deepEqual(await state(), before);
  const pngPath = resolve(output, `${label}-export.png`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, pngPath);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page
    .getByRole('status')
    .filter({ hasText: 'Exported ' + basename(pngPath) })
    .waitFor();
  assert.ok((await readFile(pngPath)).length > 0);
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Shared directions');
  await page.getByRole('img', { name: 'Statue preset preview', exact: true }).waitFor();
  await page.getByRole('radio', { name: 'Statue', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved preset Shared directions' }).waitFor();
  await page.getByRole('button', { name: 'Apply Shared directions', exact: true }).click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), before);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: label,
      cases,
      maps: 40,
      copy: true,
      history: true,
      project: true,
      preset: true,
      export: true,
      result: 'passed',
    }),
  );
} finally {
  await closeTestApp(app);
}
