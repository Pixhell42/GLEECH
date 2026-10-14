import { describe, expect, it, vi } from 'vitest';
import { assertEffect, createEffect, type SpatialCrushEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const base = createEffect('spatial-crush', 'spatial') as SpatialCrushEffect;
const effect = (params: Partial<SpatialCrushEffect['params']>): SpatialCrushEffect => ({
  ...base,
  params: { ...base.params, ...params },
});
function fixture(width = 65, height = 49) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set(
        [(x * 3) % 256, (y * 5) % 256, (x * 7 + y * 11) % 256, (x * 13 + y * 17) % 256],
        (y * width + x) * 4,
      );
  return { width, height, pixels: pixels.buffer };
}
function ramp(width = 8, height = 8) {
  const image = fixture(width, height),
    pixels = new Uint8Array(image.pixels);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixels.set([x * 30, x * 30, x * 30, 255], (y * width + x) * 4);
  return image;
}
const bytes = (image: ReturnType<typeof fixture>, fx: SpatialCrushEffect, seed = 8172) => {
  assertEffect(fx);
  return new Uint8Array(renderEffects(image, [fx], { masterSeed: seed }).pixels);
};
const modes = ['nearest', 'linear', 'average', 'dirty-nearest', 'random', 'corrupted'] as const;

