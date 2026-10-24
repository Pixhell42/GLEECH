import { expect, it } from 'vitest';
import { createEffect, type EdgeHandling, type RgbSplitEffect } from '@gleech/project-model';
import { RenderCancelledError, renderEffects, renderEffectsAsync } from './index';

const pixels = new Uint8Array([
  10, 15, 18, 0, 30, 35, 38, 64, 50, 55, 58, 255, 70, 75, 78, 192, 90, 95, 98, 32, 110, 115, 118,
  128,
]);
const image = { width: 3, height: 2, pixels: pixels.buffer };

it.each([
  ['extend', [0, 0, 0, 0, 0, 0], [5, 5, 5, 5, 5, 5]],
  ['wrap', [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5]],
  ['mirror', [5, 4, 3, 2, 1, 0], [5, 4, 3, 2, 1, 0]],
] as const)(
  'preserves integer channel sampling, green and alpha with %s edges',
  (edgeHandling, red, blue) => {
    const base = createEffect('rgb-split', 'fx') as RgbSplitEffect;
    const effect = {
      ...base,
      params: { ...base.params, amount: 1, horizontal: 100, vertical: 100, edgeHandling },
    };
    const original = pixels.slice();
    const result = new Uint8Array(renderEffects(image, [effect]).pixels);
    for (let i = 0; i < 6; i++) {
      expect([...result.subarray(i * 4, i * 4 + 4)]).toEqual([
        pixels[red[i]! * 4],
        pixels[i * 4 + 1],
        pixels[blue[i]! * 4 + 2],
        pixels[i * 4 + 3],
      ]);
    }
    expect(new Uint8Array(image.pixels)).toEqual(original);
  },
);

it('preserves fractional opacity and hidden RGB independently of alpha', () => {
  const base = createEffect('rgb-split', 'fx') as RgbSplitEffect;
  const effect = {
    ...base,
    params: {
      ...base.params,
      amount: 0.5,
      horizontal: 100 / 3,
      vertical: 50,
      edgeHandling: 'extend' as EdgeHandling,
    },
  };
  expect([...new Uint8Array(renderEffects(image, [effect]).pixels)]).toEqual([
    10, 15, 58, 0, 20, 35, 78, 64, 40, 55, 88, 255, 40, 75, 88, 192, 50, 95, 108, 32, 70, 115, 118,
    128,
  ]);
});

it('retains cooperative cancellation between rows', async () => {
  const tall = { width: 3, height: 32, pixels: new ArrayBuffer(3 * 32 * 4) };
  let checks = 0;
  const base = createEffect('rgb-split', 'fx') as RgbSplitEffect;
  await expect(
    renderEffectsAsync(tall, [{ ...base, params: { ...base.params, horizontal: 34 } }], {
      isCancelled: () => ++checks > 3,
      yieldControl: async () => {},
    }),
  ).rejects.toBeInstanceOf(RenderCancelledError);
});
