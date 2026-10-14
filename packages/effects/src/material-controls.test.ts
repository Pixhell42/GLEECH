import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  assertPresetRecipe,
  createEffect,
  type EffectType,
  type EffectInstance,
} from '@gleech/project-model';
import { renderEffects } from './index';

const width = 83,
  height = 61;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : (i * 13 + Math.floor(i / 4) * 7) % 251,
);
const image = { width, height, pixels: pixels.buffer };
function effect(type: EffectType, params: Record<string, number | string> = {}) {
  const base = createEffect(type, 'material-controls');
  return { ...base, params: { ...base.params, ...params } } as EffectInstance;
}
function render(e: EffectInstance) {
  return new Uint8Array(renderEffects(image, [e], { masterSeed: 8172 }).pixels);
}
function changed(a: Uint8Array, b: Uint8Array) {
  return a.filter((v, i) => i % 4 !== 3 && Math.abs(v - b[i]!) > 8).length / (width * height * 3);
}
describe('material control usability', () => {
  it.each(['shader-contour-melt', 'shader-filament-flow'] as const)(
    '%s hue changes visible source and material colors',
    (type) => {
      const base = render(effect(type));
      expect(changed(base, render(effect(type, { hue: 120 })))).toBeGreaterThan(0.03);
    },
  );
  it('Facet Mandala scale changes its radial footprint', () => {
    expect(
      changed(
        render(effect('shader-facet-mandala', { scale: 1 })),
        render(effect('shader-facet-mandala', { scale: 6 })),
      ),
    ).toBeGreaterThan(0.1);
  });
  it('Hatched Solids phase visibly moves projected hatching and optional geometry', () => {
    for (const objects of ['off', 'on']) {
      const base = effect('shader-hatched-solids', { objects, phase: 0 });
      expect(
        changed(render(base), render(effect('shader-hatched-solids', { objects, phase: 0.23 }))),
      ).toBeGreaterThan(0.025);
      expect(render(effect('shader-hatched-solids', { objects, phase: 1 }))).toEqual(render(base));
    }
  });
  it.each(['scatterX', 'scatterY'])('Hatched Solids supports independent %s separation', (key) => {
    expect(
      changed(
        render(effect('shader-hatched-solids', { objects: 'on', [key]: 0 })),
        render(effect('shader-hatched-solids', { objects: 'on', [key]: 2 })),
      ),
    ).toBeGreaterThan(0.02);
  });
  it('Mandelbrot flat slices and boundary extent affect the visible result', () => {
    const base = render(effect('shader-mandelbrot-slices'));
    expect(
      changed(base, render(effect('shader-mandelbrot-slices', { sliceIndex: 3 }))),
    ).toBeGreaterThan(0.01);
    expect(
      changed(base, render(effect('shader-mandelbrot-slices', { boundary: 0.1 }))),
    ).toBeGreaterThan(0.03);
  });
  it('the selected flat slice matches a single head-on 3D slice', () => {
    const p = {
      sliceIndex: 3,
      cameraYaw: 0,
      cameraPitch: 0,
      slices: 1,
      phase: 0,
      sourceMix: 0,
      imageWarp: 0,
    };
    const flat = render(effect('shader-mandelbrot-slices', { ...p, objects: 'off' }));
    const slab = render(effect('shader-mandelbrot-slices', { ...p, objects: 'on' }));
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (
          Math.abs((x + 0.5 - width / 2) / height) > 0.4 ||
          Math.abs((y + 0.5 - height / 2) / height) > 0.4
        )
          continue;
        const i = (y * width + x) * 4;
        for (let ch = 0; ch < 4; ch++)
          expect(Math.abs(flat[i + ch]! - slab[i + ch]!)).toBeLessThanOrEqual(1);
      }
  });
  it.each(['random', 'grid', 'horizontal', 'vertical'] as const)(
    'System Crash %s responds independently to both spread controls',
    (windowPlacement) => {
      for (const axis of ['windowSpreadX', 'windowSpreadY']) {
        const p = { windowPlacement, textDensity: 0, windowCount: 6, windowSize: 16 };
        expect(
          changed(
            render(effect('system-crash', { ...p, [axis]: 0 })),
            render(effect('system-crash', { ...p, [axis]: 100 })),
          ),
        ).toBeGreaterThan(0.015);
      }
    },
  );
  it.each(['random', 'grid', 'horizontal', 'vertical'] as const)(
    'System Crash %s windows can move independently of diagnostic text',
    (windowPlacement) => {
      const p = { windowPlacement, textDensity: 0, windowCount: 8 };
      expect(
        changed(
          render(effect('system-crash', p)),
          render(effect('system-crash', { ...p, windowCenterX: 20, windowSpreadY: 10 })),
        ),
      ).toBeGreaterThan(0.03);
    },
  );
  it.each([
    ['shader-contour-melt', ['hue']],
    ['shader-filament-flow', ['hue']],
    ['shader-hatched-solids', ['scatterX', 'scatterY']],
    ['shader-mandelbrot-slices', ['sliceIndex']],
    [
      'system-crash',
      ['windowPlacement', 'windowSpreadX', 'windowSpreadY', 'windowCenterX', 'windowCenterY'],
    ],
  ] as const)('%s loads previous recipes without the new optional controls', (type, keys) => {
    const e = effect(type),
      params = { ...e.params } as Record<string, number | string>;
    keys.forEach((key) => delete params[key]);
    const legacy = { ...e, params } as EffectInstance;
    assertEffect(legacy);
    assertPresetRecipe({ schemaVersion: 1, masterSeed: 8172, effects: [legacy] });
    expect(render(legacy)).toEqual(render(e));
  });
});
