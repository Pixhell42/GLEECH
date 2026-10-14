import { createRequire } from 'node:module';
import { recompressJpeg } from './jpeg-reference.mjs';
import { createEffect, renderEffectsAsync } from './effects-reference.mjs';

const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const raw = await sharp('apps/desktop/resources/presets/statue.png')
  .resize(384, 384)
  .ensureAlpha()
  .raw()
  .toBuffer();
const effect = createEffect('jpeg-recompression', 'thumbnail');
const output = await renderEffectsAsync(
  { width: 384, height: 384, pixels: Uint8Array.from(raw).buffer },
  [{ ...effect, params: { ...effect.params, quality: 3, generations: 5, qualityLoss: 1 } }],
  { recompressJpeg, yieldControl: async () => {} },
);
await sharp(Buffer.from(output.pixels), { raw: { width: 384, height: 384, channels: 4 } })
  .webp({ quality: 95 })
  .toFile('apps/desktop/src/renderer/src/assets/effects/jpeg-recompression.webp');
console.log('Rendered JPEG Recompression thumbnail using five actual codec generations.');
