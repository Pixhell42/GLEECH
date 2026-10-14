import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  FRACTAL_DEFAULTS,
  type MandelbrotEffect,
} from '@gleech/project-model';
import {
  fractalPoint,
  fractalOrbit,
  zoomFractalAt,
  renderEffects,
  renderEffectsAsync,
  RenderCancelledError,
} from './index';

const effect = (params: Partial<MandelbrotEffect['params']> = {}) =>
  ({
    ...createEffect('mandelbrot', 'fractal'),
    params: { ...createEffect('mandelbrot', 'fractal').params, ...params },
  }) as MandelbrotEffect;
const image = {
  width: 9,
  height: 9,
  pixels: Uint8Array.from({ length: 324 }, (_, i) => (i % 4 === 3 ? 255 : (i * 17) % 256)).buffer,
};

describe('fractal exploration and image mapping', () => {
  it('keeps the pointer coordinate fixed while zooming rotated non-square views', () => {
    const view = { centerReal: -0.77, centerImaginary: -0.13, zoom: 34, rotation: 37 };
    for (const [width, height] of [
      [600, 200],
      [200, 600],
    ] as const) {
      const before = fractalPoint(view, 71, 93, width, height);
      const next = zoomFractalAt(view, 71, 93, width, height, 2);
      expect(next.zoom).toBe(68);
      const after = fractalPoint({ ...view, ...next }, 71, 93, width, height);
      expect(after.real).toBeCloseTo(before.real, 12);
      expect(after.imaginary).toBeCloseTo(before.imaginary, 12);
    }
    expect(zoomFractalAt(view, 300, 100, 600, 200, 1e10).zoom).toBe(100000);
    expect(zoomFractalAt(view, 300, 100, 600, 200, 1e-10).zoom).toBe(0.25);
    expect(fractalPoint(view, 300, 100, 600, 200)).toEqual({ real: -0.77, imaginary: -0.13 });
  });
  it('distinguishes Julia starting points and parameters using known orbits', () => {
    const p = { iterations: 16, formula: 'julia' as const, juliaReal: 0, juliaImaginary: 0 };
    expect(fractalOrbit(0.5, 0, p).inside).toBe(true);
    expect(fractalOrbit(1, 0, p).inside).toBe(true);
    const escaped = fractalOrbit(1.5, 0, p);
    expect(escaped.count).toBe(1);
    expect(escaped.x).toBe(2.25);
    expect(escaped.inside).toBe(false);
    expect(fractalOrbit(0, 0, { ...p, juliaReal: 1 }).count).toBe(3);
    expect(fractalOrbit(1, 0, { iterations: 16 }).count).toBe(3);
    // z=1.95+.5i is a fixed point for c=z-z²=-1.6025-1.45i, despite |z|>2.
    expect(
      fractalOrbit(1.95, 0.5, { ...p, juliaReal: -1.6025, juliaImaginary: -1.45 }).inside,
    ).toBe(true);
  });
  it('samples computed orbit coordinates rather than painting or clipping the image', () => {
    // Center c=1 hits the unit circle at step one; scale=1 maps to UV=(1,.5).
    const e = effect({
      centerReal: 1,
      centerImaginary: 0,
      weaveScale: 1,
      abstraction: 1,
      weaveMirror: 'off',
    });
    const output = new Uint8Array(renderEffects(image, [e]).pixels);
    expect([...output.subarray(160, 164)]).toEqual([
      ...new Uint8Array(image.pixels).subarray(176, 180),
    ]);
    expect(output.filter((_, i) => i % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    expect(renderEffects(image, [effect({ abstraction: 0 })]).pixels).toBe(image.pixels);
  });
  it('preserves legacy textures, distortion and cutouts without optional fields', () => {
    for (const operation of ['texture', 'distort', 'keep-set', 'cut-out'] as const) {
      const current = effect({ operation });
      const params = { ...current.params };
      for (const key of Object.keys(FRACTAL_DEFAULTS))
        delete (params as Record<string, unknown>)[key];
      const legacy = { ...current, params };
      expect(() => assertEffect(legacy)).not.toThrow();
      expect(new Uint8Array(renderEffects(image, [legacy]).pixels)).toEqual(
        new Uint8Array(renderEffects(image, [current]).pixels),
      );
    }
    expect(effect().params.operation).toBe('weave');
    for (const key of Object.keys(FRACTAL_DEFAULTS))
      expect(() =>
        assertEffect({
          ...effect(),
          params: { ...effect().params, [key]: undefined },
        } as unknown as MandelbrotEffect),
      ).toThrow();
  });
  it('varies image scale, rotation, mirrors, abstraction, Julia and edges reproducibly', () => {
    const base = effect({ centerReal: -0.77, centerImaginary: -0.13, zoom: 34 });
    const output = renderEffects(image, [base]);
    for (const params of [
      { weaveScale: 0.25 },
      { weaveRotation: 45 },
      { weaveMirror: 'off' as const },
      { abstraction: 0.4 },
      { formula: 'julia' as const },
      { edgeHandling: 'wrap' as const, weaveScale: 0.25 },
    ])
      expect(
        new Uint8Array(
          renderEffects(image, [{ ...base, params: { ...base.params, ...params } }]).pixels,
        ),
        JSON.stringify(params),
      ).not.toEqual(new Uint8Array(output.pixels));
    expect(renderEffects(image, [base])).toEqual(output);
  });
  it('preserves transparent sampling, masks, preview coordinates and cancellation', async () => {
    const transparent = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([255, 0, 0, 0, 0, 0, 255, 255]).buffer,
    };
    const e = effect({
      centerReal: 3.4 / 200000,
      centerImaginary: 0,
      zoom: 100000,
      abstraction: 1,
    });
    const out = new Uint8Array(renderEffects(transparent, [e]).pixels);
    expect([...out.subarray(0, 4)]).toEqual([0, 0, 255, 128]);
    const masked = { ...e, application: { region: 'left' as const, coverage: 0.5, softness: 0 } };
    expect([...new Uint8Array(renderEffects(transparent, [masked]).pixels).subarray(4)]).toEqual([
      0, 0, 255, 255,
    ]);
    expect(await renderEffectsAsync(image, [e], { yieldControl: async () => {} })).toEqual(
      renderEffects(image, [e]),
    );
    let count = 0;
    await expect(
      renderEffectsAsync(
        { width: 2048, height: 1, pixels: new Uint8Array(8192).buffer },
        [effect({ formula: 'julia', iterations: 512 })],
        { isCancelled: () => ++count > 3, yieldControl: async () => {} },
      ),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(renderEffects(image, [e], { reference: { width: 90, height: 90 } })).toEqual(
      renderEffects(image, [e]),
    );
  });
});
