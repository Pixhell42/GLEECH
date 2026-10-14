import { describe, expect, it } from 'vitest';
import {
  createEffect,
  DIRECTION_CONSUMERS,
  DIRECTION_KEYS,
  directionFieldParams,
  assertEffect,
  type EffectInstance,
} from '@gleech/project-model';
import { createDirectionSampler, vectorMapSampler } from './direction-field';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const width = 41,
  height = 33;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : (i * 37 + Math.floor(i / 4) * 11) % 256,
);
const image = { width, height, pixels: pixels.buffer };
const render = (e: EffectInstance) =>
  new Uint8Array(renderEffects(image, [e], { masterSeed: 17 }).pixels);
const effect = (
  type: (typeof DIRECTION_CONSUMERS)[number],
  params: Record<string, number | string> = {},
) => {
  const e = createEffect(type, 'direction-test');
  return {
    ...e,
    params: {
      ...e.params,
      ...(type === 'glyph' ? { cellSize: 8 } : {}),
      ...(type === 'pixel-sort'
        ? { thresholdStart: 0, thresholdEnd: 1, length: 100, density: 1, breakup: 0 }
        : {}),
      ...params,
    },
  } as EffectInstance;
};
describe('shared direction field contract', () => {
  it('has aspect-correct centered vectors and rotates coordinates with the field', () => {
    const result = new Float64Array(2);
    const field = createDirectionSampler(
      { directionSource: 'radial' },
      { width: 200, height: 100 },
      image,
    );
    field(0.5, 0.5, result);
    expect([...result]).toEqual([0, 0]);
    field(0.75, 0.5, result);
    expect(result[0]).toBeCloseTo(1);
    expect(result[1]).toBe(0);
    const rotated = createDirectionSampler(
      { directionSource: 'linear', directionRotation: 90 },
      image,
      image,
    );
    rotated(0.3, 0.7, result);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(1);
  });
  it('decodes asymmetric signed bytes before interpolation and ignores transparent hidden RGB', () => {
    const map = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([255, 0, 128, 255, 0, 255, 128, 0]).buffer,
    };
    const sample = vectorMapSampler(map),
      v = new Float64Array(2);
    sample(0.25, 0.5, v);
    expect([...v]).toEqual([1, -1]);
    sample(0.5, 0.5, v);
    expect([...v]).toEqual([0.5, -0.5]);
    sample(0.75, 0.5, v);
    expect([...v]).toEqual([0, 0]);
    sample(-1, 0.5, v);
    expect([...v]).toEqual([0, 0]);
    const neutral = vectorMapSampler({
      width: 1,
      height: 1,
      pixels: Uint8Array.from([128, 128, 128, 255]).buffer,
    });
    neutral(0.5, 0.5, v);
    expect([...v]).toEqual([0, 0]);
  });
  it('keeps seeded flow independent of consumer identity and reverses both axes', () => {
    const p = { directionSource: 'flow', directionSeed: 123 },
      a = createDirectionSampler(p, image, image),
      b = createDirectionSampler({ ...p, directionInvert: 'on' }, image, image),
      v = new Float64Array(2),
      w = new Float64Array(2);
    a(0.27, 0.63, v);
    b(0.27, 0.63, w);
    expect(w[0]).toBe(-v[0]!);
    expect(w[1]).toBe(-v[1]!);
    const next = createDirectionSampler({ ...p, directionSeed: 124 }, image, image);
    next(0.27, 0.63, w);
    expect([...w]).not.toEqual([...v]);
  });
  it('has no spurious depth slope on a constant image or its borders', () => {
    const constant = { width: 1, height: 1, pixels: Uint8Array.from([200, 200, 200, 255]).buffer },
      field = createDirectionSampler({ directionSource: 'depth-gradient' }, image, constant),
      v = new Float64Array(2);
    for (const u of [0, 0.5, 1]) {
      field(u, 0.5, v);
      expect([...v]).toEqual([0, 0]);
    }
  });
  it.each(DIRECTION_CONSUMERS)(
    '%s keeps old recipes exact and responds to shared patterns',
    (type) => {
      const base = effect(type),
        legacy = {
          ...base,
          params: Object.fromEntries(
            Object.entries(base.params).filter(
              ([k]) => !(DIRECTION_KEYS as readonly string[]).includes(k),
            ),
          ),
        } as EffectInstance;
      assertEffect(legacy);
      expect(render(legacy)).toEqual(render(base));
      expect(render(effect(type, { directionSource: 'spiral', directionInfluence: 0 }))).toEqual(
        render(base),
      );
      for (const source of ['radial', 'spiral', 'flow', 'depth-gradient']) {
        const e = effect(type, {
          directionSource: source,
          directionSeed: 123,
          directionRotation: 23,
        });
        assertEffect(e);
        expect(render(e), type + ':' + source).not.toEqual(render(base));
        expect(render(e)).toEqual(render(e));
      }
    },
  );
  it('sorts non-overlapping curved paths as RGB permutations and preserves target alpha', () => {
    const e = effect('pixel-sort', { directionSource: 'circular' }),
      out = render(e);
    const colors = (bytes: Uint8Array) =>
      Array.from(
        { length: width * height },
        (_, i) => `${bytes[i * 4]},${bytes[i * 4 + 1]},${bytes[i * 4 + 2]}`,
      ).sort();
    expect(colors(out)).toEqual(colors(pixels));
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(pixels[i]);
  });
  it('does not move pixels for an imported neutral vector map', () => {
    const v = new Float64Array(2),
      field = createDirectionSampler({ directionSource: 'image' }, image, image, {
        width: 1,
        height: 1,
        pixels: Uint8Array.from([128, 128, 128, 255]).buffer,
      });
    field(0.5, 0.5, v);
    expect([...v]).toEqual([0, 0]);
  });
  it.each(DIRECTION_CONSUMERS)('%s keeps a neutral map neutral through its consumer', (type) => {
    const base = effect(type),
      e = {
        ...base,
        directionImage: {
          source: {
            id: 'neutral',
            name: 'neutral.png',
            width: 1,
            height: 1,
            format: 'png' as const,
            hasAlpha: false,
          },
          png: '',
        },
        params: { ...base.params, directionSource: 'image' },
      } as EffectInstance;
    const output = new Uint8Array(
      renderEffects(image, [e], {
        masterSeed: 17,
        layerImages: new Map([
          [
            'neutral',
            { width: 1, height: 1, pixels: Uint8Array.from([128, 128, 128, 255]).buffer },
          ],
        ]),
      }).pixels,
    );
    // These consumers retain their non-directional material/grain when travel is
    // neutral. A zero vector removes the curl/smear, rather than the entire look.
    const neutral =
      type === 'shader-filament-flow'
        ? render(effect(type, { curl: 0 }))
        : type === 'granular-echo'
          ? render(effect(type, { trailLength: 0 }))
          : type === 'pigment-drag'
            ? render(effect(type, { dragLength: 0 }))
            : type === 'glyph'
              ? render(base)
              : pixels;
    expect(output).toEqual(neutral);
  });
  it('does not require a stored unused import when the active field is procedural', () => {
    const e = effect('wave-distortion', { directionSource: 'flow' });
    expect(
      render({
        ...e,
        directionImage: {
          source: {
            id: 'unused',
            name: 'unused.png',
            width: 1,
            height: 1,
            format: 'png',
            hasAlpha: false,
          },
          png: '',
        },
      }),
    ).toEqual(render(e));
  });
  it('keeps glyph field opacity composited against the input', () => {
    const full = render(effect('glyph', { directionSource: 'spiral', amount: 1 })),
      half = render(effect('glyph', { directionSource: 'spiral', amount: 0.5 }));
    for (let i = 0; i < full.length; i++)
      expect(Math.abs(half[i]! - Math.round((full[i]! + pixels[i]!) / 2))).toBeLessThanOrEqual(1);
  });
  it('fully overrides unused height steering without requiring its missing map', () => {
    const e = effect('signal-tearing', {
      directionSource: 'spiral',
      fieldEnabled: 'on',
      fieldSource: 'image',
    });
    expect(render(e)).toEqual(render(effect('signal-tearing', { directionSource: 'spiral' })));
    expect(
      render({ ...e, params: { ...e.params, directionSource: 'native' } } as EffectInstance),
    ).toEqual(pixels);
  });
  it('cancels curved sorting cooperatively', async () => {
    let polls = 0;
    await expect(
      renderEffectsAsync(image, [effect('pixel-sort', { directionSource: 'flow' })], {
        yieldControl: async () => {},
        isCancelled: () => ++polls > 3,
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
  it('retains saved defaults independently of absent optional recipe keys', () => {
    expect(directionFieldParams({}).directionSource).toBe('native');
    const p = directionFieldParams({ directionSource: 'spiral', directionSeed: 234 });
    expect(p.directionSeed).toBe(234);
    expect(directionFieldParams({ ...p })).toEqual(p);
  });
});
