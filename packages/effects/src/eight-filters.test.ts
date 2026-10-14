import { describe, expect, it } from 'vitest';
import {
  createEffect,
  effectsNeedSubject,
  type EffectInstance,
  type EffectType,
  type LayerImage,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
const types = [
  'vector-corruption',
  'reference-mosh',
  'motion-transfer',
  'depth-parallax',
  'depth-haze',
  'depth-color-map',
  'cutout',
  'lens-distortion',
] as const;
const effect = (type: EffectType, params: Record<string, number | string> = {}) => {
  const e = createEffect(type, type);
  return { ...e, params: { ...e.params, ...params } } as EffectInstance;
};
const image = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
) => ({
  width,
  height,
  pixels: Uint8Array.from(
    { length: width * height * 4 },
    (_, i) => pixel(Math.floor(i / 4) % width, Math.floor(i / 4 / width))[i % 4]!,
  ).buffer,
});
const bytes = (
  source: ReturnType<typeof image>,
  e: EffectInstance,
  options: Parameters<typeof renderEffects>[2] = {},
) => new Uint8Array(renderEffects(source, [e], { masterSeed: 23, ...options }).pixels);
const pixel = (out: Uint8Array, x: number, y: number, width: number) =>
  Array.from(out.slice((y * width + x) * 4, (y * width + x + 1) * 4));
const attach = (
  e: EffectInstance,
  source: ReturnType<typeof image>,
  key: 'image' | 'fieldImage' = 'image',
) =>
  ({
    ...e,
    [key]: {
      source: {
        id: 'map',
        name: 'map.png',
        width: source.width,
        height: source.height,
        format: 'png',
        hasAlpha: true,
      },
      png: '',
    } as LayerImage,
  }) as EffectInstance;
const constant = image(5, 5, () => [80, 120, 160, 128]);
const strip = image(5, 5, (x) => [x * 50, 100, 200, 255]);
const layerOptions = (map: ReturnType<typeof image>) => ({ layerImages: new Map([['map', map]]) });

