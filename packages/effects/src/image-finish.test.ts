import { describe, expect, it } from 'vitest';
import {
  createEffect,
  IMAGE_FINISH_DEFAULTS,
  type EffectInstance,
  type EffectType,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
const types: EffectType[] = [
  'noise-grain',
  'blur',
  'levels-curves',
  'glow',
  'hue-saturation',
  'gradient-map',
  'rgb-split',
  'block-corruption',
  'spatial-crush',
  'bit-crush',
  'wave-distortion',
  'mirroring',
  'kaleidoscope',
  'motion-mosh',
  'shapes',
  'mandelbrot',
  'recursive-space',
];
const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);
const fixture = () => {
  const pixels = new Uint8Array(40 * 20 * 4);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 40; x++)
      pixels.set(
        [(x * 17) % 256, (y * 29) % 256, ((x + y) * 11) % 256, [0, 64, 128, 255][x % 4]!],
        (y * 40 + x) * 4,
      );
  return { width: 40, height: 20, pixels: pixels.buffer };
};
const finish = (effect: EffectInstance, params: Record<string, number | string>) =>
  ({
    ...effect,
    params: {
      ...effect.params,
      ...(Object.hasOwn(params, 'tintStrength') ? { tintEnabled: 'on' } : {}),
      ...params,
    },
  }) as EffectInstance;

describe('shared image finish', () => {
  it('starts tint off, bypasses stored strengths while off, and preserves pre-toggle tint recipes', () => {
    const image = fixture();
    for (const type of types) {
      const effect = createEffect(type, type);
      expect((effect.params as Record<string, string | number>).tintEnabled).toBe('off');
      const off = finish(effect, {
        color: '#204080',
        tintStrength: 0.8,
        tintEnabled: 'off',
        amount: 0.37,
      });
      const neutral = finish(off, { tintStrength: 0, tintEnabled: 'off' });
      expect(bytes(renderEffects(image, [off]).pixels)).toEqual(
        bytes(renderEffects(image, [neutral]).pixels),
      );
      const on = finish(off, { tintEnabled: 'on' });
      expect(bytes(renderEffects(image, [on]).pixels)).not.toEqual(
        bytes(renderEffects(image, [off]).pixels),
      );
      const params = { ...on.params } as Record<string, string | number>;
      delete params.tintEnabled;
      expect(bytes(renderEffects(image, [{ ...on, params } as EffectInstance]).pixels)).toEqual(
        bytes(renderEffects(image, [on]).pixels),
      );
      const blendedOff = finish(off, { blendMode: 'difference' });
      const blendedNeutral = finish(neutral, { blendMode: 'difference' });
      expect(bytes(renderEffects(image, [blendedOff]).pixels)).toEqual(
        bytes(renderEffects(image, [blendedNeutral]).pixels),
      );
    }
  });
  it('keeps all legacy outputs exact with neutral finish settings at fractional amounts', () => {
    for (const type of types) {
      const current = finish(createEffect(type, type), { amount: 0.37 });
      const params = { ...current.params } as Record<string, number | string>;
      for (const key of Object.keys(IMAGE_FINISH_DEFAULTS)) delete params[key];
      const image = fixture();
      expect(bytes(renderEffects(image, [current]).pixels)).toEqual(
        bytes(renderEffects(image, [{ ...current, params } as EffectInstance]).pixels),
      );
    }
  });
  it('keeps a white tint neutral even at fractional Amount and full tint strength', () => {
    const image = fixture();
    for (const type of types) {
      const effect = finish(createEffect(type, type), { amount: 0.37 });
      expect(
        bytes(renderEffects(image, [finish(effect, { color: '#ffffff', tintStrength: 1 })]).pixels),
      ).toEqual(bytes(renderEffects(image, [effect]).pixels));
    }
  });
  it('uses independently calculated blend vectors and preserves alpha', () => {
    const image = { width: 1, height: 1, pixels: new Uint8Array([240, 120, 60, 255]).buffer };
    // At 8 bits the pixel is unchanged before tint. Full tint #40a0e0
    // multiplies the processed channels to [60.235...,75.294...,52.706...].
    const expected = {
      normal: [60, 75, 53],
      multiply: [57, 35, 12],
      screen: [244, 160, 100],
      add: [255, 195, 113],
      overlay: [232, 71, 25],
      difference: [180, 45, 7],
    };
    for (const [blendMode, rgb] of Object.entries(expected)) {
      const effect = finish(createEffect('bit-crush', 'vector'), {
        bits: 8,
        color: '#40a0e0',
        tintStrength: 1,
        blendMode,
      });
      expect([...bytes(renderEffects(image, [effect]).pixels)]).toEqual([...rgb, 255]);
    }
  });
  it('composites all image filters before masking, with exact no-op Amount and Coverage', () => {
    const image = fixture();
    const input = bytes(image.pixels);
    for (const type of types) {
      const effect = finish(createEffect(type, type), {
        color: '#40a0e0',
        tintStrength: 0.75,
        blendMode: 'difference',
        amount: 0.6,
      });
      const processed = renderEffects(image, [effect]);
      expect(bytes(processed.pixels)).not.toEqual(input);
      for (const candidate of [
        finish(effect, { amount: 0 }),
        { ...effect, enabled: false },
        { ...effect, application: { ...effect.application, coverage: 0 } },
      ])
        expect(bytes(renderEffects(image, [candidate]).pixels)).toEqual(input);
      const masked = bytes(
        renderEffects(image, [
          { ...effect, application: { region: 'top', coverage: 0.5, softness: 0 } },
        ]).pixels,
      );
      expect(masked.subarray(40 * 10 * 4)).toEqual(input.subarray(40 * 10 * 4));
      expect(masked.subarray(0, 40 * 10 * 4)).toEqual(
        bytes(processed.pixels).subarray(0, 40 * 10 * 4),
      );
    }
  });
  it('never lets hidden backdrop RGB change visible displaced colors', () => {
    const image = {
      width: 2,
      height: 1,
      pixels: new Uint8Array([250, 10, 70, 0, 100, 150, 200, 255]).buffer,
    };
    const effect = finish(createEffect('spatial-crush', 'alpha'), {
      blockSize: 25,
      sampling: 'average',
      blendMode: 'difference',
      amount: 0.5,
    });
    // Force one cell over the pair by using a smaller reference than the output.
    const options = { reference: { width: 1, height: 1 } };
    const output = bytes(renderEffects(image, [effect], options).pixels);
    expect([...output.subarray(0, 4)]).toEqual([100, 150, 200, 64]);
    const changed = {
      ...image,
      pixels: new Uint8Array([0, 255, 255, 0, 100, 150, 200, 255]).buffer,
    };
    expect(bytes(renderEffects(changed, [effect], options).pixels).subarray(0, 4)).toEqual(
      output.subarray(0, 4),
    );
  });
  it('matches async rendering and supports cancellation in the finish pass', async () => {
    const image = fixture();
    const effects = types.map((type) =>
      finish(createEffect(type, type), {
        color: '#4080e0',
        tintStrength: 0.6,
        blendMode: 'screen',
        amount: 0.7,
      }),
    );
    expect(
      bytes((await renderEffectsAsync(image, effects, { yieldControl: async () => {} })).pixels),
    ).toEqual(bytes(renderEffects(image, effects).pixels));
    let checks = 0;
    await expect(
      renderEffectsAsync(image, [effects[0]!], {
        isCancelled: () => ++checks > 25,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
