import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { renderEffects } from './effects-reference.mjs';

const model = ts.transpileModule(await readFile('packages/project-model/src/index.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createEffect, BLUR_STYLES, NOISE_STYLES } = await import(
  `data:text/javascript;base64,${Buffer.from(model).toString('base64')}`
);
function fixture(width, height, transparent = false) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels.set(
        [
          (x * 17 + y * 7) % 256,
          (y * 23 + x * 3) % 256,
          ((x ^ y) * 13) % 256,
          transparent ? [0, 1, 64, 128, 254, 255][x % 6] : 255,
        ],
        i,
      );
    }
  return { width, height, pixels: pixels.buffer };
}
const mask = {
  width: 97,
  height: 73,
  values: Uint8Array.from({ length: 97 * 73 }, (_, i) => (i % 97 > 32 && i % 97 < 65 ? 255 : 0))
    .buffer,
};
const options = { masterSeed: 123, subjectMask: mask };
const signatures = {};
for (const [type, styles] of [
  ['blur', BLUR_STYLES],
  ['noise-grain', NOISE_STYLES],
])
  for (const style of styles)
    for (const edgeHandling of ['extend', 'wrap', 'mirror']) {
      const effect = createEffect(type, type);
      Object.assign(effect.params, { style, edgeHandling });
      if (type === 'noise-grain') Object.assign(effect.params, { coloring: 'color', detail: 4 });
      const result = renderEffects(fixture(97, 73, true), [effect], options);
      signatures[`${type}/${style}/${edgeHandling}`] = createHash('sha256')
        .update(new Uint8Array(result.pixels))
        .digest('hex');
    }
const timings = {};
const image = fixture(512, 512);
for (const [type, style, params] of [
  ['blur', 'gaussian', { radius: 6 }],
  ['blur', 'motion', { radius: 6 }],
  ['blur', 'lens', { radius: 6 }],
  ['blur', 'field', {}],
  ['noise-grain', 'film', {}],
  ['noise-grain', 'perlin', { detail: 4 }],
  ['noise-grain', 'voronoi', { detail: 4 }],
]) {
  const effect = createEffect(type, type);
  Object.assign(effect.params, { style, ...params });
  renderEffects(fixture(64, 64), [effect], options);
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    renderEffects(image, [effect], options);
    runs.push(performance.now() - start);
  }
  timings[`${type}/${style}`] = Math.round(runs.sort((a, b) => a - b)[1]);
}
const report = { dimensions: '512 × 512', medianMs: timings, signatures };
await mkdir('test-results/noise-blur-performance', { recursive: true });
const baselinePath = 'test-results/noise-blur-performance/baseline.json';
if (process.argv.includes('--baseline')) {
  await writeFile(baselinePath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ dimensions: report.dimensions, medianMs: timings, baseline: true }));
} else {
  const expected = JSON.parse(
    await readFile('packages/effects/src/fixtures/noise-blur-v1.json', 'utf8'),
  );
  assert.deepEqual(signatures, expected, 'Existing Noise / Blur pixels changed');
  const baseline = await readFile(baselinePath, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  await writeFile(
    'test-results/noise-blur-performance/optimized.json',
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      dimensions: report.dimensions,
      medianMs: timings,
      speedup: baseline
        ? Object.fromEntries(
            Object.entries(timings).map(([key, ms]) => [
              key,
              Number((baseline.medianMs[key] / ms).toFixed(2)),
            ]),
          )
        : null,
      exactPixelComparisons: Object.keys(signatures).length,
    }),
  );
}
