import { describe, expect, it } from 'vitest';
import { createEffect, assertEffect, type BitCrushEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const effect = createEffect('bit-crush', 'bits') as BitCrushEffect;
const pixels = new Uint8Array([
  0, 42, 84, 0, 85, 127, 128, 1, 170, 212, 255, 128, 33, 200, 250, 255,
]);
const image = { width: 4, height: 1, pixels: pixels.buffer };
const withParams = (params: Partial<BitCrushEffect['params']>): BitCrushEffect => ({
  ...effect,
  params: { ...effect.params, ...params },
});
function gray(width = 8, height = 8) {
  const values = new Uint8Array(width * height * 4);
  for (let i = 0; i < values.length; i += 4) values.set([128, 128, 128, 255], i);
  return { width, height, pixels: values.buffer };
}
function same(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

describe('bit crush version 1', () => {
  it('quantizes RGB to exact levels, preserving alpha and the input buffer including hidden RGB', () => {
    const output = new Uint8Array(renderEffects(image, [withParams({ bits: 2 })]).pixels);
    expect([...output]).toEqual([
      0, 0, 85, 0, 85, 85, 170, 1, 170, 170, 255, 128, 0, 170, 255, 255,
    ]);
    expect([...pixels]).toEqual([
      0, 42, 84, 0, 85, 127, 128, 1, 170, 212, 255, 128, 33, 200, 250, 255,
    ]);
    const blend = new Uint8Array(
      renderEffects(image, [withParams({ bits: 2, amount: 0.5 })]).pixels,
    );
    expect([...blend.slice(4, 8)]).toEqual([85, 106, 149, 1]);
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('provides exactly 2^%i levels per color channel', (bits) => {
    const ramp = new Uint8Array(
      Array.from({ length: 256 }, (_, value) => [value, value, value, value]).flat(),
    );
    const output = new Uint8Array(
      renderEffects({ width: 256, height: 1, pixels: ramp.buffer }, [withParams({ bits })]).pixels,
    );
    expect(new Set([...output].filter((_, index) => index % 4 === 0)).size).toBe(2 ** bits);
    for (let i = 3; i < output.length; i += 4) expect(output[i]).toBe(ramp[i]);
  });
  it('treats 8-bit, disabled, zero blend and zero coverage as exact no-ops', () => {
    for (const candidate of [
      withParams({ bits: 8, dither: 'random', ditherAmount: 1 }),
      { ...effect, enabled: false },
      withParams({ amount: 0 }),
      { ...effect, application: { ...effect.application, coverage: 0 } },
    ])
      expect(renderEffects(image, [candidate]).pixels).toBe(image.pixels);
    expect(() => assertEffect(withParams({ bits: 2.5 }))).toThrow();
  });
  it('uses a repeating ordered pattern, independent of seeds, and disables dithering at zero strength', () => {
    const input = gray();
    const ordered = withParams({ bits: 1, dither: 'ordered', ditherAmount: 1 });
    const output = new Uint8Array(renderEffects(input, [ordered], { masterSeed: 12 }).pixels);
    expect([...output.slice(0, 16)].filter((_, i) => i % 4 === 0)).toEqual([0, 255, 0, 255]);
    expect([...output.slice(32, 48)].filter((_, i) => i % 4 === 0)).toEqual([255, 0, 255, 0]);
    expect(
      same(
        renderEffects(input, [{ ...ordered, seedOffset: 9 }], { masterSeed: 98 }).pixels,
        output.buffer,
      ),
    ).toBe(true);
    const clean = renderEffects(input, [withParams({ bits: 1 })]).pixels;
    expect(
      same(
        renderEffects(input, [withParams({ bits: 1, dither: 'random', ditherAmount: 0 })]).pixels,
        clean,
      ),
    ).toBe(true);
    expect(
      same(
        renderEffects(input, [withParams({ bits: 1, dither: 'ordered', ditherAmount: 0 })]).pixels,
        clean,
      ),
    ).toBe(true);
  });
  it('reproduces random dithering and varies with master seed, instance ID and pattern offset', () => {
    const input = gray(32, 16);
    const random = withParams({ bits: 1, dither: 'random', ditherAmount: 1 });
    const original = renderEffects(input, [random], { masterSeed: 8172 }).pixels;
    expect(same(renderEffects(input, [random], { masterSeed: 8172 }).pixels, original)).toBe(true);
    expect(same(renderEffects(input, [random], { masterSeed: 8173 }).pixels, original)).toBe(false);
    expect(
      same(
        renderEffects(input, [{ ...random, seedOffset: 1 }], { masterSeed: 8172 }).pixels,
        original,
      ),
    ).toBe(false);
    expect(
      same(
        renderEffects(input, [{ ...random, instanceId: 'other' }], { masterSeed: 8172 }).pixels,
        original,
      ),
    ).toBe(false);
  });
  it.each(['ordered', 'random'] as const)(
    'addresses %s dithering at original-image coordinates in reduced previews',
    (dither) => {
      const candidate = withParams({ bits: 1, dither, ditherAmount: 1 });
      const full = gray(8, 8);
      const original = new Uint8Array(
        renderEffects(full, [candidate], { masterSeed: 8172 }).pixels,
      );
      const preview = new Uint8Array(
        renderEffects(gray(2, 2), [candidate], { masterSeed: 8172, reference: full }).pixels,
      );
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          const from = ((y * 4 + 2) * 8 + x * 4 + 2) * 4;
          expect(preview.slice((y * 2 + x) * 4, (y * 2 + x + 1) * 4)).toEqual(
            original.slice(from, from + 4),
          );
        }
    },
  );
  it('shares hard directional and detected-subject masks and supports cancellable async rendering', async () => {
    const input = gray();
    const top: BitCrushEffect = {
      ...withParams({ bits: 1 }),
      application: { region: 'top', coverage: 0.5, softness: 0 },
    };
    const result = new Uint8Array(renderEffects(input, [top]).pixels);
    // 128 rounds up to 255 at one bit; the unselected bottom retains its original RGB.
    expect(result[0]).toBe(255);
    expect(result[7 * 8 * 4]).toBe(128);
    const subject = {
      ...top,
      application: { region: 'subject' as const, coverage: 1, softness: 0 },
    };
    const subjectMask = { width: 1, height: 2, values: new Uint8Array([255, 0]).buffer };
    expect(same(renderEffects(input, [subject], { subjectMask }).pixels, result.buffer)).toBe(true);
    expect(
      same(
        (await renderEffectsAsync(input, [top], { yieldControl: async () => {} })).pixels,
        result.buffer,
      ),
    ).toBe(true);
    await expect(
      renderEffectsAsync(input, [top], { isCancelled: () => true, yieldControl: async () => {} }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});

describe('independent bit crush channels', () => {
  const ramp = {
    width: 256,
    height: 1,
    pixels: new Uint8Array(
      Array.from({ length: 256 }, (_, value) => [value, value, value, value]).flat(),
    ).buffer,
  };
  it('supports R3/G5/B2/A8 with exact level counts and untouched alpha', () => {
    const mixed = withParams({ linkRGB: 'off', bits: 8, redBits: 3, greenBits: 5, blueBits: 2 });
    const output = new Uint8Array(renderEffects(ramp, [mixed]).pixels);
    for (const [channel, count] of [
      [0, 8],
      [1, 32],
      [2, 4],
      [3, 256],
    ])
      expect(new Set(output.filter((_, index) => index % 4 === channel)).size).toBe(count);
    for (let i = 3; i < output.length; i += 4)
      expect(output[i]).toBe(new Uint8Array(ramp.pixels)[i]);
  });
  it('quantizes alpha independently, honors opacity/coverage and bypasses 8-bit RGB dithering', async () => {
    const alphaOnly = withParams({ bits: 8, alphaBits: 2, dither: 'none' });
    const output = new Uint8Array(renderEffects(image, [alphaOnly]).pixels);
    expect([...output]).toEqual([
      0, 42, 84, 0, 85, 127, 128, 0, 170, 212, 255, 170, 33, 200, 250, 255,
    ]);
    const partial = new Uint8Array(
      renderEffects(image, [withParams({ bits: 8, alphaBits: 2, amount: 0.5 })]).pixels,
    );
    expect(partial[11]).toBe(149);
    expect(
      same(
        (await renderEffectsAsync(image, [alphaOnly], { yieldControl: async () => {} })).pixels,
        output.buffer,
      ),
    ).toBe(true);
    for (const dither of ['ordered', 'random'] as const) {
      const result = new Uint8Array(
        renderEffects(image, [withParams({ bits: 8, alphaBits: 1, dither, ditherAmount: 1 })])
          .pixels,
      );
      for (let i = 0; i < result.length; i++) if (i % 4 !== 3) expect(result[i]).toBe(pixels[i]);
      expect(result[3]).toBe(0);
      expect(result[15]).toBe(255);
    }
    const masked = {
      ...alphaOnly,
      application: { region: 'left' as const, coverage: 0.5, softness: 0 },
    };
    const result = new Uint8Array(renderEffects(image, [masked]).pixels);
    expect(result.slice(8)).toEqual(pixels.slice(8));
    expect(result[7]).toBe(0);
  });
  it('keeps older recipes byte-identical and accepts partially specified independent channels', () => {
    const legacy = {
      ...effect,
      params: { amount: 1, bits: 2, dither: 'random' as const, ditherAmount: 0.75 },
    };
    expect(() => assertEffect(legacy)).not.toThrow();
    expect(
      same(
        renderEffects(image, [legacy]).pixels,
        renderEffects(image, [withParams({ bits: 2, dither: 'random' })]).pixels,
      ),
    ).toBe(true);
    const partial = {
      ...legacy,
      params: { ...legacy.params, linkRGB: 'off' as const, redBits: 8 },
    };
    expect(() => assertEffect(partial)).not.toThrow();
    const output = new Uint8Array(renderEffects(image, [partial]).pixels);
    expect(output[4]).toBe(85);
    expect(output[0]).toBe(pixels[0]);
    expect(output[3]).toBe(pixels[3]);
    const neutral = withParams({
      linkRGB: 'off',
      bits: 1,
      redBits: 8,
      greenBits: 8,
      blueBits: 8,
      alphaBits: 8,
      dither: 'random',
      ditherAmount: 1,
    });
    expect(renderEffects(image, [neutral]).pixels).toBe(image.pixels);
  });
  it.each(['redBits', 'greenBits', 'blueBits', 'alphaBits'])(
    'rejects invalid %s precision',
    (key) => {
      for (const value of [0, 9, 2.5, NaN, Infinity])
        expect(() => assertEffect(withParams({ [key]: value }))).toThrow();
      expect(() => assertEffect(withParams({ linkRGB: 'invalid' as 'on' }))).toThrow();
    },
  );
});
