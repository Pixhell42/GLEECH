import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEffect, renderEffects, modelUrl } from './effects-reference.mjs';
const { BETA_SHADER_TYPES } = await import(modelUrl);

// Generate previews with the actual original shader algorithms and shipped sample.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const { data, info } = await sharp(resolve(root, 'apps/desktop/resources/presets/statue.png'))
  .resize(384, 384, { fit: 'cover' })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const image = { width: info.width, height: info.height, pixels: Uint8Array.from(data).buffer };
for (const type of [
  'shader-ripple',
  'shader-plasma',
  'shader-liquid-glass',
  'shader-iridescence',
  'shader-hologram',
  'shader-flow-field',
  'shader-caustics',
  'shader-liquid-chrome',
  'shader-heat-mirage',
  'shader-nebula',
  ...BETA_SHADER_TYPES,
]) {
  const effect = createEffect(type, 'shader-thumbnail');
  const params = {
    'shader-ripple': { strength: 12, scale: 5 },
    'shader-plasma': { scale: 3 },
    'shader-liquid-glass': { strength: 10, scale: 2 },
    'shader-flow-field': { strength: 12, scale: 2 },
    'shader-iridescence': { strength: 1, scale: 2 },
    'shader-hologram': { strength: 1, scale: 4 },
    'shader-caustics': { strength: 1, scale: 3, focus: 8, dispersion: 0.65 },
    'shader-liquid-chrome': { strength: 10, scale: 2, shine: 0.75, contrast: 3 },
    'shader-heat-mirage': { strength: 14, scale: 3, direction: 90, falloff: 0.35 },
    'shader-nebula': { strength: 1.6, scale: 1, detail: 5, core: 0.85 },
    'shader-cellular-membrane': { strength: 12, scale: 5, colorMix: 0.8 },
    'shader-moire': { strength: 0.9, scale: 10, colorMix: 0.85 },
    'shader-digital-fracture': { strength: 12, scale: 6, structure: 0.2, colorMix: 0.8 },
    'shader-diffraction': {
      strength: 1,
      scale: 1,
      accent: 0.85,
      threshold: 0.45,
      variant: 'third',
    },
    'shader-infinity-tunnel': { strength: 15, scale: 2, structure: 4, colorMix: 0.7 },
    'shader-crystal-facets': { strength: 12, scale: 5, colorMix: 0.75 },
    'shader-circuit-matrix': { strength: 0.9, scale: 9, colorMix: 0.85 },
    'shader-data-lattice': { strength: 0.85, scale: 12, colorMix: 0.85 },
    'shader-op-art': { strength: 0.9, scale: 5, colorMix: 0.85 },
    'shader-polar-grid': { strength: 0.9, scale: 4, structure: 20, colorMix: 0.85 },
  }[type];
  const result = renderEffects(image, [{ ...effect, params: { ...effect.params, ...params } }], {
    masterSeed: 8172,
  });
  await sharp(Buffer.from(result.pixels), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .webp({ quality: 90 })
    .toFile(resolve(root, `apps/desktop/src/renderer/src/assets/effects/${type}.webp`));
}
