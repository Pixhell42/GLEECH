import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  type EffectInstance,
  type EffectType,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
import { softField } from './soft-field';

const types = [
  'bit-damage',
  'freeze-dropout',
  'photo-adjustments',
  'detail',
  'halation',
  'vignette',
] as const;
const effect = (type: EffectType, params: Record<string, number | string> = {}) => {
  const e = createEffect(type, type);
  return { ...e, params: { ...e.params, ...params } } as EffectInstance;
};
const image = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
) => ({
  width,
  height,
  pixels: Uint8Array.from(
    { length: width * height * 4 },
    (_, i) => pixel(Math.floor(i / 4) % width, Math.floor(i / 4 / width))[i % 4]!,
  ).buffer,
});
const render = (source: ReturnType<typeof image>, e: EffectInstance) =>
  new Uint8Array(renderEffects(source, [e], { masterSeed: 17 }).pixels);
const at = (out: Uint8Array, x: number, y: number, width: number) => [
  ...out.slice((y * width + x) * 4, (y * width + x + 1) * 4),
];
const constant = image(7, 7, () => [100, 50, 150, 128]);

describe('Advanced Bit Damage', () => {
  const params = { density: 1, lowBit: 0, highBit: 7 };
  it('operates on selected planes and targets without touching unrelated channels', () => {
    for (const [operation, red] of [
      ['flip', 155],
      ['clear', 0],
      ['set', 255],
      ['shift', 200],
      ['rotate', 200],
      ['isolate', 100],
    ] as const) {
      expect(
        at(
          render(constant, effect('bit-damage', { ...params, operation, target: 'red' })),
          0,
          0,
          7,
        ),
      ).toEqual([red, 50, 150, 128]);
    }
    expect(
      at(
        render(
          constant,
          effect('bit-damage', { ...params, operation: 'rotate', shift: -1, target: 'red' }),
        ),
        0,
        0,
        7,
      )[0],
    ).toBe(50);
    expect(
      at(
        render(
          constant,
          effect('bit-damage', {
            density: 1,
            lowBit: 4,
            highBit: 5,
            operation: 'clear',
            target: 'green',
          }),
        ),
        0,
        0,
        7,
      ),
    ).toEqual([100, 2, 150, 128]);
    expect(
      at(
        render(
          constant,
          effect('bit-damage', {
            density: 1,
            lowBit: 5,
            highBit: 4,
            operation: 'clear',
            target: 'green',
          }),
        ),
        0,
        0,
        7,
      ),
    ).toEqual([100, 2, 150, 128]);
    expect(
      at(
        render(
          constant,
          effect('bit-damage', {
            density: 1,
            lowBit: 4,
            highBit: 5,
            operation: 'shift',
            shift: -7,
            target: 'green',
          }),
        ),
        0,
        0,
        7,
      )[1],
    ).toBe(2);
  });
  it('visualizes selected bits and alpha without changing input transparency', () => {
    expect(
      at(
        render(
          constant,
          effect('bit-damage', {
            ...params,
            lowBit: 5,
            highBit: 6,
            visualize: 'on',
            target: 'red',
          }),
        ),
        0,
        0,
        7,
      ),
    ).toEqual([255, 50, 150, 128]);
    expect(
      at(
        render(
          constant,
          effect('bit-damage', { ...params, lowBit: 7, visualize: 'on', target: 'alpha' }),
        ),
        0,
        0,
        7,
      ),
    ).toEqual([255, 255, 255, 128]);
  });
  it('modifies alpha deliberately and never reveals hidden source RGB', () => {
    const source = image(2, 1, (x) => (x ? [100, 50, 150, 128] : [255, 0, 255, 0]));
    const alpha = render(source, effect('bit-damage', { ...params, target: 'alpha' }));
    expect(at(alpha, 0, 0, 2)).toEqual([0, 0, 0, 255]);
    expect(at(alpha, 1, 0, 2)).toEqual([100, 50, 150, 127]);
    expect(at(render(source, effect('bit-damage', params)), 0, 0, 2)).toEqual([255, 0, 255, 0]);
  });
  it('scrambles bit positions reproducibly, preserving selected bit population', () => {
    const source = image(24, 24, () => [49, 82, 100, 255]);
    const e = effect('bit-damage', { ...params, operation: 'scramble', cellSize: 4 });
    const out = render(source, e);
    expect(render(source, e)).toEqual(out);
    expect(render(source, { ...e, seedOffset: 1 })).not.toEqual(out);
    const count = (v: number) => v.toString(2).split('1').length - 1;
    for (let i = 0; i < out.length; i += 4)
      for (let c = 0; c < 3; c++) expect(count(out[i + c]!)).toBe(count([49, 82, 100][c]!));
  });
  it('anchors cells in original coordinates at reduced preview sizes', () => {
    const source = image(8, 8, () => [100, 50, 150, 255]);
    const reduced = image(4, 4, () => [100, 50, 150, 255]);
    const e = effect('bit-damage', { ...params, density: 0.5, cellSize: 4 });
    const full = render(source, e),
      small = new Uint8Array(
        renderEffects(reduced, [e], { masterSeed: 17, reference: source }).pixels,
      );
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) expect(at(small, x, y, 4)).toEqual(at(full, x * 2, y * 2, 8));
  });
});

