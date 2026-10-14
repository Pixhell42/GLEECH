import { describe, expect, it } from 'vitest';
import { createEffect, type ChromaMoshEffect } from '@gleech/project-model';
import { chromaAtLuma } from './chroma-mosh';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const effect = (params: Partial<ChromaMoshEffect['params']> = {}): ChromaMoshEffect => {
  const e = createEffect('chroma-mosh', 'chroma') as ChromaMoshEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const fixture = (width = 64, height = 48) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3
      ? [0, 64, 128, 255][Math.floor(i / 4) % 4]!
      : (i * 31 + Math.floor(i / (width * 4)) * 19) % 256,
  ).buffer,
});
const render = (source: ReturnType<typeof fixture>, e: ChromaMoshEffect) =>
  new Uint8Array(renderEffects(source, [e], { masterSeed: 17 }).pixels);
const luma = (bytes: Uint8Array | Float64Array, i: number) =>
  0.299 * bytes[i]! + 0.587 * bytes[i + 1]! + 0.114 * bytes[i + 2]!;

describe('Chroma Mosh', () => {
  it('fits extreme chroma into gamut by reducing color, without clipping or changing luminance', () => {
    const color = new Float64Array(4);
    for (const y of [0, 17, 128, 240, 255])
      for (const [cb, cr] of [
        [1000, -1000],
        [-1000, 1000],
        [0, 0],
      ]) {
        chromaAtLuma(y, cb!, cr!, color);
        expect(luma(color, 0)).toBeCloseTo(y, 9);
        for (const value of color.slice(0, 3)) {
          expect(value).toBeGreaterThanOrEqual(-1e-10);
          expect(value).toBeLessThanOrEqual(255 + 1e-10);
        }
      }
  });
  it('preserves brightness and every alpha byte across styles, directions and all edge modes', () => {
    const source = fixture(),
      input = new Uint8Array(source.pixels);
    for (const style of ['smear', 'blocks', 'trails'] as const)
      for (const edgeHandling of ['extend', 'wrap', 'mirror'] as const) {
        const out = render(
          source,
          effect({ style, edgeHandling, displacement: 37, direction: 28, colorResolution: 9 }),
        );
        expect(out).not.toEqual(input);
        for (let i = 0; i < out.length; i += 4) {
          expect(out[i + 3]).toBe(input[i + 3]);
          expect(Math.abs(luma(out, i) - luma(input, i))).toBeLessThanOrEqual(0.501);
          if (input[i + 3] === 0) expect(out.slice(i, i + 4)).toEqual(input.slice(i, i + 4));
        }
      }
  });
  it('ignores invisible source colors and preserves neutral gray through all color treatments', () => {
    const source = fixture(),
      other = { ...source, pixels: source.pixels.slice(0) };
    const input = new Uint8Array(source.pixels),
      changed = new Uint8Array(other.pixels);
    for (let i = 0; i < input.length; i += 4) if (input[i + 3] === 0) changed.set([255, 0, 255], i);
    const gray = {
      ...source,
      pixels: Uint8Array.from(input, (v, i) => (i % 4 === 3 ? v : 123)).buffer,
    };
    for (const style of ['smear', 'blocks', 'trails'] as const) {
      const e = effect({ style, density: 1, displacement: 29, persistence: 0.9 });
      const a = render(source, e),
        b = render(other, e);
      for (let i = 0; i < a.length; i += 4)
        if (input[i + 3] !== 0) expect(a.slice(i, i + 4)).toEqual(b.slice(i, i + 4));
      expect(render(gray, e)).toEqual(new Uint8Array(gray.pixels));
    }
  });
  it('has exact bypasses, respects masks and varies only seeded styles', () => {
    const source = fixture(),
      input = new Uint8Array(source.pixels),
      e = effect();
    for (const bypass of [
      effect({ chromaMix: 0 }),
      effect({ amount: 0 }),
      effect({ density: 0 }),
      { ...e, enabled: false },
      { ...e, application: { region: 'all' as const, coverage: 0, softness: 0 } },
    ])
      expect(render(source, bypass)).toEqual(input);
    for (const style of ['blocks', 'trails'] as const) {
      const seeded = effect({ style });
      expect(render(source, seeded)).toEqual(render(source, seeded));
      expect(render(source, { ...seeded, seedOffset: 1 })).not.toEqual(render(source, seeded));
    }
    const smear = effect({ style: 'smear' });
    expect(render(source, { ...smear, seedOffset: 1 })).toEqual(render(source, smear));
    const masked = render(source, {
      ...e,
      application: { region: 'left', coverage: 0.5, softness: 0 },
    });
    for (let y = 0; y < source.height; y++)
      expect(
        masked.slice((y * source.width + source.width / 2) * 4, (y + 1) * source.width * 4),
      ).toEqual(input.slice((y * source.width + source.width / 2) * 4, (y + 1) * source.width * 4));
  });
  it('changes trail persistence, sampling and edge handling independently and cancels bounded work', async () => {
    const source = fixture(),
      base = effect({ density: 1, displacement: 40 });
    const out = render(source, base);
    for (const params of [
      { samples: 1 },
      { persistence: 0 },
      { edgeHandling: 'wrap' as const },
      { direction: 90 },
    ])
      expect(render(source, effect({ ...base.params, ...params }))).not.toEqual(out);
    let polls = 0;
    await expect(
      renderEffectsAsync(fixture(256, 192), [base], {
        isCancelled: () => ++polls > 4,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
