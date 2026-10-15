import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}`;
const output = resolve(root, 'test-results/interactive-preview');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, label + '-profile-'));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 1024,
  height = 768;
const rgba = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    rgba.set(
      [
        (x * 17 + y * 7) % 256,
        (y * 23 + x * 3) % 256,
        ((x ^ y) * 13) % 256,
        [0, 1, 64, 128, 254, 255][x % 6],
      ],
      (y * width + x) * 4,
    );
const imagePath = resolve(output, label + '.png');
await sharp(rgba, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const app = await electron.launch({
  args: [
    ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  timeout: 30000,
});
let page;
const errors = [];
const measurements = [];
async function settle() {
  await page.waitForFunction(
    () => {
      const d = document.querySelector('.image-layer').dataset;
      return (
        d.renderRevision === d.requestedRevision &&
        d.previewQuality === 'full' &&
        !document.querySelector('.detail-loading')
      );
    },
    undefined,
    { timeout: 60000 },
  );
}
async function add(name) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.locator('.effect-picker').getByRole('button', { name, exact: true }).click();
  await settle();
}
async function liveDrag(name, start, end) {
  const before = await page
    .locator('.image-layer')
    .evaluate((e) => Number(e.dataset.interactiveFrames ?? 0));
  // Keep dispatching slider input faster than full-size rendering can finish.
  const during = await page.getByRole('slider', { name, exact: true }).evaluate(
    async (slider, [start, end]) => {
      slider.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }),
      );
      for (let i = 0; i < 40; i++) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          slider,
          String(start + ((end - start) * i) / 39),
        );
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const d = { ...document.querySelector('.image-layer').dataset };
      slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      return d;
    },
    [start, end],
  );
  assert.ok(
    Number(during.interactiveFrames) > before + 1,
    'Previews stopped painting during continuous changes',
  );
  assert.equal(during.previewQuality, 'interactive');
  assert.ok(
    Number(during.previewWidth) >= 96 && Number(during.previewWidth) <= 256,
    'Draft size remains bounded by its measured budget',
  );
  await settle();
  const after = await page.locator('.image-layer').evaluate((e) => ({ ...e.dataset }));
  assert.equal(Number(after.previewWidth), width);
  assert.equal(after.previewQuality, 'full');
  measurements.push({
    control: name,
    liveFrames: Number(during.interactiveFrames) - before,
    interactiveMs: Number(during.interactiveRenderMs),
    fullMs: Number(after.renderMs),
    cancelled: Number(after.cancelledPreviews),
  });
  return after;
}
try {
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, imagePath);
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page.getByRole('status').filter({ hasText: 'Opened ' }).waitFor();
  await add('Blur');
  const original = await page
    .locator('.image-layer')
    .evaluate((e) => JSON.parse(e.dataset.renderRecipe));
  let recipe = await liveDrag('Radius', 3, 9);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await settle();
  assert.deepEqual(
    await page.locator('.image-layer').evaluate((e) => JSON.parse(e.dataset.renderRecipe)),
    original,
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await settle();
  await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('lens');
  await settle();
  recipe = await liveDrag('Radius', 3, 8);
  const beforeCancel = await page.locator('.image-layer').evaluate((e) => ({
    frames: Number(e.dataset.interactiveFrames),
    cancelled: Number(e.dataset.cancelledPreviews),
  }));
  // Interrupt at the real full-detail request boundary. A fixed sleep can let
  // refinement finish first, especially on a fast or lightly loaded runner.
  const interruption = await page
    .getByRole('slider', { name: 'Radius', exact: true })
    .evaluate(async (slider) => {
      const postMessage = Worker.prototype.postMessage;
      const input = (value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          slider,
          value,
        );
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      };
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Full-detail request did not start')),
            30000,
          );
          Worker.prototype.postMessage = function (request, ...args) {
            const result = postMessage.call(this, request, ...args);
            if (
              request?.kind === 'render' &&
              request.purpose === 'preview' &&
              request.previewMaxDimension === undefined &&
              request.effects.some((effect) => effect.type === 'blur' && effect.params.radius === 7)
            ) {
              Worker.prototype.postMessage = postMessage;
              clearTimeout(timer);
              const frames = Number(
                document.querySelector('.image-layer').dataset.interactiveFrames,
              );
              input('6');
              resolve({ id: request.id, frames });
            }
            return result;
          };
          input('7');
        });
      } finally {
        Worker.prototype.postMessage = postMessage;
      }
    });
  assert.ok(
    interruption.frames > beforeCancel.frames,
    'Draft did not precede full-detail refinement',
  );
  await settle();
  assert.ok(
    Number(await page.locator('.image-layer').getAttribute('data-cancelled-previews')) >
      beforeCancel.cancelled,
    'Superseded full-detail rendering was not cancelled',
  );
  await add('Noise / Grain');
  await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('voronoi');
  await settle();
  recipe = await liveDrag('Scale', 5, 20);
  await add('Feedback Bloom / Melt');
  await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('melt');
  await page.getByRole('slider', { name: 'Iterations', exact: true }).fill('6');
  recipe = await liveDrag('Displacement', 1, 4);
  await add('Depth Field');
  await page.getByRole('combobox', { name: 'Field source', exact: true }).selectOption('perlin');
  await page.getByRole('combobox', { name: 'Treatment', exact: true }).selectOption('relief');
  recipe = await liveDrag('Field scale', 5, 20);
  await add('Recursive Space');
  await page.getByRole('combobox', { name: 'Depth field', exact: true }).selectOption('on');
  await page.getByRole('combobox', { name: 'Field source', exact: true }).selectOption('perlin');
  recipe = await liveDrag('Field repetition', 0.1, 0.8);
  await add('Compression Breakup');
  recipe = await liveDrag('Compression', 0.1, 0.9);
  const expected = Buffer.from(
    renderEffects(
      { width, height, pixels: Uint8Array.from(rgba).buffer },
      JSON.parse(recipe.renderRecipe),
      { masterSeed: Number(recipe.renderSeed) },
    ).pixels,
  );
  const exportPath = resolve(output, label + '-export.png');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page.getByRole('status').filter({ hasText: 'Exported ' }).waitFor({ timeout: 60000 });
  const decoded = await sharp(exportPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([decoded.info.width, decoded.info.height], [width, height]);
  assert.ok(decoded.data.equals(expected), 'Interactive preview altered full-size export pixels');
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.image-layer').getAttribute('data-render-mode'), 'original');
  await page.getByRole('button', { name: 'Edited', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.image-layer').getAttribute('data-preview-cache'), 'hit');
  if (cpu) {
    const pixels = await page
      .locator('.image-surface canvas')
      .evaluate((canvas) =>
        Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data),
      );
    // Canvas retains premultiplied display pixels, so export above is the exact
    // straight-alpha comparison; check visible opaque pixels here.
    for (let i = 0; i < pixels.length; i += 4)
      if (expected[i + 3] === 255)
        assert.deepEqual(pixels.slice(i, i + 4), Array.from(expected.subarray(i, i + 4)));
  }
  assert.deepEqual(errors, []);
  const report = {
    mode: label,
    measurements,
    fullDetailInterruption: interruption,
    fullSizeExport: true,
    undoRedo: true,
    comparisonCache: true,
    result: 'passed',
  };
  await writeFile(resolve(output, label + '-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
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
