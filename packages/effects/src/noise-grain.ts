import type { NoiseGrainEffect } from '@gleech/project-model';
import type { EffectImage } from './index';
import { createColorSampler } from './color-gradient';
import { createNoiseField, noiseValue } from './noise';

/** Keep per-pixel grain work independently optimizable from the stack dispatcher. */
export function* noiseGrainPixels(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: NoiseGrainEffect,
  reference: { width: number; height: number },
  random: (x: number, y: number, lane: number) => number,
  blend: (
    output: Uint8Array,
    input: Uint8Array,
    index: number,
    color: Float64Array,
    amount: number,
  ) => void,
): Generator<void> {
  const p = effect.params;
  const field = createNoiseField(p, random);
  const procedural = ['perlin', 'simplex', 'voronoi', 'value'].includes(p.style);
  const size =
    (Math.min(reference.width, reference.height) *
      (p.style === 'scan' ? (p.scanSpacing ?? 1) : procedural ? p.scale : p.size)) /
    100;
  const ramp = createColorSampler(p, 'noiseColor', p.noiseColor, reference, true);
  const color = new Float64Array(4);
  const values = new Float64Array(3);
  const valueAt = (nx: number, ny: number, lane: number) => {
    const value = field(nx, ny, p.coloring === 'color' ? lane * 211 : 0);
    return p.style === 'film'
      ? value * (1 - p.clumping) +
          noiseValue('value', nx / 4, ny / 4, random, lane + 601) * p.clumping
      : value;
  };
  for (let y = 0; y < image.height; y++) {
    const ny = ((y + 0.5) * reference.height) / image.height / size;
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const nx = ((x + 0.5) * reference.width) / image.width / size;
      const scanWidth = (p.scanWidth ?? 0.15) / (p.scanSpacing ?? 1);
      const inRow = ny - Math.floor(ny) < scanWidth;
      const inColumn = nx - Math.floor(nx) < scanWidth;
      const active =
        p.style === 'scan'
          ? p.scanDirection === 'vertical'
            ? inColumn
            : p.scanDirection === 'both'
              ? inRow || inColumn
              : inRow
          : !['speckle', 'salt-pepper'].includes(p.style) ||
            random(Math.floor(nx), Math.floor(ny), 903) < p.density;
      const luminance =
        (pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722) / 255;
      const response =
        p.style === 'film' ? 1 - p.tonalResponse * (1 - 4 * luminance * (1 - luminance)) : 1;
      values[0] = valueAt(nx, ny, 0);
      values[1] = p.coloring === 'color' ? valueAt(nx, ny, 1) : values[0]!;
      values[2] = p.coloring === 'color' ? valueAt(nx, ny, 2) : values[0]!;
      const selected =
        p.coloring === 'ramp'
          ? ramp((x + 0.5) / image.width, (y + 0.5) / image.height, values[0]!)
          : null;
      for (let c = 0; c < 3; c++)
        color[c] =
          !active || p.intensity === 0
            ? pixels[i + c]!
            : p.coloring === 'ramp'
              ? pixels[i + c]! * (1 - p.intensity) + selected![c]! * p.intensity
              : p.style === 'salt-pepper'
                ? pixels[i + c]! * (1 - p.intensity) + values[c]! * 255 * p.intensity
                : Math.max(
                    0,
                    Math.min(
                      255,
                      pixels[i + c]! + (values[c]! - 0.5) * 510 * p.intensity * response,
                    ),
                  );
      color[3] = pixels[i + 3]!;
      blend(output, pixels, i, color, p.amount);
      if (x % 64 === 63) yield;
    }
    yield;
  }
}
