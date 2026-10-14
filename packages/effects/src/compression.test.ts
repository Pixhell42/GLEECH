import { describe, expect, it } from 'vitest';
import { assertEffect, createEffect, type CompressionBreakupEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const fixture = (width = 32, height = 24) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3
      ? [0, 64, 128, 255][Math.floor(i / 4) % 4]!
      : (i * 31 + Math.floor(i / (width * 4)) * 19) % 256,
  ).buffer,
});
const effect = (params: Partial<CompressionBreakupEffect['params']> = {}) => {
  const e = createEffect('compression-breakup', 'codec') as CompressionBreakupEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const neutral = {
  compression: 0,
  colorResolution: 'full',
  colorBleed: 0,
  ringing: 0,
  seams: 0,
  damageDensity: 0,
} as const;
const render = (image: ReturnType<typeof fixture>, e: CompressionBreakupEffect) =>
  new Uint8Array(renderEffects(image, [e], { masterSeed: 17 }).pixels);
const constant = () => ({
  width: 32,
  height: 24,
  pixels: Uint8Array.from({ length: 32 * 24 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 128)).buffer,
});

describe('Compression Breakup', () => {
  it('retains exact source bytes for neutral settings, zero opacity, disabled effects and empty coverage', () => {
    const source = fixture(),
      e = effect();
    for (const changed of [
      effect(neutral),
      effect({ ...neutral, compression: 1e-100 }),
      { ...e, enabled: false },
      effect({ amount: 0 }),
      { ...e, application: { region: 'all' as const, coverage: 0, softness: 0 } },
      effect({ ...neutral, damageDensity: 1, damageStrength: 0 }),
    ])
      expect(render(source, changed)).toEqual(new Uint8Array(source.pixels));
  });
  it('retains uniform gray through the transform and independently draws block seams', () => {
    const source = constant();
    expect(render(source, effect({ ...neutral, compression: 0.75 }))).toEqual(
      new Uint8Array(source.pixels),
    );
    const seams = render(source, effect({ ...neutral, seams: 1 }));
    expect(seams[0]).toBeLessThan(128);
    expect(seams[(4 * 32 + 4) * 4]).toBe(128);
  });
  it('discards high-frequency detail as compression increases and adds ringing independently', () => {
    const source = fixture(64, 48),
      input = new Uint8Array(source.pixels);
    const low = render(source, effect({ ...neutral, compression: 0.15 }));
    const high = render(source, effect({ ...neutral, compression: 1 }));
    const error = (bytes: Uint8Array) =>
      bytes.reduce(
        (sum, v, i) =>
          sum + (i % 4 === 3 || input[i + 3 - (i % 4)] === 0 ? 0 : (v - input[i]!) ** 2),
        0,
      );
    expect(error(high)).toBeGreaterThan(error(low));
    expect(render(source, effect({ ...neutral, compression: 0.6, ringing: 1 }))).not.toEqual(
      render(source, effect({ ...neutral, compression: 0.6 })),
    );
  });
  it('degrades color independently while retaining luminance and source alpha', () => {
    const width = 128,
      height = 96;
    const source = {
      width,
      height,
      pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) => {
        const x = Math.floor(i / 4) % width,
          c = i % 4;
        return c === 3 ? 255 : (x % 2 === 0 ? [150, 100, 100] : [100, 150, 100])[c]!;
      }).buffer,
    };
    const input = new Uint8Array(source.pixels),
      out = render(source, effect({ ...neutral, colorResolution: 'block', blockSize: 12 }));
    expect(out).not.toEqual(input);
    for (let i = 0; i < out.length; i += 4) {
      const luminance = (b: Uint8Array) => 0.299 * b[i]! + 0.587 * b[i + 1]! + 0.114 * b[i + 2]!;
      expect(Math.abs(luminance(input) - luminance(out))).toBeLessThan(1);
      expect(out[i + 3]).toBe(input[i + 3]);
    }
  });
  it('never introduces hidden colors into visible pixels and retains partial transparency', () => {
    const source = fixture(),
      modified = { ...source, pixels: source.pixels.slice(0) };
    const a = new Uint8Array(source.pixels),
      b = new Uint8Array(modified.pixels);
    for (let i = 0; i < a.length; i += 4) if (a[i + 3] === 0) b.set([255, 0, 255], i);
    const e = effect({ damageDensity: 0.4, seams: 0.5, ringing: 0.7 }),
      out = render(source, e),
      other = render(modified, e);
    for (let i = 0; i < a.length; i += 4) {
      expect(out[i + 3]).toBe(a[i + 3]);
      if (a[i + 3] !== 0) expect(out.subarray(i, i + 4)).toEqual(other.subarray(i, i + 4));
      else expect(other.subarray(i, i + 4)).toEqual(b.subarray(i, i + 4));
    }
  });
  it('reproduces each seeded failure type and changes only damage when the pattern changes', () => {
    const source = fixture(64, 48);
    for (const damageMode of ['mixed', 'color-shift', 'dropout', 'coefficient-loss'] as const) {
      const e = effect({ ...neutral, damageDensity: 0.6, damageStrength: 0.8, damageMode });
      const out = render(source, e);
      expect(render(source, e)).toEqual(out);
      expect(render(source, { ...e, seedOffset: 1 })).not.toEqual(out);
      expect(out).not.toEqual(new Uint8Array(source.pixels));
    }
    const ordinary = effect({ ...neutral, compression: 0.7 });
    expect(render(source, { ...ordinary, seedOffset: 1 })).toEqual(render(source, ordinary));
  });
  it('uses explicit edge handling for bleeding color and validates bounded recipes', () => {
    const source = fixture(64, 48),
      e = effect({ ...neutral, colorBleed: 1, colorResolution: 'quarter' });
    expect(render(source, effect({ ...e.params, edgeHandling: 'wrap' }))).not.toEqual(
      render(source, e),
    );
    expect(render(source, effect({ ...e.params, edgeHandling: 'mirror' }))).not.toEqual(
      render(source, e),
    );
    expect(() => assertEffect(effect({ blockSize: 0.1 }))).toThrow();
    expect(() => assertEffect(effect({ damageDensity: 1.01 }))).toThrow();
    const saved = JSON.parse(JSON.stringify(e)) as CompressionBreakupEffect;
    expect(() => assertEffect(saved)).not.toThrow();
    expect(render(source, saved)).toEqual(render(source, e));
  });
  it('cancels inside block work without modifying the source', async () => {
    const source = fixture(256, 192),
      before = source.pixels.slice(0);
    let polls = 0;
    await expect(
      renderEffectsAsync(source, [effect()], {
        isCancelled: () => ++polls > 10,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(source.pixels).toEqual(before);
  });
});
