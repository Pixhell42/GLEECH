import { describe, expect, it } from 'vitest';
import {
  createEffect,
  createPaintedMask,
  heightFieldParams,
  type EffectApplication,
  type SolidEffect,
} from '@gleech/project-model';
import { renderEffects, RenderCancelledError } from './index';
import { analyzeApplication, signalApplicationSampler } from './application-analysis';
const solid = createEffect('solid', 'paint') as SolidEffect;
const source = (width: number, height: number, pixel: (x: number, y: number) => number[]) => ({
  width,
  height,
  pixels: Uint8Array.from(
    Array.from({ length: width * height }, (_, i) =>
      pixel(i % width, Math.floor(i / width)),
    ).flat(),
  ).buffer,
});
const image = source(
  3,
  1,
  (x) =>
    [
      [20, 20, 20, 255],
      [128, 128, 128, 255],
      [240, 240, 240, 255],
    ][x]!,
);
const effect = (application: Partial<EffectApplication>) => ({
  ...solid,
  params: { ...solid.params, content: 'color' as const, fillColor: '#ff0000' },
  application: { ...solid.application, ...application },
});
const render = (app: Partial<EffectApplication>, input = image) =>
  new Uint8Array(renderEffects(input, [effect(app)]).pixels);
describe('Reusable Application sources', () => {
  it.each([
    ['highlights', 2],
    ['midtones', 1],
    ['shadows', 0],
  ] as const)('%s selects the corresponding stage-input tonal range', (region, index) => {
    const out = render({ region, coverage: 1 / 3 });
    for (let x = 0; x < 3; x++)
      expect([...out.slice(x * 4, x * 4 + 4)]).toEqual(
        x === index ? [255, 0, 0, 255] : [...new Uint8Array(image.pixels).slice(x * 4, x * 4 + 4)],
      );
  });
  it('inverts the generated mask and respects cutoffs, softness and zero coverage', () => {
    const inverted = render({ region: 'highlights', coverage: 1 / 3, invert: 'on' });
    expect([...inverted.slice(0, 8)]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
    expect([...inverted.slice(8)]).toEqual([240, 240, 240, 255]);
    expect(render({ region: 'highlights', rangeStart: 0.99 })).toEqual(
      new Uint8Array(image.pixels),
    );
    expect(render({ region: 'shadows', coverage: 0, invert: 'on' })).toEqual(
      new Uint8Array(image.pixels),
    );
    const hard = render({ region: 'highlights', coverage: 0.5 }),
      soft = render({ region: 'highlights', coverage: 0.5, softness: 0.5 });
    expect(soft[4]).toBeGreaterThan(128);
    expect(soft[4]).toBeLessThan(hard[4]!);
  });
  it('uses source alpha continuously and ignores hidden RGB in content analysis', () => {
    const input = source(3, 1, (x) => [100, 100, 100, [0, 128, 255][x]!]);
    const out = render({ region: 'alpha' }, input);
    expect([...out.slice(0, 4)]).toEqual([100, 100, 100, 0]);
    expect([...out.slice(4, 8)]).toEqual([203, 33, 33, 192]);
    expect([...out.slice(8, 12)]).toEqual([255, 0, 0, 255]);
    const hidden = source(8, 8, (x) => [x % 2 ? 255 : 0, 0, 255, 0]);
    const steps = analyzeApplication(hidden, hidden, 1);
    let next = steps.next();
    while (!next.done) next = steps.next();
    expect([...next.value.edges.values].every((value) => value === 0)).toBe(true);
  });
  it('distinguishes real edges, flat areas and fine local detail', () => {
    const input = source(32, 16, (x) => [
      x < 16 ? 0 : 255,
      x < 16 ? 0 : 255,
      x < 16 ? 0 : 255,
      255,
    ]);
    const steps = analyzeApplication(input, input, 5);
    let next = steps.next();
    while (!next.done) next = steps.next();
    const field = next.value;
    for (const region of ['content-edges', 'high-detail'] as const) {
      const sampler = signalApplicationSampler(
        { ...solid.application, region, coverage: 0.5 },
        field,
      );
      expect(sampler(0.5, 0.5)).toBe(1);
      expect(sampler(0.1, 0.5)).toBe(0);
    }
    for (const region of ['flat-areas', 'low-detail'] as const) {
      const sampler = signalApplicationSampler(
        { ...solid.application, region, coverage: 0.5 },
        field,
      );
      expect(sampler(0.5, 0.5)).toBe(0);
      expect(sampler(0.1, 0.5)).toBe(1);
    }
  });
  it.each(['horizontal-bands', 'vertical-bands'] as const)(
    '%s repeats and offsets without changing with the seed',
    (region) => {
      const input = source(16, 16, () => [10, 20, 30, 255]);
      const app = { region, coverage: 0.5, bandFrequency: 4, bandOffset: 0 };
      const out = render(app, input),
        offset = render({ ...app, bandOffset: 0.5 }, input);
      expect(out).not.toEqual(offset);
      expect(render({ ...app, bandOffset: 1 }, input)).toEqual(out);
      expect(out).toEqual(
        new Uint8Array(renderEffects(input, [effect(app)], { masterSeed: 999 }).pixels),
      );
    },
  );
  it.each([
    ['depth-near', 2],
    ['depth-mid', 1],
    ['depth-far', 0],
    ['depth-band', 1],
  ] as const)('%s uses its own field and saved cutoffs', (region, index) => {
    const field = heightFieldParams({
      fieldSource: 'linear',
      fieldNormalize: 'off',
      fieldScale: 100,
    });
    const app = {
      region,
      coverage: region === 'depth-band' ? 1 : 1 / 3,
      depthField: field,
      ...(region === 'depth-band' ? { rangeStart: 0.4, rangeEnd: 0.6 } : {}),
    };
    const out = render(app);
    for (let x = 0; x < 3; x++)
      expect([...out.slice(x * 4, x * 4 + 4)]).toEqual(
        x === index ? [255, 0, 0, 255] : [...new Uint8Array(image.pixels).slice(x * 4, x * 4 + 4)],
      );
  });
  it('keeps analysis tied to stage input and multiplies it by painted masks', () => {
    const first = effect({ region: 'all' }),
      second = effect({ region: 'highlights', coverage: 1 / 3 });
    const flip = {
      ...createEffect('bit-damage', 'flip'),
      params: {
        ...(createEffect('bit-damage', 'flip') as import('@gleech/project-model').BitDamageEffect)
          .params,
        density: 1,
        lowBit: 0,
        highBit: 7,
      },
    };
    const out = new Uint8Array(
      renderEffects(image, [flip as import('@gleech/project-model').EffectInstance, second]).pixels,
    );
    expect([...out.slice(8)]).toEqual([255, 0, 0, 255]);
    expect([...out.slice(0, 4)]).toEqual([235, 235, 235, 255]);
    const masked = { ...first, paintedMask: { ...createPaintedMask(3, 1), base: 0 as const } };
    expect(renderEffects(image, [masked]).pixels).toEqual(image.pixels);
  });
  it('bounds analysis memory and can cancel during analysis without mutating the source', () => {
    const input = source(512, 256, (x, y) => [x % 256, y, 80, 255]);
    const before = input.pixels.slice(0);
    const steps = analyzeApplication(input, { width: 8192, height: 4096 }, 2);
    let next = steps.next();
    while (!next.done) next = steps.next();
    expect(next.value.luminance.width).toBe(256);
    expect(next.value.luminance.height).toBe(128);
    let checks = 0;
    expect(() =>
      renderEffects(input, [effect({ region: 'high-detail' })], {
        isCancelled: () => ++checks > input.height + 8,
      }),
    ).toThrow(RenderCancelledError);
    expect(input.pixels).toEqual(before);
  });
  it('keeps repeating bands in stage coordinates in reduced previews', () => {
    const full = source(320, 160, () => [20, 30, 40, 255]);
    const draft = source(80, 40, () => [20, 30, 40, 255]);
    const layer = effect({
      region: 'vertical-bands',
      coverage: 0.4,
      bandFrequency: 5,
      bandOffset: 0.17,
    });
    const large = new Uint8Array(renderEffects(full, [layer]).pixels);
    const small = new Uint8Array(renderEffects(draft, [layer], { reference: full }).pixels);
    for (let x = 0; x < draft.width; x++) {
      const sx = x * 4 + 2;
      expect([...small.slice(x * 4, x * 4 + 4)]).toEqual([...large.slice(sx * 4, sx * 4 + 4)]);
    }
  });
});
