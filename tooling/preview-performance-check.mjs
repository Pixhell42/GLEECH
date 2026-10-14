import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { createEffect, modelUrl } from './effects-reference.mjs';
import { closeTestApp } from './close-test-app.mjs';

const { EFFECT_DEFINITIONS } = await import(modelUrl);
const cpu = process.argv.includes('--cpu');
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'current';
const output = resolve('test-results/preview-performance');
await mkdir(output, { recursive: true });
const sharp = createRequire(resolve('apps/desktop/package.json'))('sharp');
const width = 256,
  height = 256;
const pixels = await sharp('apps/desktop/resources/presets/statue.png')
  .resize(width, height)
  .ensureAlpha()
  .raw()
  .toBuffer();
const worker = (await readdir('apps/desktop/out/renderer/assets')).find((name) =>
  /^effect-worker-.*\.js$/.test(name),
);
assert.ok(worker);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
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
    ({ worker, bytes }) => {
      window.__performanceWorker = new Worker(new URL(worker, location.href), { type: 'module' });
      window.__performancePixels = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
    },
    { worker: `assets/${worker}`, bytes: pixels.toString('base64') },
  );
  // Cold first shader plus the full ordinary catalog; imported packages and
  // image-dependent tiles need their own supplied fixtures.
  const types = [
    'shader-contour-melt',
    ...Object.keys(EFFECT_DEFINITIONS).filter(
      (type) =>
        ![
          'shader-contour-melt',
          'shader-import',
          'solid',
          'reference-mosh',
          'vector-corruption',
          'motion-transfer',
        ].includes(type),
    ),
  ];
  for (const [id, type] of types.entries()) {
    const effect = createEffect(type, 'performance');
    const result = await page.evaluate(
      async ({ effect, id, width, height }) => {
        const run = async () => {
          const started = performance.now();
          const reply = await new Promise((resolve, reject) => {
            const worker = window.__performanceWorker;
            worker.onmessage = async (e) => {
              if (e.data.kind === 'jpeg-request') {
                try {
                  const result = await window.gleech.recompressJpeg(e.data.image, e.data.options);
                  if (!result.ok) throw Error(result.error);
                  worker.postMessage(
                    {
                      kind: 'jpeg-result',
                      id: e.data.id,
                      codecId: e.data.codecId,
                      pixels: result.value,
                    },
                    [result.value],
                  );
                } catch (error) {
                  worker.postMessage({
                    kind: 'jpeg-error',
                    id: e.data.id,
                    codecId: e.data.codecId,
                    error: String(error),
                  });
                }
              } else if (['success', 'error'].includes(e.data.kind)) resolve(e.data);
            };
            worker.onerror = (e) => reject(Error(e.message));
            worker.postMessage({
              kind: 'render',
              id,
              image: { width, height, pixels: window.__performancePixels.slice().buffer },
              effects: [effect],
              masterSeed: 8172,
              reference: { width, height },
              purpose: 'preview',
            });
          });
          if (reply.kind !== 'success') throw Error(reply.error);
          return {
            milliseconds: performance.now() - started,
            backend: reply.image.shaderBackend,
            reason: reply.image.shaderReason,
          };
        };
        const cold = await run();
        const warm = await run();
        return { ...cold, warmMilliseconds: warm.milliseconds };
      },
      { effect, id, width, height },
    );
    if (type.startsWith('shader-'))
      assert.equal(result.backend, cpu ? 'cpu' : 'webgpu', result.reason);
    results.push({ type, ...result });
    await writeFile(
      resolve(output, `${label}-${cpu ? 'cpu' : 'gpu'}.json`),
      JSON.stringify({ width, height, results }, null, 2),
    );
    if (id === 0 || result.milliseconds > 150) console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(
    resolve(output, `${label}-${cpu ? 'cpu' : 'gpu'}.json`),
    JSON.stringify({ width, height, results }, null, 2),
  );
  console.log(
    `Audited ${results.length} effects. Slowest warm previews:`,
    results
      .slice(1)
      .sort((a, b) => b.warmMilliseconds - a.warmMilliseconds)
      .slice(0, 8),
  );
} finally {
  await closeTestApp(app);
}
