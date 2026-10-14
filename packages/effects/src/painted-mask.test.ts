import { describe, expect, it, vi } from 'vitest';
import {
  createPaintedMask,
  DEFAULT_MASK_BRUSH,
  createEffect,
  EFFECT_DEFINITIONS,
  type PaintedMask,
  type MaskStroke,
  type EffectType,
  type MaskPath,
} from '@gleech/project-model';
import { renderPaintedMask, renderPaintedMaskAsync, brushCoverage } from './painted-mask';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const stroke = (changes: Partial<MaskStroke> = {}): MaskStroke => ({
  ...DEFAULT_MASK_BRUSH,
  size: 40,
  hardness: 1,
  points: [{ x: 0.5, y: 0.5 }],
  ...changes,
});
const mask = (strokes: readonly MaskStroke[], changes: Partial<PaintedMask> = {}): PaintedMask => ({
  ...createPaintedMask(101, 101),
  strokes,
  ...changes,
});
const at = (values: Float32Array, x: number, y: number, width = 101) => values[y * width + x]!;
const rectangle: MaskPath = {
  id: 'rectangle',
  kind: 'polygon',
  mode: 'paint',
  opacity: 1,
  feather: 0,
  nodes: [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.75, y: 0.75 },
    { x: 0.25, y: 0.75 },
  ],
};
describe('editable mask paths and frames', () => {
  it('fills retained polygons, supports holes and combines brush opacity', () => {
    const outer = {
      ...rectangle,
      nodes: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    };
    const hole = { ...rectangle, id: 'hole', mode: 'erase' as const };
    const values = renderPaintedMask(mask([], { paths: [outer, hole] }), 101, 101);
    expect(at(values, 15, 15)).toBe(1);
    expect(at(values, 50, 50)).toBe(0);
    expect(at(values, 0, 0)).toBe(0);
    const brushed = renderPaintedMask(
      mask([stroke({ opacity: 0.5 }), stroke({ opacity: 0.5 })]),
      101,
      101,
    );
    expect(at(brushed, 50, 50)).toBe(0.75);
  });
  it('rasterizes feathered curves at requested resolution and yields during cancellation', async () => {
    const curve = {
      ...rectangle,
      kind: 'curve' as const,
      feather: 5,
      nodes: [
        { x: 0.25, y: 0.25, outgoing: { x: 0.25, y: 0 } },
        { x: 0.75, y: 0.25, incoming: { x: 0.75, y: 0 } },
        { x: 0.75, y: 0.75 },
        { x: 0.25, y: 0.75 },
      ],
    };
    const values = renderPaintedMask(mask([], { paths: [curve] }), 101, 101);
    expect(at(values, 50, 15)).toBeGreaterThan(0);
    expect(at(values, 50, 50)).toBe(1);
    expect(at(values, 25, 50)).toBeGreaterThan(0);
    expect(at(values, 25, 50)).toBeLessThan(1);
    const large = mask([], { paths: [curve] });
    let cancelled = false;
    expect(
      await renderPaintedMaskAsync(large, 2048, 2048, {
        isCancelled: () => cancelled,
        yieldControl: async () => {
          cancelled = true;
        },
      }),
    ).toBeNull();
  });
  it('moves, rotates and scales geometry in canvas pixels, including nonsquare canvases', () => {
    const original = mask([], { width: 202, height: 101, paths: [rectangle] });
    const moved = renderPaintedMask(
      { ...original, frame: { x: 25, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } },
      202,
      101,
    );
    expect(moved[50 * 202 + 151]).toBe(1);
    expect(moved[50 * 202 + 60]).toBe(0);
    const rotated = renderPaintedMask(
      { ...original, frame: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90 } },
      202,
      101,
    );
    expect(rotated[5 * 202 + 100]).toBe(1);
    expect(rotated[50 * 202 + 60]).toBe(0);
    const brush = renderPaintedMask(
      mask([stroke()], { frame: { x: 25, y: 0, scaleX: 0.5, scaleY: 0.5, rotation: 45 } }),
      101,
      101,
    );
    expect(at(brush, 75, 50)).toBe(1);
    expect(at(brush, 50, 50)).toBe(0);
  });
});
describe('painted mask brush field', () => {
  it('starts empty, inverts exactly and ignores seed or input pixels', () => {
    expect(renderPaintedMask(mask([]), 7, 3)).toEqual(new Float32Array(21));
    expect(renderPaintedMask(mask([], { inverted: true }), 7, 3)).toEqual(
      new Float32Array(21).fill(1),
    );
  });
  it.each(['circle', 'square', 'diamond'] as const)(
    '%s has the expected clipped footprint',
    (shape) => {
      const values = renderPaintedMask(mask([stroke({ shape })]), 101, 101);
      expect(at(values, 50, 50)).toBe(1);
      expect(at(values, 70, 50)).toBe(1);
      expect(at(values, 71, 50)).toBe(0);
      expect(at(values, 65, 65)).toBe(shape === 'square' ? 1 : 0);
      expect(at(values, 60, 60)).toBe(1);
    },
  );
  it('fills long diagonal segments continuously and preserves stroke direction', () => {
    for (const shape of ['circle', 'square', 'diamond'] as const) {
      const points = [
        { x: 0.05, y: 0.05 },
        { x: 0.95, y: 0.95 },
      ];
      const values = renderPaintedMask(mask([stroke({ size: 2, shape, points })]), 101, 101);
      for (let i = 10; i < 90; i++) expect(at(values, i, i)).toBe(1);
      expect(
        renderPaintedMask(
          mask([stroke({ size: 2, shape, points: [...points].reverse() })]),
          101,
          101,
        ),
      ).toEqual(values);
    }
  });
  it('unions one stroke rather than repeatedly darkening its soft edges', () => {
    const p = { x: 0.5, y: 0.5 };
    const once = renderPaintedMask(mask([stroke({ hardness: 0.1, points: [p] })]), 101, 101);
    const many = renderPaintedMask(
      mask([stroke({ hardness: 0.1, points: [p, p, p, p] })]),
      101,
      101,
    );
    expect(many).toEqual(once);
    expect(at(once, 60, 50)).toBeGreaterThan(0);
    expect(at(once, 60, 50)).toBeLessThan(1);
  });
  it('paints and erases in order, including soft strokes and inversion', () => {
    const painted = stroke();
    const erased = stroke({ size: 10, mode: 'erase' });
    const result = renderPaintedMask(mask([painted, erased]), 101, 101);
    expect(at(result, 50, 50)).toBe(0);
    expect(at(result, 60, 50)).toBe(1);
    expect(at(result, 0, 0)).toBe(0);
    const inverted = renderPaintedMask(mask([painted, erased], { inverted: true }), 101, 101);
    for (let i = 0; i < result.length; i++) expect(inverted[i]).toBe(1 - result[i]!);
    expect(renderPaintedMask(mask([erased, painted]), 101, 101)).not.toEqual(result);
  });
  it('provides three falloff curves with a hard center and bounded outside', () => {
    const values = ['linear', 'smooth', 'gaussian'].map((falloff) =>
      brushCoverage(0.8, stroke({ hardness: 0.2, falloff: falloff as MaskStroke['falloff'] })),
    );
    expect(new Set(values).size).toBe(3);
    for (const falloff of ['linear', 'smooth', 'gaussian'] as const) {
      const s = stroke({ hardness: 0.2, falloff });
      expect(brushCoverage(0.1, s)).toBe(1);
      expect(brushCoverage(1, s)).toBeCloseTo(0);
      expect(brushCoverage(1.1, s)).toBe(0);
    }
  });
  it('anchors to the saved canvas and scales across preview and target aspect ratios', () => {
    const m = mask([stroke()], { width: 202, height: 101 });
    const full = renderPaintedMask(m, 101, 101),
      small = renderPaintedMask(m, 51, 51);
    expect(at(full, 50, 50)).toBe(at(small, 25, 25, 51));
    expect(at(full, 65, 50)).toBe(0);
    expect(at(full, 50, 65)).toBe(1);
    const original = renderPaintedMask(m, 202, 101);
    expect(at(original, 115, 50, 202)).toBe(1);
  });
  it('clips outside paths safely and leaves no coverage from previous strokes', () => {
    const outside = stroke({
      points: [
        { x: 2, y: 2 },
        { x: 1.5, y: 1.5 },
      ],
    });
    const result = renderPaintedMask(mask([stroke(), outside]), 101, 101);
    expect(result).toEqual(renderPaintedMask(mask([stroke()]), 101, 101));
    expect(renderPaintedMask(mask([outside]), 101, 101)).toEqual(new Float32Array(101 * 101));
  });
});
describe('painted mask effect composition', () => {
  const image = {
    width: 101,
    height: 101,
    pixels: Uint8Array.from({ length: 101 * 101 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 32)).buffer,
  };
  it('reveals a filter only inside the painted region and bypasses a disabled mask', () => {
    const effect = createEffect('hue-saturation', 'test');
    Object.assign(effect.params, { lightness: 1 });
    const m = mask([stroke()]);
    const result = new Uint8Array(renderEffects(image, [{ ...effect, paintedMask: m }]).pixels);
    expect(result[0]).toBe(32);
    expect(result[(50 * 101 + 50) * 4]).toBe(255);
    expect(
      new Uint8Array(renderEffects(image, [{ ...effect, paintedMask: mask([]) }]).pixels),
    ).toEqual(new Uint8Array(image.pixels));
    expect(
      renderEffects(image, [{ ...effect, paintedMask: { ...m, enabled: false } }]).pixels,
    ).toEqual(renderEffects(image, [effect]).pixels);
  });
  it('combines procedural and painted coverage in one composite', () => {
    const effect = createEffect('hue-saturation', 'test');
    Object.assign(effect.params, { lightness: 1 });
    const m = mask([stroke({ hardness: 0, size: 100, falloff: 'linear' })]);
    const result = new Uint8Array(
      renderEffects(image, [
        { ...effect, application: { region: 'top', coverage: 0.5, softness: 0 }, paintedMask: m },
      ]).pixels,
    );
    expect(result[(70 * 101 + 50) * 4]).toBe(32);
    const weights = renderPaintedMask(m, 101, 101);
    expect(result[(30 * 101 + 50) * 4]).toBe(
      Math.round(32 * (1 - weights[30 * 101 + 50]!) + 255 * weights[30 * 101 + 50]!),
    );
  });
  it('keeps masks fixed while upstream wave coordinates change', () => {
    const wave = createEffect('wave-distortion', 'wave');
    const tone = createEffect('hue-saturation', 'tone');
    Object.assign(tone.params, { lightness: 1 });
    const withMask = { ...tone, paintedMask: mask([stroke({ hardness: 0.1 })]) };
    const field = renderPaintedMask(withMask.paintedMask, 101, 101);
    const expected = new Uint8Array(renderEffects(image, [withMask]).pixels);
    for (const strength of [0, 4, 12]) {
      Object.assign(wave.params, { strength });
      expect(new Uint8Array(renderEffects(image, [wave, withMask]).pixels)).toEqual(expected);
      expect(renderPaintedMask(withMask.paintedMask, 101, 101)).toEqual(field);
    }
  });
  it.each(Object.keys(EFFECT_DEFINITIONS) as EffectType[])(
    '%s supports an empty mask without changing the source',
    async (type) => {
      const effect = createEffect(type, type);
      const stack = [{ ...effect, paintedMask: mask([]) }];
      const result =
        type === 'jpeg-recompression'
          ? await renderEffectsAsync(image, stack, {
              yieldControl: async () => {},
              recompressJpeg: async (input) => {
                const pixels = new Uint8Array(input.pixels.slice(0));
                for (let i = 0; i < pixels.length; i++)
                  if (i % 4 !== 3) pixels[i] = 255 - pixels[i]!;
                return pixels.buffer;
              },
            })
          : renderEffects(image, stack);
      expect(new Uint8Array(result.pixels)).toEqual(new Uint8Array(image.pixels));
    },
  );
  it('cancels painting and effect work cooperatively', async () => {
    const clock = vi.spyOn(Date, 'now');
    let time = 0;
    clock.mockImplementation(() => (time += 9));
    try {
      let cancelled = false;
      const m = mask([
        stroke({
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        }),
      ]);
      expect(
        await renderPaintedMaskAsync(m, 101, 101, {
          isCancelled: () => cancelled,
          yieldControl: async () => {
            cancelled = true;
          },
        }),
      ).toBeNull();
      cancelled = false;
      await expect(
        renderEffectsAsync(
          image,
          [
            {
              ...createEffect('hue-saturation', 'test'),
              paintedMask: m,
              params: { ...createEffect('hue-saturation', 'test').params, lightness: 1 },
            } as ReturnType<typeof createEffect>,
          ],
          {
            isCancelled: () => cancelled,
            yieldControl: async () => {
              cancelled = true;
            },
          },
        ),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    } finally {
      clock.mockRestore();
    }
  });
});
