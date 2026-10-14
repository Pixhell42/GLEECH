import { describe, expect, it } from 'vitest';
import {
  ADVANCED_SHADER_TYPES,
  ADVANCED_SHADER_SPECS,
  SET2_EXTENSION_PARAMETERS,
  assertEffect,
  assertPresetRecipe,
  createEffect,
  getEffectDefinition,
  supportsSeedVariation,
  type EffectInstance,
  type EffectType,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const types = [...ADVANCED_SHADER_TYPES, 'granular-echo', 'pigment-drag'] as const;
const width = 41,
  height = 31;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : (i * 13 + Math.floor(i / 4) * 7) % 251,
);
const image = { width, height, pixels: pixels.buffer };
function effect(type: EffectType, params: Readonly<Record<string, number | string>> = {}) {
  const e = createEffect(type, 'completion');
  return { ...e, params: { ...e.params, ...params } } as EffectInstance;
}
const render = (e: EffectInstance) =>
  new Uint8Array(renderEffects(image, [e], { masterSeed: 8172 }).pixels);

describe('Set 2 completed collection', () => {
  it.each(ADVANCED_SHADER_TYPES)(
    '%s exposes meaningful independent material and geometry controls',
    (type) => {
      const defaults = effect(type),
        params = 'objects' in defaults.params ? { objects: 'on' } : {};
      const base = effect(type, params),
        actual = render(base);
      for (const [key, control] of Object.entries(ADVANCED_SHADER_SPECS[type]!.controls)) {
        if (key === 'objects') continue;
        const alternatives =
          control.kind === 'number'
            ? [control.min, control.max]
            : control.kind === 'choice'
              ? control.options.map((o) => o.value)
              : [];
        expect(
          alternatives.some(
            (value) =>
              value !== base.params[key as keyof typeof base.params] &&
              !render(effect(type, { ...params, [key]: value })).every((n, i) => n === actual[i]),
          ),
          `${type}:${key}`,
        ).toBe(true);
      }
    },
  );
  it.each(types)('%s is deterministic, portable, maskable and neutral when disabled', (type) => {
    const e = effect(type),
      actual = render(e);
    assertEffect(e);
    expect(actual).not.toEqual(pixels);
    expect(render(e)).toEqual(actual);
    expect(render(effect(type, { amount: 0 }))).toEqual(pixels);
    expect(render({ ...e, enabled: false })).toEqual(pixels);
    expect(render({ ...e, application: { ...e.application, coverage: 0 } })).toEqual(pixels);
    expect(
      render({
        ...e,
        paintedMask: {
          version: 1,
          enabled: true,
          inverted: false,
          width,
          height,
          base: 0,
          strokes: [],
        },
      }),
    ).toEqual(pixels);
    expect(render(effect(type, { blendMode: 'screen' }))).not.toEqual(actual);
    expect(
      render(effect(type, { tintEnabled: 'on', tintStrength: 1, color: '#ff2200' })),
    ).not.toEqual(actual);
    for (let i = 3; i < actual.length; i += 4) expect(actual[i]).toBe(pixels[i]);
    const recipe = JSON.parse(JSON.stringify({ schemaVersion: 1, masterSeed: 8172, effects: [e] }));
    assertPresetRecipe(recipe);
    expect(render(recipe.effects[0]!)).toEqual(actual);
    for (const control of Object.values(getEffectDefinition(e).parameters))
      expect(control.description.length).toBeGreaterThan(5);
  });
  it.each(types)('%s has meaningful Phase and New Pattern', (type) => {
    const e = effect(type),
      actual = render(e);
    expect(supportsSeedVariation(e)).toBe(true);
    expect(render(effect(type, { phase: 1 }))).toEqual(actual);
    expect(render(effect(type, { phase: 0.23 }))).not.toEqual(actual);
    expect(render({ ...e, seedOffset: 1 })).not.toEqual(actual);
  });
  it.each(types)('%s matches asynchronous rendering and supports cancellation', async (type) => {
    const e = effect(type);
    expect(
      new Uint8Array(
        (await renderEffectsAsync(image, [e], { masterSeed: 8172, yieldControl: async () => {} }))
          .pixels,
      ),
    ).toEqual(render(e));
    let checks = 0;
    await expect(
      renderEffectsAsync(image, [e], {
        isCancelled: () => ++checks > 10,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
  it.each(ADVANCED_SHADER_TYPES)('%s supports neutral intensity and canvas fill', (type) => {
    expect(render(effect(type, { strength: 0 }))).toEqual(pixels);
    const opaque = render(effect(type, { alpha: 'opaque', strength: 1 }));
    for (let i = 3; i < opaque.length; i += 4) expect(opaque[i]).toBe(255);
  });
  it.each([
    'shader-signal-orb',
    'shader-hatched-solids',
    'shader-mandelbrot-slices',
    'shader-liquid-foil',
  ] as const)('%s projects by default and offers independent geometry', (type) => {
    const e = effect(type);
    expect('objects' in e.params && e.params.objects).toBe('off');
    expect(render(effect(type, { objects: 'on' }))).not.toEqual(render(effect(type)));
    expect(render(effect(type, { objects: 'on', rotation: 35 }))).not.toEqual(
      render(effect(type, { objects: 'on' })),
    );
  });
  it.each(['sphere', 'cube', 'cylinder', 'cone'] as const)(
    'Hatched Solids renders distinct %s geometry',
    (primitive) => {
      expect(
        render(effect('shader-hatched-solids', { objects: 'on', primitive, objectCount: 4 })),
      ).not.toEqual(
        render(effect('shader-hatched-solids', { objects: 'off', primitive, objectCount: 4 })),
      );
    },
  );
  it.each(['torus', 'rings'] as const)('Liquid Foil renders distinct %s forms', (geometry) => {
    expect(render(effect('shader-liquid-foil', { objects: 'on', geometry }))).not.toEqual(
      render(effect('shader-liquid-foil', { objects: 'on', geometry: 'sphere' })),
    );
  });
  it.each(Object.keys(SET2_EXTENSION_PARAMETERS) as EffectType[])(
    '%s preserves older recipes with omitted extension controls',
    (type) => {
      const e = effect(type),
        params = { ...e.params } as Record<string, number | string>;
      for (const key of Object.keys(SET2_EXTENSION_PARAMETERS[type]!)) {
        delete params[key];
        for (const name of Object.keys(params))
          if (name.startsWith(key) && name !== key) delete params[name];
      }
      const old = { ...e, params } as EffectInstance;
      assertEffect(old);
      expect(render(old)).toEqual(render(e));
    },
  );
  it.each([
    ['system-crash', { annotations: 'on' }],
    ['system-crash', { annotations: 'on', annotationLabels: 'off', overlayFrames: 'off' }],
    ['terminal-wireframe', { traceStyle: 'circuit' }],
    ['contour-waves', { breakup: 0.6, tearStrength: 6 }],
    ['block-corruption', { replacement: 'checker' }],
    ['block-corruption', { replacement: 'noise' }],
    ['pixel-stretch', { protectedRadius: 60 }],
    ['led-matrix', { brightnessSource: 'pattern' }],
    ['shader-microculture', { lens: 1 }],
    ['shader-signal-collapse', { treatment: 'slabs' }],
    ['shader-signal-collapse', { treatment: 'eroded' }],
    ['shader-diffraction', { treatment: 'projector' }],
  ] as const)('%s has meaningful optional treatments', (type, params) => {
    expect(render(effect(type, params))).not.toEqual(render(effect(type)));
  });
  it('keeps source imagery intact inside the protected center', () => {
    const actual = render(
      effect('pixel-stretch', { protectedRadius: 60, originX: 50, originY: 50 }),
    );
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) > height * 0.6) continue;
        const i = (y * width + x) * 4;
        expect(actual.subarray(i, i + 4)).toEqual(pixels.subarray(i, i + 4));
      }
  });
  it('lets annotations change without changing glitch controls', () => {
    const base = effect('system-crash', {
      annotations: 'on',
      annotationLabels: 'on',
      anchorDensity: 1,
    });
    expect(render(effect('system-crash', { ...base.params, labelText: 'AAAA' }))).not.toEqual(
      render(effect('system-crash', { ...base.params, labelText: 'BBBB' })),
    );
  });
  it('varies Contour Waves when breakup/tears are active without changing its smooth default', () => {
    const base = effect('contour-waves');
    expect(supportsSeedVariation(base)).toBe(false);
    expect(render({ ...base, seedOffset: 1 })).toEqual(render(base));
    const variations: readonly Readonly<Record<string, number>>[] = [
      { breakup: 0.6 },
      { tearStrength: 6 },
    ];
    for (const params of variations) {
      const active = effect('contour-waves', params);
      expect(supportsSeedVariation(active)).toBe(true);
      expect(render({ ...active, seedOffset: 1 })).not.toEqual(render(active));
    }
  });
  it('changes LED pattern frequency without requiring source brightness', () => {
    expect(
      render(effect('led-matrix', { brightnessSource: 'pattern', patternFrequency: 2 })),
    ).not.toEqual(
      render(effect('led-matrix', { brightnessSource: 'pattern', patternFrequency: 17 })),
    );
  });
});
