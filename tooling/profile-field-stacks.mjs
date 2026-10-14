import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { createEffect, renderEffectsAsync, heightFieldParams } from './effects-reference.mjs';

const label = process.argv[2] ?? 'current';
const output = 'test-results/field-performance';
await mkdir(output, { recursive: true });
const field = heightFieldParams({ fieldSource: 'perlin', fieldScale: 12, fieldSmoothing: 2 });
const configure = (type, params) => {
  const e = createEffect(type, type);
  return { ...e, params: { ...e.params, ...params } };
};
const feedback = configure('feedback-bloom', { style: 'melt', iterations: 8 });
const depth = configure('depth-field', { ...field, operation: 'relief' });
const blur = configure('blur', { ...field, style: 'depth', radius: 4 });
const recursive = configure('recursive-space', {
  ...field,
  fieldEnabled: 'on',
  fieldImageScale: 0.3,
});
const cases = {
  feedback: [feedback],
  blur: [configure('blur', { radius: 4 })],
  depth: [depth],
  stack: [depth, blur, feedback, recursive],
};
const rows = [];
const sizes = process.argv.includes('--quick')
  ? [
      [256, 192],
      [1024, 768],
    ]
  : [
      [256, 192],
      [1024, 768],
      [2048, 1536],
      [4096, 3072],
    ];
for (const [width, height] of sizes) {
  const image = {
    width,
    height,
    pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? [0, 128, 255, 255][Math.floor(i / 4) % 4] : (i * 17) % 256,
    ).buffer,
  };
  for (const [name, effects] of Object.entries(cases)) {
    const start = performance.now();
    const result = await renderEffectsAsync(image, effects, {
      reference: { width: 4096, height: 3072 },
      masterSeed: 8172,
      yieldControl: setImmediate,
    });
    const row = {
      name,
      width,
      height,
      milliseconds: +(performance.now() - start).toFixed(1),
      sha256: createHash('sha256').update(new Uint8Array(result.pixels)).digest('hex'),
      rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
await writeFile(
  `${output}/${label}.json`,
  JSON.stringify(
    {
      label,
      node: process.version,
      reference: { width: 4096, height: 3072 },
      renderer: 'CPU effect worker algorithms; GUI readback/encoding excluded',
      rows,
    },
    null,
    2,
  ),
);