describe('Freeze / Dropout', () => {
  const source = image(9, 5, (x) => [20 * x, 50, 100, 255]);
  it('holds an earlier translation and caps hold age without preview feedback', () => {
    const params = { style: 'freeze', density: 1, steps: 2, travel: 20, holdAge: 1 };
    expect(at(render(source, effect('freeze-dropout', params)), 4, 2, 9)).toEqual([
      60, 50, 100, 255,
    ]);
    expect(
      at(render(source, effect('freeze-dropout', { ...params, holdAge: 0 })), 4, 2, 9),
    ).toEqual([40, 50, 100, 255]);
    expect(render(source, effect('freeze-dropout', { ...params, holdAge: 32 }))).toEqual(
      new Uint8Array(source.pixels),
    );
    expect(render(source, effect('freeze-dropout', { ...params, density: 0 }))).toEqual(
      new Uint8Array(source.pixels),
    );
  });
  it('duplicates patches with deliberate Extend, Wrap and Mirror edge sampling', () => {
    const params = { style: 'duplicate', density: 1, steps: 2, travel: 20, scatter: 0 };
    expect(
      at(
        render(source, effect('freeze-dropout', { ...params, edgeHandling: 'extend' })),
        0,
        2,
        9,
      )[0],
    ).toBe(0);
    expect(
      at(render(source, effect('freeze-dropout', { ...params, edgeHandling: 'wrap' })), 0, 2, 9)[0],
    ).toBe(140);
    expect(
      at(
        render(source, effect('freeze-dropout', { ...params, edgeHandling: 'mirror' })),
        0,
        2,
        9,
      )[0],
    ).toBe(20);
  });
  it('fills and cuts out blank regions, preserving partial alpha and hidden RGB', () => {
    expect(
      at(
        render(
          constant,
          effect('freeze-dropout', { style: 'blank', density: 1, dropoutColor: '#ff0000' }),
        ),
        0,
        0,
        7,
      ),
    ).toEqual([255, 0, 0, 128]);
    expect(
      at(
        render(
          constant,
          effect('freeze-dropout', { style: 'blank', density: 1, clearAlpha: 'on' }),
        ),
        0,
        0,
        7,
      )[3],
    ).toBe(0);
    const source = image(3, 3, () => [255, 0, 255, 0]);
    expect(render(source, effect('freeze-dropout', { style: 'noise', density: 1 }))).toEqual(
      new Uint8Array(source.pixels),
    );
    const e = effect('freeze-dropout', {
      style: 'blank',
      density: 1,
      dropoutColorMode: 'gradient',
      dropoutColor: '#ff0000',
      dropoutColorEnd: '#0000ff',
      dropoutColorStops:
        '[{"position":0,"color":"#ff0000"},{"position":0.5,"color":"#00ff00"},{"position":1,"color":"#0000ff"}]',
    });
    const out = render(constant, e);
    expect(at(out, 3, 3, 7)).toEqual([0, 255, 0, 128]);
    expect(at(out, 0, 3, 7)[0]).toBeGreaterThan(at(out, 6, 3, 7)[0]!);
  });
  it('groups failures into saved clusters and creates seeded noise and duplicates', () => {
    const flat = image(24, 24, () => [100, 100, 100, 128]);
    const e = effect('freeze-dropout', {
      style: 'blank',
      density: 0.5,
      clustering: 1,
      patchSize: 100 / 24,
    });
    const out = render(flat, e);
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++)
        expect(at(out, x, y, 24)).toEqual(
          at(out, Math.floor(x / 3) * 3, Math.floor(y / 3) * 3, 24),
        );
    expect(render(flat, { ...e, seedOffset: 1 })).not.toEqual(out);
    for (const style of ['noise', 'duplicate']) {
      const e = effect('freeze-dropout', { style, density: 0.7, scatter: 1, travel: 10 });
      expect(render(source, e)).toEqual(render(source, e));
      expect(render(source, { ...e, seedOffset: 1 })).not.toEqual(render(source, e));
    }
  });
});

