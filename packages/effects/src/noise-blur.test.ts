import { describe, expect, it, vi } from 'vitest';
import {
  createEffect,
  NOISE_STYLES,
  BLUR_STYLES,
  assertEffect,
  assertPresetRecipe,
  effectsNeedSubject,
  type NoiseGrainEffect,
  type BlurEffect,
  type EffectInstance,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, cellRandom, RenderCancelledError } from './index';
import { noiseValue, createNoiseField } from './noise';
import { fieldRadius, separableBlur } from './blur';

const noise = (params: Partial<NoiseGrainEffect['params']> = {}) => {
  const e = createEffect('noise-grain', 'noise') as NoiseGrainEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const blur = (params: Partial<BlurEffect['params']> = {}) => {
  const e = createEffect('blur', 'blur') as BlurEffect;
  return { ...e, params: { ...e.params, ...params } };
};
function fixture(width = 31, height = 23) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels.set(
        [
          (x * 19 + y * 7) % 256,
          (x * 7 + y * 23) % 256,
          (x * 11 + y * 31) % 256,
          [0, 1, 64, 128, 255][(x + y) % 5]!,
        ],
        i,
      );
    }
  return { width, height, pixels: pixels.buffer };
}
const render = (e: EffectInstance, image = fixture()) =>
  new Uint8Array(renderEffects(image, [e], { masterSeed: 123 }).pixels);
