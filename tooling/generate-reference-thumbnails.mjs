import { createRequire } from 'node:module';
import { createEffect, renderEffectsAsync } from './effects-reference.mjs';
const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const raw = await sharp('apps/desktop/resources/presets/statue.png')
  .resize(384, 384)
  .ensureAlpha()
  .raw()
  .toBuffer();
const types = [
  'cel-shading',
  'shader-signal-collapse',
  'shader-paint-flow',
  'shader-billowing-smoke',
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
];
const requested = process.argv.slice(2);
for (const type of types.filter((type) => !requested.length || requested.includes(type))) {
  const effect = createEffect(type, 'reference-thumbnail');
  const params =
    type === 'shader-bloom-field'
      ? { strength: 1, scale: 12, dotSize: 0.08, density: 0.6 }
      : type === 'shader-chromatic-erosion'
        ? { strength: 1, colorMix: 1, distortion: 13 }
        : type === 'window-fragments'
          ? { count: 12, colorShift: 0.8, borderWidth: 0.4 }
          : ({
              'cel-shading': {
                shadeBands: 3,
                colorBands: 5,
                smoothing: 0.6,
                outlineWidth: 0.6,
                outlineThreshold: 0.08,
              },
              'shader-signal-collapse': {
                strength: 1,
                collapse: 0.8,
                static: 0.6,
                stretch: 0.8,
                dropout: 0.25,
              },
              'shader-paint-flow': {
                strength: 1,
                scale: 7,
                density: 0.7,
                radius: 0.4,
                colorMix: 0.65,
                colorVariation: 0.5,
                viscosity: 0.15,
                sourceMix: 0.15,
                travel: 25,
              },
              'shader-billowing-smoke': {
                strength: 1,
                alpha: 'opaque',
                density: 0.8,
                volume: 0.9,
                light: 0.9,
                scale: 3,
                phase: 0.18,
                eddyStrength: 0.85,
                eddyScale: 2.4,
              },
              'shader-neon-edges': { strength: 1, glow: 1, darkness: 1 },
              'shader-wire-ghost': { strength: 1, trails: 5, travel: 12 },
              'shader-prismatic-shatter': { strength: 1, colorMix: 0.9 },
              'shader-radial-extrusion': { strength: 1, depth: 0.85, colorMix: 0.55, facets: 0.8 },
              'shader-cellular-mesh': { strength: 1, holes: 0.5, wireframe: 0.65 },
              'shader-particle-burst': {
                strength: 1,
                patternColor: '#ff3b32',
                density: 0.85,
                particleSize: 0.12,
                scatter: 0.9,
              },
              'shader-spectral-terrain': { strength: 1, scale: 2, lineWidth: 0.3, height: 0.5 },
              'terminal-wireframe': { density: 0.9, edgeStrength: 9, continuity: 0.9 },
            }[type] ?? {});
  const result = await renderEffectsAsync(
    { width: 384, height: 384, pixels: Uint8Array.from(raw).buffer },
    [{ ...effect, params: { ...effect.params, ...params } }],
    { masterSeed: 8172, yieldControl: async () => {} },
  );
  await sharp(Buffer.from(result.pixels), { raw: { width: 384, height: 384, channels: 4 } })
    .webp({ quality: 95 })
    .toFile(`apps/desktop/src/renderer/src/assets/effects/${type}.webp`);
  console.log(`Rendered ${type}`);
}