describe('Vector Corruption and imported displacement', () => {
  it('keeps neutral settings exact and makes seeded corruption repeatable', () => {
    for (const p of [{ strength: 0 }, { density: 0 }])
      expect(bytes(strip, effect('vector-corruption', p))).toEqual(new Uint8Array(strip.pixels));
    const e = effect('vector-corruption', { strength: 30, density: 1, cellSize: 20 });
    expect(bytes(strip, e)).toEqual(bytes(strip, e));
    expect(bytes(strip, e)).not.toEqual(bytes(strip, { ...e, seedOffset: 9 }));
  });
  it('reverses a base vector and rotates it through a quarter-turn', () => {
    const gradient = image(21, 21, (x, y) => [x * 10, y * 10, 0, 255]);
    const p = { strength: 20, density: 1, direction: 0 };
    const reversed = pixel(
      bytes(gradient, effect('vector-corruption', { ...p, operation: 'reverse' })),
      10,
      10,
      21,
    );
    const rotated = pixel(
      bytes(gradient, effect('vector-corruption', { ...p, operation: 'rotate' })),
      10,
      10,
      21,
    );
    expect(reversed[0]).toBeGreaterThan(100);
    expect(reversed[1]).toBe(100);
    expect(rotated[0]).toBe(100);
    expect(rotated[1]).toBeLessThan(100);
  });
  it('bypasses absent references/maps and rejects missing decoded attachments', () => {
    for (const type of ['reference-mosh', 'motion-transfer'] as const) {
      expect(bytes(strip, effect(type))).toEqual(new Uint8Array(strip.pixels));
      expect(() => bytes(strip, attach(effect(type), constant))).toThrow(/not available/);
    }
  });
  it('has exact cross-image endpoints for all three transition styles', () => {
    const other = image(5, 5, (x, y) => [y * 35, x * 22, 40, 128]);
    for (const style of ['patches', 'dissolve', 'drag']) {
      expect(
        bytes(
          strip,
          attach(effect('reference-mosh', { style, progression: 0 }), other),
          layerOptions(other),
        ),
      ).toEqual(new Uint8Array(strip.pixels));
      expect(
        bytes(
          strip,
          attach(effect('reference-mosh', { style, progression: 1 }), other),
          layerOptions(other),
        ),
      ).toEqual(new Uint8Array(other.pixels));
    }
  });
  it('retains stable, monotonic patch identities while scrubbing', () => {
    const source = image(31, 23, () => [10, 20, 30, 255]),
      other = image(31, 23, () => [240, 240, 240, 255]);
    let previous = new Uint8Array(source.pixels);
    for (const progression of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const next = bytes(
        source,
        attach(effect('reference-mosh', { progression, patchSize: 8 }), other),
        layerOptions(other),
      );
      for (let i = 0; i < next.length; i += 4) expect(next[i]).toBeGreaterThanOrEqual(previous[i]!);
      previous = next;
    }
  });
  it('fits a non-square reference using transparent margins instead of stretching', () => {
    const other = image(5, 1, () => [255, 0, 0, 255]);
    const out = bytes(
      constant,
      attach(effect('reference-mosh', { progression: 1, placement: 'fit' }), other),
      layerOptions(other),
    );
    expect(pixel(out, 2, 0, 5)[3]).toBe(0);
    expect(pixel(out, 2, 2, 5)).toEqual([255, 0, 0, 255]);
  });
  it('decodes 128 as exact RG neutral and excludes hidden colors in transparent maps', () => {
    for (const map of [
      image(5, 5, () => [128, 128, 255, 255]),
      image(5, 5, () => [255, 0, 255, 0]),
    ]) {
      expect(
        bytes(strip, attach(effect('motion-transfer', { strength: 50 }), map), layerOptions(map)),
      ).toEqual(new Uint8Array(strip.pixels));
    }
  });
  it('transfers horizontal red vectors and independently inverts them', () => {
    const map = image(5, 5, () => [255, 128, 0, 255]);
    const e = attach(effect('motion-transfer', { strength: 20 }), map);
    expect(pixel(bytes(strip, e, layerOptions(map)), 2, 2, 5)[0]).toBe(50);
    const inverted = attach(effect('motion-transfer', { strength: 20, invertX: 'on' }), map);
    expect(pixel(bytes(strip, inverted, layerOptions(map)), 2, 2, 5)[0]).toBe(150);
  });
  it('rotates the vector direction with the map and handles grayscale directions', () => {
    const source = image(5, 5, (x, y) => [x * 50, y * 50, 0, 255]),
      map = image(5, 5, () => [255, 128, 0, 255]);
    const out = bytes(
      source,
      attach(effect('motion-transfer', { strength: 20, mapRotation: 90 }), map),
      layerOptions(map),
    );
    expect(pixel(out, 2, 2, 5)).toEqual([100, 50, 0, 255]);
    const gray = image(5, 5, () => [255, 255, 255, 255]);
    const vertical = bytes(
      source,
      attach(effect('motion-transfer', { strength: 20, encoding: 'luma', direction: 90 }), gray),
      layerOptions(gray),
    );
    expect(pixel(vertical, 2, 2, 5)[0]).toBe(100);
    expect(pixel(vertical, 2, 2, 5)[1]).toBeLessThan(100);
  });
  it('uses brightness slopes rather than brightness itself in gradient mode', () => {
    const flat = image(5, 5, () => [240, 240, 240, 255]);
    const slope = image(5, 5, (x) => [x * 50, x * 50, x * 50, 255]);
    const p = { strength: 50, encoding: 'gradient' };
    expect(
      pixel(
        bytes(strip, attach(effect('motion-transfer', p), flat), layerOptions(flat)),
        2,
        2,
        5,
      )[0],
    ).toBe(100);
    expect(
      pixel(
        bytes(strip, attach(effect('motion-transfer', p), slope), layerOptions(slope)),
        2,
        2,
        5,
      )[0],
    ).toBeLessThan(100);
  });
});
describe('Grayscale map boundaries', () => {
  it('keeps a flat slope map neutral at its edges and outside its footprint', () => {
    const source = image(31, 23, (x, y) => [x * 7, y * 9, 50, [0, 1, 128, 255][x % 4]!]);
    const map = image(19, 13, () => [240, 240, 240, 255]);
    for (const mapScale of [25, 100, 200]) {
      const e = attach(
        effect('motion-transfer', { encoding: 'gradient', strength: 50, mapScale }),
        map,
      );
      expect(bytes(source, e, layerOptions(map))).toEqual(new Uint8Array(source.pixels));
    }
    const transparent = image(19, 13, () => [255, 0, 255, 0]);
    expect(
      bytes(
        source,
        attach(effect('motion-transfer', { encoding: 'gradient', strength: 50 }), transparent),
        layerOptions(transparent),
      ),
    ).toEqual(new Uint8Array(source.pixels));
  });
  it('keeps the same normalized grayscale slope comparable at different map resolutions', () => {
    const source = image(31, 23, (x, y) => [x * 7, y * 9, 50, 255]);
    const samples = [9, 257].map((size) => {
      const map = image(size, size, (x) => {
        const value = ((x + 0.5) * 255) / size;
        return [value, value, value, 255];
      });
      return pixel(
        bytes(
          source,
          attach(effect('motion-transfer', { encoding: 'gradient', strength: 30 }), map),
          layerOptions(map),
        ),
        15,
        11,
        31,
      );
    });
    expect(Math.abs(samples[0]![0]! - samples[1]![0]!)).toBeLessThanOrEqual(1);
    expect(samples[0]![0]).toBeLessThan(105);
    expect(samples[0]![1]).toBe(99);
    expect(samples[1]![1]).toBe(99);
  });
});
describe('Depth finishing and optical geometry', () => {
  it('keeps the focus plane fixed and reverses signed camera travel', () => {
    const map = image(5, 5, () => [255, 255, 255, 255]),
      base = { fieldSource: 'image', focusDepth: 1, cameraX: 20, cameraY: 0 };
    expect(
      bytes(strip, attach(effect('depth-parallax', base), map, 'fieldImage'), layerOptions(map)),
    ).toEqual(new Uint8Array(strip.pixels));
    for (const cameraX of [-20, 20]) {
      const out = bytes(
        strip,
        attach(
          effect('depth-parallax', { ...base, focusDepth: 0, cameraX, edges: 'extend' }),
          map,
          'fieldImage',
        ),
        layerOptions(map),
      );
      const value = pixel(out, 2, 2, 5)[0]!;
      expect(cameraX > 0 ? value < 100 : value > 100).toBe(true);
    }
  });
  it('preserves the push-pull center and produces seeded depth tearing', () => {
    const map = image(5, 5, () => [255, 255, 255, 255]);
    const p = { fieldSource: 'image', focusDepth: 0, style: 'push-pull', strength: 1 };
    const out = bytes(
      strip,
      attach(effect('depth-parallax', p), map, 'fieldImage'),
      layerOptions(map),
    );
    expect(pixel(out, 2, 2, 5)[0]).toBe(100);
    expect(pixel(out, 4, 2, 5)[0]).toBeLessThan(200);
    const e = effect('depth-parallax', {
      style: 'tearing',
      fieldSource: 'linear',
      cameraX: 35,
      scatter: 1,
    });
    expect(bytes(strip, e)).toEqual(bytes(strip, e));
    expect(bytes(strip, e)).not.toEqual(bytes(strip, { ...e, seedOffset: 9 }));
  });
  it('makes haze near-clear and far-opaque without changing source alpha', () => {
    const map = image(5, 5, (x) => [x === 0 ? 0 : 255, x === 0 ? 0 : 255, x === 0 ? 0 : 255, 255]);
    const out = bytes(
      constant,
      attach(
        effect('depth-haze', {
          fieldSource: 'image',
          density: 1,
          start: 0,
          end: 1,
          falloff: 1,
          fogColor: '#ffffff',
        }),
        map,
        'fieldImage',
      ),
      layerOptions(map),
    );
    expect(pixel(out, 0, 2, 5)).toEqual([255, 255, 255, 128]);
    expect(pixel(out, 4, 2, 5)).toEqual([80, 120, 160, 128]);
  });
  it('maps near/far values and intermediate gradient stops independently of image brightness', () => {
    const map = image(5, 5, (x) => [(x * 255) / 4, (x * 255) / 4, (x * 255) / 4, 255]);
    const p = {
      fieldSource: 'image',
      shading: 0,
      depthColor: '#ff0000',
      depthColorEnd: '#0000ff',
      depthColorStops:
        '[{"position":0,"color":"#ff0000"},{"position":0.5,"color":"#00ff00"},{"position":1,"color":"#0000ff"}]',
    };
    const out = bytes(
      constant,
      attach(effect('depth-color-map', p), map, 'fieldImage'),
      layerOptions(map),
    );
    expect(pixel(out, 0, 2, 5)).toEqual([255, 0, 0, 128]);
    expect(pixel(out, 4, 2, 5)).toEqual([0, 0, 255, 128]);
    expect(pixel(out, 2, 2, 5)[1]).toBeGreaterThan(250);
    const reverse = bytes(
      constant,
      attach(effect('depth-color-map', { ...p, reverse: 'on' }), map, 'fieldImage'),
      layerOptions(map),
    );
    expect(pixel(reverse, 0, 2, 5)).toEqual([0, 0, 255, 128]);
  });
  it('cuts only alpha, feathers depth boundaries and includes range endpoints', () => {
    const source = image(5, 5, (x) => [100, 50, 25, x === 0 ? 0 : 128]);
    const out = bytes(
      source,
      effect('cutout', { fieldSource: 'linear', far: 0.5, near: 1, softness: 0 }),
    );
    expect(pixel(out, 1, 2, 5)).toEqual([100, 50, 25, 0]);
    expect(pixel(out, 4, 2, 5)).toEqual([100, 50, 25, 128]);
    const soft = bytes(
      source,
      effect('cutout', { fieldSource: 'linear', far: 0.5, near: 1, softness: 0.4 }),
    );
    expect(pixel(soft, 2, 2, 5)[3]).toBe(64);
    expect(
      bytes(source, effect('cutout', { fieldSource: 'linear', far: 0, near: 1, softness: 0.2 })),
    ).toEqual(new Uint8Array(source.pixels));
  });
  it('combines detected subject with depth by intersection or union and complements the selection', () => {
    const subject = {
      width: 5,
      height: 5,
      values: Uint8Array.from({ length: 25 }, (_, i) => (i % 5 < 2 ? 255 : 0)).buffer,
    };
    const base = { mode: 'hybrid', fieldSource: 'linear', far: 0.5, near: 1, softness: 0 };
    const intersection = bytes(constant, effect('cutout', base), { subjectMask: subject });
    expect(intersection.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
    const union = bytes(constant, effect('cutout', { ...base, combine: 'union' }), {
      subjectMask: subject,
    });
    expect([0, 1, 2, 3, 4].map((x) => pixel(union, x, 2, 5)[3])).toEqual([128, 128, 128, 128, 128]);
    const outside = bytes(
      constant,
      effect('cutout', { mode: 'subject', keep: 'outside', softness: 0 }),
      { subjectMask: subject },
    );
    expect(pixel(outside, 0, 2, 5)[3]).toBe(0);
    expect(pixel(outside, 4, 2, 5)[3]).toBe(128);
  });
  it('requests subject detection for Subject/Hybrid even with Application All and reports missing mattes', () => {
    for (const mode of ['subject', 'hybrid']) {
      const e = effect('cutout', { mode });
      expect(effectsNeedSubject([e])).toBe(true);
      expect(() => bytes(constant, e)).toThrow(/Subject detection/);
      expect(effectsNeedSubject([{ ...e, enabled: false }])).toBe(false);
    }
    expect(effectsNeedSubject([effect('cutout', { mode: 'depth' })])).toBe(false);
  });
  it('bends a lens around its fixed center and offers transparent, tiled and mirrored edges', () => {
    expect(bytes(strip, effect('lens-distortion', { distortion: 0, secondary: 0 }))).toEqual(
      new Uint8Array(strip.pixels),
    );
    const p = { distortion: 0.8, secondary: 0.5 };
    const out = bytes(strip, effect('lens-distortion', p));
    expect(pixel(out, 2, 2, 5)[0]).toBe(100);
    expect(pixel(out, 0, 0, 5)[3]).toBe(0);
    for (const edges of ['extend', 'wrap', 'mirror'])
      expect(pixel(bytes(strip, effect('lens-distortion', { ...p, edges })), 0, 0, 5)[3]).toBe(255);
  });
});
describe.each(types)('%s shared contracts', (type) => {
  it('preserves disabled/zero-opacity/zero-coverage recipes and does not mutate input', () => {
    const original = constant.pixels.slice(0),
      e = effect(type);
    for (const off of [
      { ...e, enabled: false },
      effect(type, { amount: 0 }),
      { ...e, application: { ...e.application, coverage: 0 } },
    ])
      expect(bytes(constant, off)).toEqual(new Uint8Array(original));
    bytes(constant, e);
    expect(constant.pixels).toEqual(original);
  });
  it('has matching asynchronous results and bounded cancellation', async () => {
    const e = effect(type),
      source = image(513, 389, (x, y) => [x % 256, y % 256, 40, 255]);
    const attached =
      type === 'reference-mosh' || type === 'motion-transfer' ? attach(e, constant) : e;
    const options = { ...layerOptions(constant), masterSeed: 23, yieldEveryMs: 0 };
    expect(
      new Uint8Array(
        (await renderEffectsAsync(source, [attached], { ...options, yieldControl: async () => {} }))
          .pixels,
      ),
    ).toEqual(bytes(source, attached, options));
    let cancelled = false;
    let cancellationYields = 0;
    await expect(
      renderEffectsAsync(source, [attached], {
        ...options,
        isCancelled: () => cancelled,
        yieldControl: async () => {
          cancellationYields++;
          cancelled = true;
        },
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(cancellationYields).toBe(1);
  }, 30000);
});