const random = (x: number, y: number, lane: number) => cellRandom(17, x, y, lane, 4);
describe('Noise / Grain', () => {
  it('uses true black/white impulses with an adjustable probability and balance', () => {
    const image = fixture(97, 73);
    for (const balance of [0, 0.5, 1]) {
      const out = render(noise({ style: 'salt-pepper', density: 1, intensity: 1, balance }), image);
      for (let i = 0; i < out.length; i += 4) {
        expect([0, 255]).toContain(out[i]);
        expect(out[i + 1]).toBe(out[i]);
        expect(out[i + 2]).toBe(out[i]);
        if (balance !== 0.5) expect(out[i]).toBe(balance * 255);
      }
    }
    expect(render(noise({ style: 'salt-pepper', density: 0 }), image)).toEqual(
      new Uint8Array(image.pixels),
    );
  });
  it('correlates scan noise by row or column and breaks correlation deliberately', () => {
    const horizontal = createNoiseField(
      noise({ style: 'scan', scanDirection: 'horizontal', scanIrregularity: 0 }).params,
      random,
    );
    const vertical = createNoiseField(
      noise({ style: 'scan', scanDirection: 'vertical', scanIrregularity: 0 }).params,
      random,
    );
    expect(horizontal(1.1, 2.2)).toBe(horizontal(4.1, 2.2));
    expect(horizontal(1.1, 2.2)).not.toBe(horizontal(1.1, 3.2));
    expect(vertical(1.1, 2.2)).toBe(vertical(1.1, 4.2));
    expect(vertical(1.1, 2.2)).not.toBe(vertical(2.1, 2.2));
    const broken = createNoiseField(noise({ style: 'scan', scanIrregularity: 1 }).params, random);
    expect(broken(1.1, 2.2)).not.toBe(broken(1.2, 2.2));
  });
  it.each(NOISE_STYLES)('%s is deterministic, seeded and preserves alpha', (style) => {
    const e = noise({ style, intensity: 0.7 });
    const input = fixture(),
      out = render(e, input);
    expect(render(e, input)).toEqual(out);
    expect(render({ ...e, seedOffset: 1 }, input)).not.toEqual(out);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(new Uint8Array(input.pixels)[i]);
  });
  it('has neutral zero intensity and sparse zero density', () => {
    const flat = {
      width: 31,
      height: 23,
      pixels: Uint8Array.from({ length: 31 * 23 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 128)).buffer,
    };
    const mono = render(noise({ style: 'film', coloring: 'mono', clumping: 1 }), flat);
    for (let i = 0; i < mono.length; i += 4)
      expect([...mono.slice(i, i + 3)]).toEqual([mono[i], mono[i], mono[i]]);
    for (const e of [noise({ intensity: 0 }), noise({ style: 'speckle', density: 0 })])
      expect(render(e)).toEqual(new Uint8Array(fixture().pixels));
  });
  it('separates white and Gaussian distributions', () => {
    const white: number[] = [],
      gaussian: number[] = [];
    for (let i = 0; i < 10000; i++) {
      white.push(noiseValue('white', i, 3, random));
      gaussian.push(noiseValue('gaussian', i, 3, random));
    }
    const variance = (a: number[]) => a.reduce((s, v) => s + (v - 0.5) ** 2, 0) / a.length;
    expect(variance(white)).toBeGreaterThan(0.075);
    expect(variance(gaussian)).toBeLessThan(0.035);
    expect(variance(gaussian)).toBeGreaterThan(0.02);
  });
  it('uses lattice values, gradient dots, simplex triangles and distinct cells', () => {
    expect(noiseValue('value', 2, 3, random)).toBe(random(2, 3, 0));
    expect(noiseValue('perlin', 2, 3, random)).toBe(0.5);
    expect(noiseValue('simplex', 0, 0, random)).toBe(0.5);
    const values = ['perlin', 'simplex', 'value', 'voronoi'].map((style) =>
      noiseValue(style as NoiseGrainEffect['params']['style'], 2.3, 3.7, random),
    );
    expect(new Set(values).size).toBe(4);
    for (const style of ['perlin', 'simplex', 'value'] as const)
      expect(
        Math.abs(
          noiseValue(style, 2.31, 3.71, random) - noiseValue(style, 2.310001, 3.710001, random),
        ),
      ).toBeLessThan(0.001);
    const modes = ['cells', 'distance', 'borders'].map((mode) =>
      noiseValue('voronoi', 2.3, 3.7, random, 0, mode),
    );
    expect(new Set(modes).size).toBe(3);
  });
  it.each(['fbm', 'turbulence', 'ridged'] as const)('bounds six octaves of %s', (variant) => {
    const field = createNoiseField(
      noise({ style: 'simplex', variant, detail: 6, roughness: 1 }).params,
      random,
    );
    for (let i = 0; i < 100; i++) {
      const v = field(i / 11, i / 31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('retains pattern coordinates at the same original image point', () => {
    const flat = (width: number) => ({
      width,
      height: width,
      pixels: Uint8Array.from({ length: width * width * 4 }, (_, i) => (i % 4 === 3 ? 255 : 128))
        .buffer,
    });
    const e = noise({ style: 'perlin' });
    const full = new Uint8Array(
      renderEffects(flat(101), [e], { reference: { width: 101, height: 101 } }).pixels,
    );
    const small = new Uint8Array(
      renderEffects(flat(51), [e], { reference: { width: 101, height: 101 } }).pixels,
    );
    expect(full.slice((50 * 101 + 50) * 4, (50 * 101 + 50) * 4 + 4)).toEqual(
      small.slice((25 * 51 + 25) * 4, (25 * 51 + 25) * 4 + 4),
    );
  });
  it('renders a two-color procedural field ramp', () => {
    const e = noise({
      style: 'value',
      coloring: 'ramp',
      intensity: 1,
      noiseColor: '#ff0000',
      noiseColorMode: 'gradient',
      noiseColorEnd: '#0000ff',
    });
    const out = render(e);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i + 1]).toBe(0);
      expect(out[i]! + out[i + 2]!).toBe(255);
    }
  });
  it.each(['white', 'gaussian', 'film', 'voronoi'] as const)(
    'reuses %s samples without changing lanes or coordinates',
    (style) => {
      const params = noise({ style, detail: 1 }).params;
      const field = createNoiseField(params, random);
      for (const lane of [0, 211, 422, 0])
        for (const [x, y] of [
          [0.1, 0.1],
          [0.2, 0.2],
          [1.1, 0.2],
          [-3.7, -1.1],
          [0.1, 0.1],
          [0.1, 0.3],
        ] as const)
          expect(field(x, y, lane)).toBe(noiseValue(style, x, y, random, lane));
    },
  );
});
describe('Blur', () => {
  it('averages high-frequency detail before widely spaced Gaussian taps', () => {
    const input = Float32Array.from({ length: 1024 * 3 * 4 }, (_, i) =>
      i % 4 === 3 ? 1 : Math.floor(i / 4) % 2,
    );
    const work = separableBlur(
      input,
      1024,
      3,
      200,
      0,
      'wrap',
      (v, size) => ((v % size) + size) % size,
    );
    let step = work.next();
    while (!step.done) step = work.next();
    for (let x = 300; x < 700; x++) expect(step.value[x * 4]).toBeCloseTo(0.5, 1);
  });
  const mask = {
    width: 31,
    height: 23,
    values: Uint8Array.from({ length: 31 * 23 }, (_, i) => (i % 31 > 9 && i % 31 < 20 ? 255 : 0))
      .buffer,
  };
  it.each(BLUR_STYLES)('%s preserves constant opaque color', (style) => {
    const image = {
      width: 17,
      height: 13,
      pixels: Uint8Array.from({ length: 17 * 13 * 4 }, (_, i) => [60, 120, 180, 255][i % 4]!)
        .buffer,
    };
    const subject = {
      width: 17,
      height: 13,
      values: Uint8Array.from({ length: 17 * 13 }, (_, i) => (i % 17 > 5 && i % 17 < 11 ? 255 : 0))
        .buffer,
    };
    expect(
      new Uint8Array(
        renderEffects(image, [blur({ style, radius: 5 })], { subjectMask: subject }).pixels,
      ),
    ).toEqual(new Uint8Array(image.pixels));
  });
  it.each(BLUR_STYLES)('%s is neutral at zero footprint', (style) => {
    const e = blur({ style, radius: 0, travel: 0, point0Radius: 0, point1Radius: 0 });
    expect(render(e)).toEqual(new Uint8Array(fixture().pixels));
  });
  it('Box averages a known rectangular neighborhood with wrap', () => {
    const image = {
      width: 3,
      height: 3,
      pixels: Uint8Array.from({ length: 36 }, (_, i) => (i % 4 === 3 ? 255 : i < 4 ? 90 : 0))
        .buffer,
    };
    const out = new Uint8Array(
      renderEffects(image, [blur({ style: 'box', radius: 10, edgeHandling: 'wrap' })]).pixels,
    );
    for (let i = 0; i < out.length; i += 4)
      expect([...out.slice(i, i + 4)]).toEqual([10, 10, 10, 255]);
  });
  it('Gaussian uses weights instead of uniform averaging', () => {
    const image = {
      width: 9,
      height: 9,
      pixels: Uint8Array.from({ length: 9 * 9 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : Math.floor(i / 4) === 40 ? 255 : 0,
      ).buffer,
    };
    const e = blur({ radius: 10 });
    const gauss = render(e, image),
      box = render(blur({ style: 'box', radius: 10 }), image);
    expect(gauss[40 * 4]!).toBeGreaterThan(box[40 * 4]!);
    expect(gauss[40 * 4]!).toBeGreaterThan(gauss[39 * 4]!);
  });
  it('ignores hidden RGB while premultiplied sampling blurs alpha', () => {
    const image = {
      width: 9,
      height: 9,
      pixels: Uint8Array.from({ length: 9 * 9 * 4 }, (_, i) => [255, 0, 0, 0][i % 4]!).buffer,
    };
    new Uint8Array(image.pixels).set([0, 0, 255, 255], 40 * 4);
    for (const style of [
      'gaussian',
      'box',
      'motion',
      'lens',
      'shape',
      'grainy',
      'smart',
    ] as const) {
      const out = render(blur({ style, radius: 10, sensitivity: 1 }), image);
      for (let i = 0; i < out.length; i += 4)
        if (out[i + 3]! > 0) {
          expect(out[i]).toBe(0);
          expect(out[i + 1]).toBe(0);
          expect(out[i + 2]).toBe(255);
        }
    }
  });
  it('only Grainy changes with the seed', () => {
    const a = fixture(),
      b = fixture();
    const altered = new Uint8Array(b.pixels);
    for (let i = 0; i < altered.length; i += 4)
      if (altered[i + 3] === 0) altered.set([17, 222, 91], i);
    for (const style of ['surface', 'smart', 'lens'] as const) {
      const first = render(blur({ style, radius: 10, threshold: 0.5, highlights: 3 }), a);
      const second = render(blur({ style, radius: 10, threshold: 0.5, highlights: 3 }), b);
      for (let i = 0; i < first.length; i += 4)
        if (first[i + 3]! > 0)
          expect([...second.slice(i, i + 4)]).toEqual([...first.slice(i, i + 4)]);
    }
    const e = blur({ style: 'grainy', radius: 10 });
    expect(render({ ...e, seedOffset: 3 })).not.toEqual(render(e));
    for (const style of BLUR_STYLES.filter((s) => !['grainy', 'background'].includes(s))) {
      const deterministic = blur({ style, radius: 10 });
      expect(render({ ...deterministic, seedOffset: 3 })).toEqual(render(deterministic));
    }
  });
  it('protects subject colors and never bleeds them into the background', () => {
    const image = {
      width: 31,
      height: 23,
      pixels: Uint8Array.from({ length: 31 * 23 * 4 }, (_, i) => {
        const inside = new Uint8Array(mask.values)[Math.floor(i / 4)] === 255;
        return i % 4 === 3
          ? 255
          : i % 4 === 0
            ? inside
              ? 255
              : 0
            : i % 4 === 1
              ? inside
                ? 0
                : 255
              : 0;
      }).buffer,
    };
    const out = new Uint8Array(
      renderEffects(image, [blur({ style: 'background', radius: 10, maskSoftness: 0 })], {
        subjectMask: mask,
      }).pixels,
    );
    expect(out).toEqual(new Uint8Array(image.pixels));
    expect(effectsNeedSubject([blur({ style: 'background' })])).toBe(true);
    expect(effectsNeedSubject([blur({ style: 'background', radius: 0 })])).toBe(false);
  });
  it('interpolates field radii and keeps exact sharp control points', () => {
    const params = blur({
      point0X: 0,
      point0Y: 50,
      point0Radius: 0,
      point1X: 100,
      point1Y: 50,
      point1Radius: 10,
    }).params;
    expect(fieldRadius(params, 0, 0.5)).toBe(0);
    expect(fieldRadius(params, 1, 0.5)).toBe(10);
    expect(fieldRadius(params, 0.5, 0.5)).toBe(5);
  });
  it('does not apply dormant aperture controls to other styles', () => {
    for (const style of ['surface', 'grainy', 'field', 'tilt-shift', 'smart'] as const)
      expect(render(blur({ style, radius: 10, aspect: 4, apertureRotation: 127 }))).toEqual(
        render(blur({ style, radius: 10 })),
      );
    for (const shape of ['circle', 'ring'] as const)
      expect(render(blur({ style: 'shape', shape, radius: 10, apertureRotation: 127 }))).toEqual(
        render(blur({ style: 'shape', shape, radius: 10 })),
      );
  });
  it('Surface and Smart Blur have distinct edge responses', () => {
    const image = {
      width: 31,
      height: 23,
      pixels: Uint8Array.from({ length: 31 * 23 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : Math.floor(i / 4) % 31 < 15 ? 0 : 255,
      ).buffer,
    };
    const surface = render(blur({ style: 'surface', radius: 10, threshold: 0 }), image);
    const smart = render(
      blur({ style: 'smart', radius: 10, sensitivity: 1, preservation: 0 }),
      image,
    );
    expect(surface).toEqual(new Uint8Array(image.pixels));
    expect(smart).not.toEqual(surface);
    expect(render(blur({ style: 'smart', radius: 10, preservation: 1 }), image)).toEqual(
      new Uint8Array(image.pixels),
    );
  });
  it('keeps the tilt-shift focus band sharp', () => {
    const image = fixture(31, 31);
    const out = render(blur({ style: 'tilt-shift', radius: 10, width: 20, falloff: 10 }), image);
    expect(out.slice(15 * 31 * 4, 16 * 31 * 4)).toEqual(
      new Uint8Array(image.pixels).slice(15 * 31 * 4, 16 * 31 * 4),
    );
    expect(out.slice(0, 31 * 4)).not.toEqual(new Uint8Array(image.pixels).slice(0, 31 * 4));
  });
});
describe('finishing integration', () => {
  it.each([noise(), blur()])('disables, masks and persists $type without input mutation', (e) => {
    const image = fixture(),
      before = new Uint8Array(image.pixels).slice();
    for (const neutral of [
      { ...e, enabled: false },
      { ...e, params: { ...e.params, amount: 0 } },
      { ...e, application: { ...e.application, coverage: 0 } },
    ] as EffectInstance[])
      expect(render(neutral, image)).toEqual(before);
    render(e, image);
    expect(new Uint8Array(image.pixels)).toEqual(before);
    const restored = JSON.parse(JSON.stringify(e)) as EffectInstance;
    assertEffect(restored);
    assertPresetRecipe({ masterSeed: 123, effects: [restored] });
    expect(render(restored, image)).toEqual(render(e, image));
  });
  it('rejects invalid styles, octaves and field data', () => {
    const missingEdge = JSON.parse(JSON.stringify(blur())) as BlurEffect;
    delete (missingEdge.params as Record<string, number | string>).edgeHandling;
    expect(() => assertEffect(missingEdge)).toThrow();
    for (const e of [
      { ...noise(), params: { ...noise().params, detail: 7 } },
      { ...blur(), params: { ...blur().params, pointCount: 9 } },
      { ...blur(), params: { ...blur().params, point7X: NaN } },
    ])
      expect(() => assertEffect(e as EffectInstance)).toThrow();
  });
  it.each([
    noise({ style: 'voronoi', detail: 6 }),
    blur({ style: 'lens' }),
    blur({ style: 'gaussian' }),
    blur({ style: 'field' }),
  ])('cancels $type during rendering', async (e) => {
    let cancel = false;
    let time = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (time += 9));
    try {
      await expect(
        renderEffectsAsync(fixture(129, 129), [e], {
          yieldControl: async () => {
            cancel = true;
          },
          isCancelled: () => cancel,
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    } finally {
      clock.mockRestore();
    }
  });
});
