import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, basename } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { createEffect, renderEffects } from './effects-reference.mjs';
const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe')),
  cpu = process.argv.includes('--cpu');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve('test-results/mixed-stacks');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [
    ...(exe ? [] : [resolve('apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
  ...(exe ? { executablePath: resolve(exe) } : {}),
});
const width = 2048,
  height = 1536;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 128, 255, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const input = resolve(output, `${label}-input.png`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(input);
const png = await readFile('apps/desktop/resources/depth-maps/ridged-terrain.png');
const map = Uint8Array.from(await sharp(png).ensureAlpha().raw().toBuffer()).buffer;
const fieldImage = {
  source: {
    id: 'depth-map-v1:ridged-terrain',
    name: 'Ridged Terrain.png',
    width: 2048,
    height: 2048,
    format: 'png',
    hasAlpha: false,
  },
  png: 'data:image/png;base64,' + png.toString('base64'),
};
const e = (type, params = {}) => ({
  ...createEffect(type, type),
  params: { ...createEffect(type, type).params, ...params },
});
const field = { fieldSource: 'image', fieldScale: 100, fieldSmoothing: 2 };
const imported = (type, params) => ({ ...e(type, { ...field, ...params }), fieldImage });
const cases = {
  photographic: [
    e('photo-adjustments'),
    e('blur', { radius: 2, style: 'lens' }),
    e('noise-grain', { style: 'voronoi', scale: 8 }),
    e('halation'),
    e('glow', { radius: 1.5 }),
  ],
  'imported-depth': [
    imported('depth-parallax', { cameraX: 8 }),
    imported('blur', { style: 'depth', radius: 3 }),
    imported('depth-haze', { density: 0.5 }),
    imported('depth-color-map', { amount: 0.3 }),
  ],
  'recursive-damage': [
    e('noise-grain', { style: 'perlin' }),
    e('feedback-bloom', { style: 'melt', iterations: 8 }),
    e('recursive-space', { fieldEnabled: 'on', fieldSource: 'simplex' }),
    e('compression-breakup'),
  ],
};
const thumbnail = JSON.parse(await readFile('apps/desktop/resources/presets/built-in.json', 'utf8'))
  .presets[0].thumbnail;
let page;
const errors = [],
  measurements = [];
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
    { timeout: 180000 },
  );
}
async function state() {
  await settle();
  return page.locator('.image-layer').evaluate((node) => ({
    effects: JSON.parse(node.dataset.renderRecipe),
    masterSeed: Number(node.dataset.renderSeed),
  }));
}
async function apply(name) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: `Apply Benchmark ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  await settle();
}
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, input);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await settle();
  for (const [name, effects] of Object.entries(cases)) {
    const saved = await page.evaluate(
      async ({ name, effects, thumbnail }) =>
        window.gleech.storePreset(
          { masterSeed: 8172, effects },
          `Benchmark ${name}`,
          thumbnail,
          'statue',
        ),
      { name, effects, thumbnail },
    );
    assert.equal(saved.ok, true);
  }
  // Seed all fixtures before the catalog takes its first library snapshot.
  for (const name of Object.keys(cases)) {
    await apply(name);
    const before = await state();
    const frames = Number(
      await page.locator('.image-layer').getAttribute('data-interactive-frames'),
    );
    const during = await page
      .getByRole('slider', { name: 'Opacity', exact: true })
      .evaluate(async (slider) => {
        slider.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }),
        );
        for (let i = 0; i < 50; i++) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
            slider,
            String(0.4 + i / 100),
          );
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((done) => setTimeout(done, 60));
        }
        const data = { ...document.querySelector('.image-layer').dataset };
        slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
        return data;
      });
    assert.ok(
      Number(during.interactiveFrames) >= frames + 5,
      'Mixed stack keeps painting during a long gesture',
    );
    assert.equal(during.previewQuality, 'interactive');
    assert.ok(Number(during.previewWidth) >= 96 && Number(during.previewWidth) <= 256);
    await settle();
    const after = await state(),
      refined = await page.locator('.image-layer').evaluate((node) => ({ ...node.dataset }));
    assert.equal(Number(refined.previewWidth), width);
    assert.equal(refined.previewQuality, 'full');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), before);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), after);
    const path = resolve(output, `${label}-${name}.png`);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
    await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
    await page
      .getByRole('status')
      .filter({ hasText: 'Exported ' + basename(path) })
      .waitFor({ timeout: 180000 });
    const layers = new Map([[fieldImage.source.id, { width: 2048, height: 2048, pixels: map }]]);
    const expected = renderEffects({ width, height, pixels: pixels.buffer }, after.effects, {
      masterSeed: after.masterSeed,
      layerImages: layers,
    });
    assert.ok(
      (await sharp(path).ensureAlpha().raw().toBuffer()).equals(Buffer.from(expected.pixels)),
      'Adaptive drafts retain exact full-resolution export',
    );
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await settle();
    assert.equal(await page.locator('.image-layer').getAttribute('data-render-mode'), 'original');
    await page.getByRole('button', { name: 'Edited', exact: true }).click();
    await settle();
    assert.equal(await page.locator('.image-layer').getAttribute('data-preview-cache'), 'hit');
    const row = {
      name,
      sourceWidth: width,
      sourceHeight: height,
      liveFrames: Number(during.interactiveFrames) - frames,
      draftWidth: Number(during.previewWidth),
      draftMs: Number(during.interactiveRenderMs),
      fullMs: Number(refined.renderMs),
      cancelled: Number(refined.cancelledPreviews),
      exactExport: true,
      history: true,
      comparisonCache: true,
    };
    measurements.push(row);
    console.log(JSON.stringify(row));
  }
  assert.deepEqual(errors, []);
  assert.ok(
    measurements.some((row) => row.draftWidth < 256),
    'Expensive mixed drafts adapt their resolution',
  );
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify({ mode: cpu ? 'cpu' : 'auto', measurements, errors }, null, 2),
  );
} finally {
  await closeTestApp(app);
}
