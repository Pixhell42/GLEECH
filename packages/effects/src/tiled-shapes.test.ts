import { describe, expect, it, vi } from 'vitest';
import {
  createEffect,
  SHAPE_TILE_DEFAULTS,
  assertEffect,
  type ShapesEffect,
} from '@gleech/project-model';
import { polygonDistance, shapeProgression } from './shape-tiles';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

function fixture(width = 100, height = 100, partial = false) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set(
        [(x * 2) % 256, (y * 2) % 256, 60, partial ? [0, 64, 128, 255][x % 4]! : 255],
        (y * width + x) * 4,
      );
  return { width, height, pixels: pixels.buffer };
}
function shape(params: Partial<ShapesEffect['params']> = {}): ShapesEffect {
  const effect = createEffect('shapes', 'tiles') as ShapesEffect;
  return { ...effect, params: { ...effect.params, layout: 'tiled', size: 50, ...params } };
}
const render = (image: ReturnType<typeof fixture>, effect: ShapesEffect, seed = 8172) =>
  new Uint8Array(renderEffects(image, [effect], { masterSeed: seed }).pixels);
const pixel = (out: Uint8Array, width: number, x: number, y: number) => [
  ...out.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];

describe('tiled Shapes', () => {
  it('keeps legacy single-shape recipes exact without filling missing fields', () => {
    const image = fixture(41, 31, true);
    const effect = shape({ layout: 'single', shape: 'triangle' });
    const params = { ...effect.params };
    for (const key of Object.keys(SHAPE_TILE_DEFAULTS) as (keyof typeof SHAPE_TILE_DEFAULTS)[])
      delete params[key];
    const legacy = { ...effect, params };
    assertEffect(legacy);
    expect(render(image, legacy)).toEqual(render(image, effect));
    expect(Object.hasOwn(legacy.params, 'layout')).toBe(false);
    expect(() => assertEffect(shape({ startSides: 3.5 }))).toThrow();
    expect(() => assertEffect(shape({ spacing: 0 }))).toThrow();
  });
  it('places grid, staggered and radial centers at independently known coordinates', () => {
    const image = fixture();
    const grid = render(image, shape());
    const staggered = render(image, shape({ tilePattern: 'staggered' }));
    const radial = render(image, shape({ tilePattern: 'radial' }));
    const alpha = (out: Uint8Array, x: number, y: number) => pixel(out, 100, x, y)[3];
    expect(alpha(grid, 50, 30)).toBe(255);
    expect(alpha(grid, 40, 30)).toBe(0);
    expect(alpha(staggered, 50, 30)).toBe(0);
    expect(alpha(staggered, 40, 30)).toBe(255);
    expect(alpha(radial, 70, 50)).toBe(255);
    expect(alpha(radial, 64, 64)).toBe(255);
    expect(alpha(radial, 70, 70)).toBe(0);
    expect(alpha(grid, 70, 70)).toBe(255);
    const filled = render(image, shape({ shape: 'square', size: 160, rotation: 45 }));
    expect([...filled].filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true);
  });
  it('separates spacing, size, layout position and shape rotation, with field-driven discrete polygons', () => {
    const image = fixture();
    const base = shape({ shape: 'triangle' });
    const original = render(image, base);
    for (const params of [
      { spacing: 30 },
      { size: 80 },
      { scale: 1.5 },
      { rotation: 35 },
      { layoutRotation: 35 },
      { positionX: 40 },
      { positionY: 40 },
    ])
      expect(render(image, shape({ ...base.params, ...params }))).not.toEqual(original);
    expect(render(image, shape({ size: 40, scale: 2 }))).toEqual(
      render(image, shape({ size: 80 })),
    );
    const polygons = shape({
      shape: 'polygon',
      positionX: 0,
      size: 100,
      startSides: 10,
      endSides: 3,
      polygonStyle: 'linear',
    });
    const progressing = render(image, polygons);
    expect(pixel(progressing, 100, 7, 50)[3]).toBe(255); // Inside the decagon at x=0.
    expect(pixel(progressing, 100, 92, 50)[3]).toBe(0); // Outside the triangle at x=100.
    expect(
      pixel(render(image, shape({ ...polygons.params, polygonStyle: 'uniform' })), 100, 92, 50)[3],
    ).toBe(255);
    expect(polygonDistance(8, 0, 10, 3)).toBeGreaterThan(0);
    expect(polygonDistance(8, 0, 10, 10)).toBeLessThan(0);
  });
  it('has independent directional, radial and square fields with editable center and range', () => {
    const reference = { width: 100, height: 100 };
    const field = (x: number, y: number, params: Partial<typeof SHAPE_TILE_DEFAULTS> = {}) =>
      shapeProgression(x, y, reference, { ...SHAPE_TILE_DEFAULTS, ...params });
    expect(field(25, 80)).toBe(0.25);
    expect(field(25, 80, { progressionField: 'right-left' })).toBe(0.75);
    expect(field(25, 80, { progressionField: 'top-bottom' })).toBe(0.8);
    expect(field(25, 80, { progressionField: 'bottom-top' })).toBeCloseTo(0.2);
    expect(field(80, 90, { progressionField: 'radial' })).toBe(1);
    expect(field(80, 90, { progressionField: 'square' })).toBe(0.8);
    expect(field(25, 80, { progressionRange: 50 })).toBe(0);
    expect(field(25, 80, { progressionX: 25 })).toBe(0.5);
    const image = fixture();
    const original = render(
      image,
      shape({ shape: 'polygon', rotationStyle: 'linear', startSides: 10, polygonStyle: 'linear' }),
    );
    for (const params of [
      { rotationStyle: 'graduated' as const },
      { polygonStyle: 'graduated' as const },
      { progressionX: 30 },
      { progressionRange: 60 },
      { progressionField: 'radial' as const },
    ])
      expect(
        render(
          image,
          shape({
            shape: 'polygon',
            rotationStyle: 'linear',
            startSides: 10,
            polygonStyle: 'linear',
            ...params,
          }),
        ),
      ).not.toEqual(original);
  });
  it('warps around each tile center, preserves overlay alpha and hidden RGB, and obeys masks/no-ops', () => {
    const image = fixture();
    const distorted = shape({ size: 100, operation: 'distort', distortionScale: 2, twist: 0 });
    expect(pixel(render(image, distorted), 100, 54, 50)).toEqual([104, 100, 60, 255]);
    // Equally interior overlapping squares choose the first grid tile consistently.
    // Centers 50.5 and 70.5 tie at pixel-center 60.5; the first samples source x=55.
    expect(
      pixel(
        render(
          image,
          shape({
            shape: 'square',
            size: 120,
            positionX: 50.5,
            operation: 'distort',
            distortionScale: 2,
            twist: 0,
          }),
        ),
        100,
        60,
        50,
      ),
    ).toEqual([110, 100, 60, 255]);
    expect(
      renderEffects(image, [shape({ operation: 'distort', distortionScale: 1, twist: 0 })]).pixels,
    ).toBe(image.pixels);
    expect(renderEffects(image, [shape({ amount: 0 })]).pixels).toBe(image.pixels);
    const partial = fixture(100, 100, true);
    const overlay = render(partial, shape({ operation: 'overlay', shapeColor: '#4080e0' }));
    const keep = render(partial, shape());
    const cut = render(partial, shape({ operation: 'cut-out' }));
    const source = new Uint8Array(partial.pixels);
    for (let i = 0; i < source.length; i += 4) {
      expect(overlay[i + 3]).toBe(source[i + 3]);
      expect(keep.subarray(i, i + 3)).toEqual(source.subarray(i, i + 3));
      expect(Math.abs(keep[i + 3]! + cut[i + 3]! - source[i + 3]!)).toBeLessThanOrEqual(1);
    }
    const masked = render(image, {
      ...distorted,
      application: { region: 'top', coverage: 0.4, softness: 0 },
    });
    expect(pixel(masked, 100, 54, 70)).toEqual(pixel(new Uint8Array(image.pixels), 100, 54, 70));
  });
  it('replays seeded tiles, stays stable at original reference scale, and cooperatively cancels', async () => {
    const image = fixture();
    const effect = shape({
      shape: 'polygon',
      rotationStyle: 'random',
      polygonStyle: 'random',
      startSides: 10,
    });
    const out = render(image, effect);
    expect(out).toEqual(render(image, effect));
    expect(out).not.toEqual(render(image, { ...effect, seedOffset: 1 }));
    expect(out).not.toEqual(render(image, effect, 23));
    expect(
      new Uint8Array(
        renderEffects(image, [effect], {
          masterSeed: 8172,
          reference: { width: 1000, height: 1000 },
        }).pixels,
      ),
    ).toEqual(out);
    for (const tilePattern of ['grid', 'staggered', 'radial'] as const) {
      const tiled = shape({ ...effect.params, tilePattern });
      expect(
        new Uint8Array(
          (
            await renderEffectsAsync(image, [tiled], {
              masterSeed: 8172,
              yieldControl: async () => {},
            })
          ).pixels,
        ),
      ).toEqual(render(image, tiled));
    }
    let time = 0,
      cancelled = false;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (time += 9));
    try {
      await expect(
        renderEffectsAsync(
          image,
          [shape({ tilePattern: 'radial', spacing: 2, size: 200, scale: 4 })],
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
