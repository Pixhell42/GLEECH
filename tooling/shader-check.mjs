import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';
import { createEffect, renderEffects, modelUrl } from './effects-reference.mjs';
const { EFFECT_DEFINITIONS } = await import(modelUrl);
const shaderCount = Object.keys(EFFECT_DEFINITIONS).filter((type) =>
  type.startsWith('shader-'),
).length;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const output = resolve(root, 'test-results/shader-check');
await mkdir(output, { recursive: true });
const workerFile = (await readdir(resolve(root, 'apps/desktop/out/renderer/assets'))).find((name) =>
  /^effect-worker-.*\.js$/.test(name),
);
assert.ok(workerFile);
const cpu = process.argv.includes('--cpu'),
  label = cpu ? 'cpu' : 'gpu';
const largeOnly = process.argv.includes('--large-only');
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, `${label}-profile-`)),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const width = 129,
  height = 65,
  rgba = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    rgba.set(
      [(x * 17) % 256, (y * 23) % 256, ((x ^ y) * 13) % 256, [0, 1, 64, 128, 254, 255][x % 6]],
      (y * width + x) * 4,
    );
const imagePath = resolve(output, `${label}-input.png`),
  projectPath = resolve(output, `${label}.gleech`);
await sharp(rgba, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
let saved = null;
let app,
  page,
  exports = 0;
const errors = [];
const launch = async () => {
  app = await electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    args: [
      ...(executablePath ? [] : [resolve(root, 'apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
};
const open = (path) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
const save = (path) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 30000 });
async function settle() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
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
    backend: element.dataset.shaderBackend,
    reason: element.dataset.shaderReason,
  }));
}
async function add(name) {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  await page.getByRole('button', { name: /^Shaders/ }).click();
  assert.equal(await page.locator('.effect-tile').count(), shaderCount);
  const tile = page.locator('.effect-picker').getByRole('button', { name, exact: true });
  await tile.locator('img').evaluate((image) => {
    if (!image.complete || image.naturalWidth !== 384)
      throw new Error('Shader thumbnail is not bundled.');
  });
  await tile.click();
  await settle();
}
const gpuReferenceCache = new Map();
function parity(actual, expected, context) {
  let maximum = 0,
    alpha = 0;
  for (let i = 0; i < actual.length; i += 4) {
    alpha = Math.max(alpha, Math.abs(actual[i + 3] - expected[i + 3]));
    for (let c = 0; c < 3; c++)
      maximum = Math.max(
        maximum,
        Math.abs((actual[i + c] * actual[i + 3]) / 255 - (expected[i + c] * expected[i + 3]) / 255),
      );
  }
  assert.ok(maximum <= 3 && alpha <= 1, `${context}: visible ${maximum}, alpha ${alpha}`);
}
async function gpuReference(recipe) {
  let incoming = rgba;
  for (let index = 0; index < recipe.effects.length; index++) {
    const prefix = recipe.effects.slice(0, index + 1);
    const key = JSON.stringify({ seed: recipe.seed, effects: prefix });
    let result = gpuReferenceCache.get(key);
    if (!result) {
      const effect = recipe.effects[index];
      const rendered = await page.evaluate(
        async ({ path, pixels, width, height, effect, seed }) => {
          let harness = window.__shaderReference;
          if (!harness) {
            const worker = new Worker(new URL(path, location.href), { type: 'module' });
            harness = window.__shaderReference = { worker, pending: new Map(), id: 0 };
            worker.onmessage = (event) => {
              const reply = event.data,
                callback = harness.pending.get(reply.id);
              harness.pending.delete(reply.id);
              callback?.(reply);
            };
            worker.onerror = (event) => {
              for (const callback of harness.pending.values())
                callback({ kind: 'error', error: event.message });
              harness.pending.clear();
            };
          }
          const id = ++harness.id;
          const reply = await new Promise((resolve) => {
            harness.pending.set(id, resolve);
            harness.worker.postMessage({
              kind: 'render',
              id,
              image: { width, height, pixels: Uint8Array.from(pixels).buffer },
              effects: [effect],
              masterSeed: seed,
              reference: { width, height },
              purpose: 'export',
            });
          });
          if (reply.kind !== 'success')
            throw new Error(reply.error ?? 'Reference shader render failed.');
          return {
            pixels: [...new Uint8Array(reply.image.pixels)],
            backend: reply.image.shaderBackend,
            reason: reply.image.shaderReason,
          };
        },
        {
          path: `assets/${workerFile}`,
          pixels: [...incoming],
          width,
          height,
          effect,
          seed: recipe.seed,
        },
      );
      assert.equal(rendered.backend, 'webgpu', rendered.reason);
      result = Buffer.from(rendered.pixels);
      const cpuStage = Buffer.from(
        renderEffects({ width, height, pixels: Uint8Array.from(incoming).buffer }, [effect], {
          masterSeed: recipe.seed,
        }).pixels,
      );
      // Nonlinear material treatments amplify preceding differences. Compare
      // each CPU/GPU stage on identical input, rather than assuming a linear
      // rounding allowance for independently rendered six-effect stacks.
      parity(result, cpuStage, `${effect.type} same-input CPU/GPU parity`);
      gpuReferenceCache.set(key, result);
    }
    incoming = result;
  }
  return incoming;
}
async function exportChecked(exact = false) {
  const recipe = await state();
  assert.equal(recipe.backend, cpu ? 'cpu' : 'webgpu', `Shader backend: ${recipe.reason}`);
  if (cpu) assert.ok(recipe.reason);
  const path = resolve(output, `${label}-${++exports}.png`);
  await save(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status(`Exported ${basename(path)}`);
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  const expected = Buffer.from(
    renderEffects({ width, height, pixels: Uint8Array.from(rgba).buffer }, recipe.effects, {
      masterSeed: recipe.seed,
    }).pixels,
  );
  if (cpu || exact) assert.ok(data.equals(expected), 'CPU/neutral export must be byte-exact.');
  if (!cpu)
    assert.ok(
      data.equals(await gpuReference(recipe)),
      'PNG export must match the independent GPU stack exactly.',
    );
  return data;
}
const slider = (name, value) => page.getByRole('slider', { name, exact: true }).fill(String(value));
try {
  await launch();
  if (!largeOnly) {
    await open(imagePath);
    await fileAction(page, 'Open image Ctrl+Shift+O');
    await status(`Opened ${basename(imagePath)}`);
    await add('Shader Ripple');
    const phaseZero = await exportChecked();
    await slider('Phase', 1);
    assert.ok((await exportChecked()).equals(phaseZero));
    await slider('Phase', 0.37);
    assert.ok(!(await exportChecked()).equals(phaseZero));
    await slider('Strength', 15);
    for (const mode of ['extend', 'wrap', 'mirror']) {
      await page.getByRole('combobox', { name: 'Edge Handling', exact: true }).selectOption(mode);
      await exportChecked();
    }
    await slider('Strength', 0);
    assert.ok((await exportChecked(true)).equals(rgba));
    await slider('Strength', 12);
    await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('top');
    await slider('Coverage', 0.5);
    const masked = await exportChecked();
    const untouched = Math.ceil(height / 2) * width * 4;
    assert.ok(masked.subarray(untouched).equals(rgba.subarray(untouched)));
    await slider('Softness', 0.6);
    await exportChecked();
    const before = await state();
    await page.getByRole('button', { name: 'New pattern', exact: true }).click();
    const changed = await state();
    assert.equal(changed.effects[0].seedOffset, before.effects[0].seedOffset + 1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), before);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), changed);
    await add('Shader Plasma');
    let generated = await exportChecked();
    // Ripple is below Plasma: preserve its incoming alpha, not original source alpha.
    await page.getByRole('combobox', { name: 'Canvas', exact: true }).selectOption('opaque');
    generated = await exportChecked();
    for (let i = 3; i < generated.length; i += 4) assert.equal(generated[i], 255);
    await page.getByRole('combobox', { name: 'Blend mode', exact: true }).selectOption('screen');
    await slider('Opacity', 0.43);
    await slider('Phase', 0.52);
    await exportChecked();
    for (const [title, refracts] of [
      ['Liquid Glass', true],
      ['Iridescence', false],
      ['Hologram', false],
      ['Flow Field', true],
      ['Caustics', false],
      ['Liquid Chrome', true],
      ['Heat Mirage', true],
    ]) {
      const incoming = await exportChecked();
      await add(title);
      const control = refracts ? 'Strength' : 'Intensity';
      await slider(control, 0);
      assert.ok(
        (await exportChecked()).equals(incoming),
        `${title} neutral strength must be exact`,
      );
      await slider(control, refracts ? 9 : 0.85);
      const phaseStart = await exportChecked();
      await slider('Phase', 1);
      assert.ok((await exportChecked()).equals(phaseStart), `${title} phase must loop exactly`);
      await slider('Phase', 0.31);
      assert.ok(!(await exportChecked()).equals(phaseStart));
      if (refracts) {
        await page
          .getByRole('combobox', { name: 'Edge Handling', exact: true })
          .selectOption('mirror');
        await exportChecked();
      }
      const beforePattern = await state();
      await page.getByRole('button', { name: 'New pattern', exact: true }).click();
      const afterPattern = await state();
      const current = afterPattern.effects.find(
        (effect) => effect.instanceId === beforePattern.effects.at(-1).instanceId,
      );
      assert.equal(current.seedOffset, beforePattern.effects.at(-1).seedOffset + 1);
      await exportChecked();
    }
    await add('Nebula');
    const nebula = await exportChecked();
    await slider('Phase', 1);
    assert.ok((await exportChecked()).equals(nebula), 'Nebula phase must loop exactly');
    await slider('Phase', 0.31);
    await slider('Cloud detail', 6);
    await slider('Core glow', 0.85);
    assert.ok(!(await exportChecked()).equals(nebula));
    await page.getByRole('combobox', { name: 'Canvas', exact: true }).selectOption('opaque');
    const opaqueNebula = await exportChecked();
    for (let i = 3; i < opaqueNebula.length; i += 4) assert.equal(opaqueNebula[i], 255);
    await slider('Opacity', 0.6);
    saved = await state();
    await save(projectPath);
    await fileAction(page, 'Save project Ctrl+S');
    await status(`Saved ${basename(projectPath)}`);
    const exported = await exportChecked();
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayAwake: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    await writeFile(resolve(output, `${label}-controls.png`), Buffer.from(png, 'base64'));
    await closeTestApp(app);
    await launch();
    await open(projectPath);
    await fileAction(page, 'Open project Ctrl+O');
    await status(`Opened ${basename(projectPath)}`);
    assert.deepEqual(await state(), saved);
    assert.ok((await exportChecked()).equals(exported));
    // Presets must retain the shader recipe and render the statue thumbnail too.
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.getByRole('tab', { name: 'Presets', exact: true }).click();
    await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Original shaders');
    await page
      .getByRole('img', { name: 'Statue preset preview', exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole('radio', { name: 'Statue', exact: true }).check();
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await status('Saved preset Original shaders');
    await page.getByRole('button', { name: 'Apply Original shaders', exact: true }).click();
    await page
      .locator('.preset-flyout')
      .getByRole('button', { name: 'Replace All', exact: true })
      .click();
    assert.deepEqual(await state(), saved);
    assert.ok((await exportChecked()).equals(exported));
  }
  // A texture larger than 16 MiB requires multiple padded readback chunks.
  // Exercise the actual bundled worker and cancellation independently of display.
  const largeWidth = 2049,
    largeHeight = 2051;
  const largeBytes = Uint8Array.from({ length: largeWidth * largeHeight * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 1, 64, 128, 254, 255][Math.floor(i / 4) % 6] : (i * 17) % 256,
  );
  const indices = [
    ...new Set([
      0,
      largeWidth - 1,
      largeWidth * 2016,
      largeWidth * largeHeight - 1,
      ...Array.from({ length: 4096 }, (_, i) => i * 1021),
    ]),
  ];
  for (const type of [
    'shader-ripple',
    'shader-plasma',
    'shader-liquid-glass',
    'shader-iridescence',
    'shader-hologram',
    'shader-flow-field',
    'shader-caustics',
    'shader-liquid-chrome',
    'shader-heat-mirage',
    'shader-nebula',
  ]) {
    const base = createEffect(type, 'large-shader');
    const effect = {
      ...base,
      params: {
        ...base.params,
        phase: 0.731,
        scale: 13,
        ...('edgeHandling' in base.params ? { strength: 15, edgeHandling: 'wrap' } : {}),
      },
    };
    const result = await page.evaluate(
      async ({ path, width, height, effect, indices }) => {
        const worker = new Worker(new URL(path, location.href), { type: 'module' });
        const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
          i % 4 === 3 ? [0, 1, 64, 128, 254, 255][Math.floor(i / 4) % 6] : (i * 17) % 256,
        ).buffer;
        const replies = new Map();
        worker.onmessage = (event) => replies.get(event.data.id)?.(event.data);
        worker.onerror = (event) => {
          throw new Error(event.message);
        };
        const render = (id) =>
          new Promise((resolve) => {
            replies.set(id, resolve);
            worker.postMessage({
              kind: 'render',
              id,
              image: { width, height, pixels },
              effects: [effect],
              masterSeed: 8172,
              reference: { width, height },
              purpose: 'export',
            });
          });
        const started = performance.now();
        try {
          const obsolete = render(1);
          worker.postMessage({ kind: 'cancel', id: 1 });
          const cancelled = await obsolete;
          if (cancelled.kind !== 'cancelled')
            throw new Error('Obsolete shader work was not cancelled.');
          const rendered = await render(2);
          if (rendered.kind !== 'success') throw new Error(rendered.error ?? 'Shader work failed.');
          const bytes = new Uint8Array(rendered.image.pixels);
          return {
            backend: rendered.image.shaderBackend,
            reason: rendered.image.shaderReason,
            size: bytes.length,
            sampled: indices.flatMap((index) => [...bytes.subarray(index * 4, index * 4 + 4)]),
            milliseconds: performance.now() - started,
          };
        } finally {
          worker.terminate();
        }
      },
      { path: `assets/${workerFile}`, width: largeWidth, height: largeHeight, effect, indices },
    );
    assert.equal(result.backend, cpu ? 'cpu' : 'webgpu', result.reason);
    assert.equal(result.size, largeBytes.byteLength);
    const expected = new Uint8Array(
      renderEffects(
        { width: largeWidth, height: largeHeight, pixels: largeBytes.buffer },
        [effect],
        { masterSeed: 8172 },
      ).pixels,
    );
    const sampled = indices.flatMap((index) => [...expected.subarray(index * 4, index * 4 + 4)]);
    const maximumRaw = Math.max(...sampled.map((value, i) => Math.abs(value - result.sampled[i])));
    let maximum = 0,
      maximumAlpha = 0;
    for (let i = 0; i < sampled.length; i += 4) {
      maximumAlpha = Math.max(maximumAlpha, Math.abs(sampled[i + 3] - result.sampled[i + 3]));
      for (let channel = 0; channel < 3; channel++)
        maximum = Math.max(
          maximum,
          Math.abs(
            (sampled[i + channel] * sampled[i + 3]) / 255 -
              (result.sampled[i + channel] * result.sampled[i + 3]) / 255,
          ),
        );
    }
    // Small subpixel differences can change hidden RGB beside alpha=0. Compare
    // visible premultiplied color and alpha; CPU fallback remains byte-exact.
    assert.ok(
      cpu ? maximumRaw === 0 : maximum <= 3 && maximumAlpha <= 1,
      `${type} large shader difference: color ${maximum}, alpha ${maximumAlpha}, raw ${maximumRaw}`,
    );
    console.log(
      JSON.stringify({
        mode: label,
        type,
        largeReadback: true,
        cancellation: true,
        maximum,
        maximumRaw,
        maximumAlpha,
        milliseconds: result.milliseconds,
      }),
    );
  }
  assert.deepEqual(errors, []);
  if (!largeOnly) assert.ok((await readFile(projectPath)).byteLength);
  console.log(
    JSON.stringify({
      mode: label,
      exports,
      backend: saved?.backend ?? (cpu ? 'cpu' : 'webgpu'),
      persistence: !largeOnly,
      result: 'passed',
    }),
  );
} catch (error) {
  await writeFile(
    resolve(output, `${label}-failure.json`),
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
  if (app) await closeTestApp(app);
}
