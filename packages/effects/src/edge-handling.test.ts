import { describe, expect, it } from 'vitest';
import {
  createEffect,
  deriveEffectSeed,
  type EdgeHandling,
  type EffectInstance,
} from '@gleech/project-model';
import { cellRandom, renderEffects, renderEffectsAsync } from './index';

function fixture(width = 20, height = 16) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set(
        [x * 11, y * 13, (x * 7 + y * 5) % 256, [0, 64, 128, 255][x % 4]!],
        (y * width + x) * 4,
      );
  return { width, height, pixels: pixels.buffer };
}
const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);
const types = ['rgb-split', 'block-corruption', 'wave-distortion'] as const;

// Build a 3-by-3 texture explicitly: ordinary copies, reflected tiles, or solid borders.
// This oracle avoids using the renderer's coordinate mapper.
function tiled(image: ReturnType<typeof fixture>, mode: EdgeHandling) {
  const axis = (size: number) => {
    const forward = Array.from({ length: size }, (_, i) => i);
    const reverse = [...forward].reverse();
    return mode === 'extend'
      ? [...Array<number>(size).fill(0), ...forward, ...Array<number>(size).fill(size - 1)]
      : mode === 'mirror'
        ? [...reverse, ...forward, ...reverse]
        : [...forward, ...forward, ...forward];
  };
  const xs = axis(image.width),
    ys = axis(image.height),
    source = bytes(image.pixels);
  return (x: number, y: number) => {
    const index = (ys[y + image.height]! * image.width + xs[x + image.width]!) * 4;
    return source.subarray(index, index + 4);
  };
}

