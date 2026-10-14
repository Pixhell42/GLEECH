import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  EFFECT_DEFINITIONS,
  SCANLINE_FINISH_DEFAULTS,
  IMAGE_FINISH_DEFAULTS,
  OUTPUT_ALIGNMENT_DEFAULTS,
  effectsNeedSubject,
  type EffectInstance,
  type EffectType,
} from './index';

describe('versioned parameter schemas', () => {
  it('keeps older reflection recipes unchanged and validates output placement', () => {
    for (const type of ['mirroring', 'kaleidoscope'] as const) {
      const effect = createEffect(type, 'placement');
      const params = { ...effect.params } as Record<string, string | number>;
      for (const key of Object.keys(OUTPUT_ALIGNMENT_DEFAULTS)) delete params[key];
      const legacy = { ...effect, params } as EffectInstance;
      expect(() => assertEffect(legacy)).not.toThrow();
      expect(legacy.params).toEqual(params);
      for (const key of Object.keys(OUTPUT_ALIGNMENT_DEFAULTS))
        expect(() =>
          assertEffect({
            ...legacy,
            params: { ...params, [key]: undefined },
          } as unknown as EffectInstance),
        ).toThrow();
      const aligned = {
        ...effect,
        params: { ...effect.params, outputAlignment: 'center' },
      } as EffectInstance;
      const opaqueRgba = Uint8Array.from([80, 90, 120, 255]).buffer;
      const transparentRgba = Uint8Array.from([80, 90, 120, 0]).buffer;
      expect(effectsNeedSubject([aligned], opaqueRgba)).toBe(true);
      expect(effectsNeedSubject([aligned], transparentRgba)).toBe(false);
      expect(effectsNeedSubject([{ ...aligned, enabled: false }])).toBe(false);
      expect(
        effectsNeedSubject([
          { ...aligned, params: { ...aligned.params, amount: 0 } } as EffectInstance,
        ]),
      ).toBe(false);
      expect(
        effectsNeedSubject(
          [{ ...aligned, application: { region: 'subject', coverage: 1, softness: 0 } }],
          transparentRgba,
        ),
      ).toBe(true);
    }
  });
  it('accepts older scanlines while rejecting invalid colors, omitted required controls and malformed new settings', () => {
    const effect = createEffect('scanlines', 'old');
    const params = { ...effect.params } as Record<string, number | string>;
    for (const key of Object.keys(SCANLINE_FINISH_DEFAULTS)) delete params[key];
    expect(() => assertEffect({ ...effect, params } as EffectInstance)).not.toThrow();
    for (const color of ['red', '#fff', '#12345g', '#11223344', 0])
      expect(() =>
        assertEffect({ ...effect, params: { ...effect.params, color } } as EffectInstance),
      ).toThrow();
    delete params.frequency;
    expect(() => assertEffect({ ...effect, params } as EffectInstance)).toThrow();
  });
  it('accepts legacy image filters without finish controls, without filling their stored recipes', () => {
    for (const type of Object.keys(EFFECT_DEFINITIONS) as EffectType[]) {
      if (type === 'scanlines') continue;
      const effect = createEffect(type, 'legacy-finish');
      const params = { ...effect.params } as Record<string, number | string>;
      for (const key of Object.keys(IMAGE_FINISH_DEFAULTS)) delete params[key];
      const legacy = { ...effect, params } as EffectInstance;
      expect(() => assertEffect(legacy)).not.toThrow();
      expect(legacy.params).toEqual(params);
      for (const key of Object.keys(IMAGE_FINISH_DEFAULTS))
        expect(() =>
          assertEffect({
            ...legacy,
            params: { ...params, [key]: undefined },
          } as unknown as EffectInstance),
        ).toThrow();
      delete params.amount;
      expect(() => assertEffect(legacy)).toThrow();
    }
  });
  it('accepts older distortion recipes without Edge Handling but rejects missing required controls', () => {
    for (const type of ['rgb-split', 'block-corruption', 'wave-distortion'] as const) {
      const effect = createEffect(type, 'legacy');
      const params = { ...effect.params };
      if ('edgeHandling' in params) delete params.edgeHandling;
      expect(() => assertEffect({ ...effect, params } as EffectInstance)).not.toThrow();
      delete (params as Partial<typeof params>).amount;
      expect(() => assertEffect({ ...effect, params } as EffectInstance)).toThrow();
      expect(() =>
        assertEffect({
          ...effect,
          params: { ...effect.params, edgeHandling: undefined },
        } as unknown as EffectInstance),
      ).toThrow();
    }
  });
  it('requires a whole number of kaleidoscope segments', () => {
    const effect = createEffect('kaleidoscope', 'sectors');
    expect(() =>
      assertEffect({ ...effect, params: { ...effect.params, segments: 3.5 } } as EffectInstance),
    ).toThrow();
  });
  it('validates defaults for every effect and rejects unsupported versions and parameters', () => {
    for (const type of Object.keys(EFFECT_DEFINITIONS) as EffectType[]) {
      const effect = createEffect(type, 'a');
      expect(() => assertEffect(effect)).not.toThrow();
      expect(() => assertEffect({ ...effect, version: 2 } as unknown as EffectInstance)).toThrow();
      expect(() => assertEffect({ ...effect, seedOffset: -1 })).toThrow();
      for (const coverage of [-1, 2, NaN, Infinity])
        expect(() =>
          assertEffect({ ...effect, application: { ...effect.application, coverage } }),
        ).toThrow();
      for (const softness of [-1, 2, NaN, Infinity])
        expect(() =>
          assertEffect({ ...effect, application: { ...effect.application, softness } }),
        ).toThrow();
      expect(() =>
        assertEffect({
          ...effect,
          application: { ...effect.application, region: 'invalid' },
        } as unknown as EffectInstance),
      ).toThrow();
      for (const [key, schema] of Object.entries(EFFECT_DEFINITIONS[type].parameters)) {
        for (const value of schema.kind === 'number'
          ? [NaN, Infinity, schema.min - 1, schema.max + 1, '1']
          : schema.kind === 'text'
            ? ['x'.repeat(schema.maxLength + 1), '\0', 0]
            : ['invalid', 0]) {
          expect(() =>
            assertEffect({
              ...effect,
              params: { ...effect.params, [key]: value },
            } as EffectInstance),
          ).toThrow();
        }
      }
      expect(() =>
        assertEffect({
          ...effect,
          params: { ...effect.params, unknown: 1 },
        } as unknown as EffectInstance),
      ).toThrow();
    }
  });
});