describe('Photo Adjustments', () => {
  const neutral = {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    vibrance: 0,
    temperature: 0,
    tint: 0,
  };
  it('uses linear-light exposure stops and independently warms or cools white balance', () => {
    const gray = image(3, 3, () => [128, 128, 128, 128]);
    expect(render(gray, effect('photo-adjustments', neutral))).toEqual(new Uint8Array(gray.pixels));
    expect(
      at(render(gray, effect('photo-adjustments', { ...neutral, exposure: 1 })), 1, 1, 3),
    ).toEqual([176, 176, 176, 128]);
    expect(
      at(render(gray, effect('photo-adjustments', { ...neutral, exposure: -1 })), 1, 1, 3),
    ).toEqual([92, 92, 92, 128]);
    const warm = at(
      render(gray, effect('photo-adjustments', { ...neutral, temperature: 1 })),
      1,
      1,
      3,
    );
    expect(warm[0]).toBeGreaterThan(128);
    expect(warm[1]).toBe(128);
    expect(warm[2]).toBeLessThan(128);
    const magenta = at(render(gray, effect('photo-adjustments', { ...neutral, tint: 1 })), 1, 1, 3);
    expect(magenta[0]).toBeGreaterThan(magenta[1]!);
    expect(magenta[2]).toBeGreaterThan(magenta[1]!);
  });
  it('targets shadow/highlight regions and gives muted colors more vibrance', () => {
    const tones = image(2, 1, (x) => (x ? [220, 220, 220, 255] : [30, 30, 30, 255]));
    expect(
      at(render(tones, effect('photo-adjustments', { ...neutral, shadows: 1 })), 0, 0, 2)[0],
    ).toBeGreaterThan(30);
    expect(
      at(render(tones, effect('photo-adjustments', { ...neutral, shadows: 1 })), 1, 0, 2)[0],
    ).toBe(220);
    expect(
      at(render(tones, effect('photo-adjustments', { ...neutral, highlights: -1 })), 1, 0, 2)[0],
    ).toBeLessThan(220);
    expect(
      at(render(tones, effect('photo-adjustments', { ...neutral, highlights: -1 })), 0, 0, 2)[0],
    ).toBe(30);
    const colors = image(
      3,
      1,
      (x) =>
        [
          [120, 100, 80, 255],
          [255, 0, 0, 255],
          [100, 100, 100, 255],
        ][x]!,
    );
    const out = render(colors, effect('photo-adjustments', { ...neutral, vibrance: 1 }));
    expect(out[0]).toBeGreaterThan(120);
    expect(out[2]).toBeLessThan(80);
    expect(at(out, 1, 0, 3)).toEqual([255, 0, 0, 255]);
    expect(at(out, 2, 0, 3)).toEqual([100, 100, 100, 255]);
  });
});

