import { describe, expect, it } from 'vitest';
import {
  GLYPH_DEFAULTS,
  GLYPH_STYLES,
  createEffect,
  assertEffect,
  type GlyphEffect,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
import { glyphFalloff } from './glyph';
import { GLYPH_EMOJI, emojiSelection, EMOJI_ATLAS_VERSION } from './glyph-atlas';

const effect = (params: Partial<GlyphEffect['params']> = {}): GlyphEffect => {
  const e = createEffect('glyph', 'glyph') as GlyphEffect;
  return {
    ...e,
    params: {
      ...e.params,
      cellSize: 10,
      aspect: 1.4,
      glyphScale: 1,
      coloring: 'custom',
      foregroundColor: '#ffffff',
      backgroundColor: '#000000',
      ...params,
    },
  };
};
const image = (
  width: number,
  height: number,
  value: (x: number, y: number) => readonly number[] = () => [255, 255, 255, 255],
) => ({
  width,
  height,
  pixels: Uint8Array.from(
    Array.from({ length: width * height }, (_, i) =>
      value(i % width, Math.floor(i / width)),
    ).flat(),
  ).buffer,
});
const pixels = (source: ReturnType<typeof image>, e: GlyphEffect, seed = 1) =>
  new Uint8Array(renderEffects(source, [e], { masterSeed: seed }).pixels);

describe('expanded glyph rendering', () => {
  it('preserves version-one recipes with absent additions and inactive controls', () => {
    const e = effect(),
      old = {
        ...e,
        params: Object.fromEntries(
          Object.entries(e.params).filter(([key]) => !Object.hasOwn(GLYPH_DEFAULTS, key)),
        ),
      } as GlyphEffect;
    expect(() => assertEffect(old)).not.toThrow();
    const source = image(43, 29, (x, y) => [(x * 17) % 256, (y * 23) % 256, 80, 255]);
    for (const style of ['ascii', 'braille', 'blocks'] as const)
      expect(pixels(source, { ...old, params: { ...old.params, style } })).toEqual(
        pixels(source, {
          ...e,
          params: { ...e.params, style, sizeFrom: 0, sizeTo: 2, falloffColor: '#ff0000' },
        }),
      );
  });
  it('keeps repeating custom text in reading order, including spaces', () => {
    const source = image(30, 14),
      result = pixels(source, effect({ style: 'custom-text', text: 'A ' }));
    const rows = [14, 17, 17, 31, 17, 17, 17];
    for (let y = 0; y < 14; y++)
      for (let x = 0; x < 30; x++) {
        const expected =
          x >= 10 && x < 20
            ? 0
            : (rows[Math.floor(y / 2)]! & (1 << (4 - Math.floor((x % 10) / 2)))) !== 0
              ? 255
              : 0;
        expect([...result.slice((y * 30 + x) * 4, (y * 30 + x) * 4 + 4)]).toEqual([
          expected,
          expected,
          expected,
          255,
        ]);
      }
    expect(
      pixels(source, effect({ style: 'custom-text', text: '' }))
        .filter((_, i) => i % 4 !== 3)
        .every((v) => v === 0),
    ).toBe(true);
  });
  it('ranks custom sets by caller order and encodes adjusted source-channel digits', () => {
    const white = image(10, 14),
      black = image(10, 14, () => [0, 0, 0, 255]);
    expect(pixels(white, effect({ style: 'custom-set', glyphSet: ' A' }))).toEqual(
      pixels(white, effect({ style: 'custom-text', text: 'A' })),
    );
    expect(pixels(black, effect({ style: 'custom-set', glyphSet: ' A' }))).toEqual(
      pixels(black, effect({ style: 'custom-text', text: ' ' })),
    );
    const gray = image(80, 14, () => [128, 128, 128, 255]);
    expect(pixels(gray, effect({ style: 'binary' }))).toEqual(
      pixels(gray, effect({ style: 'custom-text', text: '10000000' })),
    );
    expect(pixels(white, effect({ style: 'hexadecimal' }))).toEqual(
      pixels(white, effect({ style: 'custom-text', text: 'F' })),
    );
    expect(
      pixels(
        image(30, 14, () => [128, 128, 128, 255]),
        effect({ style: 'numbers' }),
      ),
    ).toEqual(
      pixels(
        image(30, 14, () => [128, 128, 128, 255]),
        effect({ style: 'custom-text', text: '128' }),
      ),
    );
  });
  it('bounds falloffs, supports hard edges, reversed endpoints, centers and independent inversion', () => {
    const ref = { width: 200, height: 100 };
    const f = (
      u: number,
      v: number,
      d = 'horizontal',
      start = 0.25,
      end = 0.75,
      cx = 0.5,
      cy = 0.5,
      invert = false,
    ) => glyphFalloff(u, v, d, start, end, cx, cy, invert, ref);
    expect([f(0, 0.5), f(0.25, 0.5), f(0.5, 0.5), f(0.75, 0.5), f(1, 0.5)]).toEqual([
      0, 0, 0.5, 1, 1,
    ]);
    expect(f(0.5, 0.75, 'vertical')).toBe(1);
    expect(f(0.1, 0.5, 'horizontal', 0.75, 0.25)).toBe(1);
    expect(f(0.49, 0.5, 'horizontal', 0.5, 0.5)).toBe(0);
    expect(f(0.5, 0.5, 'horizontal', 0.5, 0.5)).toBe(1);
    expect(f(0.5, 0.5, 'radial', 0, 1)).toBe(0);
    expect(f(0, 0, 'radial', 0, 1)).toBe(1);
    expect(f(1, 1, 'square', 0, 1)).toBe(1);
    expect(f(0.5, 0.5, 'radial', 0, 1, 0.5, 0.5, true)).toBe(1);
    expect(f(0, 0.5, 'square', 0, 1, 0, 0.5)).toBe(0);
  });
  it('uses a fixed grid for size falloff and restores a cell at either endpoint on inversion', () => {
    const source = image(20, 14),
      base = effect({ style: 'custom-text', text: 'A' }),
      full = pixels(source, base),
      e = effect({
        ...base.params,
        sizeFalloff: 'on',
        sizeFrom: 0,
        sizeTo: 1,
        sizeStart: 0.25,
        sizeEnd: 0.75,
      });
    const result = pixels(source, e),
      inverse = pixels(source, { ...e, params: { ...e.params, sizeInvert: 'on' } });
    for (let y = 0; y < 14; y++) {
      expect(
        result
          .slice(y * 80, y * 80 + 40)
          .filter((_, i) => i % 4 !== 3)
          .every((v) => v === 0),
      ).toBe(true);
      expect(result.slice(y * 80 + 40, y * 80 + 80)).toEqual(full.slice(y * 80 + 40, y * 80 + 80));
      expect(inverse.slice(y * 80, y * 80 + 40)).toEqual(full.slice(y * 80, y * 80 + 40));
    }
  });
  it('defaults to source color falloff and independently interpolates chosen endpoints', () => {
    const source = image(20, 14, () => [190, 90, 40, 128]),
      base = effect({
        style: 'blocks',
        aspect: 1,
        threshold: 0,
        cellSize: 10,
        colorFalloff: 'on',
        colorFalloffStart: 0.25,
        colorFalloffEnd: 0.75,
      }),
      result = pixels(source, base);
    expect(base.params.colorSource).toBe('source');
    expect([...result.slice(0, 4)]).toEqual([0, 0, 0, 128]);
    expect([...result.slice(10 * 4, 10 * 4 + 4)]).toEqual([190, 90, 40, 128]);
    const chosen = effect({
        ...base.params,
        colorSource: 'chosen',
        foregroundColor: '#ff0000',
        falloffColor: '#0000ff',
      }),
      colored = pixels(source, chosen);
    expect([...colored.slice(0, 4)]).toEqual([255, 0, 0, 128]);
    expect([...colored.slice(40, 44)]).toEqual([0, 0, 255, 128]);
    const inverse = pixels(source, { ...chosen, params: { ...chosen.params, colorInvert: 'on' } });
    expect([...inverse.slice(0, 4)]).toEqual([0, 0, 255, 128]);
  });
  it('ships an original stable atlas with usable palettes and ignores unsupported emoji', () => {
    expect(EMOJI_ATLAS_VERSION).toBe('gleech-pixel-emoji-v1');
    expect(GLYPH_EMOJI).toHaveLength(25);
    expect(new Set(GLYPH_EMOJI.map((g) => g.character)).size).toBe(25);
    for (const palette of ['faces', 'objects', 'symbols', 'nature', 'geometric'])
      expect(emojiSelection(palette, '').every((g) => g.category === palette)).toBe(true);
    expect(emojiSelection('custom', '❤️⭐🦄').map((g) => g.character)).toEqual(['❤', '⭐']);
    expect(emojiSelection('custom', '🦄')).toEqual(GLYPH_EMOJI);
    for (const glyph of GLYPH_EMOJI) {
      expect(glyph.pixels.length).toBe(24 * 24 * 4);
      expect(glyph.luminance).toBeGreaterThan(0);
      expect(glyph.pixels.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
    }
  });
  it('samples native atlas colors and supports source tint, monochrome and RGB offsets', () => {
    const source = image(24, 24, () => [80, 130, 200, 255]),
      base = effect({
        style: 'emoji',
        cellSize: 24,
        aspect: 1,
        emojiPalette: 'custom',
        emojiSet: '🔴',
      });
    const i = (12 * 24 + 12) * 4;
    expect([...pixels(source, base).slice(i, i + 4)]).toEqual([243, 70, 101, 255]);
    expect([
      ...pixels(source, effect({ ...base.params, emojiColors: 'source' })).slice(i, i + 4),
    ]).toEqual([80, 130, 200, 255]);
    expect([
      ...pixels(
        source,
        effect({ ...base.params, emojiColors: 'monochrome', foregroundColor: '#ffeedd' }),
      ).slice(i, i + 4),
    ]).toEqual([255, 238, 221, 255]);
    expect([
      ...pixels(
        source,
        effect({ ...base.params, emojiRed: 25, emojiGreen: -100, emojiBlue: 50 }),
      ).slice(i, i + 4),
    ]).toEqual([255, 0, 151, 255]);
    expect(pixels(source, effect({ ...base.params, emojiColors: 'palette' }))).not.toEqual(
      pixels(source, effect({ ...base.params, emojiColors: 'monochrome' })),
    );
  });
  it('changes seeds only for enabled disorder/random mapping and preserves zero-density behavior', () => {
    const source = image(80, 56, (x, y) => [(x * 7) % 256, (y * 9) % 256, 170, 255]),
      base = effect({ style: 'custom-text', text: 'ABC' });
    expect(pixels(source, base, 1)).toEqual(pixels(source, base, 2));
    for (const params of [
      { rotation: 45 },
      { rotationJitter: 80 },
      { positionJitter: 0.3 },
      { missing: 0.5 },
      { duplicate: 0.8 },
      { glitch: 0.6 },
    ])
      expect(pixels(source, effect({ ...base.params, ...params }))).not.toEqual(
        pixels(source, base),
      );
    const randomized = effect({
      style: 'emoji',
      emojiMapping: 'random',
      rotationJitter: 50,
      positionJitter: 0.2,
      missing: 0.2,
      duplicate: 0.3,
      glitch: 0.4,
    });
    expect(pixels(source, randomized, 1)).toEqual(pixels(source, randomized, 1));
    expect(pixels(source, randomized, 1)).not.toEqual(pixels(source, randomized, 2));
    for (const style of GLYPH_STYLES)
      expect(
        pixels(source, effect({ style, density: 0, glitch: 1, duplicate: 1 }))
          .filter((_, i) => i % 4 !== 3)
          .every((v) => v === 0),
      ).toBe(true);
  });
  it('keeps transparent source bytes for all twelve modes and bounded cooperative cancellation', async () => {
    const source = image(43, 31, (x, y) => [x * 5, y * 7, 130, (x + y) % 3 === 0 ? 0 : 128]),
      input = new Uint8Array(source.pixels);
    for (const style of GLYPH_STYLES) {
      const e = effect({ style, rotation: 15, colorFalloff: 'on', sizeFalloff: 'on' }),
        output = pixels(source, e);
      for (let i = 0; i < output.length; i += 4) {
        expect(output[i + 3]).toBe(input[i + 3]);
        if (input[i + 3] === 0) expect(output.slice(i, i + 4)).toEqual(input.slice(i, i + 4));
      }
      expect(
        new Uint8Array(
          (await renderEffectsAsync(source, [e], { masterSeed: 1, yieldControl: async () => {} }))
            .pixels,
        ),
      ).toEqual(output);
    }
    const abort = new AbortController();
    let yields = 0;
    await expect(
      renderEffectsAsync(image(512, 512), [effect({ style: 'emoji', cellSize: 128 })], {
        isCancelled: () => abort.signal.aborted,
        yieldControl: async () => {
          if (++yields === 2) abort.abort();
        },
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
  it('rejects malformed text, unknown palettes and nonfinite/out-of-range falloffs', () => {
    for (const params of [
      { text: 'x'.repeat(513) },
      { text: '\0' },
      { emojiMapping: 'unknown' },
      { sizeFrom: -1 },
      { colorFalloffEnd: Infinity },
      { glyphSet: 'x'.repeat(129) },
    ])
      expect(() => assertEffect(effect(params as Partial<GlyphEffect['params']>))).toThrow();
    expect(() =>
      assertEffect(
        effect({
          text: 'GLEECH\nHello',
          sizeStart: 0.8,
          sizeEnd: 0.2,
          colorFalloffStart: 0.5,
          colorFalloffEnd: 0.5,
        }),
      ),
    ).not.toThrow();
  });
});
