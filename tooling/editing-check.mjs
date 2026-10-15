import { fileAction } from './file-action.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/editing-check');
await mkdir(output, { recursive: true });
const smallPath = resolve(output, 'alpha.png');
const largePath = resolve(output, 'large.png');
const rgba = Buffer.alloc(257 * 129 * 4);
for (let y = 0; y < 129; y++)
  for (let x = 0; x < 257; x++) {
    const index = (y * 257 + x) * 4;
    rgba.set(
      [(x * 17) % 256, (y * 23) % 256, ((x ^ y) * 13) % 256, [0, 1, 64, 128, 254, 255][x % 6]],
      index,
    );
  }
await sharp(rgba, { raw: { width: 257, height: 129, channels: 4 } })
  .png()
  .toFile(smallPath);
await sharp(
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="3072">
  <defs><linearGradient id="a"><stop stop-color="#231a24"/><stop offset="1" stop-color="#ce9449"/></linearGradient></defs>
  <rect x="160" y="160" width="3776" height="2752" rx="48" fill="url(#a)"/>
  <circle cx="2048" cy="1536" r="940" fill="#f1cc6b"/><circle cx="2048" cy="1536" r="710" fill="#211d28"/>
  <g stroke="#f1cc6b" stroke-width="36"><path d="M850 1150H3250M850 1536H3250M850 1920H3250"/></g>
  <rect x="2640" y="630" width="480" height="1800" fill="#b87755" fill-opacity=".65"/>
</svg>`),
)
  .png()
  .toFile(largePath);
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const forceCpu = process.argv.includes('--cpu');
const label = `${executablePath ? 'packaged-' : ''}${forceCpu ? 'cpu' : 'auto'}`;
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(env.GLEECH_SMOKE_USER_DATA, { recursive: true });
const app = await electron.launch({
  args: [
    ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
    '--smoke-test',
    ...(forceCpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
  timeout: 30000,
});
const errors = [];
const metrics = { mode: label };
let exports = 0;
let page;
let checkpoint = 'startup';

try {
  page = await app.firstWindow();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  // Fixed IDs make the auto and forced CPU runs directly comparable.
  await page.evaluate(() => {
    let sequence = 0;
    Object.defineProperty(crypto, 'randomUUID', { value: () => `editing-fixture-${++sequence}` });
  });
  const layer = page.getByTestId('image-layer');
  const stage = page.getByLabel('Pan and zoom image');
  const seed = page.getByRole('spinbutton', { name: 'Master seed' });
  async function settle() {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.waitForFunction(
      () => {
        const data = document.querySelector('.image-layer').dataset;
        return (
          data.renderRevision === data.requestedRevision &&
          data.renderSeed === document.querySelector('[aria-label="Master seed"]').value &&
          !document.querySelector('.detail-loading')
        );
      },
      undefined,
      { timeout: 30000 },
    );
  }
  async function state() {
    await settle();
    return layer.evaluate((element) => ({
      effects: JSON.parse(element.dataset.renderRecipe),
      seed: Number(element.dataset.renderSeed),
      mode: element.dataset.renderMode,
    }));
  }
  async function open(path) {
    checkpoint = `Open ${path.split(/[\\/]/).at(-1)}`;
    await app.evaluate(({ dialog }, path) => {
      globalThis.__editingOpenDialog = { path, calls: 0 };
      dialog.showOpenDialog = async () => {
        globalThis.__editingOpenDialog.calls++;
        return { canceled: false, filePaths: [path] };
      };
    }, path);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await page
      .getByRole('status')
      .filter({ hasText: `Opened ${path.split(/[\\/]/).at(-1)}` })
      .waitFor();
    await settle();
  }
  async function add(title) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page
      .locator('.effect-picker')
      .getByRole('button', { name: new RegExp(`^${title}`) })
      .click();
    await settle();
  }
  async function exportImage(width, height, original, recipe = null) {
    checkpoint = `Export ${width} × ${height}`;
    const snapshot = recipe ?? (await state());
    const path = resolve(output, `${label}-${++exports}.png`);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, path);
    const started = Date.now();
    await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
    await page
      .getByRole('status')
      .filter({ hasText: `Exported ${path.split(/[\\/]/).at(-1)}` })
      .waitFor({ timeout: 60000 });
    const exported = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(exported.info.width, width);
    assert.equal(exported.info.height, height);
    const input = {
      width,
      height,
      pixels: original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength),
    };
    const expected = Buffer.from(
      renderEffects(input, snapshot.effects, { masterSeed: snapshot.seed, reference: input })
        .pixels,
    );
    assert.ok(
      exported.data.equals(expected),
      `Worker/export did not match the shared recipe: ${path}`,
    );
    assert.equal(await page.getByRole('alert').count(), 0);
    return { pixels: exported.data, ms: Date.now() - started };
  }
  async function capture(rect = undefined) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    return Buffer.from(
      await app.evaluate(
        async ({ BrowserWindow }, rect) =>
          (await BrowserWindow.getAllWindows()[0].capturePage(rect, { stayAwake: true }))
            .toPNG()
            .toString('base64'),
        rect,
      ),
      'base64',
    );
  }
  async function undo() {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settle();
  }

  await open(smallPath);
  metrics.backend = await page.locator('footer').getAttribute('data-render-backend');
  if (forceCpu) assert.equal(metrics.backend, 'cpu');
  if (process.env.GLEECH_REQUIRE_WEBGPU === '1' && !forceCpu)
    assert.equal(metrics.backend, 'webgpu');
  await add('RGB split');
  await page.getByRole('slider', { name: 'Horizontal shift' }).fill('5');
  await add('Block corruption');
  await page.getByRole('slider', { name: 'Density' }).fill('0.7');
  await page.getByRole('slider', { name: 'Displacement' }).fill('20');
  await add('Spatial crush');
  await page.getByRole('slider', { name: 'Block size' }).fill('8');
  await page.getByRole('combobox', { name: 'Sampling' }).selectOption('random');
  const baseline = await state();
  assert.equal(baseline.effects.length, 3);
  const baselineExport = await exportImage(257, 129, rgba);
  assert.ok(!baselineExport.pixels.equals(rgba));
  await page.getByRole('button', { name: 'Actual pixels', exact: true }).click();
  const transform = await layer.evaluate((element) => getComputedStyle(element).transform);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  assert.equal((await state()).mode, 'original');
  assert.equal(await layer.evaluate((element) => getComputedStyle(element).transform), transform);
  assert.ok(
    (await exportImage(257, 129, rgba)).pixels.equals(baselineExport.pixels),
    'Original comparison changed export',
  );
  await page.getByRole('button', { name: 'Edited', exact: true }).click();
  await stage.focus();
  await page.keyboard.down('Space');
  await page.waitForFunction(
    () => document.querySelector('.image-layer').dataset.renderMode === 'original',
  );
  await page.keyboard.up('Space');
  await page.waitForFunction(
    () => document.querySelector('.image-layer').dataset.renderMode === 'edited',
  );
  assert.equal(await layer.evaluate((element) => getComputedStyle(element).transform), transform);

  await page.getByRole('button', { name: 'Random seed', exact: true }).click();
  assert.notEqual(Number(await seed.inputValue()), baseline.seed);
  assert.deepEqual((await state()).effects, baseline.effects);
  assert.ok(!(await exportImage(257, 129, rgba)).pixels.equals(baselineExport.pixels));
  await undo();
  assert.equal(Number(await seed.inputValue()), baseline.seed);
  assert.ok((await exportImage(257, 129, rgba)).pixels.equals(baselineExport.pixels));
  await page.getByRole('button', { name: 'New pattern', exact: true }).click();
  assert.equal((await state()).effects[2].seedOffset, 1);
  assert.ok(!(await exportImage(257, 129, rgba)).pixels.equals(baselineExport.pixels));
  await undo();
  for (const sampling of ['average', 'nearest']) {
    await page.getByRole('combobox', { name: 'Sampling' }).selectOption(sampling);
    await exportImage(257, 129, rgba);
    await undo();
    assert.equal(await page.getByRole('combobox', { name: 'Sampling' }).inputValue(), 'random');
  }
  await page.getByRole('slider', { name: 'Block size' }).fill('11');
  await page.getByRole('button', { name: 'Reset controls', exact: true }).click();
  assert.equal(await page.getByRole('slider', { name: 'Block size' }).inputValue(), '2');
  await undo();
  assert.equal(await page.getByRole('slider', { name: 'Block size' }).inputValue(), '11');
  await undo();
  assert.deepEqual((await state()).effects, baseline.effects);
  const reorderTarget = page.locator('.effect-row').nth(1);
  const reorderBounds = await reorderTarget.boundingBox();
  await page
    .getByRole('button', { name: 'Reorder Spatial crush 1', exact: true })
    .dragTo(reorderTarget, { targetPosition: { x: 25, y: reorderBounds.height - 3 } });
  assert.deepEqual(
    (await state()).effects.map((effect) => effect.instanceId),
    [
      baseline.effects[0].instanceId,
      baseline.effects[2].instanceId,
      baseline.effects[1].instanceId,
    ],
  );
  assert.ok(!(await exportImage(257, 129, rgba)).pixels.equals(baselineExport.pixels));
  await undo();
  await page.locator('.effect-row').nth(1).locator('.effect-select').click();
  await page.getByRole('button', { name: 'Delete selected effect', exact: true }).click();
  assert.equal((await state()).effects.length, 2);
  await undo();
  assert.deepEqual((await state()).effects, baseline.effects);
  await page.getByRole('button', { name: 'Enable Block corruption 2', exact: true }).click();
  await exportImage(257, 129, rgba);
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual((await state()).effects, baseline.effects);
  await page.keyboard.press('Control+y');
  await settle();
  assert.equal((await state()).effects[1].enabled, false);
  await undo();

  await open(largePath);
  assert.equal(
    await page.locator('.image-surface canvas').evaluate((canvas) => canvas.width),
    2048,
  );
  const largePixels = await sharp(largePath).ensureAlpha().raw().toBuffer();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const bounds = await stage.boundingBox();
  // Compare artwork rather than the Original badge or the status/zoom overlays.
  // Exporting changes the persistent footer text even when image pixels match.
  const topInset = 60;
  const bottomInset = 100;
  const crop = {
    x: Math.ceil(bounds.x),
    y: Math.ceil(bounds.y + topInset),
    width: Math.floor(bounds.width - 2),
    height: Math.floor(bounds.height - topInset - bottomInset),
  };
  const edited = await capture(crop);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await settle();
  const originalView = await capture(crop);
  assert.ok(!edited.equals(originalView), 'Comparison did not change the visible image');
  metrics.largeExportMs = (await exportImage(4096, 3072, largePixels)).ms;
  await page.getByRole('button', { name: 'Edited', exact: true }).click();
  for (const title of ['RGB split 3', 'Block corruption 2', 'Spatial crush 1'])
    await page.getByRole('button', { name: `Enable ${title}`, exact: true }).click();
  await settle();
  const disabled = await capture(crop);
  const originalDecoded = await sharp(originalView).raw().toBuffer();
  const disabledDecoded = await sharp(disabled).raw().toBuffer();
  if (!disabledDecoded.equals(originalDecoded)) {
    await writeFile(resolve(output, `${label}-original-preview.png`), originalView);
    await writeFile(resolve(output, `${label}-disabled-preview.png`), disabled);
  }
  assert.ok(
    disabledDecoded.equals(originalDecoded),
    'Original view did not match the source with all effects disabled',
  );
  await exportImage(4096, 3072, largePixels);
  for (const title of ['RGB split 3', 'Block corruption 2', 'Spatial crush 1'])
    await page.getByRole('button', { name: `Enable ${title}`, exact: true }).click();
  await settle();

  // Cancel full-detail refinements; small interactive drafts intentionally finish.
  await page.getByRole('button', { name: 'Actual pixels', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.image-surface canvas').width === 4096);
  await settle();
  // Undo restores the deleted layer's selection; target this burst explicitly.
  await page
    .locator('.effect-row')
    .filter({ hasText: 'Spatial crush' })
    .locator('.effect-select')
    .click();
  const cancelledBefore = Number(await layer.getAttribute('data-cancelled-previews'));
  const slider = page.getByRole('slider', { name: 'Block size' });
  const start = Date.now();
  // Start each edit as soon as the preceding full-detail preview is posted. Automation
  // round trips and hidden-window animation frames can otherwise outlast a render.
  const burst = await slider.evaluate(async (input) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const values = ['3', '14', '5', '12', '8.1'];
    const postMessage = Worker.prototype.postMessage;
    let previews = 0;
    let cancellations = 0;
    let timer;
    const edit = () => {
      setValue.call(input, values.shift());
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('The rapid preview edit burst timed out.')),
          15000,
        );
        Worker.prototype.postMessage = function (message, ...args) {
          const result = postMessage.call(this, message, ...args);
          if (message.kind === 'cancel') cancellations++;
          if (
            message.kind === 'render' &&
            message.purpose === 'preview' &&
            !message.previewMaxDimension
          ) {
            previews++;
            if (values.length) queueMicrotask(edit);
            else resolve({ previews, cancellations });
          }
          return result;
        };
        edit();
      });
    } finally {
      clearTimeout(timer);
      Worker.prototype.postMessage = postMessage;
    }
  });
  assert.equal(burst.previews, 5);
  assert.ok(burst.cancellations > 0, 'Rapid edits did not request cancellation of a real preview');
  // Pan remains interactive while the CPU worker is processing the new recipe.
  const panBefore = await layer.evaluate(
    (element) => new DOMMatrix(getComputedStyle(element).transform).e,
  );
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 100, bounds.y + bounds.height / 2 + 60, {
    steps: 20,
  });
  await page.mouse.up();
  await page.waitForFunction(
    (before) =>
      Math.abs(
        new DOMMatrix(getComputedStyle(document.querySelector('.image-layer')).transform).e -
          before -
          100,
      ) < 2,
    panBefore,
  );
  await settle();
  const latest = await state();
  assert.equal(latest.effects[2].params.blockSize, 8.1);
  metrics.rapidEditMs = Date.now() - start;
  metrics.cancelledPreviews =
    Number(await layer.getAttribute('data-cancelled-previews')) - cancelledBefore;
  assert.ok(metrics.cancelledPreviews > 0, 'No active preview was actually cancelled');
  await page.waitForTimeout(200);
  assert.deepEqual(await state(), latest, 'An older preview overwrote the newest render');
  metrics.fullPreviewMs = Number(await layer.getAttribute('data-render-ms'));
  metrics.fullExportMs = (await exportImage(4096, 3072, largePixels)).ms;
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await writeFile(resolve(output, `${label}-workspace.png`), await capture());
  // Verify the viewport tools also fit the supported minimum window size.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  await page.waitForTimeout(100);
  assert.ok(
    await page
      .locator('.viewport-tools')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  );
  await writeFile(resolve(output, `${label}-compact.png`), await capture());

  if (metrics.backend === 'webgpu') {
    await page
      .locator('.image-surface canvas')
      .evaluate((canvas) => canvas.getContext('webgpu').getConfiguration().device.destroy());
    await page.waitForFunction(
      () => document.querySelector('footer').dataset.renderBackend === 'cpu',
    );
    assert.deepEqual((await state()).effects, latest.effects);
    await exportImage(4096, 3072, largePixels);
    metrics.deviceLossRecovery = true;
  }
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
  metrics.exports = exports;
  await writeFile(resolve(output, `${label}-metrics.json`), JSON.stringify(metrics, null, 2));
  console.log('Editing checkpoint passed:', JSON.stringify(metrics));
} catch (failure) {
  const diagnostics = {
    checkpoint,
    error: failure instanceof Error ? failure.stack : String(failure),
    errors,
    metrics,
  };
  const captures = await Promise.allSettled([
    page?.evaluate(() => ({
      title: document.title,
      busy: document.querySelector('[aria-busy]')?.getAttribute('aria-busy'),
      statuses: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
      layer: { ...document.querySelector('.image-layer')?.dataset },
      menu: document.querySelector('.file-menu-items')?.textContent,
    })),
    app.evaluate(() => globalThis.__editingOpenDialog),
    page?.screenshot({ path: resolve(output, `${label}-failure.png`), timeout: 5000 }),
  ]);
  diagnostics.renderer =
    captures[0].status === 'fulfilled' ? captures[0].value : String(captures[0].reason);
  diagnostics.openDialog =
    captures[1].status === 'fulfilled' ? captures[1].value : String(captures[1].reason);
  await writeFile(resolve(output, `${label}-failure.json`), JSON.stringify(diagnostics, null, 2));
  throw failure;
} finally {
  await closeTestApp(app);
}