describe('Detail, Halation and Vignette', () => {
  it('preserves uniform partial-alpha detail and ignores hidden colors in both neighborhoods', () => {
    expect(render(constant, effect('detail', { threshold: 0, clarity: 1 }))).toEqual(
      new Uint8Array(constant.pixels),
    );
    const source = image(7, 7, (x) => (x < 3 ? [100, 50, 150, 128] : [255, 0, 255, 0]));
    const out = render(source, effect('detail', { threshold: 0, radius: 4, clarity: 1 }));
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 3; x++) expect(at(out, x, y, 7)).toEqual([100, 50, 150, 128]);
    expect(at(out, 5, 2, 7)).toEqual([255, 0, 255, 0]);
  });
  it('sharpens or softens real edges and suppresses changes below Detail threshold', () => {
    const source = image(9, 9, (x) => (x < 4 ? [80, 80, 80, 255] : [180, 180, 180, 255]));
    expect(
      at(
        render(source, effect('detail', { sharpen: 1, radius: 3, threshold: 0, clarity: 0 })),
        4,
        4,
        9,
      )[0],
    ).toBeGreaterThan(180);
    expect(
      at(
        render(source, effect('detail', { sharpen: -1, radius: 3, threshold: 0, clarity: 0 })),
        4,
        4,
        9,
      )[0],
    ).toBeLessThan(180);
    const tiny = image(9, 9, (x) => (x < 4 ? [100, 100, 100, 255] : [102, 102, 102, 255]));
    expect(render(tiny, effect('detail', { threshold: 0.1, clarity: 0 }))).toEqual(
      new Uint8Array(tiny.pixels),
    );
    const clarity = render(
      source,
      effect('detail', { sharpen: 0, clarity: 1, clarityRadius: 20 / 9 }),
    );
    expect(clarity).not.toEqual(new Uint8Array(source.pixels));
  });
  it('spreads highlight energy as colored halos without revealing hidden highlights or changing alpha', () => {
    const source = image(9, 9, (x, y) =>
      x === 4 && y === 4 ? [255, 255, 255, 255] : [0, 0, 0, 128],
    );
    const out = render(
      source,
      effect('halation', { radius: 10, threshold: 0, knee: 0, strength: 5, haloColor: '#ff0000' }),
    );
    expect(at(out, 5, 4, 9)[0]).toBeGreaterThan(0);
    expect(at(out, 5, 4, 9).slice(1)).toEqual([0, 0, 128]);
    const hidden = image(9, 9, (x, y) =>
      x === 4 && y === 4 ? [255, 255, 255, 0] : [0, 0, 0, 128],
    );
    expect(render(hidden, effect('halation', { threshold: 0, knee: 0, strength: 5 }))).toEqual(
      new Uint8Array(hidden.pixels),
    );
    const gray = image(9, 9, () => [200, 200, 200, 255]);
    const normal = render(gray, effect('halation', { threshold: 0, strength: 1, edgeBias: 0 }));
    const biased = render(gray, effect('halation', { threshold: 0, strength: 1, edgeBias: 1 }));
    expect(biased[0]).toBeLessThan(normal[0]!);
  });
  it('vignettes feathered or clipped regions with position, inversion and rotation', () => {
    const source = image(9, 5, () => [200, 200, 200, 128]);
    const params = { strength: 1, size: 1, softness: 0, roundness: 0 };
    const hard = render(source, effect('vignette', params));
    expect(at(hard, 4, 2, 9)).toEqual([200, 200, 200, 128]);
    expect(at(hard, 0, 0, 9)).toEqual([0, 0, 0, 128]);
    expect(at(render(source, effect('vignette', { ...params, invert: 'on' })), 4, 2, 9)).toEqual([
      0, 0, 0, 128,
    ]);
    const shifted = render(source, effect('vignette', { ...params, centerX: 0, size: 0.4 }));
    expect(at(shifted, 4, 2, 9)[0]).toBe(0);
    expect(render(source, effect('vignette', { ...params, rotation: 90 }))).not.toEqual(hard);
    const feathered = render(source, effect('vignette', { ...params, softness: 1 }));
    expect(feathered[4 * 4]).toBeGreaterThan(0);
    expect(feathered[4 * 4]).toBeLessThan(200);
    expect(render(source, effect('vignette', { ...params, roundness: 1, rotation: 90 }))).toEqual(
      render(source, effect('vignette', { ...params, roundness: 1 })),
    );
  });
});

