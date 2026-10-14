import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { createEffect, modelUrl, renderPaintedMask } from './effects-reference.mjs';
import { closeTestApp } from './close-test-app.mjs';

const { createPaintedMask, DEFAULT_MASK_BRUSH } = await import(modelUrl);
const cpu = process.argv.includes('--cpu'),
  label = cpu ? 'cpu' : 'gpu';
const output = resolve('test-results/stack-preview');
await mkdir(output, { recursive: true });
const assets = await readdir('apps/desktop/out/renderer/assets');
const worker = assets.find((name) => /^effect-worker-.*\.js$/.test(name));
const overlay = assets.find((name) => /^mask-overlay-worker-.*\.js$/.test(name));
assert.ok(worker && overlay);
const env = {
  ...process.env,
  GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, label + '-profile-')),
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
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
  );
  const mask = {
    ...createPaintedMask(2048, 2048),
    base: 0,
    strokes: [
      {
        ...DEFAULT_MASK_BRUSH,
        hardness: 0.35,
        opacity: 0.6,
        points: Array.from({ length: 60 }, (_, i) => ({
          x: 0.1 + i / 80,
          y: 0.5 + Math.sin(i / 7) * 0.2,
        })),
      },
    ],
  };
  const types = [
    'shader-ripple',
    'shader-hologram',
    'channel-transform',
    'scanlines',
    'shader-filament-flow',
  ];
  const effects = Array.from({ length: 25 }, (_, i) => ({
    ...createEffect(types[i % types.length], 'layer-' + i),
    ...(i > 16 ? { paintedMask: { ...mask, base: 1 } } : {}),
  }));
  const report = await page.evaluate(
    async ({ worker, overlay, effects, mask }) => {
      const size = 192;
      const pixels = Uint8Array.from({ length: size * size * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (i * 17) % 251,
      );
      const engine = new Worker(new URL('assets/' + worker, location.href), { type: 'module' });
      let id = 0;
      async function run(recipe, cached, activeMaskId, maximum = size) {
        const start = performance.now();
        const reply = await new Promise((resolve, reject) => {
          engine.onmessage = (e) => resolve(e.data);
          engine.onerror = (e) => reject(Error(e.message));
          engine.postMessage({
            kind: 'render',
            id: ++id,
            ...(id === 1
              ? { image: { width: size, height: size, pixels: pixels.buffer.slice(0) } }
              : {}),
            effects: recipe,
            purpose: 'preview',
            masterSeed: 27,
            reference: { width: 2048, height: 2048 },
            ...(cached ? { previewMaxDimension: maximum } : {}),
            ...(activeMaskId ? { activeMaskId } : {}),
          });
        });
        if (reply.kind !== 'success') throw Error(reply.error ?? reply.kind);
        return {
          ms: performance.now() - start,
          bytes: new Uint8Array(reply.image.pixels),
          backend: reply.image.shaderBackend,
        };
      }
      await run(effects, true); // compile and populate checkpoints
      const frames = [];
      for (let step = 0; step < 4; step++) {
        const stroke = {
          ...mask.strokes[0],
          points: mask.strokes[0].points.slice(0, 40 + step * 4),
        };
        const recipe = [
          ...effects.slice(0, -1),
          { ...effects.at(-1), paintedMask: { ...mask, strokes: [stroke] } },
        ];
        const cached = await run(recipe, true, recipe.at(-1).instanceId),
          full = await run(recipe, false);
        if (!cached.bytes.every((value, i) => value === full.bytes[i]))
          throw Error('Checkpoint changed preview pixels.');
        frames.push({ cachedMs: cached.ms, uncachedMs: full.ms, backend: cached.backend });
      }
      const middleFrames = [];
      for (let step = 0; step < 3; step++) {
        const recipe = effects.map((effect, index) =>
          index === 17
            ? {
                ...effect,
                paintedMask: {
                  ...mask,
                  strokes: [
                    { ...mask.strokes[0], points: mask.strokes[0].points.slice(0, 30 + step * 4) },
                  ],
                },
              }
            : effect,
        );
        const cached = await run(recipe, true, recipe[17].instanceId),
          full = await run(recipe, false);
        if (!cached.bytes.every((value, i) => value === full.bytes[i]))
          throw Error('Active middle-mask cache changed pixels.');
        middleFrames.push({ cachedMs: cached.ms, uncachedMs: full.ms });
      }
      const overlayEngine = new Worker(new URL('assets/' + overlay, location.href), {
        type: 'module',
      });
      const overlayPixels = await new Promise((resolve, reject) => {
        overlayEngine.onmessage = (e) => resolve(Array.from(new Uint8ClampedArray(e.data.pixels)));
        overlayEngine.onerror = (e) => reject(Error(e.message));
        overlayEngine.postMessage({ mask, width: size, height: size });
      });
      overlayEngine.terminate();
      const sizes = [192, 128, 96, 256],
        prior = new Map(),
        resolutionFrames = [];
      for (const maximum of sizes) prior.set(maximum, await run(effects, true, undefined, maximum));
      for (const maximum of sizes) {
        const result = await run(effects, true, undefined, maximum);
        if (!result.bytes.every((value, i) => value === prior.get(maximum).bytes[i]))
          throw Error('Resolution cache changed pixels.');
        resolutionFrames.push({ maximum, coldMs: prior.get(maximum).ms, warmMs: result.ms });
      }
      engine.terminate();
      return {
        layers: effects.length,
        frames,
        middleFrames,
        resolutionFrames,
        size,
        overlayPixels,
      };
    },
    { worker, overlay, effects, mask },
  );
  for (const frame of report.frames) assert.equal(frame.backend, cpu ? 'cpu' : 'webgpu');
  const coverage = renderPaintedMask(mask, report.size, report.size);
  assert.equal(report.overlayPixels.length, coverage.length * 4);
  for (let i = 0; i < coverage.length; i++) {
    assert.deepEqual(report.overlayPixels.slice(i * 4, i * 4 + 4), [
      240,
      75,
      75,
      Math.round((1 - coverage[i]) * 85),
    ]);
  }
  delete report.overlayPixels;
  report.exactPreviewAndOverlay = true;
  await writeFile(resolve(output, label + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await closeTestApp(app);
}
