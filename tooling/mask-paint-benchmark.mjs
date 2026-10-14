import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { PaintedMaskRasterizer, renderPaintedMask, modelUrl } from './effects-reference.mjs';
const { createPaintedMask, DEFAULT_MASK_BRUSH } = await import(modelUrl);
const points = Array.from({ length: 120 }, (_, i) => ({
  x: 0.08 + i / 140,
  y: 0.5 + Math.sin(i / 8) * 0.28,
}));
const strokes = Array.from({ length: 40 }, (_, i) => ({
  ...DEFAULT_MASK_BRUSH,
  size: 18,
  hardness: 0.25,
  opacity: 0.5,
  mode: i % 3 ? 'paint' : 'erase',
  points: points.slice(0, 100),
}));
const base = { ...createPaintedMask(4000, 3000), strokes };
const rasterizer = new PaintedMaskRasterizer();
function drain(work) {
  while (true) {
    const step = work.next();
    if (step.done) return step.value;
  }
}
drain(rasterizer.steps(base, 256, 192));
const timings = [];
for (let count = 101; count <= 110; count++) {
  const mask = {
    ...base,
    strokes: [...strokes.slice(0, -1), { ...strokes.at(-1), points: points.slice(0, count) }],
  };
  let start = performance.now();
  const full = renderPaintedMask(mask, 256, 192);
  const fullMs = performance.now() - start;
  start = performance.now();
  const cached = drain(rasterizer.steps(mask, 256, 192));
  const cachedMs = performance.now() - start;
  assert.deepEqual(cached, full);
  timings.push({ fullMs, cachedMs });
}
const average = (key) => timings.reduce((sum, frame) => sum + frame[key], 0) / timings.length;
const fullMs = average('fullMs'),
  cachedMs = average('cachedMs');
const report = {
  raster: '256×192',
  completedStrokes: 39,
  activePoints: '101–110',
  frames: 10,
  fullMs,
  cachedMs,
  speedup: fullMs / cachedMs,
  exact: true,
};
await mkdir('test-results/mask-reference', { recursive: true });
await writeFile('test-results/mask-reference/benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
