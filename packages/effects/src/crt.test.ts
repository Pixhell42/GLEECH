import { describe, expect, it } from 'vitest';
import { createEffect, assertEffect, type CrtEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
import { crtBand, crtWarp, crtIsNeutral, phosphorCoverage } from './crt';

const effect = (params: Partial<CrtEffect['params']> = {}): CrtEffect => {
  const e = createEffect('crt', 'crt') as CrtEffect;
  return {
    ...e,
    params: { ...e.params, curvature: 0, phosphor: 'off', fieldBlend: 0, bloom: 0, ...params },
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
const bytes = (
  source: ReturnType<typeof image>,
  e: CrtEffect,
  reference?: { width: number; height: number },
) => new Uint8Array(renderEffects(source, [e], reference ? { reference } : {}).pixels);
const pixel = (data: Uint8Array, x: number, y: number, width: number) => [
  ...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4),
];
describe('CRT finishing', () => {
  it('has an exact neutral bypass and retains active shared finishing', () => {
    const source = image(7, 5, (x, y) => [x * 30, y * 40, 130, (x + y) % 2 ? 128 : 0]);
    for (const e of [
      effect(),
      effect({ phosphor: 'dots', phosphorStrength: 0, phosphorGain: 6 }),
      effect({ fieldBlend: 1, fieldOffsetX: 0, fieldOffsetY: 0 }),
      { ...createEffect('crt', 'disabled'), enabled: false } as CrtEffect,
      effect({ amount: 0, curvature: 0.5 }),
    ])
      expect(bytes(source, e)).toEqual(new Uint8Array(source.pixels));
    expect(crtIsNeutral(effect().params)).toBe(true);
    const opaque = image(3, 2, () => [100, 100, 100, 255]);
    expect(
      pixel(
        bytes(opaque, effect({ tintEnabled: 'on', color: '#ff0000', tintStrength: 1 })),
        0,
        0,
        3,
      ),
    ).toEqual([100, 0, 0, 255]);
  });
  it('integrates rectangular patterns without changing phase at draft resolutions', () => {
    expect(crtBand(0.5, 1, 3, 0, 1)).toBe(1);
    expect(crtBand(1.5, 1, 3, 0, 1)).toBe(0);
    expect(crtBand(-2.5, 1, 3, 0, 1)).toBe(1);
    expect(crtBand(8, 8, 2, 1, 2)).toBe(0.5);
    expect(crtBand(123.5, 30, 3, 0, 1)).toBeCloseTo(1 / 3);
    const source = image(3, 2, () => [120, 90, 60, 128]);
    const e = effect({
      phosphor: 'grille',
      phosphorStrength: 1,
      phosphorPitch: 3,
      phosphorWidth: 1,
      phosphorGain: 1,
    });
    const out = bytes(source, e);
    expect(pixel(out, 0, 0, 3)).toEqual([120, 0, 0, 128]);
    expect(pixel(out, 1, 0, 3)).toEqual([0, 90, 0, 128]);
    expect(pixel(out, 2, 0, 3)).toEqual([0, 0, 60, 128]);
    // Each projected preview pixel covers a complete RGB triplet.
    expect(pixel(bytes(source, e, { width: 9, height: 6 }), 0, 0, 3)).toEqual([40, 30, 20, 128]);
  });
  it('uses rectangular slots and staggered circular dots, with averaged fine masks', () => {
    const slot = effect({
      phosphor: 'slot',
      phosphorPitch: 6,
      phosphorWidth: 0.5,
      phosphorStrength: 1,
      phosphorGain: 1,
    });
    const source = image(6, 6, () => [120, 90, 60, 255]);
    const out = bytes(source, slot);
    expect(pixel(out, 0, 0, 6)).toEqual([0, 0, 0, 255]);
    expect(pixel(out, 0, 2, 6)).toEqual([60, 0, 0, 255]);
    expect(pixel(out, 2, 2, 6)).toEqual([0, 45, 0, 255]);
    expect(pixel(out, 4, 2, 6)).toEqual([0, 0, 30, 255]);
    const p = effect({ phosphor: 'dots', phosphorPitch: 12, phosphorWidth: 1 }).params;
    expect(phosphorCoverage(p, 0, 2, 3, 0.01, 0.01)).toBe(1);
    expect(phosphorCoverage(p, 1, 2, 3, 0.01, 0.01)).toBe(0);
    expect(phosphorCoverage(p, 0, 8, 9, 0.01, 0.01)).toBe(1);
    expect(phosphorCoverage(p, 0, 2, 9, 0.01, 0.01)).toBe(0);
    expect(phosphorCoverage(p, 0, 2, 3, 12, 12)).toBeCloseTo(Math.PI / 18);
    expect(phosphorCoverage(p, 0, 100, 120, 12, 12)).toBeCloseTo(Math.PI / 18);
  });
  it('curves normalized image coordinates and independently clips the screen edge', () => {
    expect(crtWarp(0.5, 0.5, 0.5)).toEqual([0.5, 0.5]);
    expect(crtWarp(0, 0, 0.5)).toEqual([-0.25, -0.25]);
    expect(crtWarp(0.25, 0.75, 0.5)).toEqual([0.21875, 0.78125]);
    const source = image(32, 32, () => [200, 100, 50, 255]);
    const out = bytes(source, effect({ curvature: 0.4 }));
    let partial = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        let coverage = 0;
        for (const dx of [0.25, 0.75])
          for (const dy of [0.25, 0.75]) {
            const u = (2 * (x + dx)) / 32 - 1,
              v = (2 * (y + dy)) / 32 - 1;
            if (Math.abs(u * (1 + 0.4 * v * v)) <= 1 && Math.abs(v * (1 + 0.4 * u * u)) <= 1)
              coverage += 0.25;
          }
        const expected = coverage ? [200, 100, 50, Math.round(255 * coverage)] : [0, 0, 0, 0];
        expect(pixel(out, x, y, 32)).toEqual(expected);
        if (coverage > 0 && coverage < 1) partial++;
      }
    expect(partial).toBeGreaterThan(0);
    expect(pixel(bytes(source, effect({ curvature: 0.4, clipScreen: 'off' })), 0, 0, 32)).toEqual([
      200, 100, 50, 255,
    ]);
  });
  it('moves only the selected field, mixes it in premultiplied color and respects band height', () => {
    const source = image(4, 4, (x, y) => [20 + 40 * x, 40 + 40 * y, 20, 255]);
    const e = effect({ fieldBlend: 0.5, fieldOffsetX: 1, fieldOffsetY: 0 });
    expect(pixel(bytes(source, e), 2, 0, 4)).toEqual([100, 40, 20, 255]);
    expect(pixel(bytes(source, e), 2, 1, 4)).toEqual([80, 80, 20, 255]);
    const vertical = effect({ fieldBlend: 1, fieldOrder: 'even', fieldOffsetY: 1 });
    expect(pixel(bytes(source, vertical), 2, 2, 4)).toEqual([100, 80, 20, 255]);
    expect(pixel(bytes(source, vertical), 2, 1, 4)).toEqual([100, 80, 20, 255]);
    const tall = effect({ fieldBlend: 1, fieldOffsetX: 1, fieldOffsetY: 0, fieldSize: 2 });
    expect(pixel(bytes(source, tall), 2, 1, 4)[0]).toBe(100);
    expect(pixel(bytes(source, tall), 2, 2, 4)[0]).toBe(60);
    const alpha = image(4, 4, (x) => (x === 1 ? [255, 0, 0, 0] : [0, 80, 160, 255]));
    expect(pixel(bytes(alpha, e), 2, 1, 4)).toEqual([0, 80, 160, 128]);
  });
  it('adds image-driven bloom without introducing opacity or hidden-color fringes', () => {
    const source = image(4, 4, () => [100, 100, 100, 128]);
    const e = effect({ bloom: 1, bloomRadius: 0, bloomThreshold: 0 });
    expect(pixel(bytes(source, e), 0, 0, 4)).toEqual([150, 150, 150, 128]);
    expect(
      pixel(
        bytes(source, effect({ ...e.params, bloomColorMix: 1, glowColor: '#ff0000' })),
        0,
        0,
        4,
      ),
    ).toEqual([150, 100, 100, 128]);
    const opaque = image(4, 4, () => [100, 100, 100, 255]);
    const gradient = effect({
      ...e.params,
      bloomColorMix: 1,
      glowColor: '#000000',
      glowColorMode: 'gradient',
      glowColorEnd: '#ffffff',
    });
    expect([0, 1, 2, 3].map((x) => pixel(bytes(opaque, gradient), x, 0, 4)[0])).toEqual([
      113, 138, 163, 188,
    ]);
    const light = image(9, 9, (x, y) =>
      x === 4 && y === 4 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    expect(
      pixel(bytes(light, effect({ bloom: 1, bloomRadius: 20, bloomThreshold: 0.5 })), 3, 4, 9)[0],
    ).toBeGreaterThan(0);
    const hidden = image(9, 9, (x, y) =>
      x < 3 ? [200, 80, 20, 128] : [255, (y * 40) % 256, 0, 0],
    );
    const other = { ...hidden, pixels: hidden.pixels.slice(0) };
    const changed = new Uint8Array(other.pixels);
    for (let i = 0; i < changed.length; i += 4)
      if (changed[i + 3] === 0) changed.set([0, 0, 255], i);
    const active = effect({
      curvature: 0.15,
      phosphor: 'dots',
      fieldBlend: 0.5,
      fieldOffsetX: 1,
      bloom: 1,
      bloomRadius: 5,
    });
    const a = bytes(hidden, active),
      b = bytes(other, active);
    for (let i = 0; i < a.length; i += 4)
      if (a[i + 3]! > 0) expect(a.slice(i, i + 4)).toEqual(b.slice(i, i + 4));
  });
  it('honors edge modes, alpha-aware opacity, blends and application coverage', () => {
    const source = image(12, 12, (x, y) => [20 + x * 15, 20 + y * 15, (x + y) * 10, 255]);
    const e = effect({ curvature: 0.4, clipScreen: 'off' });
    expect(bytes(source, e)).not.toEqual(
      bytes(source, effect({ ...e.params, edgeHandling: 'wrap' })),
    );
    expect(bytes(source, e)).not.toEqual(
      bytes(source, effect({ ...e.params, edgeHandling: 'mirror' })),
    );
    const small = image(6, 4, () => [120, 90, 60, 255]);
    const pattern = effect({
      phosphor: 'grille',
      phosphorStrength: 1,
      phosphorPitch: 3,
      phosphorWidth: 1,
      phosphorGain: 1,
      amount: 0.5,
    });
    expect(pixel(bytes(small, pattern), 0, 0, 6)).toEqual([120, 45, 30, 255]);
    const masked = {
      ...pattern,
      application: { region: 'left' as const, coverage: 0.5, softness: 0 },
    };
    expect(pixel(bytes(small, masked), 4, 0, 6)).toEqual([120, 90, 60, 255]);
    const screen = bytes(
      image(3, 2, () => [100, 100, 100, 255]),
      effect({ ...pattern.params, amount: 1, blendMode: 'screen' }),
    );
    expect(pixel(screen, 0, 0, 3)).toEqual([161, 100, 100, 255]);
  });
  it('handles thin images and validates parameter ranges', () => {
    for (const [width, height] of [
      [1, 1],
      [1, 23],
      [21, 1],
      [7, 9],
    ]) {
      const source = image(width!, height!, () => [200, 150, 80, 128]);
      for (const phosphor of ['grille', 'slot', 'dots'] as const) {
        const out = bytes(
          source,
          effect({ curvature: 0.75, phosphor, fieldBlend: 1, fieldOffsetY: 8, bloom: 1 }),
        );
        expect(out).toHaveLength(width! * height! * 4);
        expect([...out].every(Number.isFinite)).toBe(true);
      }
    }
    expect(() => assertEffect(effect({ phosphorPitch: 2 }))).toThrow();
    expect(() => assertEffect(effect({ curvature: 1 }))).toThrow();
    expect(() => assertEffect(effect({ fieldSize: 0 }))).toThrow();
  });
  it('cooperatively cancels large curvature and phosphor/bloom renders', async () => {
    const source = image(1024, 1024, () => [200, 120, 40, 255]);
    for (const params of [
      { curvature: 0.5 },
      { phosphor: 'dots' as const, bloom: 1, bloomRadius: 8 },
    ]) {
      let cancelled = false;
      await expect(
        renderEffectsAsync(source, [effect(params)], {
          isCancelled: () => cancelled,
          yieldControl: async () => {
            cancelled = true;
          },
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    }
  });
});
