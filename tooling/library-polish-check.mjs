import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, basename } from 'node:path';
import { _electron as electron } from './test-electron.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { effectCount, renderEffects, modelUrl } from './effects-reference.mjs';
const { isShaderEffect } = await import(modelUrl);
const workerFile = (await readdir(resolve('apps/desktop/out/renderer/assets'))).find((file) =>
  /^effect-worker-.*\.js$/.test(file),
);
const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const exe = process.argv.slice(2).find((arg) => arg.endsWith('.exe')),
  cpu = process.argv.includes('--cpu');
const focus = process.argv.includes('--focus');
const storageOnly = process.argv.includes('--storage-only');
const set2 = process.argv.includes('--set2');
const label = `${exe ? 'packaged-' : ''}${cpu ? 'cpu' : 'auto'}${storageOnly ? '-storage' : ''}`;
const output = resolve('test-results/library-polish');
await mkdir(output, { recursive: true });
const catalog = JSON.parse(
  await readFile('apps/desktop/resources/presets/built-in.json', 'utf8'),
).presets;
let profile = await mkdtemp(resolve(output, `${label}-profile-`));
let env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const launch = () =>
  electron.launch({
    args: [
      ...(exe ? [] : [resolve('apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
    ...(exe ? { executablePath: resolve(exe) } : {}),
  });
let app = await launch(),
  page,
  exports = 0;
const errors = [],
  layers = new Map();
const width = 257,
  height = 193;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 128, 255, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
);
const input = resolve(output, `${label}-input.png`),
  project = resolve(output, `${label}.gleech`),
  presetPath = resolve(output, `${label}.gleechpreset`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(input);
async function configure() {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
}
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
    { timeout: 60000 },
  );
}
async function state() {
  await settle();
  return page.locator('.image-layer').evaluate((n) => ({
    effects: JSON.parse(n.dataset.renderRecipe),
    masterSeed: Number(n.dataset.renderSeed),
  }));
}
const status = (text) =>
  page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60000 });
