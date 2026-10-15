import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from './test-electron.mjs';
import { createEffect, renderEffects, modelUrl } from './effects-reference.mjs';
import { fileAction } from './file-action.mjs';
import { closeTestApp } from './close-test-app.mjs';
const { getEffectDefinition, supportsSeedVariation } = await import(modelUrl);
const creativeSuite = process.argv.includes('--creative-suite');
const set2 = process.argv.includes('--set2');
const set2Variants = {
  'shader-contour-melt': [
    {},
    { hue: 120 },
    { style: 'terraces', phase: 0.23 },
    { flow: 0.9, pixelSize: 0.05, contours: 32 },
    { fieldSource: 'perlin', fieldInvert: 'on' },
    { fieldSource: 'radial', sourceMix: 0.8 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-filament-flow': [
    {},
    { hue: -120 },
    { style: 'ribbons', phase: 0.23 },
    { style: 'fibers', curl: 0.9, density: 1 },
    { directionSource: 'spiral', directionInfluence: 0.8 },
    { directionSource: 'flow', directionSeed: 9 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-signal-orb': [
    {},
    { objects: 'on', phase: 0.23 },
    { objects: 'on', orbRadius: 0.5, objectRotation: 85 },
    { style: 'stepped', signalNoise: 0.8 },
    { rotation: 39, scale: 8 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-hatched-solids': [
    {},
    { objects: 'on', scatterX: 0, scatterY: 2, phase: 0.23 },
    ...['sphere', 'cube', 'cylinder', 'cone', 'mixed'].map((primitive) => ({
      objects: 'on',
      primitive,
      objectCount: 4,
      phase: 0.23,
    })),
    { objects: 'on', cameraYaw: 45, cameraPitch: -25, objectRotation: 90, lighting: 0.9 },
    { style: 'cross' },
    { style: 'engraved', sourceMix: 0.2 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-mandelbrot-slices': [
    {},
    { sliceIndex: 3, boundary: 0.1 },
    { fractalZoom: 128, fractalX: -0.7435, fractalY: 0.1314 },
    { style: 'image', phase: 0.23 },
    { objects: 'on', slices: 5, iterations: 32 },
    { objects: 'on', slices: 3, thickness: 0.08, spacing: 0.18, cameraYaw: 45, cameraPitch: -20 },
    { fractalZoom: 5, fractalX: -0.75, fractalY: 0.1 },
    { iterations: 96, fractalZoom: 16, fractalX: -0.7435, fractalY: 0.1314, style: 'image' },
    { objects: 'on', iterations: 96, slices: 4, fractalZoom: 3 },
    { rotation: 35, scale: 5 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-arc-network': [
    {},
    { style: 'procedural', phase: 0.23 },
    { branchLength: 1.4, jaggedness: 0.9, charge: 1 },
    { emitterDensity: 0.3, lineWidth: 0.09, glow: 0.8 },
    { rotation: 39 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-bead-weave': [
    {},
    { style: 'beads', phase: 0.23 },
    { style: 'squares', gaps: 0.4 },
    { rowSpacing: 1.7, wave: 0.9, stagger: 1 },
    { ringWidth: 0.4, beadSize: 0.45 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-facet-mandala': [
    {},
    { scale: 1 },
    { scale: 6 },
    { style: 'diamonds', phase: 0.23 },
    { symmetry: 7, rings: 7, overlap: 0.8 },
    { divisions: 5, outline: 0.4, ringRotation: 60 },
    { rotation: 39 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-particle-web': [
    {},
    { style: 'uniform', phase: 0.23 },
    { density: 0.6, connectionDistance: 1.7 },
    { coreFalloff: 0.9, lineWidth: 0.08, glow: 0.8 },
    { jitter: 0.9, rotation: 39 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'shader-liquid-foil': [
    {},
    ...['sphere', 'torus', 'rings'].map((geometry) => ({ objects: 'on', geometry, phase: 0.23 })),
    { fieldSource: 'perlin', heightRelief: 0.9 },
    { objects: 'on', objectRotation: 80, cameraPitch: -30, roughness: 0.8 },
    { style: 'sharp', metallic: 0.3, foldStrength: 0.9 },
    { alpha: 'opaque' },
    { strength: 0 },
  ],
  'granular-echo': [
    {},
    { phase: 0.23, trailLength: 35, breakup: 0.8 },
    { monochrome: 'on' },
    { colorSource: 'chosen', particleColorMode: 'gradient', particleColorEnd: '#44e7ff' },
    { directionSource: 'spiral' },
    { particleSize: 5, trailLayers: 9 },
    { trailLength: 0 },
  ],
  'pigment-drag': [
    {},
    { phase: 0.23, dragLength: 40, scraping: 0.8 },
    { drips: 0.9, grain: 0.7 },
    { colorMix: 0.8, pigmentColorMode: 'gradient', pigmentColorEnd: '#44e7ff' },
    { directionSource: 'radial' },
    { brushSize: 8, retention: 0.8 },
    { dragLength: 0, drips: 0 },
  ],
  'system-crash': [
    {},
    { windowPlacement: 'grid', windowCenterX: 25, windowSpreadY: 20 },
    { windowPlacement: 'horizontal', windowSpreadX: 130 },
    { windowPlacement: 'vertical', windowCenterY: 70 },
    { annotations: 'on' },
    { annotations: 'on', connectorStyle: 'straight', labelText: 'TEST / SIGNAL' },
    { annotations: 'on', annotationLabels: 'off', overlayFrames: 'off' },
    { annotations: 'on', anchorDensity: 0.9, overlayWidth: 0.4 },
  ],
  'terminal-wireframe': [
    {},
    { traceStyle: 'circuit' },
    { traceStyle: 'circuit', rightAngleBias: 0 },
    { traceStyle: 'circuit', channelSeparation: 0.15, phase: 0.23 },
  ],
  'contour-waves': [
    {},
    { breakup: 0.6 },
    { stepSize: 4, tearStrength: 9, phase: 0.23 },
    { fieldSource: 'perlin', breakup: 0.5, tearStrength: 5 },
  ],
  'block-corruption': [
    {},
    { replacement: 'checker' },
    { replacement: 'noise', replacementColorMode: 'gradient', replacementColorEnd: '#55ccff' },
    { erosion: 0.8, fragmentTravel: 12 },
  ],
  'shader-signal-collapse': [
    {},
    { treatment: 'slabs' },
    { treatment: 'eroded', phase: 0.23, slabRoughness: 0.9, slabLevels: 3 },
    { treatment: 'slabs', slabTravel: 0.9, stripeAngle: 65, slabDropout: 0.7 },
  ],
  'shader-diffraction': [
    {},
    { treatment: 'projector' },
    { treatment: 'projector', phase: 0.23, fanSpread: 130, rayLength: 1.4 },
    { treatment: 'projector', gratingFrequency: 42, centerX: 15, centerY: 65, rotation: 39 },
  ],
  'shader-liquid-marbling': [
    {},
    { style: 'ink', phase: 0.23 },
    { swirl: 0.9, bands: 19, sharpness: 0.2, travel: 25 },
    { fieldSource: 'perlin', fieldInvert: 'on', colorMix: 0.9 },
    { rotation: 39, edgeHandling: 'wrap', sourceMix: 0.6 },
    { alpha: 'opaque', strength: 1 },
    { strength: 0 },
  ],
  'shader-truchet-mosaic': [
    {},
    { style: 'arcs', arcWidth: 0.35 },
    { style: 'dots', dotSize: 0.35, dotDensity: 0.9, phase: 0.23 },
    { style: 'mixed', rotation: 39, grid: 0.6 },
    { sourceMix: 0.8, colorMix: 0.2, scale: 13 },
    { alpha: 'opaque', strength: 1 },
    { strength: 0 },
  ],
  'shader-microculture': [
    {},
    { style: 'colonies', phase: 0.23 },
    { lens: 1 },
    { style: 'colonies', lens: 0.8, phase: 0.23 },
    { radius: 0.7, membrane: 0.3, granules: 0.8, clustering: 0.9 },
    { radius: 0 },
    { membrane: 0, sourceMix: 0.7, rotation: 39 },
    { alpha: 'opaque', strength: 1 },
    { strength: 0 },
  ],
  'shader-prismatic-panels': [
    {},
    { style: 'pastel', phase: 0.23 },
    { widthVariation: 0, refraction: 20, softness: 0.9 },
    { edgeWidth: 0.3, iridescence: 0, sourceMix: 0.9 },
    { rotation: 39, edgeHandling: 'mirror' },
    { alpha: 'opaque', strength: 1 },
    { strength: 0 },
  ],
  'pixel-stretch': [
    {},
    { style: 'bands', axis: 'horizontal', phase: 0.23 },
    { style: 'radial', originX: 28, originY: 63, density: 0.9 },
    { length: 65, stripWidth: 9, softness: 0.7, threshold: 0.3 },
    { length: 0 },
    { density: 0 },
    { edgeHandling: 'wrap' },
    { style: 'radial', edgeBias: 1, protectedRadius: 25, originX: 40, originY: 60 },
    { style: 'bands', axis: 'horizontal', protectedRadius: 45, originX: 35, originY: 70 },
  ],
  'led-matrix': [
    {},
    { shape: 'square', gap: 0.6, glow: 0.8, phase: 0.23 },
    { shape: 'ring', rotation: 39, brightness: 2 },
    { deadCells: 1 },
    {
      coloring: 'chosen',
      ledColorMode: 'gradient',
      ledColorEnd: '#66ffff',
      backgroundColorMode: 'gradient',
      backgroundColorEnd: '#332266',
    },
    { cellSize: 10, gap: 1 },
    { glow: 0 },
    { brightnessSource: 'pattern', patternFrequency: 17, phase: 0.23 },
    { brightnessSource: 'pattern', patternFrequency: 2, shape: 'ring', coloring: 'chosen' },
  ],
};
const cpu = process.argv.includes('--cpu'),
  output = resolve(
    set2
      ? 'test-results/set2-effects'
      : creativeSuite
        ? 'test-results/creative-suite'
        : 'test-results/reference-collection',
  );
const workflowOnly = process.argv.includes('--workflow-only');
await mkdir(output, { recursive: true });
const executablePath = process.argv.slice(2).find((arg) => arg.endsWith('.exe'));
const label = `${executablePath ? 'packaged-' : ''}${cpu ? 'cpu' : 'gpu'}`;
const requestedTypes =
  process.argv
    .find((arg) => arg.startsWith('--effects='))
    ?.slice(10)
    .split(',') ?? [];
const types = (
  set2
    ? Object.keys(set2Variants)
    : creativeSuite
      ? ['cel-shading', 'shader-signal-collapse', 'shader-paint-flow', 'shader-billowing-smoke']
      : [
          'shader-chromatic-erosion',
          'shader-radial-extrusion',
          'shader-cellular-mesh',
          'shader-particle-burst',
          'shader-spectral-terrain',
          'shader-neon-edges',
          'shader-wire-ghost',
          'shader-prismatic-shatter',
          'shader-bloom-field',
          'window-fragments',
          'contour-waves',
          'pixel-dissolve',
          'neon-print',
          'system-crash',
          'terminal-wireframe',
          'signal-weave',
          'data-weave',
          'micro-collage',
        ]
).filter((type) => requestedTypes.length === 0 || requestedTypes.includes(type));
for (const type of requestedTypes)
  assert.ok(types.includes(type), `Unknown reference effect ${type}`);
const width = 71,
  height = 53,
  pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4] : (i * 37) % 256,
  );
const sharp = createRequire(resolve('apps/desktop/package.json'))('sharp');
const imagePath = resolve(output, `${label}-input.png`);
await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(imagePath);
const worker = (await readdir(resolve('apps/desktop/out/renderer/assets'))).find((name) =>
  /^effect-worker-.*\.js$/.test(name),
);
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: await mkdtemp(resolve(output, 'profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const launch = () =>
  electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    args: [
      ...(executablePath ? [] : [resolve('apps/desktop')]),
      '--smoke-test',
      ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
    ],
    env,
  });
let app = await launch();
let cases = 0;
try {
  let page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, imagePath);
  async function check(effect, layers = []) {
    const actual = await page.evaluate(
      async ({ worker, effect, width, height, bytes, layers }) => {
        const w = (window.__referenceWorker ??= new Worker(new URL(worker, location.href), {
          type: 'module',
        }));
        const reply = await new Promise((resolve, reject) => {
          w.onmessage = (e) => resolve(e.data);
          w.onerror = (e) => reject(Error(e.message));
          w.postMessage({
            kind: 'render',
            id: 1,
            image: { width, height, pixels: Uint8Array.from(bytes).buffer },
            effects: [effect],
            layerImages: layers.map(({ id, image }) => ({
              id,
              image: { ...image, pixels: Uint8Array.from(image.pixels).buffer },
            })),
            masterSeed: 8172,
            reference: { width, height },
            purpose: 'export',
          });
        });
        if (reply.kind !== 'success') throw Error(reply.error);
        return { ...reply.image, pixels: [...new Uint8Array(reply.image.pixels)] };
      },
      { worker: `assets/${worker}`, effect, width, height, bytes: [...pixels], layers },
    );
    if (effect.type.startsWith('shader-'))
      assert.equal(actual.shaderBackend, cpu ? 'cpu' : 'webgpu', actual.shaderReason);
    const expected = new Uint8Array(
      renderEffects({ width, height, pixels: pixels.buffer }, [effect], {
        masterSeed: 8172,
        layerImages: new Map(
          layers.map(({ id, image }) => [
            id,
            { ...image, pixels: Uint8Array.from(image.pixels).buffer },
          ]),
        ),
      }).pixels,
    );
    let max = 0,
      worst = 0,
      alpha = 0,
      total = 0;
    for (let i = 0; i < expected.length; i += 4) {
      alpha = Math.max(alpha, Math.abs(expected[i + 3] - actual.pixels[i + 3]));
      for (let c = 0; c < 3; c++) {
        const difference = Math.abs(
          (expected[i + c] * expected[i + 3]) / 255 -
            (actual.pixels[i + c] * actual.pixels[i + 3]) / 255,
        );
        total += difference;
        if (difference > max) {
          max = difference;
          worst = i + c;
        }
      }
    }
    // The fixed-point fractal orbits match exactly. Floating-point camera
    // projection and interpolation can add one visible level at isolated
    // boundary pixels; also bound mean error so broad drift cannot pass.
    const fractal = effect.type === 'shader-mandelbrot-slices';
    const mean = total / (width * height * 3);
    assert.ok(
      max <= (cpu ? 0 : fractal ? 4 : 3) && alpha <= (cpu ? 0 : 1) && (!fractal || mean <= 0.5),
      `${effect.type} GPU/CPU mismatch ${max}, mean ${mean}, alpha ${alpha}, pixel ${Math.floor(worst / 4) % width},${Math.floor(worst / 4 / width)} CPU ${expected[worst]} GPU ${actual.pixels[worst]}: ${JSON.stringify(effect.params)}`,
    );
    cases++;
  }
  for (const type of workflowOnly ? [] : types) {
    const base = createEffect(type, 'native-reference');
    const variants = set2
      ? set2Variants[type]
      : type === 'cel-shading'
        ? [
            {},
            { shadeBands: 8, colorBands: 3 },
            { outlineWidth: 1, outlineThreshold: 0.03, outlineColor: '#ff3300' },
            { smoothing: 2, saturation: 0 },
            { amount: 0 },
          ]
        : type === 'shader-signal-collapse'
          ? [
              {},
              { collapse: 0.9, stretch: 0.9, static: 0.6, dropout: 0.4 },
              { scale: 7, phase: 0.23, rotation: 30 },
              { collapse: 0, static: 0, dropout: 0, colorMix: 0, stretch: 1, ribbons: 1 },
              { collapse: 0, static: 0, dropout: 0, colorMix: 0, stretch: 0.2, ribbons: 0.61 },
              { collapse: 0, stretch: 0, static: 0, dropout: 0, colorMix: 0 },
              { colorMix: 1, patternColor: '#ffff00', edgeHandling: 'wrap' },
              { strength: 0 },
            ]
          : type === 'shader-paint-flow'
            ? [
                {},
                { paintStyle: 'liquid', phase: 0.23 },
                { radius: 0.8, viscosity: 0.1, travel: 30, density: 0.4 },
                { paintStyle: 'liquid', phase: 0.7, colorMix: 1, sourceMix: 0.2 },
                { colorMix: 0.5, rotation: 35, edgeHandling: 'mirror' },
                {
                  viscosity: 0,
                  colorVariation: 1,
                  colorMix: 1,
                  radius: 0.3,
                  density: 0.4,
                  rotation: 90,
                },
                { viscosity: 1, colorVariation: 0.5, colorMix: 1 },
                { paintStyle: 'liquid', viscosity: 0, colorVariation: 1 },
                { density: 0, sourceMix: 1 },
                { strength: 0 },
              ]
            : type === 'shader-billowing-smoke'
              ? [
                  {},
                  { phase: 0.23, turbulence: 0.9, light: 1 },
                  { phase: 0.25, eddyStrength: 1, eddyScale: 2 },
                  { phase: 0.5, eddyStrength: 1, eddyScale: 0.5 },
                  { phase: 0.75, eddyStrength: 0, eddyScale: 6 },
                  { smokeLayers: 8, softness: 0.1, density: 0.7 },
                  { alpha: 'opaque', colorMix: 0, rotation: 35 },
                  { scale: 2, volume: 0.2, patternColor: '#ff5500' },
                  { density: 0 },
                  { volume: 0 },
                  { strength: 0 },
                ]
              : type === 'shader-bloom-field'
                ? [
                    {},
                    { phase: 0.23 },
                    { petals: 3, radius: 0.4 },
                    { dotSize: 0.15, density: 0.9, noiseScale: 7 },
                    { rotation: 35, scale: 6 },
                    { colorMix: 0.4, patternColor: '#ff0066', backgroundColor: '#221144' },
                    { alpha: 'opaque', strength: 1 },
                    { strength: 0 },
                  ]
                : type === 'shader-radial-extrusion'
                  ? [
                      {},
                      { spokes: 24, depth: 0.2 },
                      { tunnel: 0.3, facets: 0.1 },
                      { rotation: 35, phase: 0.3, colorMix: 0 },
                    ]
                  : type === 'shader-cellular-mesh'
                    ? [
                        {},
                        { holes: 0.7, rounding: 0.1 },
                        { fractures: 0.7, wireframe: 1 },
                        { rotation: 35, phase: 0.3, colorMix: 0 },
                      ]
                    : type === 'shader-particle-burst'
                      ? [
                          {},
                          { density: 0.9, particleSize: 0.3 },
                          { scatter: 1, branches: 1 },
                          { focalGlow: 1, focalLength: 0.6, rotation: 35, phase: 0.3 },
                        ]
                      : type === 'shader-spectral-terrain'
                        ? [
                            {},
                            { mode: 'terrain', height: 0.8, perspective: 0.8 },
                            { fieldSource: 'brightness', ridges: 7, lineWidth: 0.5 },
                            { fieldSource: 'radial', rotation: 35, phase: 0.3, colorMix: 0 },
                          ]
                        : type === 'shader-neon-edges'
                          ? [
                              {},
                              { edgeWidth: 1, glow: 0 },
                              { darkness: 0.3, colorMix: 0 },
                              { phase: 0.3, scale: 12, rotation: 35 },
                            ]
                          : type === 'shader-wire-ghost'
                            ? [
                                {},
                                { trails: 2, travel: 15 },
                                { disruption: 0.8, glow: 1, edgeWidth: 1 },
                                { phase: 0.3, rotation: 40, edgeHandling: 'mirror' },
                              ]
                            : type === 'shader-prismatic-shatter'
                              ? [
                                  {},
                                  { distortion: 20, grain: 1 },
                                  { interference: 0, shredding: 0 },
                                  { phase: 0.3, rotation: 35, scale: 35, edgeHandling: 'wrap' },
                                ]
                              : type === 'system-crash'
                                ? [
                                    {},
                                    { windowCount: 0, textSize: 3, text: 'HELLO GLEECH' },
                                    { textDensity: 0.3, threshold: 0.7, sourceMix: 0.4 },
                                    {
                                      windowCount: 10,
                                      windowSize: 35,
                                      windowTravel: 40,
                                      phase: 0.3,
                                    },
                                  ]
                                : type === 'terminal-wireframe'
                                  ? [
                                      {},
                                      { cellSize: 3, edgeStrength: 9 },
                                      { continuity: 0.2, density: 0.9, perspective: 0.7 },
                                      {
                                        sourceMix: 0.5,
                                        frame: 'on',
                                        phase: 0.2,
                                        colorSource: 'source',
                                      },
                                    ]
                                  : type === 'signal-weave'
                                    ? [
                                        {},
                                        { rasterSpacing: 2, rasterWidth: 0.8 },
                                        { bands: 7, colorMix: 0 },
                                        { dropouts: 0.5, distortion: 20, phase: 0.3 },
                                        { edgeHandling: 'wrap', backgroundColor: '#2a0655' },
                                      ]
                                    : type === 'data-weave'
                                      ? [
                                          {},
                                          { dashLength: 4, spacing: 1, rowSpacing: 2 },
                                          { thickness: 0.3, disruption: 0.7, phase: 0.2 },
                                          {
                                            sourceMix: 0.4,
                                            colorSource: 'chosen',
                                            lineColor: '#ff2244',
                                          },
                                        ]
                                      : type === 'micro-collage'
                                        ? [
                                            {},
                                            { fragmentSize: 8, spacing: 0.2 },
                                            { travel: 30, zoom: 3, phase: 0.3 },
                                            { rotation: 90, sourceMix: 0, edgeHandling: 'mirror' },
                                          ]
                                        : type === 'shader-chromatic-erosion'
                                          ? [
                                              {},
                                              { phase: 0.3 },
                                              { distortion: 0, colorMix: 1 },
                                              { distortion: 15, colorMix: 0 },
                                              { erosion: 0.7, banding: 3 },
                                              { rotation: 35, edgeHandling: 'wrap' },
                                              { edgeHandling: 'mirror', colorMix: 0.4 },
                                              { strength: 0 },
                                            ]
                                          : type === 'window-fragments'
                                            ? [
                                                {},
                                                { count: 3, borderWidth: 1, decorations: 'on' },
                                                { phase: 0.25, colorShift: 1 },
                                                { zoom: 3, travel: 40 },
                                              ]
                                            : type === 'pixel-dissolve'
                                              ? [
                                                  {},
                                                  { dissolve: 0, breakup: 0 },
                                                  { dissolve: 1 },
                                                  {
                                                    cellSize: 4,
                                                    bias: 'bright',
                                                    softness: 0.3,
                                                    phase: 0.2,
                                                  },
                                                  {
                                                    fill: 'background',
                                                    backgroundColor: '#ff8800',
                                                    scatter: 25,
                                                    direction: 45,
                                                  },
                                                ]
                                              : type === 'neon-print'
                                                ? [
                                                    {},
                                                    { grain: 0, outlines: 0 },
                                                    { cellSize: 2, contrast: 2 },
                                                    {
                                                      inkColor1: '#ff0000',
                                                      inkColor2: '#00ff00',
                                                      inkColor3: '#ccccff',
                                                      outlineWidth: 1,
                                                    },
                                                  ]
                                                : [
                                                    {},
                                                    { lines: 24, rotation: 35 },
                                                    { fieldSource: 'radial', amplitude: 20 },
                                                    {
                                                      fieldSource: 'perlin',
                                                      lineWidth: 0.8,
                                                      sourceMix: 0.4,
                                                    },
                                                  ];
    for (const params of variants) await check({ ...base, params: { ...base.params, ...params } });
    if (type !== 'contour-waves') await check({ ...base, seedOffset: 1 });
    else if (set2)
      await check({
        ...base,
        seedOffset: 1,
        params: { ...base.params, breakup: 0.6, tearStrength: 6 },
      });
    if (type === 'shader-particle-burst')
      await check({
        ...base,
        params: { ...base.params, branches: 0, scatter: 0, focalGlow: 0, phase: 0.23 },
      });
    for (const blendMode of ['color-dodge', 'color-burn', 'soft-light', 'hard-light', 'exclusion'])
      await check({ ...base, params: { ...base.params, blendMode, amount: 0.65 } });
    await check({
      ...base,
      params: {
        ...base.params,
        amount: 0.5,
        tintEnabled: 'on',
        tintStrength: 0.6,
        color: '#ff9900',
        blendMode: 'screen',
      },
    });
    await check({
      ...base,
      paintedMask: {
        version: 1,
        enabled: true,
        inverted: false,
        width,
        height,
        base: 0,
        strokes: [
          {
            size: 30,
            shape: 'circle',
            hardness: 0.4,
            falloff: 'smooth',
            mode: 'paint',
            points: [{ x: 0.5, y: 0.5 }],
          },
        ],
      },
    });
    await check({
      ...base,
      application: { ...base.application, region: 'top', coverage: 0.45, softness: 0.3 },
    });
    if (type.startsWith('shader-'))
      await check({
        ...base,
        paintedMask: {
          version: 1,
          enabled: true,
          inverted: false,
          width,
          height,
          base: 1,
          strokes: [],
          frame: { x: 10, y: -8, scaleX: 1.2, scaleY: 0.8, rotation: 25 },
          pattern: { attached: true, matrix: [1, 0, 0, 1, 0, 0] },
        },
      });
  }
  const mapPixels = [32, 32, 32, 255, 128, 128, 128, 255, 220, 220, 220, 255, 64, 64, 64, 255];
  const mapPath = resolve(output, `${label}-reference-map.png`);
  const mapPng = await sharp(Uint8Array.from(mapPixels), {
    raw: { width: 2, height: 2, channels: 4 },
  })
    .png()
    .toBuffer();
  await sharp(mapPng).toFile(mapPath);
  const fieldImage = {
    source: {
      id: 'native-map',
      name: 'reference-map.png',
      width: 2,
      height: 2,
      format: 'png',
      hasAlpha: true,
    },
    png: 'data:image/png;base64,' + mapPng.toString('base64'),
  };
  const layers = [{ id: 'native-map', image: { width: 2, height: 2, pixels: mapPixels } }];
  for (const type of workflowOnly || creativeSuite
    ? []
    : set2
      ? ['shader-liquid-marbling', 'shader-contour-melt', 'shader-liquid-foil']
      : ['contour-waves', 'shader-spectral-terrain']) {
    const e = createEffect(type, 'native-reference');
    for (const mode of type === 'shader-spectral-terrain' ? ['flat', 'terrain'] : ['flat'])
      await check(
        {
          ...e,
          fieldImage,
          params: {
            ...e.params,
            fieldSource: 'image',
            ...(type === 'shader-spectral-terrain' ? { mode } : {}),
            fieldNormalize: 'off',
          },
        },
        layers,
      );
  }
  for (const type of workflowOnly || creativeSuite || set2
    ? []
    : ['window-fragments', 'micro-collage']) {
    const e = createEffect(type, 'native-reference');
    await check({ ...e, image: fieldImage }, layers);
  }
  if (set2 && !workflowOnly)
    for (const type of ['shader-filament-flow', 'granular-echo', 'pigment-drag']) {
      const e = createEffect(type, 'native-reference');
      await check(
        {
          ...e,
          directionImage: fieldImage,
          params: { ...e.params, directionSource: 'image', directionInfluence: 0.85 },
        },
        layers,
      );
    }
  console.log(
    `${cases} ${cpu ? 'CPU' : 'GPU/CPU'} render comparisons passed; checking editing and persistence.`,
  );
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page
    .getByRole('status')
    .filter({ hasText: 'Opened ' + basename(imagePath) })
    .first()
    .waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640),
  );
  for (const type of types) {
    await page.getByRole('button', { name: 'Add effect', exact: true }).click();
    const tile = page.locator('.effect-picker').getByRole('button', {
      name: getEffectDefinition(createEffect(type, 'ui')).title,
      exact: true,
    });
    await tile.scrollIntoViewIfNeeded();
    await tile.locator('img').evaluate(async (n) => {
      await n.decode();
      if (n.naturalWidth !== 384) throw Error(`Missing effect thumbnail: ${n.src}`);
    });
    await tile.click();
    if (set2 && supportsSeedVariation(createEffect(type, 'pattern-check'))) {
      const pattern = page.getByRole('button', { name: 'New pattern', exact: true });
      await pattern.click();
      assert.match(await pattern.getAttribute('title'), /Current pattern: 1\./, type);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      assert.match(await pattern.getAttribute('title'), /Current pattern: 0\./, `${type} undo`);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      assert.match(await pattern.getAttribute('title'), /Current pattern: 1\./, `${type} redo`);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      const phase = page.getByRole('slider', { name: 'Phase', exact: true });
      if (await phase.count()) {
        await phase.fill('0.23');
        assert.equal(await phase.inputValue(), '0.23', `${type} phase`);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert.equal(await phase.inputValue(), '0', `${type} phase undo`);
      }
    }
    if (type.startsWith('shader-'))
      assert.equal(await page.getByRole('button', { name: 'New pattern', exact: true }).count(), 1);
    if (
      type === 'contour-waves' ||
      type === 'shader-spectral-terrain' ||
      type === 'shader-liquid-marbling'
    )
      assert.equal(
        await page.getByRole('combobox', { name: 'Field source', exact: true }).count(),
        1,
      );
    if (type === 'shader-spectral-terrain' || type === 'shader-liquid-marbling') {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, mapPath);
      await page.getByRole('button', { name: 'Import map...', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('select[aria-label="Field source"]')?.value === 'image',
      );
      await page.getByRole('combobox', { name: 'Field source', exact: true }).evaluate((n) => {
        if (n.value !== 'image') throw Error('Import did not select image source');
      });
      await page.locator('.depth-field-preview img').waitFor();
    }
    const bounds = await page
      .locator('.effect-detail')
      .evaluate((n) => ({ width: n.clientWidth, scroll: n.scrollWidth }));
    assert.ok(bounds.scroll <= bounds.width + 1, 'Control overflow');
  }
  const state = async () => {
    await page.waitForFunction(() => {
      const n = document.querySelector('.image-layer');
      return (
        n &&
        n.dataset.renderRevision === n.dataset.requestedRevision &&
        JSON.parse(n.dataset.renderRecipe ?? '[]').length ===
          document.querySelectorAll('.effect-row').length
      );
    });
    return page.locator('.image-layer').evaluate((n) => JSON.parse(n.dataset.renderRecipe));
  };
  const before = await state(),
    projectPath = resolve(output, `${cpu ? 'cpu' : 'gpu'}.gleech`);
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
  const exported = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(exported.info.width, width);
  assert.equal(exported.info.height, height);
  const masterSeed = Number(
    await page.getByRole('spinbutton', { name: 'Master seed', exact: true }).inputValue(),
  );
  const expectedExport = await page.evaluate(
    async ({ effects, bytes, width, height, masterSeed, mapPixels, worker }) => {
      const w = (window.__referenceWorker ??= new Worker(new URL(worker, location.href), {
        type: 'module',
      }));
      const layerImages = [];
      for (const effect of effects)
        for (const asset of [effect.image, effect.fieldImage]) {
          if (!asset || layerImages.some((layer) => layer.id === asset.source.id)) continue;
          layerImages.push({
            id: asset.source.id,
            image: { width: 2, height: 2, pixels: Uint8Array.from(mapPixels).buffer },
          });
        }

      const reply = await new Promise((resolve, reject) => {
        w.onmessage = (e) => resolve(e.data);
        w.onerror = (e) => reject(Error(e.message));
        w.postMessage({
          kind: 'render',
          id: 2,
          image: { width, height, pixels: Uint8Array.from(bytes).buffer },
          effects,
          layerImages,
          masterSeed,
          reference: { width, height },
          purpose: 'export',
        });
      });
      if (reply.kind !== 'success') throw Error(reply.error);
      return [...new Uint8Array(reply.image.pixels)];
    },
    {
      effects: before,
      bytes: [...pixels],
      width,
      height,
      masterSeed,
      mapPixels,
      worker: `assets/${worker}`,
    },
  );
  for (let i = 0; i < expectedExport.length; i += 4) {
    assert.equal(exported.data[i + 3], expectedExport[i + 3], `Export alpha at ${i / 4}`);
    if (expectedExport[i + 3] > 0)
      for (let c = 0; c < 3; c++)
        assert.equal(exported.data[i + c], expectedExport[i + c], `Export color at ${i / 4}`);
  }
  await page.getByRole('button', { name: 'Add effect', exact: true }).click();
  await page.getByRole('tab', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Save current stack', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Preset name', exact: true })
    .fill('Reference collection');
  // Full CPU stacks also render a statue thumbnail on hosted machines.
  await page
    .getByRole('img', { name: 'Statue preset preview', exact: true })
    .waitFor({ timeout: 180000 });
  await page.getByRole('radio', { name: 'Statue', exact: true }).check();
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Saved preset Reference collection' })
    .first()
    .waitFor();
  const preset = page.getByRole('button', { name: 'Apply Reference collection', exact: true });
  // Saving opens the library before its asynchronous list refresh completes.
  await preset.waitFor({ state: 'visible' });
  assert.equal(await preset.locator('.shader-mark').count(), 1);
  await preset.click();
  await page
    .locator('.preset-flyout')
    .getByRole('button', { name: 'Replace All', exact: true })
    .click();
  assert.deepEqual(await state(), before);
  if (!executablePath && (!creativeSuite || !cpu))
    await page.screenshot({ path: resolve(output, `${cpu ? 'cpu' : 'gpu'}-controls.png`) });
  if (set2) {
    await closeTestApp(app);
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow, dialog }, path) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, projectPath);
    await fileAction(page, 'Open project Ctrl+O');
    await page
      .getByRole('status')
      .filter({ hasText: 'Opened ' + basename(projectPath) })
      .first()
      .waitFor();
    assert.deepEqual(await state(), before, 'Complete reference stack survives process restart');
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      mode: cpu ? 'cpu' : 'gpu',
      cases,
      project: true,
      export: true,
      preset: true,
      ...(set2 ? { restart: true } : {}),
      result: 'passed',
    }),
  );
} finally {
  await closeTestApp(app);
}
