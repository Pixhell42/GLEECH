import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  assertPresetRecipe,
  createEffect,
  isBuiltinShader,
  type EffectInstance,
  type EffectType,
  type ReferenceShaderEffect,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const types = [
  'cel-shading',
  'shader-signal-collapse',
  'shader-paint-flow',
  'shader-billowing-smoke',
] as const;
const width = 73,
  height = 57;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3
    ? [0, 80, 160, 255][Math.floor(i / 4) % 4]!
    : (i * 37 + Math.floor(i / 292) * 17) % 256,
);
const image = { width, height, pixels: pixels.buffer };
const effect = (type: EffectType, params: Record<string, string | number> = {}) => {
  const e = createEffect(type, 'creative-suite');
  return { ...e, params: { ...e.params, ...params } } as EffectInstance;
};
const render = (e: EffectInstance) =>
  new Uint8Array(renderEffects(image, [e], { masterSeed: 8172 }).pixels);
describe('illustration and organic shader suite', () => {
  it('both ribbon controls visibly affect isolated source sampling', () => {
    const base = { collapse: 0, static: 0, dropout: 0, colorMix: 0, strength: 1 };
    expect(
      render(effect('shader-signal-collapse', { ...base, stretch: 1, ribbons: 1 })),
    ).not.toEqual(render(effect('shader-signal-collapse', { ...base, stretch: 0, ribbons: 1 })));
    expect(
      render(effect('shader-signal-collapse', { ...base, stretch: 1, ribbons: 0.61 })),
    ).not.toEqual(render(effect('shader-signal-collapse', { ...base, stretch: 1, ribbons: 0.6 })));
  });
  it('smoke Phase produces local eddy deformation and responds to both curl controls', () => {
    const moving = render(
      effect('shader-billowing-smoke', { phase: 0.25, eddyStrength: 1, eddyScale: 2 }),
    );
    expect(moving).not.toEqual(
      render(effect('shader-billowing-smoke', { phase: 0.25, eddyStrength: 0, eddyScale: 2 })),
    );
    expect(moving).not.toEqual(
      render(effect('shader-billowing-smoke', { phase: 0.25, eddyStrength: 1, eddyScale: 0.8 })),
    );
    expect(render(effect('shader-billowing-smoke', { phase: 1 }))).toEqual(
      render(effect('shader-billowing-smoke', { phase: 0 })),
    );
  });
  it('paint color variation is seeded, independent of viscosity and works in both modes', () => {
    for (const paintStyle of ['splatter', 'liquid']) {
      const params = { paintStyle, colorMix: 1, sourceMix: 0 };
      const uniform = render(effect('shader-paint-flow', { ...params, colorVariation: 0 }));
      const varied = render(effect('shader-paint-flow', { ...params, colorVariation: 1 }));
      expect(varied).not.toEqual(uniform);
      expect(render(effect('shader-paint-flow', { ...params, colorVariation: 1 }))).toEqual(varied);
      expect(render(effect('shader-paint-flow', { ...params, viscosity: 0 }))).not.toEqual(
        render(effect('shader-paint-flow', { ...params, viscosity: 1 })),
      );
    }
  });
  it.each(['shader-paint-flow', 'shader-billowing-smoke'] as const)(
    '%s keeps saved recipes without the new controls usable',
    (type) => {
      const e = effect(type, { phase: 0.23 }) as ReferenceShaderEffect;
      const params = Object.fromEntries(
        Object.entries(e.params).filter(
          ([key]) => !['colorVariation', 'eddyStrength', 'eddyScale'].includes(key),
        ),
      );
      const legacy = { ...e, params } as ReferenceShaderEffect;
      assertEffect(legacy);
      expect(render(legacy)).toEqual(render(e));
      assertPresetRecipe({ schemaVersion: 1, masterSeed: 8172, effects: [legacy] });
    },
  );
  it.each(types)(
    '%s has portable controls, deterministic output and standard finishing',
    (type) => {
      const e = effect(type),
        original = render(e);
      assertEffect(e);
      expect(original).not.toEqual(pixels);
      expect(render(e)).toEqual(original);
      expect(render(effect(type, { amount: 0 }))).toEqual(pixels);
      expect(render({ ...e, enabled: false })).toEqual(pixels);
      expect(render({ ...e, application: { ...e.application, coverage: 0 } })).toEqual(pixels);
      expect(render(effect(type, { blendMode: 'color-dodge' }))).not.toEqual(original);
      expect(
        render(effect(type, { tintEnabled: 'on', tintStrength: 1, color: '#ff2200' })),
      ).not.toEqual(original);
      const recipe = JSON.parse(
        JSON.stringify({ schemaVersion: 1, masterSeed: 8172, effects: [e] }),
      );
      assertPresetRecipe(recipe);
      expect(render(recipe.effects[0]!)).toEqual(original);
      if (isBuiltinShader(e)) {
        expect(render(effect(type, { strength: 0 }))).toEqual(pixels);
        expect(render(effect(type, { phase: 0.23 }))).not.toEqual(original);
        expect(render(effect(type, { phase: 1 }))).toEqual(original);
        expect(render({ ...e, seedOffset: 1 })).not.toEqual(original);
      }
    },
  );
  it.each([
    [
      'cel-shading',
      {
        shadeBands: 8,
        colorBands: 3,
        smoothing: 1.5,
        contrast: 0.8,
        saturation: 0,
        outlineWidth: 2,
        outlineThreshold: 0.8,
        outlineStrength: 0,
        outlineColor: '#ff0000',
      },
    ],
    [
      'shader-signal-collapse',
      {
        collapse: 0,
        stretch: 0,
        static: 0,
        dropout: 0.6,
        ribbons: 0,
        scale: 7,
        phase: 0.3,
        rotation: 30,
        colorMix: 0,
        patternColor: '#ffff00',
        backgroundColor: '#aaaaaa',
      },
    ],
    [
      'shader-paint-flow',
      {
        paintStyle: 'liquid',
        density: 0.3,
        radius: 0.8,
        travel: 30,
        viscosity: 0.1,
        sourceMix: 0.2,
        colorMix: 1,
        scale: 5,
        rotation: 30,
        phase: 0.3,
        patternColor: '#00eeff',
        backgroundColor: '#aaaaaa',
      },
    ],
    [
      'shader-billowing-smoke',
      {
        density: 0.3,
        turbulence: 0,
        volume: 0.2,
        light: 0,
        softness: 0.1,
        smokeLayers: 2,
        scale: 2,
        rotation: 30,
        phase: 0.3,
        colorMix: 0,
        patternColor: '#ff4400',
        backgroundColor: '#555555',
      },
    ],
  ] as const)('%s controls independently affect its rendered construction', (type, changes) => {
    for (const [key, value] of Object.entries(changes)) {
      const active =
        type === 'cel-shading' && key.startsWith('outline')
          ? { outlineWidth: 1, outlineThreshold: 0.03 }
          : type === 'shader-paint-flow' && key === 'patternColor'
            ? { colorMix: 1 }
            : {};
      const original = render(effect(type, active));
      expect(render(effect(type, { ...active, [key]: value })), key).not.toEqual(original);
    }
  });
  it('paint modes are distinct and Phase and New pattern work in each mode', () => {
    const splatter = render(effect('shader-paint-flow'));
    const liquid = effect('shader-paint-flow', { paintStyle: 'liquid' });
    expect(render(liquid)).not.toEqual(splatter);
    for (const mode of ['splatter', 'liquid']) {
      const e = effect('shader-paint-flow', { paintStyle: mode });
      expect(render({ ...e, seedOffset: 1 })).not.toEqual(render(e));
      expect(render(effect('shader-paint-flow', { paintStyle: mode, phase: 0.23 }))).not.toEqual(
        render(e),
      );
      expect(render(effect('shader-paint-flow', { paintStyle: mode, phase: 1 }))).toEqual(
        render(e),
      );
    }
  });
  it('Cel Shading preserves alpha and supplies flat steps without ink or smoothing', () => {
    const e = effect('cel-shading', { smoothing: 0, outlineStrength: 0, colorBands: 4 });
    const bytes = render(e);
    for (let i = 0; i < bytes.length; i += 4) {
      expect(bytes[i + 3]).toBe(pixels[i + 3]);
      for (let k = 0; k < 3; k++) expect([0, 85, 170, 255]).toContain(bytes[i + k]);
    }
    expect(render({ ...e, seedOffset: 1 })).toEqual(bytes);
  });
  it('Smoke Canvas supports both the source silhouette and opaque generation', () => {
    const preserved = render(effect('shader-billowing-smoke', { strength: 1 }));
    const opaque = render(effect('shader-billowing-smoke', { strength: 1, alpha: 'opaque' }));
    for (let i = 3; i < opaque.length; i += 4) {
      expect(preserved[i]).toBe(pixels[i]);
      expect(opaque[i]).toBe(255);
    }
    expect(render(effect('shader-billowing-smoke', { volume: 0 }))).not.toEqual(preserved);
  });
  it.each(types)('%s supports asynchronous rendering and bounded cancellation', async (type) => {
    const e = effect(type);
    const result = await renderEffectsAsync(image, [e], {
      masterSeed: 8172,
      yieldControl: async () => {},
    });
    expect(new Uint8Array(result.pixels)).toEqual(render(e));
    let polls = 0;
    await expect(
      renderEffectsAsync(image, [e], {
        isCancelled: () => ++polls > 4,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
