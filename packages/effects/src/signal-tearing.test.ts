import { describe, expect, it } from 'vitest';
import { assertEffect, createEffect, type SignalTearingEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
import { tearSampler } from './signal-tearing';
const effect = (params: Partial<SignalTearingEffect['params']> = {}): SignalTearingEffect => {
  const e = createEffect('signal-tearing', 'tear') as SignalTearingEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const image = (w = 80, h = 60) => ({
  width: w,
  height: h,
  pixels: Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 17) % 256))
    .buffer,
});
const bytes = (e: SignalTearingEffect, source = image()) =>
  new Uint8Array(renderEffects(source, [e], { masterSeed: 17 }).pixels);
describe('Signal Tearing', () => {
  it('uses exact neutral bypasses but retains active shared finishing', () => {
    const source = image();
    for (const e of [
      effect({ displacement: 0 }),
      effect({ density: 0 }),
      effect({ amount: 0 }),
      { ...effect(), enabled: false },
    ])
      expect(bytes(e, source)).toEqual(new Uint8Array(source.pixels));
    expect(
      bytes(
        effect({ displacement: 0, tintEnabled: 'on', tintStrength: 1, color: '#ff0000' }),
        source,
      ),
    ).not.toEqual(new Uint8Array(source.pixels));
  });
  it('holds one displacement across slices and whole bursts, including negative coordinates', () => {
    const random = (_x: number, _y: number, lane: number) => (lane === 1 ? 1 : 0);
    const p = effect({
      sliceSize: 10,
      displacement: 10,
      density: 1,
      randomness: 1,
      sliceSoftness: 0,
    }).params;
    const sampler = tearSampler(p, 100, random);
    expect([sampler(-19), sampler(-1), sampler(1), sampler(9)]).toEqual([10, 10, 10, 10]);
    const burst = tearSampler({ ...p, style: 'bursts', burstLength: 4 }, 100, (x, _y, lane) =>
      lane === 1 ? (x === 0 ? 1 : 0) : 0,
    );
    expect([burst(1), burst(11), burst(39), burst(41)]).toEqual([10, 10, 10, -10]);
  });
  it('feathers the actual displacement at group boundaries', () => {
    const sampler = tearSampler(
      effect({ sliceSize: 10, displacement: 10, density: 1, randomness: 1, sliceSoftness: 1 })
        .params,
      100,
      (_x, _y, lane) => (lane === 1 ? 1 : 0),
    );
    expect(sampler(0)).toBe(0);
    expect(sampler(2.5)).toBe(5);
    expect(sampler(5)).toBe(10);
  });
  it('matches independent integer displacement in each axis without crossing rows', () => {
    const source = image(100, 100);
    // Sawtooth at phase 0, one 100px band centered at q=50 yields zero;
    // phase 0.25 yields +5px at displacement 10%.
    const p = effect({
      style: 'staircase',
      sliceSize: 25,
      displacement: 10,
      frequency: 1,
      randomness: 0,
      density: 1,
      sliceSoftness: 0,
      positionY: 0,
    }).params;
    const sampler = tearSampler(p, 100, () => 0);
    expect(sampler(12)).toBe(-7.5);
    expect(sampler(38)).toBe(-2.5);
    const horizontal = bytes(effect({ orientation: 0, direction: 0, density: 1 }), source);
    const vertical = bytes(effect({ orientation: 90, direction: 90, density: 1 }), source);
    expect(horizontal).not.toEqual(vertical);
    // Constant rows must stay constant when travel is exclusively horizontal.
    const rows = {
      ...source,
      pixels: Uint8Array.from({ length: 40000 }, (_, i) =>
        i % 4 === 3 ? 255 : Math.floor(i / 400),
      ).buffer,
    };
    expect(bytes(effect({ direction: 0 }), rows)).toEqual(new Uint8Array(rows.pixels));
  });
  it('is deterministic, supports pattern changes and all styles/edges', () => {
    const source = image();
    for (const style of ['slices', 'bursts', 'staircase'] as const)
      for (const edgeHandling of ['extend', 'wrap', 'mirror'] as const) {
        const e = effect({ style, edgeHandling, orientation: 35, direction: 70 });
        expect(bytes(e, source)).toEqual(bytes(e, source));
        expect(bytes(e, source)).not.toEqual(bytes({ ...e, seedOffset: 1 }, source));
      }
  });
  it('steers displacement with a depth field and zero influence keeps ordinary travel', () => {
    const base = effect({ density: 1, direction: 0 });
    const enabled = effect({
      ...base.params,
      fieldEnabled: 'on',
      fieldSource: 'linear',
      fieldInfluence: 1,
    });
    expect(bytes(enabled)).not.toEqual(bytes(base));
    expect(bytes(effect({ ...enabled.params, fieldInfluence: 0 }))).toEqual(bytes(base));
  });
  it('does not introduce hidden-color fringes in fractional samples', () => {
    const source = {
      width: 80,
      height: 60,
      pixels: Uint8Array.from({ length: 80 * 60 * 4 }, (_, i) => {
        const visible = Math.floor(i / 4) % 2 === 0;
        return i % 4 === 3 ? (visible ? 255 : 0) : visible ? (i % 4 === 0 ? 100 : 0) : 255;
      }).buffer,
    };
    const out = bytes(effect({ displacement: 13, density: 1 }), source);
    for (let i = 0; i < out.length; i += 4)
      if (out[i + 3]! > 0) expect([...out.slice(i, i + 3)]).toEqual([100, 0, 0]);
  });
  it('validates recipes and renders one-pixel and reduced canvases', () => {
    expect(() => assertEffect(effect({ burstLength: 0 }))).toThrow();
    for (const [width, height] of [
      [1, 1],
      [1, 100],
      [100, 1],
    ])
      expect(bytes(effect({ orientation: 45 }), image(width, height))).toHaveLength(
        width! * height! * 4,
      );
    const out = renderEffects(image(20, 15), [effect()], {
      reference: { width: 400, height: 300 },
    });
    expect(new Uint8Array(out.pixels)).toHaveLength(1200);
  });
  it('cooperatively cancels large renders with and without a direction field', async () => {
    for (const e of [effect(), effect({ fieldEnabled: 'on', fieldSource: 'perlin' })]) {
      let cancelled = false;
      await expect(
        renderEffectsAsync(image(1024, 1024), [e], {
          isCancelled: () => cancelled,
          yieldControl: async () => {
            cancelled = true;
          },
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    }
  });
});
