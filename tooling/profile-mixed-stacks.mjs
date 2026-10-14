import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';
import { createEffect, renderEffectsAsync } from './effects-reference.mjs';
const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const label = process.argv[2] ?? 'current';
const draft = process.argv.includes('--bounded-draft');
const quick = process.argv.includes('--quick');
const draftOnly = process.argv.includes('--draft-only');
const draftSize = Number(
  process.argv.find((arg) => arg.startsWith('--draft-size='))?.split('=')[1] ?? 256,
);
const output = new URL('../test-results/mixed-performance/', import.meta.url);
await mkdir(output, { recursive: true });
const e = (type, params = {}) => ({
  ...createEffect(type, type),
  params: { ...createEffect(type, type).params, ...params },
});
const png = await readFile(
  new URL('../apps/desktop/resources/depth-maps/ridged-terrain.png', import.meta.url),
);
const bytes = await sharp(png).ensureAlpha().raw().toBuffer();
const fieldImage = {
  source: {
    id: 'depth-map-v1:ridged-terrain',
    name: 'terrain.png',
    width: 2048,
    height: 2048,
    format: 'png',
    hasAlpha: false,
  },
  png: 'data:image/png;base64,' + png.toString('base64'),
};
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
const rows = [];
for (const [width, height, phase] of [
  [draftSize, Math.round((draftSize * 3) / 4), 'draft'],
  ...(draftOnly ? [] : [[2048, 1536, 'full'], ...(quick ? [] : [[4096, 3072, 'full']])]),
]) {
  const image = {
    width,
    height,
    pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? [0, 128, 255, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
    ).buffer,
  };
  for (const [name, effects] of Object.entries(cases)) {
    const timings = [];
    let result;
    for (let run = 0; run < (phase === 'draft' ? 5 : 1); run++) {
      const start = performance.now();
      result = await renderEffectsAsync(image, effects, {
        reference: { width: 4096, height: 3072 },
        masterSeed: 8172,
        layerImages: new Map([
          [
            fieldImage.source.id,
            { width: 2048, height: 2048, pixels: Uint8Array.from(bytes).buffer },
          ],
        ]),
        ...(draft && phase === 'draft' ? { fieldMaxDimension: draftSize } : {}),
        yieldControl: setImmediate,
      });
      timings.push(+(performance.now() - start).toFixed(1));
    }
    timings.sort((a, b) => a - b);
    const row = {
      name,
      width,
      height,
      phase,
      medianMs: timings[Math.floor(timings.length / 2)],
      timings,
      sha256: createHash('sha256').update(new Uint8Array(result.pixels)).digest('hex'),
      rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
await writeFile(
  new URL(`${label}.json`, output),
  JSON.stringify(
    {
      label,
      node: process.version,
      reference: { width: 4096, height: 3072 },
      renderer: 'CPU effect algorithms; GUI readback and encoding excluded',
      rows,
    },
    null,
    2,
  ),
);
