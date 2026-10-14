/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createEffect,
  type BlurEffect,
  type NoiseGrainEffect,
  type EdgeHandling,
} from '@gleech/project-model';
import { renderEffects } from './index';

// Captured before optimizing the version-one kernels, independently of the
// current renderer. Mixed alpha also exercises premultiplication and hidden RGB.
const signatures = JSON.parse(
  readFileSync(new URL('./fixtures/noise-blur-v1.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const width = 97,
  height = 73;
const pixels = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    pixels.set(
      [
        (x * 17 + y * 7) % 256,
        (y * 23 + x * 3) % 256,
        ((x ^ y) * 13) % 256,
        [0, 1, 64, 128, 254, 255][x % 6]!,
      ],
      (y * width + x) * 4,
    );
const subjectMask = {
  width,
  height,
  values: Uint8Array.from({ length: width * height }, (_, i) =>
    i % width > 32 && i % width < 65 ? 255 : 0,
  ).buffer,
};
describe('version-one Noise / Blur pixel compatibility', () => {
  it.each(Object.entries(signatures))('%s matches the original pixels', (key, expected) => {
    const [type, style, edgeHandling] = key.split('/') as [
      'blur' | 'noise-grain',
      string,
      EdgeHandling,
    ];
    const effect = createEffect(type, type) as BlurEffect | NoiseGrainEffect;
    Object.assign(effect.params, { style, edgeHandling });
    if (type === 'noise-grain') Object.assign(effect.params, { coloring: 'color', detail: 4 });
    const result = renderEffects({ width, height, pixels: pixels.buffer }, [effect], {
      masterSeed: 123,
      subjectMask,
    });
    expect(createHash('sha256').update(new Uint8Array(result.pixels)).digest('hex')).toBe(expected);
  });
});