describe('Shared six-filter contracts', () => {
  it.each(types)('%s respects opacity, spatial masks and hidden bytes', (type) => {
    const source = image(7, 7, (x) => (x === 0 ? [255, 0, 255, 0] : [100, 50, 150, 128]));
    const params =
      type === 'bit-damage'
        ? { density: 1 }
        : type === 'freeze-dropout'
          ? { style: 'blank', density: 1 }
          : {};
    const e = effect(type, params);
    expect(render(source, { ...e, params: { ...e.params, amount: 0 } } as EffectInstance)).toEqual(
      new Uint8Array(source.pixels),
    );
    const masked = render(source, {
      ...e,
      application: { region: 'left', coverage: 0.5, softness: 0 },
    });
    expect(at(masked, 6, 3, 7)).toEqual([100, 50, 150, 128]);
    expect(at(masked, 0, 3, 7)).toEqual([255, 0, 255, 0]);
    const changed = render(constant, e),
      half = render(constant, { ...e, params: { ...e.params, amount: 0.5 } } as EffectInstance);
    for (let i = 0; i < half.length; i++)
      expect(
        Math.abs(half[i]! - (new Uint8Array(constant.pixels)[i]! + changed[i]!) / 2),
      ).toBeLessThanOrEqual(1);
  });
  it.each(types)('%s retains shared Tint for neutral effect settings', (type) => {
    const neutral =
      type === 'bit-damage' || type === 'freeze-dropout'
        ? { density: 0 }
        : type === 'photo-adjustments'
          ? {
              exposure: 0,
              contrast: 0,
              highlights: 0,
              shadows: 0,
              vibrance: 0,
              temperature: 0,
              tint: 0,
            }
          : type === 'detail'
            ? { sharpen: 0, clarity: 0 }
            : { strength: 0 };
    expect(
      at(
        render(
          constant,
          effect(type, { ...neutral, tintEnabled: 'on', color: '#ff0000', tintStrength: 1 }),
        ),
        0,
        0,
        7,
      ),
    ).toEqual([100, 0, 0, 128]);
  });
  it('validates every default and rejects invalid operations, ranges, colors and steps', () => {
    for (const type of types) expect(() => assertEffect(effect(type))).not.toThrow();
    for (const [type, params] of [
      ['bit-damage', { highBit: 8 }],
      ['bit-damage', { operation: 'unknown' }],
      ['freeze-dropout', { steps: 33 }],
      ['photo-adjustments', { exposure: 5 }],
      ['detail', { radius: 0 }],
      ['halation', { haloColor: 'red' }],
      ['vignette', { size: 0 }],
    ] as const)
      expect(() => assertEffect(effect(type, params))).toThrow();
  });
  it('yields for cancellation and matches synchronous stacked results', async () => {
    const source = image(65, 65, (x, y) => [
      (x * 17) % 256,
      (y * 23) % 256,
      100,
      (x + y) % 4 ? 255 : 0,
    ]);
    const stack = types.map((type) => effect(type));
    const sync = renderEffects(source, stack, { masterSeed: 21 });
    const asyncResult = await renderEffectsAsync(source, stack, {
      masterSeed: 21,
      yieldControl: async () => {},
    });
    expect(asyncResult).toEqual(sync);
    let checkpoints = 0;
    await expect(
      renderEffectsAsync(source, [effect('detail')], {
        yieldControl: async () => {},
        isCancelled: () => ++checkpoints > 50,
      }),
    ).rejects.toThrow(RenderCancelledError);
  });
  it('keeps fractional sliding blur equivalent to an independent direct convolution', () => {
    const width = 5,
      height = 3,
      field = Float32Array.from({ length: width * height * 4 }, (_, i) => (i * 7) % 31);
    const edge = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
    let expected = field;
    for (let pass = 0; pass < 3; pass++)
      for (let axis = 0; axis < 2; axis++) {
        const radius = (axis === 0 ? 2.3 : 0.7) / Math.sqrt(3),
          r = Math.floor(radius),
          f = radius - r;
        const next = new Float32Array(field.length);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++)
            for (let c = 0; c < 4; c++) {
              let sum = 0;
              for (let k = -r - 1; k <= r + 1; k++)
                sum +=
                  expected[
                    (axis === 0
                      ? y * width + edge(x + k, width)
                      : edge(y + k, height) * width + x) *
                      4 +
                      c
                  ]! * (Math.abs(k) > r ? f : 1);
              next[(y * width + x) * 4 + c] = sum / (2 * r + 1 + 2 * f);
            }
        expected = next;
      }
    const generator = softField(field, width, height, 2.3, 0.7, 'extend', edge);
    let step = generator.next();
    while (!step.done) step = generator.next();
    for (let i = 0; i < field.length; i++) expect(step.value[i]).toBeCloseTo(expected[i]!, 5);
  });
});
