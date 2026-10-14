import { describe, expect, it } from 'vitest';
import { createEffect, type PixelSortEffect } from '@gleech/project-model';
import { pixelSortKey } from './pixel-sort';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const effect = (params: Partial<PixelSortEffect['params']> = {}): PixelSortEffect => {
  const e = createEffect('pixel-sort', 'sort') as PixelSortEffect;
  return {
    ...e,
    params: { ...e.params, thresholdStart: 0, thresholdEnd: 1, length: 100, ...params },
  };
};
const gray = (values: number[], width = values.length) => ({
  width,
  height: values.length / width,
  pixels: Uint8Array.from(values.flatMap((v) => [v, v, v, 255])).buffer,
});
const render = (source: ReturnType<typeof gray>, e = effect()) =>
  new Uint8Array(renderEffects(source, [e], { masterSeed: 83 }).pixels);
const reds = (bytes: Uint8Array) => [...bytes].filter((_, i) => i % 4 === 0);
const fixture = (width = 64, height = 48) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3
      ? [0, 64, 128, 255][Math.floor(i / 4) % 4]!
      : (i * 37 + Math.floor(i / (width * 4)) * 23) % 256,
  ).buffer,
});

describe('Pixel Sorting', () => {
  it('sorts rows and columns in the requested direction and reverses the order', () => {
    const row = gray([180, 40, 90, 10]);
    expect(reds(render(row))).toEqual([10, 40, 90, 180]);
    expect(reds(render(row, effect({ order: 'descending' })))).toEqual([180, 90, 40, 10]);
    expect(reds(render(row, effect({ direction: 180 })))).toEqual([180, 90, 40, 10]);
    expect(reds(render(row, effect({ direction: 180, order: 'descending' })))).toEqual([
      10, 40, 90, 180,
    ]);
    const column = gray([180, 40, 90, 10], 1);
    expect(reds(render(column, effect({ direction: 90 })))).toEqual([10, 40, 90, 180]);
    expect(reds(render(column, effect({ direction: 270 })))).toEqual([180, 90, 40, 10]);
    expect(render(row, effect({ direction: 360 }))).toEqual(render(row));
  });
  it('sorts intersecting diagonal runs without rotating or interpolating the source', () => {
    const source = gray([90, 70, 10, 60, 30, 80, 20, 50, 40], 3);
    expect(reds(render(source, effect({ direction: 45 })))).toEqual([
      30, 70, 10, 50, 40, 80, 20, 60, 90,
    ]);
    expect(reds(render(source, effect({ direction: 135 })))).toEqual([
      90, 60, 10, 70, 20, 50, 30, 80, 40,
    ]);
  });
  it('leaves threshold exclusions in place and uses them as hard boundaries', () => {
    const source = gray([10, 180, 80, 120, 250, 200, 60]);
    const e = effect({ thresholdStart: 0.2, thresholdEnd: 0.8 });
    expect(reds(render(source, e))).toEqual([10, 80, 120, 180, 250, 60, 200]);
    expect(render(source, effect({ ...e.params, thresholdStart: 0.8, thresholdEnd: 0.2 }))).toEqual(
      render(source, e),
    );
    expect(reds(render(gray([220, 180, 140, 100, 60, 20]), effect({ length: 50 })))).toEqual([
      140, 180, 220, 20, 60, 100,
    ]);
  });
  it('orders hue and saturation independently and keeps equal-value colors stable', () => {
    const colors = [
      [0, 0, 255],
      [255, 0, 0],
      [0, 255, 0],
      [255, 0, 255],
      [255, 255, 0],
      [0, 255, 255],
    ];
    const source = {
      width: 6,
      height: 1,
      pixels: Uint8Array.from(colors.flatMap((rgb) => [...rgb, 255])).buffer,
    };
    const hue = render(source, effect({ criterion: 'hue' }));
    expect([...hue]).toEqual(
      [colors[1]!, colors[4]!, colors[2]!, colors[5]!, colors[0]!, colors[3]!].flatMap((rgb) => [
        ...rgb,
        255,
      ]),
    );
    expect(render(source, effect({ criterion: 'saturation' }))).toEqual(
      new Uint8Array(source.pixels),
    );
    const redsOnly = {
      width: 3,
      height: 1,
      pixels: new Uint8Array([255, 0, 0, 255, 80, 0, 0, 255, 160, 0, 0, 255]).buffer,
    };
    expect(render(redsOnly, effect({ criterion: 'hue', order: 'descending' }))).toEqual(
      new Uint8Array(redsOnly.pixels),
    );
    expect(pixelSortKey(255, 255, 255, 'hue')).toBe(0);
    expect(pixelSortKey(0, 0, 0, 'saturation')).toBe(0);
  });
  it('selects and orders wrapped hue intervals continuously across the red seam', () => {
    const source = {
      width: 4,
      height: 1,
      pixels: new Uint8Array([255, 40, 0, 255, 255, 0, 0, 255, 255, 0, 40, 255, 0, 255, 0, 255])
        .buffer,
    };
    expect([
      ...render(source, effect({ criterion: 'hue', thresholdStart: 0.9, thresholdEnd: 0.1 })),
    ]).toEqual([255, 0, 40, 255, 255, 0, 0, 255, 255, 40, 0, 255, 0, 255, 0, 255]);
  });
  it('retains every alpha byte and splits at invisible pixels without using their hidden colors', () => {
    const source = gray([180, 40, 250, 120, 80, 10]);
    const input = new Uint8Array(source.pixels);
    input[3] = 64;
    input[7] = 128;
    input[11] = 0;
    expect([...render(source)]).toEqual([
      40, 40, 40, 64, 180, 180, 180, 128, 250, 250, 250, 0, 10, 10, 10, 255, 80, 80, 80, 255, 120,
      120, 120, 255,
    ]);
    const changed = { ...source, pixels: source.pixels.slice(0) };
    new Uint8Array(changed.pixels).set([255, 0, 255], 8);
    expect(render(changed).slice(12)).toEqual(render(source).slice(12));
    expect(render(changed).slice(0, 8)).toEqual(render(source).slice(0, 8));
  });
  it('preserves the color multiset for arbitrary angles and thin images', () => {
    const signature = (bytes: Uint8Array) =>
      Array.from({ length: bytes.length / 4 }, (_, i) =>
        [...bytes.slice(i * 4, i * 4 + 3)].join(','),
      ).sort();
    for (const [width, height] of [
      [19, 13],
      [1, 257],
      [257, 1],
      [2, 137],
      [137, 2],
    ]) {
      const source = fixture(width!, height!);
      const input = new Uint8Array(source.pixels);
      for (let i = 3; i < input.length; i += 4) input[i] = 255;
      const before = signature(input);
      for (const direction of [0, 17, 45, 89, 90, 135, 179, 180, 213, 270, 315, 359])
        expect(signature(render(source, effect({ direction })))).toEqual(before);
    }
  });
  it('reproduces seeded density and broken boundaries and has exact bypasses', () => {
    const source = fixture(),
      input = new Uint8Array(source.pixels);
    for (const params of [{ density: 0.4 }, { breakup: 0.3 }]) {
      const e = effect(params),
        out = render(source, e);
      expect(out).toEqual(render(source, e));
      expect(out).not.toEqual(render(source, { ...e, seedOffset: 1 }));
    }
    const ordinary = effect();
    expect(render(source, ordinary)).toEqual(render(source, { ...ordinary, seedOffset: 1 }));
    for (const e of [
      effect({ length: 0 }),
      effect({ density: 0 }),
      effect({ amount: 0 }),
      effect({ thresholdStart: 1, thresholdEnd: 1 }),
      { ...ordinary, enabled: false },
      { ...ordinary, application: { region: 'all' as const, coverage: 0, softness: 0 } },
    ])
      expect(render(source, e)).toEqual(input);
    expect(render(gray([90, 30, 80, 10]), effect({ breakup: 1 }))).toEqual(
      new Uint8Array(gray([90, 30, 80, 10]).pixels),
    );
  });
  it('composites fractional opacity and masks, and cancels long scans', async () => {
    const source = gray([200, 100, 50, 10]);
    expect(reds(render(source, effect({ amount: 0.5 })))).toEqual([105, 75, 75, 105]);
    const e = effect();
    expect(
      reds(render(source, { ...e, application: { region: 'left', coverage: 0.5, softness: 0 } })),
    ).toEqual([10, 50, 50, 10]);
    let polls = 0;
    await expect(
      renderEffectsAsync(fixture(2048, 1536), [effect()], {
        isCancelled: () => ++polls > 4,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
