import { describe, expect, it, vi } from 'vitest';
import {
  createEffect,
  type BlockCorruptionEffect,
  type SpatialCrushEffect,
} from '@gleech/project-model';
import { cellRandom, renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

function fixture(width = 64, height = 48) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      pixels.set(
        [(x * 3) % 256, (y * 5) % 256, (x * 7 + y * 11) % 256, (x * 13 + y * 17) % 256],
        (y * width + x) * 4,
      );
    }
  return { width, height, pixels: pixels.buffer };
}
function same(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const left = new Uint8Array(a),
    right = new Uint8Array(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
const block = createEffect('block-corruption', 'blocks') as BlockCorruptionEffect;
const crush = createEffect('spatial-crush', 'crush') as SpatialCrushEffect;

describe('seeded version 1 effects', () => {
  it('preserves version 1 random field vectors for future saved recipes', () => {
    expect(cellRandom(1601876140, 0, 0, 0) * 0x100000000).toBe(3698932622);
    expect(cellRandom(1601876140, 1, 0, 1) * 0x100000000).toBe(252019648);
    expect(cellRandom(1601876140, 3, 7, 3) * 0x100000000).toBe(4200986478);
    expect(cellRandom(1601876140, 100, 200, 4, 17) * 0x100000000).toBe(4203300208);
  });
  it('reproduces pixels by seed and instance while variations hold parameters constant', () => {
    const image = fixture();
    const original = image.pixels.slice(0);
    const effect = { ...block, params: { ...block.params, density: 1, displacement: 25 } };
    const output = renderEffects(image, [effect], { masterSeed: 8172 });
    expect(same(renderEffects(image, [effect], { masterSeed: 8172 }).pixels, output.pixels)).toBe(
      true,
    );
    expect(same(renderEffects(image, [effect], { masterSeed: 8173 }).pixels, output.pixels)).toBe(
      false,
    );
    expect(
      same(
        renderEffects(image, [{ ...effect, seedOffset: 1 }], { masterSeed: 8172 }).pixels,
        output.pixels,
      ),
    ).toBe(false);
    expect(
      same(
        renderEffects(image, [{ ...effect, instanceId: 'another' }], { masterSeed: 8172 }).pixels,
        output.pixels,
      ),
    ).toBe(false);
    expect(same(image.pixels, original)).toBe(true);
    expect(
      renderEffects(image, [{ ...block, params: { ...block.params, density: 0 } }]).pixels,
    ).toBe(image.pixels);
    expect(
      renderEffects(image, [{ ...block, params: { ...block.params, displacement: 0 } }]).pixels,
    ).toBe(image.pixels);
  });

  it('addresses cells independently of traversal order and unrelated effects', () => {
    const cells = [
      [0, 0],
      [1, 0],
      [3, 7],
      [100, 200],
    ];
    const values = cells.map(([x, y]) => cellRandom(1601876140, x!, y!, 0));
    expect([...cells].reverse().map(([x, y]) => cellRandom(1601876140, x!, y!, 0))).toEqual(
      [...values].reverse(),
    );
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    const image = fixture();
    const ignored = { ...crush, enabled: false };
    expect(
      same(
        renderEffects(image, [ignored, block], { masterSeed: 11 }).pixels,
        renderEffects(image, [block, ignored], { masterSeed: 11 }).pixels,
      ),
    ).toBe(true);
  });

  it('samples whole RGBA blocks and uses original dimensions for reduced previews', () => {
    const image = fixture(8, 8);
    const effect = { ...crush, params: { ...crush.params, blockSize: 25 } };
    const result = new Uint8Array(renderEffects(image, [effect]).pixels);
    const source = new Uint8Array(image.pixels);
    expect(Array.from(result.subarray(0, 4))).toEqual(Array.from(source.subarray(36, 40)));
    expect(Array.from(result.subarray(4, 8))).toEqual(Array.from(result.subarray(0, 4)));
    const scaled = renderEffects(image, [effect], { reference: { width: 16, height: 16 } });
    expect(same(scaled.pixels, renderEffects(image, [effect]).pixels)).toBe(true);
    const random = { ...effect, params: { ...effect.params, sampling: 'random' as const } };
    expect(
      same(
        renderEffects(image, [random], { masterSeed: 0 }).pixels,
        renderEffects(image, [random], { masterSeed: 1 }).pixels,
      ),
    ).toBe(false);
    expect(
      same(
        renderEffects(image, [random], { masterSeed: 0 }).pixels,
        renderEffects(image, [random], { masterSeed: 0 }).pixels,
      ),
    ).toBe(true);
  });

  it('averages and blends transparency in premultiplied color without dark fringes', () => {
    const image = fixture(8, 8);
    const source = new Uint8Array(image.pixels);
    for (const index of [0, 4, 32, 36]) source.set([0, 0, 255, 0], index);
    source.set([255, 0, 0, 255], 36);
    const average = {
      ...crush,
      params: { ...crush.params, blockSize: 25, sampling: 'average' as const },
    };
    expect(
      Array.from(new Uint8Array(renderEffects(image, [average]).pixels).subarray(0, 4)),
    ).toEqual([255, 0, 0, 64]);
    const mixed = { ...average, params: { ...average.params, amount: 0.5 } };
    expect(Array.from(new Uint8Array(renderEffects(image, [mixed]).pixels).subarray(0, 4))).toEqual(
      [255, 0, 0, 32],
    );
    source.set([10, 20, 30, 0], 36);
    expect(
      Array.from(new Uint8Array(renderEffects(image, [average]).pixels).subarray(0, 4)),
    ).toEqual([3, 5, 199, 0]);
  });

  it('evaluates order while preserving stable instance patterns', () => {
    const image = fixture();
    const pixelate = { ...crush, params: { ...crush.params, blockSize: 20 } };
    const a = renderEffects(image, [block, pixelate], { masterSeed: 1 });
    const b = renderEffects(image, [pixelate, block], { masterSeed: 1 });
    expect(same(a.pixels, b.pixels)).toBe(false);
    expect(same(renderEffects(image, [block, pixelate], { masterSeed: 1 }).pixels, a.pixels)).toBe(
      true,
    );
  });

  it('yields for cancellation and leaves the source untouched', async () => {
    const image = fixture();
    const original = image.pixels.slice(0);
    let cancelled = false;
    let ticks = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (ticks += 10));
    try {
      await expect(
        renderEffectsAsync(image, [block, crush], {
          isCancelled: () => cancelled,
          yieldControl: async () => {
            cancelled = true;
          },
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    } finally {
      clock.mockRestore();
    }
    expect(same(image.pixels, original)).toBe(true);
    const asyncResult = await renderEffectsAsync(image, [block, crush], {
      masterSeed: 3,
      yieldControl: async () => {},
    });
    expect(
      same(asyncResult.pixels, renderEffects(image, [block, crush], { masterSeed: 3 }).pixels),
    ).toBe(true);
  });
});