describe('distortion edge handling', () => {
  for (const mode of ['extend', 'wrap', 'mirror'] as const) {
    it(`samples both edges and axes with ${mode} in RGB split, preserving green and alpha`, () => {
      const image = fixture(),
        sample = tiled(image, mode),
        source = bytes(image.pixels);
      const effect = createEffect('rgb-split', 'rgb');
      const output = bytes(
        renderEffects(image, [
          {
            ...effect,
            params: { ...effect.params, horizontal: 10, vertical: 10, edgeHandling: mode },
          } as EffectInstance,
        ]).pixels,
      );
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4;
          expect([...output.subarray(i, i + 4)]).toEqual([
            sample(x - 2, y - 2)[0],
            source[i + 1],
            sample(x + 2, y + 2)[2],
            source[i + 3],
          ]);
        }
    });
    it(`samples whole RGBA with ${mode} in seeded block corruption`, () => {
      const image = fixture(),
        sample = tiled(image, mode);
      const effect = createEffect('block-corruption', 'blocks');
      const seed = deriveEffectSeed(8172, effect.instanceId);
      const output = bytes(
        renderEffects(
          image,
          [
            {
              ...effect,
              params: {
                ...effect.params,
                blockSize: 25,
                displacement: 25,
                density: 1,
                edgeHandling: mode,
              },
            } as EffectInstance,
          ],
          { masterSeed: 8172 },
        ).pixels,
      );
      let outside = 0;
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const dx = Math.round(
            (cellRandom(seed, Math.floor(x / 4), Math.floor(y / 4), 1) * 2 - 1) * 4,
          );
          const dy = Math.round(
            (cellRandom(seed, Math.floor(x / 4), Math.floor(y / 4), 2) * 2 - 1) * 4,
          );
          if (x + dx < 0 || x + dx >= image.width || y + dy < 0 || y + dy >= image.height)
            outside++;
          const i = (y * image.width + x) * 4;
          expect(output.subarray(i, i + 4)).toEqual(sample(x + dx, y + dy));
        }
      expect(outside).toBeGreaterThan(0);
    });
    it(`interpolates diagonal Wave boundaries with ${mode} without hidden RGB fringes`, () => {
      const image = fixture(),
        sample = tiled(image, mode);
      const effect = createEffect('wave-distortion', 'wave');
      const phase = cellRandom(deriveEffectSeed(19, effect.instanceId), 0, 0, 5) * Math.PI * 2;
      const cosine = Math.cos(Math.PI / 4),
        sine = Math.sin(Math.PI / 4);
      const output = bytes(
        renderEffects(
          image,
          [
            {
              ...effect,
              params: {
                ...effect.params,
                strength: 25,
                frequency: 2,
                direction: 45,
                edgeHandling: mode,
              },
            } as EffectInstance,
          ],
          { masterSeed: 19 },
        ).pixels,
      );
      let outside = 0;
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const delta =
            Math.sin(
              ((-sine * (x + 0.5 - image.width / 2) + cosine * (y + 0.5 - image.height / 2)) *
                Math.PI) /
                4 +
                phase,
            ) * 4;
          let sx = x - delta * cosine,
            sy = y - delta * sine;
          if (sx < 0 || sy < 0 || sx > image.width - 1 || sy > image.height - 1) outside++;
          // Preserve the old Extend interpolation arithmetic exactly.
          if (mode === 'extend') {
            sx = Math.max(0, Math.min(image.width - 1, sx));
            sy = Math.max(0, Math.min(image.height - 1, sy));
          }
          const left = Math.floor(sx),
            top = Math.floor(sy),
            tx = sx - left,
            ty = sy - top;
          const corners = [
            sample(left, top),
            sample(left + 1, top),
            sample(left, top + 1),
            sample(left + 1, top + 1),
          ];
          const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
          const alpha = corners.reduce((sum, pixel, i) => sum + pixel[3]! * weights[i]!, 0);
          const expected = [0, 1, 2].map((channel) =>
            Math.round(
              corners.reduce(
                (sum, pixel, i) =>
                  sum + pixel[channel]! * weights[i]! * (alpha > 0 ? pixel[3]! : 1),
                0,
              ) / (alpha || 1),
            ),
          );
          expected.push(Math.round(alpha));
          const i = (y * image.width + x) * 4;
          for (let c = 0; c < 4; c++)
            expect(Math.abs(output[i + c]! - expected[c]!)).toBeLessThanOrEqual(1);
        }
      expect(outside).toBeGreaterThan(0);
    });
  }
  it('retains exact legacy Extend output, masks and asynchronous behavior', async () => {
    const image = fixture();
    for (const type of types) {
      const explicit = createEffect(type, type);
      const params = { ...explicit.params };
      if ('edgeHandling' in params) delete params.edgeHandling;
      const legacy = { ...explicit, params } as EffectInstance;
      expect(bytes(renderEffects(image, [legacy]).pixels)).toEqual(
        bytes(renderEffects(image, [explicit]).pixels),
      );
      for (const mode of ['wrap', 'mirror'] as const) {
        const effect = {
          ...explicit,
          params: { ...explicit.params, edgeHandling: mode },
          application: { region: 'top', coverage: 0.5, softness: 0 },
        } as EffectInstance;
        const output = renderEffects(image, [effect]);
        expect(bytes(output.pixels).subarray(image.width * image.height * 2)).toEqual(
          bytes(image.pixels).subarray(image.width * image.height * 2),
        );
        expect(
          bytes(
            (await renderEffectsAsync(image, [effect], { yieldControl: async () => {} })).pixels,
          ),
        ).toEqual(bytes(output.pixels));
      }
    }
  });
  it('handles one-pixel dimensions in every mode without introducing color or alpha', () => {
    for (const image of [fixture(1, 1), fixture(1, 16), fixture(20, 1)]) {
      const input = bytes(image.pixels);
      for (let i = 0; i < input.length; i += 4) input.set([71, 93, 127, 128], i);
      for (const type of types)
        for (const mode of ['extend', 'wrap', 'mirror'] as const) {
          const effect = createEffect(type, type);
          const output = renderEffects(image, [
            { ...effect, params: { ...effect.params, edgeHandling: mode } } as EffectInstance,
          ]);
          expect(bytes(output.pixels)).toEqual(input);
        }
    }
  });
});
