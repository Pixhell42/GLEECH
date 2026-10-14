import { describe, expect, it } from 'vitest';
import { createEffect, assertEffect, type GlyphEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
import { ASCII_GLYPHS, BRAILLE_BITS, glyphPattern, glyphMark, glyphTone } from './glyph';

const effect = (params: Partial<GlyphEffect['params']> = {}): GlyphEffect => {
  const e = createEffect('glyph', 'glyph') as GlyphEffect;
  return {
    ...e,
    params: {
      ...e.params,
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
  value: (x: number, y: number) => readonly number[],
) => ({
  width,
  height,
  pixels: Uint8Array.from(
    Array.from({ length: width * height }, (_, i) =>
      value(i % width, Math.floor(i / width)),
    ).flat(),
  ).buffer,
});
const bytes = (source: ReturnType<typeof image>, e: GlyphEffect) =>
  new Uint8Array(renderEffects(source, [e]).pixels);

describe('Glyph Renderer', () => {
  it('uses an original monotone-density ASCII alphabet with stable shape selection', () => {
    const painted = ASCII_GLYPHS.map((g) =>
      g.rows.reduce<number>((sum, row) => sum + row.toString(2).replaceAll('0', '').length, 0),
    );
    expect([...painted].sort((a, b) => a - b)).toEqual(painted);
    expect(ASCII_GLYPHS.map((g) => g.character).join('')).toBe(' .:-=+*%#@');
    expect(glyphPattern([0], [1], effect().params)).toBe(0);
    expect(glyphPattern([1], [1], effect().params)).toBe(9);
    expect(glyphPattern([1], [0], effect().params)).toBe(0);
    expect(glyphMark('ascii', 1, 0.5, 5.5 / 7, 1, 1)).toBe(true);
    expect(glyphMark('ascii', 1, 0.1, 5.5 / 7, 1, 1)).toBe(false);
    expect(glyphMark('ascii', 9, -0.1, 0.5, 1, 1)).toBe(false);
  });
  it('maps each row-major Braille dot to the standard Unicode bit ordering', () => {
    expect(BRAILLE_BITS.map((n) => 1 << n)).toEqual([1, 8, 2, 16, 4, 32, 64, 128]);
    const p = effect({ style: 'braille' }).params;
    for (let i = 0; i < 8; i++) {
      const tones = Array.from({ length: 8 }, (_, n) => (n === i ? 1 : 0));
      expect(glyphPattern(tones, Array(8).fill(1), p)).toBe([1, 8, 2, 16, 4, 32, 64, 128][i]);
      expect(
        glyphMark(
          'braille',
          1 << BRAILLE_BITS[i]!,
          ((i % 2) + 0.5) / 2,
          (Math.floor(i / 2) + 0.5) / 4,
          1,
          2,
        ),
      ).toBe(true);
    }
    expect(glyphPattern(Array(8).fill(1), Array(8).fill(1), p)).toBe(255);
    expect(
      glyphPattern(Array(8).fill(1), Array(8).fill(0), { ...p, invert: 'on', threshold: 0 }),
    ).toBe(0);
  });
  it('renders independent four-quadrant block fixtures without font rasterization', () => {
    const source = image(4, 4, (x, y) => (x < 2 && y < 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const output = bytes(
      source,
      effect({ style: 'blocks', cellSize: 4, aspect: 1, glyphScale: 1 }),
    );
    expect(output).toEqual(new Uint8Array(source.pixels));
    const inverse = bytes(
      source,
      effect({ style: 'blocks', cellSize: 4, aspect: 1, glyphScale: 1, invert: 'on' }),
    );
    for (let i = 0; i < output.length; i += 4) expect(inverse[i]).toBe(255 - output[i]!);
  });
  it('renders circular eight-dot marks with deterministic four-sample antialiasing', () => {
    const source = image(8, 16, (x, y) => [
      x >= 4 && y >= 12 ? 255 : 0,
      x >= 4 && y >= 12 ? 255 : 0,
      x >= 4 && y >= 12 ? 255 : 0,
      255,
    ]);
    const output = bytes(
      source,
      effect({ style: 'braille', cellSize: 8, aspect: 2, glyphScale: 1 }),
    );
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 8; x++) {
        let coverage = 0;
        for (const dx of [0.25, 0.75])
          for (const dy of [0.25, 0.75])
            if ((x + dx - 6) ** 2 + (y + dy - 14) ** 2 <= 1.44 ** 2) coverage += 0.25;
        expect([...output.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)]).toEqual([
          Math.round(255 * coverage),
          Math.round(255 * coverage),
          Math.round(255 * coverage),
          255,
        ]);
      }
  });
  it('keeps original alpha and hidden bytes while excluding invisible source colors', () => {
    const source = image(8, 8, (x, y) =>
      x < 4 ? [220, 40, 80, [1, 128, 255][y % 3]!] : [0, 255, 0, 0],
    );
    const other = { ...source, pixels: source.pixels.slice(0) };
    const changed = new Uint8Array(other.pixels);
    for (let i = 0; i < changed.length; i += 4)
      if (changed[i + 3] === 0) changed.set([255, 0, 255], i);
    for (const style of ['ascii', 'braille', 'blocks'] as const) {
      const e = effect({ style, cellSize: 8, aspect: 1, coloring: 'source' });
      const output = bytes(source, e),
        alternate = bytes(other, e),
        input = new Uint8Array(source.pixels);
      for (let i = 0; i < output.length; i += 4) {
        expect(output[i + 3]).toBe(input[i + 3]);
        if (input[i + 3] === 0) expect(output.slice(i, i + 4)).toEqual(input.slice(i, i + 4));
        else expect(output.slice(i, i + 4)).toEqual(alternate.slice(i, i + 4));
      }
    }
  });
  it('samples source RGB with alpha weighting and uses gradients at canvas coordinates', () => {
    const source = image(4, 4, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 1]));
    const p = effect({
      style: 'blocks',
      cellSize: 4,
      aspect: 1,
      glyphScale: 1,
      density: 2,
      threshold: 0,
      coloring: 'source',
    });
    const output = bytes(source, p);
    expect([...output.slice(0, 3)]).toEqual([252, 0, 3]);
    const gradient = effect({
      style: 'blocks',
      cellSize: 4,
      aspect: 1,
      glyphScale: 1,
      density: 0,
      backgroundColor: '#000000',
      backgroundColorMode: 'gradient',
      backgroundColorEnd: '#ffffff',
      backgroundColorAngle: 0,
    });
    const white = image(4, 4, () => [255, 255, 255, 255]);
    expect([0, 1, 2, 3].map((x) => bytes(white, gradient)[x * 4])).toEqual([32, 96, 159, 223]);
  });
  it('applies density, inversion and contrast without creating marks at zero density', () => {
    expect(glyphTone(0.75, effect({ contrast: 2 }).params)).toBe(1);
    expect(glyphTone(0.75, effect({ invert: 'on', density: 2 }).params)).toBe(0.5);
    for (const style of ['ascii', 'braille', 'blocks'] as const)
      expect(
        glyphPattern(
          Array(8).fill(1),
          Array(8).fill(1),
          effect({ style, density: 0, threshold: 0 }).params,
        ),
      ).toBe(0);
  });
  it('changes cell/aspect/scale controls, handles clipped edge cells and odd/thin dimensions', () => {
    const source = image(39, 27, (x, y) => [
      (x * 19 + y * 13) % 256,
      (x * 7) % 256,
      (y * 23) % 256,
      255,
    ]);
    const baseline = bytes(source, effect());
    for (const params of [
      { cellSize: 8 },
      { aspect: 0.75 },
      { glyphScale: 0.4 },
      { density: 1.5 },
      { contrast: 3 },
    ])
      expect(bytes(source, effect(params))).not.toEqual(baseline);
    for (const [w, h] of [
      [1, 17],
      [19, 1],
      [1, 1],
      [7, 11],
    ])
      for (const style of ['ascii', 'braille', 'blocks'] as const) {
        const tiny = image(w!, h!, () => [255, 255, 255, 255]);
        const output = bytes(tiny, effect({ style, cellSize: 4, aspect: 0.51 }));
        expect(output).toHaveLength(w! * h! * 4);
        expect([...output].every(Number.isFinite)).toBe(true);
        for (let i = 3; i < output.length; i += 4) expect(output[i]).toBe(255);
      }
  });
  it('uses preceding stack output and shared opacity, finishing and application masks', () => {
    const source = image(8, 8, () => [128, 128, 128, 255]);
    const e = effect({ style: 'blocks', cellSize: 4, aspect: 1, glyphScale: 1 });
    const solid = createEffect('solid', 'solid');
    Object.assign(solid.params, { fillColor: '#000000' });
    const chain = new Uint8Array(renderEffects(source, [solid, e]).pixels);
    expect(chain).not.toEqual(bytes(source, e));
    const masked = {
      ...e,
      application: { ...e.application, region: 'left' as const, coverage: 0.5, softness: 0 },
    };
    const output = bytes(source, masked);
    expect(output.slice(4 * 4, 8 * 4)).toEqual(new Uint8Array(source.pixels).slice(4 * 4, 8 * 4));
    const opacity = bytes(source, effect({ ...e.params, amount: 0.5 }));
    expect(opacity[0]).toBe(192);
    expect(
      bytes(
        source,
        effect({ ...e.params, tintEnabled: 'on', color: '#ff0000', tintStrength: 1 }),
      )[1],
    ).toBe(0);
  });
  it('preserves inactive identity, validates recipes and cooperatively cancels large renders', async () => {
    const source = image(64, 32, () => [80, 120, 160, 128]);
    for (const e of [effect({ amount: 0 }), { ...effect(), enabled: false }])
      expect(bytes(source, e)).toEqual(new Uint8Array(source.pixels));
    expect(() => assertEffect(effect({ cellSize: 3 }))).toThrow();
    expect(() => assertEffect(effect({ aspect: 0 }))).toThrow();
    const large = image(1024, 1024, () => [240, 220, 200, 255]);
    let cancelled = false;
    await expect(
      renderEffectsAsync(large, [effect()], {
        isCancelled: () => cancelled,
        yieldControl: async () => {
          cancelled = true;
        },
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
