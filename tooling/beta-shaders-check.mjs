import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { createEffect, renderEffects, modelUrl } from './effects-reference.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';

const { BETA_SHADER_TYPES, EFFECT_DEFINITIONS } = await import(modelUrl);
const shaderCount = Object.keys(EFFECT_DEFINITIONS).filter((type) =>
  type.startsWith('shader-'),
).length;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/beta-shaders');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const executablePath = process.argv.slice(2).find((x) => x.endsWith('.exe'));
const worker = (await readdir(resolve(root, 'apps/desktop/out/renderer/assets'))).find((x) =>
  /^effect-worker-.*\.js$/.test(x),
);
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const width = 67,
  height = 49;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 1, 64, 128, 255][Math.floor(i / 4) % 5] : (i * 37) % 256,
);
const imagePath = resolve(output, `${cpu ? 'cpu' : 'gpu'}-input.png`),
  projectPath = resolve(output, `${cpu ? 'cpu' : 'gpu'}.gleech`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
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
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1 });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, imagePath);
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  async function render(effect, fixture = { width, height, pixels, masterSeed: 8172 }) {
    const { width, height, pixels, masterSeed } = fixture;
    const image = { width, height, pixels: pixels.buffer };
    const actual = await page.evaluate(
      async ({ path, effect, width, height, bytes, masterSeed }) => {
        const instance = (window.__betaWorker ??= new Worker(new URL(path, location.href), {
          type: 'module',
        }));
        const reply = await new Promise((resolve, reject) => {
          instance.onmessage = (e) => resolve(e.data);
          instance.onerror = (e) => reject(new Error(e.message));
          instance.postMessage({
            kind: 'render',
            id: 1,
            image: { width, height, pixels: Uint8Array.from(bytes).buffer },
            effects: [effect],
            masterSeed,
            reference: { width, height },
            purpose: 'export',
          });
        });
        if (reply.kind !== 'success') throw new Error(reply.error);
        return { ...reply.image, pixels: [...new Uint8Array(reply.image.pixels)] };
      },
      { path: `assets/${worker}`, effect, width, height, bytes: [...pixels], masterSeed },
    );
    if (effect.type.startsWith('shader-'))
      assert.equal(actual.shaderBackend, cpu ? 'cpu' : 'webgpu', actual.shaderReason);
    const expected = new Uint8Array(renderEffects(image, [effect], { masterSeed }).pixels);
    let visible = 0,
      alpha = 0;
    for (let i = 0; i < expected.length; i += 4) {
      alpha = Math.max(alpha, Math.abs(expected[i + 3] - actual.pixels[i + 3]));
      for (let c = 0; c < 3; c++)
        visible = Math.max(
          visible,
          Math.abs(
            (expected[i + c] * expected[i + 3]) / 255 -
              (actual.pixels[i + c] * actual.pixels[i + 3]) / 255,
          ),
        );
    }
    if (visible > 3 || alpha > 1) {
      const diffs = [];
      for (let i = 0; i < expected.length; i += 4)
        if (
          Math.abs(expected[i + 3] - actual.pixels[i + 3]) > 1 ||
          [0, 1, 2].some(
            (c) =>
              Math.abs(
                (expected[i + c] * expected[i + 3]) / 255 -
                  (actual.pixels[i + c] * actual.pixels[i + 3]) / 255,
              ) > 3,
          )
        )
          diffs.push({
            x: (i / 4) % width,
            y: Math.floor(i / 4 / width),
            cpu: [...expected.slice(i, i + 4)],
            gpu: actual.pixels.slice(i, i + 4),
          });
      console.log(
        JSON.stringify({ type: effect.type, diffs: diffs.slice(0, 10), count: diffs.length }),
      );
    }
    assert.ok(
      visible <= (cpu ? 0 : 3) && alpha <= (cpu ? 0 : 1),
      `${effect.type}/${effect.params.variant}: visible ${visible}, alpha ${alpha}`,
    );
    cases++;
    return actual.pixels;
  }
  for (const type of BETA_SHADER_TYPES) {
    const base = createEffect(type, 'beta-native');
    for (const variant of ['first', 'second', 'third'])
      await render({ ...base, params: { ...base.params, variant, phase: 0.27, rotation: 23 } });
    const initial = await render(base);
    assert.deepEqual(await render({ ...base, params: { ...base.params, phase: 1 } }), initial);
    assert.deepEqual(await render({ ...base, params: { ...base.params, strength: 0 } }), [
      ...pixels,
    ]);
    await render({
      ...base,
      seedOffset: 1,
      application: { region: 'left', coverage: 0.5, softness: 0.3 },
      params: { ...base.params, colorMix: 1, patternColor: '#ff8811', backgroundColor: '#141d32' },
    });
    console.log(JSON.stringify({ shader: type, cases }));
  }
  // Rotated hexagons on this odd-size transparent input hit a shared facet edge
  // at (227,175). Both backends must choose the same cell's refraction vector.
  const crystal = createEffect('shader-crystal-facets', 'builtin:crystal-mosaic:0');
  await render(
    {
      ...crystal,
      seedOffset: 1255,
      params: {
        ...crystal.params,
        variant: 'third',
        scale: 9,
        strength: 7,
        structure: 0.34,
        accent: 0.65,
        colorMix: 0.6,
        rotation: 12,
        edgeHandling: 'mirror',
      },
    },
    {
      width: 257,
      height: 193,
      masterSeed: 9717,
      pixels: Uint8Array.from({ length: 257 * 193 * 4 }, (_, i) =>
        i % 4 === 3 ? [0, 128, 255, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
      ),
    },
  );
  for (const params of [
    { style: 'salt-pepper', balance: 0, density: 1, intensity: 1 },
    { style: 'salt-pepper', balance: 0.5, density: 0.4, intensity: 0.8 },
    { style: 'salt-pepper', balance: 1, density: 1, intensity: 1 },
    { style: 'salt-pepper', density: 0 },
    ...['horizontal', 'vertical', 'both'].map((scanDirection) => ({
      style: 'scan',
      scanDirection,
      scanIrregularity: 0,
      scanWidth: 0.6,
      scanSpacing: 3,
    })),
    { style: 'scan', scanIrregularity: 1, coloring: 'color' },
  ]) {
    const e = createEffect('noise-grain', 'noise-native');
    await render({ ...e, params: { ...e.params, ...params } });
  }
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened ' + basename(imagePath) })
    .first()
    .waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  for (const type of BETA_SHADER_TYPES) {
    await page.getByRole('button', { name: /Add effect/ }).click();
    await page.getByRole('button', { name: /^Shaders/ }).click();
    assert.equal(await page.locator('.effect-tile').count(), shaderCount);
    const tile = page
      .locator('.effect-picker')
      .getByRole('button', { name: EFFECT_DEFINITIONS[type].title, exact: true });
    assert.equal(await tile.locator('.shader-mark').count(), 1);
    await tile.locator('img').evaluate((n) => {
      if (!n.complete || n.naturalWidth !== 384) throw new Error('Missing shader thumbnail');
    });
    await tile.click();
    assert.equal(await page.getByRole('combobox', { name: 'Pattern', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 1);
    const section = page.locator('.effect-detail');
    const dimensions = await section.evaluate((n) => ({
      width: n.clientWidth,
      scroll: n.scrollWidth,
    }));
    assert.ok(dimensions.scroll <= dimensions.width + 1, 'Shader controls overflow horizontally');
  }
  const state = async () => {
    await page.waitForFunction(() => {
      const layer = document.querySelector('.image-layer');
      return (
        layer?.dataset.renderRevision === layer?.dataset.requestedRevision &&
        JSON.parse(layer?.dataset.renderRecipe ?? '[]').length ===
          document.querySelectorAll('.effect-row').length &&
        !document.querySelector('.detail-loading')
      );
    });
    return page.locator('.image-layer').evaluate((n) => JSON.parse(n.dataset.renderRecipe));
  };
  const before = await state();
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, projectPath);
  await fileAction(page, 'Save project Ctrl+S');
  await page
    .getByRole('status')
    .filter({ hasText: 'Saved ' + basename(projectPath) })
    .first()
    .waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, projectPath);
  await fileAction(page, 'Open project Ctrl+O');
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened ' + basename(projectPath) })
    .first()
    .waitFor();
  assert.deepEqual(await state(), before);
  const pngPath = resolve(output, `${cpu ? 'cpu' : 'gpu'}-export.png`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, pngPath);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await page
    .getByRole('status')
    .filter({ hasText: 'Exported ' + basename(pngPath) })
    .first()
    .waitFor();
  assert.ok((await readFile(pngPath)).length > 0);
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Beta geometry');
  await page.getByRole('img', { name: 'Statue preset preview', exact: true }).waitFor();
  await page.getByRole('radio', { name: 'Statue', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Saved preset Beta geometry' })
    .first()
    .waitFor();
  const preset = page.getByRole('button', { name: 'Apply Beta geometry', exact: true });
  await preset.waitFor({ state: 'visible' });
  assert.equal(await preset.locator('.shader-mark').count(), 1);
  await preset.click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), before);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: cpu ? 'cpu' : 'gpu',
      cases,
      tiles: shaderCount,
      projectRoundTrip: true,
      export: true,
      preset: true,
      result: 'passed',
    }),
  );
} finally {
  await closeTestApp(app);
}
