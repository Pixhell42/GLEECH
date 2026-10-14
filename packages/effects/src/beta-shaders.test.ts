import { describe, expect, it } from 'vitest';
import {
  BETA_SHADER_TYPES,
  BETA_REFRACTION_TYPES,
  createEffect,
  assertEffect,
  assertPresetRecipe,
  getEffectDefinition,
  type BetaShaderEffect,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const width = 43,
  height = 31;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : (i * 37) % 256,
);
const image = { width, height, pixels: pixels.buffer };
const effect = (
  type: (typeof BETA_SHADER_TYPES)[number],
  params: Partial<BetaShaderEffect['params']> = {},
) => {
  const base = createEffect(type, 'beta-shader') as BetaShaderEffect;
  return { ...base, params: { ...base.params, ...params } };
};
const render = (e: BetaShaderEffect) =>
  new Uint8Array(renderEffects(image, [e], { masterSeed: 8172 }).pixels);
describe('beta original geometric/glitch shaders', () => {
  it.each(BETA_SHADER_TYPES)('%s is deterministic, neutral and loops exactly', (type) => {
    const e = effect(type),
      original = render(e);
    assertEffect(e);
    expect(render(e)).toEqual(original);
    expect(original).not.toEqual(pixels);
    expect(render(effect(type, { strength: 0 }))).toEqual(pixels);
    expect(render(effect(type, { amount: 0 }))).toEqual(pixels);
    expect(render(effect(type, { phase: 1 }))).toEqual(original);
    expect(render(effect(type, { phase: 0.27 }))).not.toEqual(original);
    expect(render({ ...e, seedOffset: 1 })).not.toEqual(original);
    if (!BETA_REFRACTION_TYPES.includes(type))
      for (let i = 3; i < original.length; i += 4) expect(original[i]).toBe(pixels[i]);
  });
  it.each(BETA_SHADER_TYPES)('%s exposes meaningful variants and numeric controls', (type) => {
    const e = effect(type),
      initial = render(e);
    for (const variant of ['second', 'third'] as const)
      expect(render(effect(type, { variant }))).not.toEqual(initial);
    const definitions = getEffectDefinition(e).parameters;
    for (const key of [
      'structure',
      'accent',
      'rotation',
      'scale',
      'centerX',
      'centerY',
      'colorMix',
    ]) {
      const control = definitions[key]!;
      if (control.kind !== 'number') throw new Error('Expected numeric shader control');
      const value =
        key === 'structure' && control.unit === 'count'
          ? control.max
          : key === 'rotation'
            ? 45
            : key === 'scale'
              ? 2
              : key.startsWith('center')
                ? 30
                : control.default === control.min
                  ? control.max
                  : control.min;
      expect(render(effect(type, { [key]: value })), type + ':' + key).not.toEqual(initial);
    }
  });
  it.each(BETA_SHADER_TYPES)('%s retains portable recipe values', (type) => {
    const e = effect(type, {
      phase: 0.3,
      variant: 'third',
      patternColor: '#ff8800',
      backgroundColor: '#081030',
    });
    const recipe = { schemaVersion: 1 as const, masterSeed: 8172, effects: [e] };
    assertPresetRecipe(JSON.parse(JSON.stringify(recipe)));
    expect(render(JSON.parse(JSON.stringify(e)))).toEqual(render(e));
  });
  it('can cancel a costly diffraction fallback', async () => {
    let polls = 0;
    await expect(
      renderEffectsAsync(image, [effect('shader-diffraction', { structure: 12 })], {
        yieldControl: async () => {},
        isCancelled: () => ++polls > 3,
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
