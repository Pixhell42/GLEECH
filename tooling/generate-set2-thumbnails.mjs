import { createRequire } from 'node:module';
import { createEffect, renderEffectsAsync } from './effects-reference.mjs';
const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const size = 384;
const pixels = await sharp('apps/desktop/resources/presets/statue.png')
  .resize(size, size)
  .ensureAlpha()
  .raw()
  .toBuffer();
const recipes = {
  'shader-contour-melt': { sourceMix: 0.25, flow: 0.85, fieldSource: 'perlin', colorMix: 0.9 },
  'shader-filament-flow': { style: 'ribbons', density: 0.9, thickness: 0.25, sourceMix: 0.5 },
  'shader-signal-orb': { objects: 'on', alpha: 'opaque', sourceMix: 0.35, colorMix: 0.8 },
  'shader-hatched-solids': {
    objects: 'on',
    alpha: 'opaque',
    sourceMix: 0.15,
    colorMix: 0.05,
    patternColor: '#eee0c7',
    backgroundColor: '#10272c',
    scatter: 0.65,
    objectCount: 5,
  },
  'shader-mandelbrot-slices': {
    objects: 'on',
    alpha: 'opaque',
    sourceMix: 0.35,
    slices: 7,
    fractalZoom: 1.2,
  },
  'shader-arc-network': { style: 'procedural', sourceMix: 0.2, alpha: 'opaque', charge: 1 },
  'shader-bead-weave': { sourceMix: 0.25, alpha: 'opaque', style: 'rings', scale: 12 },
  'shader-facet-mandala': { sourceMix: 0.15, alpha: 'opaque', outline: 0.2, colorMix: 0.6 },
  'shader-particle-web': { sourceMix: 0.2, alpha: 'opaque', lineWidth: 0.04, scale: 12 },
  'shader-liquid-foil': {
    sourceMix: 0.3,
    foldStrength: 0.8,
    objects: 'on',
    geometry: 'torus',
    alpha: 'opaque',
    fieldSource: 'perlin',
  },
  'granular-echo': { breakup: 0.55, trailLength: 24, trailLayers: 8, particleSize: 1.4 },
  'pigment-drag': { dragLength: 24, scraping: 0.65, drips: 0.7, retention: 0.15 },
  'shader-liquid-marbling': { strength: 0.9, swirl: 0.85, travel: 12, bands: 12, sourceMix: 0.15 },
  'shader-truchet-mosaic': { strength: 1, scale: 7, arcWidth: 0.22, sourceMix: 0, alpha: 'opaque' },
  'shader-microculture': {
    strength: 1,
    scale: 4,
    radius: 0.6,
    membrane: 0.17,
    granules: 0.7,
    sourceMix: 0.05,
    alpha: 'opaque',
  },
  'shader-prismatic-panels': {
    strength: 0.95,
    scale: 6,
    style: 'pastel',
    edgeWidth: 0.18,
    sourceMix: 0.35,
    iridescence: 1,
  },
  'pixel-stretch': {
    style: 'radial',
    length: 55,
    density: 0.95,
    stripWidth: 2,
    originX: 50,
    originY: 48,
  },
  'led-matrix': { cellSize: 3, gap: 0.4, glow: 0.5, brightness: 1.6, deadCells: 0.03 },
};
const requested = process.argv
  .find((arg) => arg.startsWith('--effects='))
  ?.slice(10)
  .split(',');
for (const [type, params] of Object.entries(recipes)) {
  if (requested && !requested.includes(type)) continue;
  const base = createEffect(type, 'set2-thumbnail');
  const result = await renderEffectsAsync(
    { width: size, height: size, pixels: Uint8Array.from(pixels).buffer },
    [{ ...base, params: { ...base.params, ...params } }],
    { masterSeed: 8172, yieldControl: async () => {} },
  );
  await sharp(Buffer.from(result.pixels), { raw: { width: size, height: size, channels: 4 } })
    .webp({ quality: 95 })
    .toFile(`apps/desktop/src/renderer/src/assets/effects/${type}.webp`);
  console.log(`Rendered ${type}`);
}
