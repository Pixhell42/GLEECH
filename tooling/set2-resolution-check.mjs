import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from './test-electron.mjs';
import { createEffect, renderEffects, modelUrl } from './effects-reference.mjs';
import { closeTestApp } from './close-test-app.mjs';

const { ADVANCED_SHADER_TYPES } = await import(modelUrl);
const types = [
  ...ADVANCED_SHADER_TYPES,
  'shader-liquid-marbling',
  'shader-truchet-mosaic',
  'shader-microculture',
  'shader-prismatic-panels',
  'granular-echo',
  'pigment-drag',
  'pixel-stretch',
  'led-matrix',
];
const width = 769,
  height = 513,
  masterSeed = 8172,
  cpu = process.argv.includes('--cpu');
const label = cpu ? 'cpu' : 'gpu';
const output = resolve('test-results/set2-resolution');
await mkdir(output, { recursive: true });
const sharp = createRequire(resolve('apps/desktop/package.json'))('sharp');
const pixels = await sharp('apps/desktop/resources/presets/statue.png')
  .resize(width, height)
  .ensureAlpha()
  .raw()
  .toBuffer();
const worker = (await readdir('apps/desktop/out/renderer/assets')).find((name) =>
  /^effect-worker-.*\.js$/.test(name),
);
assert.ok(worker);
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, `${label}-profile-`)),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const app = await electron.launch({
  args: [
    resolve('apps/desktop'),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
});
const results = [];
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  await page.evaluate(
    ({ bytes, worker }) => {
      window.__resolutionPixels = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
      window.__resolutionWorker = new Worker(new URL(worker, location.href), { type: 'module' });
    },
    { bytes: pixels.toString('base64'), worker: `assets/${worker}` },
  );
  const recipes = types.map((type) => ({ type, params: {} }));
  for (const type of [
    'shader-signal-orb',
    'shader-hatched-solids',
    'shader-mandelbrot-slices',
    'shader-liquid-foil',
  ])
    recipes.push({ type, params: { objects: 'on' } });
  recipes.push(
    { type: 'shader-filament-flow', params: { style: 'ribbons', directionSource: 'spiral' } },
    { type: 'shader-liquid-foil', params: { fieldSource: 'perlin', heightRelief: 0.9 } },
    { type: 'shader-microculture', params: { style: 'colonies', lens: 1 } },
    { type: 'pixel-stretch', params: { style: 'radial', edgeBias: 1, protectedRadius: 25 } },
    { type: 'led-matrix', params: { brightnessSource: 'pattern', patternFrequency: 17 } },
  );
  const requested = process.argv.find((arg) => arg.startsWith('--effect='))?.slice(9);
  for (const primitive of ['sphere', 'cube', 'cylinder', 'cone'])
    recipes.push({
      type: 'shader-hatched-solids',
      params: { objects: 'on', primitive, objectCount: 1 },
    });
  for (const geometry of ['torus', 'rings'])
    recipes.push({ type: 'shader-liquid-foil', params: { objects: 'on', geometry, phase: 0.23 } });
  let caseIndex = 0;
  for (const recipe of recipes.filter((recipe) => !requested || recipe.type === requested)) {
    const base = createEffect(recipe.type, 'resolution');
    const effect = { ...base, params: { ...base.params, ...recipe.params } };
    const actual = await page.evaluate(
      async ({ effect, width, height, masterSeed }) => {
        const w = window.__resolutionWorker;
        const result = await new Promise((resolve, reject) => {
          w.onmessage = (e) => resolve(e.data);
          w.onerror = (e) => reject(Error(e.message));
          w.postMessage({
            kind: 'render',
            id: 1,
            image: { width, height, pixels: window.__resolutionPixels.slice().buffer },
            effects: [effect],
            masterSeed,
            reference: { width, height },
            purpose: 'export',
          });
        });
        if (result.kind !== 'success') throw Error(result.error);
        const bytes = new Uint8Array(result.image.pixels);
        let encoded = '';
        for (let start = 0; start < bytes.length; start += 32768)
          encoded += String.fromCharCode(...bytes.subarray(start, start + 32768));
        return { ...result.image, pixels: btoa(encoded) };
      },
      { effect, width, height, masterSeed },
    );
    assert.equal(actual.width, width);
    assert.equal(actual.height, height);
    if (recipe.type.startsWith('shader-'))
      assert.equal(actual.shaderBackend, cpu ? 'cpu' : 'webgpu', actual.shaderReason);
    const incoming = Uint8Array.from(pixels);
    const expected = new Uint8Array(
      renderEffects({ width, height, pixels: incoming.buffer }, [effect], { masterSeed }).pixels,
    );
    const rendered = Buffer.from(actual.pixels, 'base64');
    assert.equal(rendered.length, expected.length);
    let max = 0,
      alpha = 0,
      total = 0,
      boundaryChannels = 0,
      worst = 0;
    for (let i = 0; i < expected.length; i += 4) {
      alpha = Math.max(alpha, Math.abs(expected[i + 3] - rendered[i + 3]));
      for (let c = 0; c < 3; c++) {
        const difference = Math.abs(
          (expected[i + c] * expected[i + 3]) / 255 - (rendered[i + c] * rendered[i + 3]) / 255,
        );
        if (difference > max) {
          max = difference;
          worst = i + c;
        }
        total += difference;
        if (difference > 3) boundaryChannels++;
      }
    }
    const mean = total / (width * height * 3),
      fractal = recipe.type === 'shader-mandelbrot-slices';
    const passed =
      // Larger source textures amplify subpixel camera/UV rounding at isolated
      // fractal boundaries. Keep an explicit worst-case bound, a much tighter
      // mean bound, and a cap on affected channels rather than accepting drift.
      max <= (cpu ? 0 : fractal ? 8 : 3) &&
      alpha <= (cpu ? 0 : 1) &&
      (!fractal || (mean <= 0.25 && boundaryChannels <= width * height * 0.0001));
    const pixel = Math.floor(worst / 4),
      offset = pixel * 4;
    results.push({
      type: recipe.type,
      params: recipe.params,
      max,
      mean,
      alpha,
      boundaryChannels,
      passed,
      worst: {
        x: pixel % width,
        y: Math.floor(pixel / width),
        cpu: [...expected.subarray(offset, offset + 4)],
        gpu: [...rendered.subarray(offset, offset + 4)],
      },
    });
    if (!passed) {
      await sharp(rendered, { raw: { width, height, channels: 4 } })
        .png()
        .toFile(resolve(output, `${label}-failure-${caseIndex}-actual.png`));
      await sharp(expected, { raw: { width, height, channels: 4 } })
        .png()
        .toFile(resolve(output, `${label}-failure-${caseIndex}-expected.png`));
    }
    caseIndex++;
    console.log(
      `${label}: ${recipe.type} ${JSON.stringify(recipe.params)} ${passed ? 'passed' : 'FAILED'}: max ${max}, mean ${mean}, pixel ${pixel % width},${Math.floor(pixel / width)}`,
    );
  }
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify(
      {
        width,
        height,
        cases: results.length,
        results,
        result: results.every((r) => r.passed) ? 'passed' : 'failed',
      },
      null,
      2,
    ),
  );
  assert.ok(
    results.every((r) => r.passed),
    'Larger-image GPU/CPU parity failed; see recorded results.',
  );
  console.log(
    `${results.length} larger-image Set 2 cases passed (${label}, ${width} × ${height}).`,
  );
} finally {
  await closeTestApp(app);
}