describe('spatial crush sampling', () => {
  it('smooths coarse center samples rather than blurring or averaging each block', () => {
    const image = ramp();
    const row = (sampling: SpatialCrushEffect['params']['sampling']) =>
      [...bytes(image, effect({ sampling, blockSize: 25 })).slice(0, 32)].filter(
        (_, i) => i % 4 === 0,
      );
    expect(row('nearest')).toEqual([30, 30, 90, 90, 150, 150, 210, 210]);
    expect(row('average')).toEqual([15, 15, 75, 75, 135, 135, 195, 195]);
    expect(row('linear')).toEqual([30, 45, 75, 105, 135, 165, 195, 210]);
  });
  it('uses the true center of shorter edge cells and handles one-pixel-high images', () => {
    const image = ramp(7, 7);
    const output = bytes(image, effect({ sampling: 'linear', blockSize: 25 }));
    expect([...output.slice(0, 28)].filter((_, i) => i % 4 === 0)).toEqual([
      30, 45, 75, 105, 135, 160, 180,
    ]);
    const strip = ramp(7, 1);
    expect(bytes(strip, effect({ sampling: 'linear', blockSize: 25 }))).toEqual(
      new Uint8Array(strip.pixels),
    );
  });
  it('interpolates transparency without bleeding hidden RGB into visible edges', () => {
    const image = ramp(),
      input = new Uint8Array(image.pixels);
    for (let y = 0; y < image.height; y++) {
      input.set([255, 0, 0, 255], (y * image.width + 1) * 4);
      input.set([0, 0, 255, 0], (y * image.width + 3) * 4);
    }
    const fx = effect({ sampling: 'linear', blockSize: 25 });
    expect([...bytes(image, fx).slice(4, 8)]).toEqual([255, 0, 0, 191]);
    for (let i = 3; i < input.length; i += 4) input[i] = 0;
    expect([...bytes(image, fx).slice(4, 8)]).toEqual([191, 0, 64, 0]);
  });
  it.each(['dirty-nearest', 'corrupted'] as const)(
    '%s at zero strength exactly restores Nearest',
    (sampling) => {
      const image = fixture();
      expect(bytes(image, effect({ sampling, blockSize: 15, jitter: 0, corruption: 0 }))).toEqual(
        bytes(image, effect({ sampling: 'nearest', blockSize: 15 })),
      );
    },
  );
  it.each(['dirty-nearest', 'random', 'corrupted'] as const)(
    '%s is deterministic, seeded and samples intact RGBA pixels',
    (sampling) => {
      const image = fixture(),
        fx = effect({ sampling, blockSize: 15, jitter: 1, corruption: 1 });
      const original = image.pixels.slice(0),
        result = bytes(image, fx);
      expect(bytes(image, fx)).toEqual(result);
      expect(bytes(image, fx, 8173)).not.toEqual(result);
      expect(bytes(image, { ...fx, seedOffset: 1 })).not.toEqual(result);
      expect(bytes(image, { ...fx, instanceId: 'other' })).not.toEqual(result);
      const input = new Uint8Array(image.pixels);
      const palette = new Set(
        Array.from({ length: input.length / 4 }, (_, i) => input.slice(i * 4, i * 4 + 4).join(',')),
      );
      for (let i = 0; i < result.length; i += 4)
        expect(palette.has(result.slice(i, i + 4).join(','))).toBe(true);
      expect(image.pixels).toEqual(original);
      expect(result).not.toEqual(bytes(image, effect({ sampling: 'nearest', blockSize: 15 })));
    },
  );
  it('corrupts grid addresses, unlike Random sample which samples within each block', () => {
    const image = fixture(),
      fx = effect({ sampling: 'corrupted', blockSize: 15, corruption: 1 });
    const nearest = bytes(image, effect({ sampling: 'nearest', blockSize: 15 }));
    const palette = new Set(
      Array.from({ length: nearest.length / 4 }, (_, i) =>
        nearest.slice(i * 4, i * 4 + 4).join(','),
      ),
    );
    const output = bytes(image, fx);
    for (let i = 0; i < output.length; i += 4)
      expect(palette.has(output.slice(i, i + 4).join(','))).toBe(true);
    expect(output).not.toEqual(bytes(image, effect({ sampling: 'random', blockSize: 15 })));
    expect(bytes(image, { ...fx, params: { ...fx.params, edgeHandling: 'wrap' } })).not.toEqual(
      output,
    );
    expect(bytes(image, { ...fx, params: { ...fx.params, edgeHandling: 'mirror' } })).not.toEqual(
      output,
    );
  });
  it.each(modes)('%s respects opacity, coverage and disabled layers', (sampling) => {
    const image = fixture(),
      fx = effect({ sampling, blockSize: 15 });
    for (const candidate of [
      { ...fx, enabled: false },
      { ...fx, params: { ...fx.params, amount: 0 } },
      { ...fx, application: { ...fx.application, coverage: 0 } },
    ])
      expect(renderEffects(image, [candidate]).pixels).toBe(image.pixels);
    const partial = bytes(image, { ...fx, params: { ...fx.params, amount: 0.5 } });
    expect(partial).not.toEqual(new Uint8Array(image.pixels));
    expect(partial).not.toEqual(bytes(image, fx));
    const masked = bytes(image, {
      ...fx,
      application: { region: 'left', coverage: 0.5, softness: 0 },
    });
    const index = (image.width - 1) * 4;
    expect(masked.slice(index, index + 4)).toEqual(
      new Uint8Array(image.pixels).slice(index, index + 4),
    );
  });
  it('preserves older recipes and validates optional sampling controls', () => {
    const old = effect({ sampling: 'random' });
    const params = { ...old.params };
    delete params.jitter;
    delete params.corruption;
    delete params.edgeHandling;
    const legacy = { ...old, params };
    expect(() => assertEffect(legacy)).not.toThrow();
    expect(bytes(fixture(), legacy)).toEqual(bytes(fixture(), old));
    for (const change of [{ jitter: -0.01 }, { corruption: 1.01 }, { corruption: NaN }])
      expect(() => assertEffect(effect(change))).toThrow();
  });
  it.each(['linear', 'dirty-nearest', 'corrupted'] as const)(
    '%s retains its geometry and seeded decisions in reduced previews',
    (sampling) => {
      const full = fixture(96, 72),
        preview = fixture(32, 24);
      // Cell-flat artwork isolates geometry from the source detail lost during
      // downsampling. A 3:1 reduction aligns preview and export pixel centers.
      for (const [image, scale] of [
        [full, 1],
        [preview, 3],
      ] as const) {
        const pixels = new Uint8Array(image.pixels);
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            const cx = Math.floor(((x + 0.5) * scale) / 12);
            const cy = Math.floor(((y + 0.5) * scale) / 12);
            pixels.set([cx * 31, cy * 43, (cx + cy) * 15, 255], (y * image.width + x) * 4);
          }
      }
      const fx = effect({
        sampling,
        blockSize: 16.7,
        jitter: 1,
        corruption: 0.85,
        edgeHandling: 'wrap',
      });
      const exported = bytes(full, fx);
      const reduced = new Uint8Array(
        renderEffects(preview, [fx], { masterSeed: 8172, reference: full }).pixels,
      );
      for (let y = 0; y < preview.height; y++)
        for (let x = 0; x < preview.width; x++) {
          const index = (y * preview.width + x) * 4;
          const source = ((y * 3 + 1) * full.width + x * 3 + 1) * 4;
          expect(reduced.slice(index, index + 4)).toEqual(exported.slice(source, source + 4));
        }
    },
  );
  it.each(['linear', 'dirty-nearest', 'corrupted'] as const)(
    '%s supports cancellation and matches async rendering',
    async (sampling) => {
      const image = fixture(),
        original = image.pixels.slice(0),
        fx = effect({ sampling, blockSize: 15 });
      let cancelled = false,
        ticks = 0;
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => (ticks += 10));
      try {
        await expect(
          renderEffectsAsync(image, [fx], {
            isCancelled: () => cancelled,
            yieldControl: async () => {
              cancelled = true;
            },
          }),
        ).rejects.toBeInstanceOf(RenderCancelledError);
      } finally {
        clock.mockRestore();
      }
      expect(image.pixels).toEqual(original);
      expect(
        new Uint8Array(
          (
            await renderEffectsAsync(image, [fx], {
              masterSeed: 8172,
              yieldControl: async () => {},
            })
          ).pixels,
        ),
      ).toEqual(bytes(image, fx));
    },
  );
});
