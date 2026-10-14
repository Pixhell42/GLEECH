import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  DEPTH_FIELD_KEYS,
  heightFieldParams,
  type BlurEffect,
  type RecursiveSpaceEffect,
  type EffectInstance,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const image = (width = 32, height = 24) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 128, 255, 255][Math.floor(i / 4) % 4]! : (i * 31) % 256,
  ).buffer,
});
const blur = (params: Partial<BlurEffect['params']> = {}) => {
  const e = createEffect('blur', 'focus') as BlurEffect;
  return {
    ...e,
    params: {
      ...e.params,
      style: 'depth' as const,
      fieldSource: 'linear' as const,
      fieldScale: 100,
      radius: 10,
      ...params,
    },
  };
};
const recursive = (params: Partial<RecursiveSpaceEffect['params']> = {}) => {
  const e = createEffect('recursive-space', 'space') as RecursiveSpaceEffect;
  return {
    ...e,
    params: {
      ...e.params,
      fieldEnabled: 'on' as const,
      fieldSource: 'linear' as const,
      fieldScale: 100,
      ...params,
    },
  };
};
const bytes = (source: ReturnType<typeof image>, effects: EffectInstance[]) =>
  new Uint8Array(renderEffects(source, effects).pixels);
describe('Reusable depth consumers', () => {
  it('keeps the chosen focus band exact while height distance controls blur and falloff', () => {
    const source = image(32, 32),
      input = new Uint8Array(source.pixels);
    const e = blur({ focusPosition: 0.5, focusRange: 0.4, focusFalloff: 0.2 });
    const out = bytes(source, [e]);
    for (let y = 0; y < 32; y++)
      for (let x = 10; x <= 21; x++) {
        const i = (y * 32 + x) * 4;
        expect(out.subarray(i, i + 4)).toEqual(input.subarray(i, i + 4));
      }
    expect(out).not.toEqual(input);
    expect(bytes(source, [blur({ focusRange: 1 })])).toEqual(input);
    expect(bytes(source, [blur({ radius: 0 })])).toEqual(input);
    expect(bytes(source, [blur({ focusFalloff: 0 })])).not.toEqual(out);
    expect(bytes(source, [blur({ focusPosition: 0 })])).not.toEqual(
      bytes(source, [blur({ focusPosition: 1 })]),
    );
  });
  it('supports each source, deterministic reuse and masks without leaking hidden colors', () => {
    const source = image();
    for (const fieldSource of [
      'brightness',
      'linear',
      'radial',
      'perlin',
      'simplex',
      'value',
      'voronoi',
      'shapes',
    ] as const) {
      const e = blur({ fieldSource, fieldScale: 14, fieldSeed: 3456 });
      const out = bytes(source, [e]);
      expect(out).not.toEqual(new Uint8Array(source.pixels));
      expect(
        new Uint8Array(
          renderEffects(source, [{ ...e, instanceId: 'copy' }], { masterSeed: 234 }).pixels,
        ),
      ).toEqual(out);
      expect(
        bytes(source, [{ ...e, application: { region: 'all', coverage: 0, softness: 0 } }]),
      ).toEqual(new Uint8Array(source.pixels));
    }
    const hidden = {
      width: 2,
      height: 1,
      pixels: new Uint8Array([255, 0, 0, 0, 0, 0, 255, 255]).buffer,
    };
    const out = bytes(hidden, [
      blur({ radius: 10, focusPosition: 1, focusRange: 0, focusFalloff: 0 }),
    ]);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(255);
  });
  it('modulates all recursive layouts with independent repetition, image scale and distortion', () => {
    const source = image();
    for (const style of ['tunnel', 'spiral', 'lattice'] as const) {
      const off = recursive({ style, fieldEnabled: 'off' });
      const original = bytes(source, [off]);
      expect(
        bytes(source, [
          recursive({ style, fieldRepetition: 0, fieldImageScale: 0, fieldDistortion: 0 }),
        ]),
      ).toEqual(original);
      for (const params of [
        { fieldRepetition: 0.8 },
        { fieldRepetition: 0, fieldImageScale: 0.8 },
        { fieldRepetition: 0, fieldDistortion: 20 },
      ])
        expect(bytes(source, [recursive({ style, ...params })])).not.toEqual(original);
    }
  });
  it('preserves legacy looks and validates optional reusable field controls', () => {
    const source = image();
    for (const e of [createEffect('blur', 'legacy'), createEffect('recursive-space', 'legacy')]) {
      const params = { ...e.params } as Record<string, string | number>;
      for (const key of [
        ...DEPTH_FIELD_KEYS,
        'focusPosition',
        'focusRange',
        'focusFalloff',
        'fieldEnabled',
        'fieldRepetition',
        'fieldImageScale',
        'fieldDistortion',
      ])
        delete params[key];
      const legacy = { ...e, params } as EffectInstance;
      expect(() => assertEffect(legacy)).not.toThrow();
      expect(bytes(source, [legacy])).toEqual(bytes(source, [e]));
    }
    expect(() => assertEffect(blur({ focusRange: 1.1 }))).toThrow();
    expect(() => assertEffect(recursive({ fieldSeed: 65536 }))).toThrow();
    const shared = heightFieldParams(blur({ fieldSeed: 4567, fieldSource: 'value' }).params);
    expect(heightFieldParams(recursive(shared).params)).toEqual(shared);
  });
  it('retains combined recipes through serialization and cooperatively cancels both consumers', async () => {
    const source = image(256, 192),
      effects = [
        blur({ fieldSource: 'perlin' }),
        recursive({ fieldSource: 'perlin', fieldImageScale: 0.5 }),
      ];
    const recipe = JSON.parse(JSON.stringify(effects)) as EffectInstance[];
    recipe.forEach(assertEffect);
    expect(bytes(source, recipe)).toEqual(bytes(source, effects));
    for (const e of effects) {
      let polls = 0;
      await expect(
        renderEffectsAsync(source, [e], {
          isCancelled: () => ++polls > 10,
          yieldControl: async () => {},
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    }
  });
});