async function open(path, action) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  await fileAction(page, action);
  await settle();
}
async function savePath(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
}
async function picker() {
  await page.getByRole('button', { name: /Add effect/ }).click();
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Analog Afterimage', exact: true }).waitFor();
}
async function apply(name, placement = 'Replace All') {
  await picker();
  await page.getByRole('button', { name: `Apply ${name}`, exact: true }).click();
  await page.getByRole('button', { name: placement, exact: true }).click();
  await settle();
}
async function remember(recipe) {
  layers.clear();
  for (const effect of recipe.effects)
    for (const image of [effect.image, effect.fieldImage, effect.directionImage].filter(Boolean)) {
      if (layers.has(image.source.id)) continue;
      const raw = await sharp(Buffer.from(image.png.slice(22), 'base64'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      layers.set(image.source.id, {
        width: raw.info.width,
        height: raw.info.height,
        pixels: Uint8Array.from(raw.data).buffer,
      });
    }
}
// A separate worker checks the export path without reading its rendered pixels.
async function workerRender(effects, incoming, masterSeed) {
  return page.evaluate(
    async ({ workerFile, width, height, pixels, effects, masterSeed }) => {
      const worker = (window.__presetWorker ??= new Worker(
        new URL(`assets/${workerFile}`, location.href),
        { type: 'module' },
      ));
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({
          kind: 'render',
          id: 1,
          image: { width, height, pixels: Uint8Array.from(pixels).buffer },
          effects,
          masterSeed,
          reference: { width, height },
          purpose: 'export',
        });
      });
      if (result.kind !== 'success') throw new Error(result.error);
      return {
        pixels: [...new Uint8Array(result.image.pixels)],
        backend: result.image.shaderBackend,
      };
    },
    { workerFile, width, height, pixels: [...incoming], effects, masterSeed },
  );
}
function assertChromaRounding(actual, expected) {
  // Chromium and Node can round the same half-integer chroma blend to adjacent
  // bytes. Bound that cross-runtime difference, then require exact worker export.
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++)
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= (i % 4 === 3 ? 0 : 1),
      `Chroma runtime rounding at byte ${i}`,
    );
}
async function exportExact() {
  const recipe = await state(),
    path = resolve(output, `${label}-${++exports}.png`);
  await savePath(path);
  await fileAction(page, 'Quick PNG Export Ctrl+Shift+E');
  await status('Exported ' + basename(path));
  let expected;
  if (!cpu && recipe.effects.some(isShaderEffect)) {
    let incoming = pixels;
    for (const effect of recipe.effects) {
      const cpuStage = new Uint8Array(
        renderEffects({ width, height, pixels: incoming.buffer }, [effect], {
          masterSeed: recipe.masterSeed,
          layerImages: layers,
          paletteSource: { width, height, pixels: pixels.buffer },
        }).pixels,
      );
      if (isShaderEffect(effect)) {
        const result = await workerRender([effect], incoming, recipe.masterSeed);
        assert.equal(result.backend, 'webgpu');
        const gpuStage = Uint8Array.from(result.pixels);
        let color = 0,
          alpha = 0;
        for (let i = 0; i < gpuStage.length; i += 4) {
          alpha = Math.max(alpha, Math.abs(gpuStage[i + 3] - cpuStage[i + 3]));
          for (let c = 0; c < 3; c++)
            color = Math.max(
              color,
              Math.abs(
                (gpuStage[i + c] * gpuStage[i + 3]) / 255 -
                  (cpuStage[i + c] * cpuStage[i + 3]) / 255,
              ),
            );
        }
        assert.ok(
          color <= 3 && alpha <= 1,
          `${effect.type} same-input CPU/GPU parity: color ${color}, alpha ${alpha}`,
        );
        incoming = gpuStage;
      } else if (effect.type === 'chroma-mosh') {
        const result = await workerRender([effect], incoming, recipe.masterSeed);
        const browserStage = Uint8Array.from(result.pixels);
        assertChromaRounding(browserStage, cpuStage);
        incoming = browserStage;
      } else incoming = cpuStage;
    }
    expected = incoming;
  } else
    expected = new Uint8Array(
      renderEffects({ width, height, pixels: pixels.buffer }, recipe.effects, {
        masterSeed: recipe.masterSeed,
        layerImages: layers,
      }).pixels,
    );
  if (cpu && recipe.effects.some((effect) => effect.type === 'chroma-mosh')) {
    const result = await workerRender(recipe.effects, pixels, recipe.masterSeed);
    assert.equal(result.backend, recipe.effects.some(isShaderEffect) ? 'cpu' : undefined);
    const browserExpected = Uint8Array.from(result.pixels);
    assertChromaRounding(browserExpected, expected);
    expected = browserExpected;
  }
  assert.ok(
    (await sharp(path).ensureAlpha().raw().toBuffer()).equals(Buffer.from(expected)),
    'Exact starter-preset RGBA export',
  );
}
async function capture(name) {
  const path = resolve(output, `${label}-${name}.png`);
  await captureTestWindow(app, path);
  await page.waitForTimeout(200);
  await captureTestWindow(app, path);
}
try {
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  await page.getByRole('button', { name: /Add effect/ }).click();
  const dialog = page.locator('#effect-catalog');
  assert.equal(await dialog.locator('.effect-tile').count(), effectCount);
  for (const category of [
    'Glitch',
    'Distortion',
    'Color',
    'Depth',
    'Geometry',
    'Finishing',
    'Shaders',
  ]) {
    await dialog
      .getByRole('navigation', { name: 'Effect categories', exact: true })
      .getByRole('button', { name: new RegExp(`^${category}`) })
      .click();
    assert.ok(await dialog.locator('.effect-tile').count());
  }
  await dialog
    .getByRole('navigation', { name: 'Effect categories', exact: true })
    .getByRole('button', { name: /^All/ })
    .click();
  const search = dialog.getByRole('searchbox', { name: 'Search effects', exact: true });
  await search.fill('julia');
  assert.equal(await dialog.locator('.effect-tile').count(), 1);
  assert.ok(await dialog.getByRole('button', { name: 'Mandelbrot', exact: true }).isVisible());
  await search.fill('vector map');
  assert.ok(await dialog.getByRole('button', { name: 'Motion Transfer', exact: true }).isVisible());
  await search.fill('no-such-effect');
  await dialog.getByText('No effects match your search in All.', { exact: true }).waitFor();
  await search.fill('');
  assert.equal(await dialog.locator('.effect-tile').count(), effectCount);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  await capture('effects');
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Apply Analog Afterimage', exact: true }).waitFor();
  await page
    .getByRole('combobox', { name: 'Preset collection', exact: true })
    .selectOption('built-in');
  assert.equal(await dialog.locator('.preset-card').count(), catalog.length);
  assert.equal(
    await dialog.locator('.preset-card .shader-mark').count(),
    catalog.filter((preset) => preset.effects.some(isShaderEffect)).length,
  );
  assert.equal(await dialog.getByRole('button', { name: /^Edit preset/ }).count(), 0);
  assert.equal(await dialog.getByRole('button', { name: /^Delete preset/ }).count(), 0);
  await dialog.locator('.preset-card img').evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
    if (!images.every((image) => image.naturalWidth === 384))
      throw new Error('Invalid built-in thumbnail');
  });
  await capture('presets');
  await page.getByRole('combobox', { name: 'Preset collection', exact: true }).selectOption('mine');
  await dialog.getByText('Your preset library is empty.', { exact: true }).waitFor();
  await page
    .getByRole('combobox', { name: 'Preset collection', exact: true })
    .selectOption('built-in');
  await page.getByRole('searchbox', { name: 'Search presets', exact: true }).fill('corridor');
  assert.equal(await dialog.locator('.preset-card').count(), 1);
  await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
  const testedPresets = set2
    ? catalog.slice(-5)
    : storageOnly
      ? []
      : focus
        ? catalog.filter((preset) =>
            ['Crystal Mosaic', 'Circuit Ghost', 'Glyph Vortex'].includes(preset.name),
          )
        : catalog;
  for (const preset of testedPresets) {
    await remember(preset);
    await apply(preset.name);
    await exportExact();
    const recipe = await state();
    assert.deepEqual(
      recipe.effects.map((effect) => effect.params),
      preset.effects.map((effect) => effect.params),
    );
    console.log(`${label}: ${preset.name} apply and exact export passed`);
  }
  const rejected = await page.evaluate(async () => [
    await window.gleech.renamePreset('builtin-v1:spiral-transfer', 'Changed'),
    await window.gleech.deletePreset('builtin-v1:spiral-transfer'),
  ]);
  assert.ok(rejected.every((result) => !result.ok && result.error.includes('read-only')));
  const spiral = catalog.find((preset) => preset.name === 'Spiral Transfer');
  const broken = catalog.find((preset) => preset.name === 'Broken Current');
  await remember({ effects: [...spiral.effects, ...broken.effects] });
  for (const placement of storageOnly ? [] : ['Add Above', 'Add Below', 'Merge']) {
    await apply('Broken Current');
    const before = await state();
    await apply('Spiral Transfer', placement);
    const after = await state();
    await exportExact();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.deepEqual(await state(), before);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    assert.deepEqual(await state(), after);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settle();
  }
  const portable = [
    {
      name: set2 ? 'Psychedelic Skin' : 'Circuit Ghost',
      project: project.replace('.gleech', '-shader.gleech'),
      preset: presetPath.replace('.gleechpreset', '-shader.gleechpreset'),
    },
    { name: set2 ? 'Analog Color Drag' : 'Glyph Vortex', project, preset: presetPath },
  ];
  const saved = new Map();
  for (const entry of portable) {
    await apply(entry.name);
    await picker();
    await savePath(entry.preset);
    await page.getByRole('button', { name: `Export preset ${entry.name}`, exact: true }).click();
    await status('Exported preset');
    await page.getByRole('button', { name: 'Close effect picker', exact: true }).click();
    saved.set(entry.name, await state());
    await savePath(entry.project);
    await fileAction(page, 'Save project as… Ctrl+Shift+S');
    await status('Saved ' + basename(entry.project));
  }
  await closeTestApp(app);
  app = await launch();
  await configure();
  for (const entry of portable) {
    await remember(catalog.find((preset) => preset.name === entry.name));
    await open(entry.project, 'Open project Ctrl+O');
    assert.deepEqual(await state(), saved.get(entry.name));
    await exportExact();
  }
  await closeTestApp(app);
  profile = await mkdtemp(resolve(output, `${label}-transfer-profile-`));
  env = { ...env, GLEECH_SMOKE_USER_DATA: profile };
  app = await launch();
  await configure();
  await open(input, 'Open image Ctrl+Shift+O');
  for (const entry of portable) {
    await remember(catalog.find((preset) => preset.name === entry.name));
    await open(entry.preset, 'Import Preset');
    await status(`Imported preset ${entry.name}`);
    await page
      .getByRole('combobox', { name: 'Preset collection', exact: true })
      .selectOption('mine');
    assert.ok(
      await page
        .getByRole('button', { name: `Edit preset ${entry.name}`, exact: true })
        .isVisible(),
    );
    await page.getByRole('button', { name: `Apply ${entry.name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Replace All', exact: true }).click();
    await exportExact();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify(
      {
        effects: effectCount,
        builtins: catalog.length,
        appliedPresets: testedPresets.length,
        exactExports: exports,
        categories: true,
        search: true,
        readonly: true,
        placements: storageOnly ? 0 : 4,
        history: !storageOnly,
        restart: true,
        portablePreset: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `${label}: library organization, ${testedPresets.length}/${catalog.length} preset applications, ${storageOnly ? 'storage round trips' : 'all placements'} and ${exports} exact exports passed`,
  );
} finally {
  await closeTestApp(app);
}
