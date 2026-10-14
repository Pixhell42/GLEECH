import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  assertPresetRecipe,
  createEffect,
  getEffectDefinition,
  isShaderEffect,
  supportsHeightField,
  supportsSeedVariation,
  type EffectInstance,
  type EffectType,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
const types = [
  'shader-liquid-marbling',
  'shader-truchet-mosaic',
  'shader-microculture',
  'shader-prismatic-panels',
  'pixel-stretch',
  'led-matrix',
] as const;
const width = 73,
  height = 55;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : (i * 13 + Math.floor(i / 4) * 7) % 251,
);
const image = { width, height, pixels: pixels.buffer };
function effect(type: EffectType, params: Readonly<Record<string, number | string>> = {}) {
  const e = createEffect(type, 'set2');
  return { ...e, params: { ...e.params, ...params } } as EffectInstance;
}
const render = (e: EffectInstance) =>
  new Uint8Array(renderEffects(image, [e], { masterSeed: 8172 }).pixels);
describe('Set 2 first batch', () => {
  it.each(types)('%s is deterministic, editable, portable and neutral when disabled', (type) => {
    const e = effect(type),
      actual = render(e);
    assertEffect(e);
    expect(actual).not.toEqual(pixels);
    expect(render(e)).toEqual(actual);
    expect(render(effect(type, { amount: 0 }))).toEqual(pixels);
    expect(render({ ...e, enabled: false })).toEqual(pixels);
    assertPresetRecipe(
      JSON.parse(JSON.stringify({ schemaVersion: 1, masterSeed: 8172, effects: [e] })),
    );
    expect(render(JSON.parse(JSON.stringify(e)))).toEqual(actual);
    expect(() => assertEffect(effect(type, { amount: Infinity }))).toThrow();
    for (const control of Object.values(getEffectDefinition(e).parameters))
      expect(control.description.length).toBeGreaterThan(5);
  });
  it.each(types)('%s supports meaningful frozen Phase and New Pattern', (type) => {
    const e = effect(type),
      actual = render(e);
    expect(supportsSeedVariation(e)).toBe(true);
    expect(render(effect(type, { phase: 1 }))).toEqual(actual);
    expect(render(effect(type, { phase: 0.23 }))).not.toEqual(actual);
    expect(render({ ...e, seedOffset: 1 })).not.toEqual(actual);
  });
  it.each(types)('%s respects common masks and finishing', (type) => {
    const e = effect(type);
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
    expect(render(effect(type, { blendMode: 'screen' }))).not.toEqual(render(e));
    expect(
      render(effect(type, { tintEnabled: 'on', tintStrength: 1, color: '#ff2200' })),
    ).not.toEqual(render(e));
  });
  it.each(types)('%s has equivalent async results and bounded cancellation', async (type) => {
    const e = effect(type);
    expect(
      new Uint8Array(
        (
          await renderEffectsAsync(image, [e], {
            masterSeed: 8172,
            yieldControl: async () => {},
          })
        ).pixels,
      ),
    ).toEqual(render(e));
    let checks = 0;
    await expect(
      renderEffectsAsync(image, [e], {
        isCancelled: () => ++checks > 10,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(checks).toBe(11);
  });
  it.each(types.slice(0, 4))('%s is a built-in shader and has neutral strength', (type) => {
    expect(isShaderEffect(effect(type))).toBe(true);
    expect(render(effect(type, { strength: 0 }))).toEqual(pixels);
    const opaque = render(effect(type, { alpha: 'opaque', strength: 1 }));
    for (let i = 3; i < opaque.length; i += 4) expect(opaque[i]).toBe(255);
  });
  it.each([
    ['shader-liquid-marbling', 'style', 'ink'],
    ['shader-liquid-marbling', 'swirl', 0.1],
    ['shader-liquid-marbling', 'bands', 19],
    ['shader-liquid-marbling', 'sharpness', 0.1],
    ['shader-liquid-marbling', 'travel', 25],
    ['shader-liquid-marbling', 'colorMix', 0],
    ['shader-liquid-marbling', 'sourceMix', 0.9],
    ['shader-truchet-mosaic', 'style', 'arcs'],
    ['shader-truchet-mosaic', 'style', 'dots'],
    ['shader-truchet-mosaic', 'arcWidth', 0.35],
    ['shader-truchet-mosaic', 'dotSize', 0.4],
    ['shader-truchet-mosaic', 'dotDensity', 0.9],
    ['shader-truchet-mosaic', 'grid', 1],
    ['shader-truchet-mosaic', 'sourceMix', 0.9],
    ['shader-microculture', 'style', 'colonies'],
    ['shader-microculture', 'radius', 0.7],
    ['shader-microculture', 'membrane', 0.4],
    ['shader-microculture', 'granules', 1],
    ['shader-microculture', 'clustering', 0],
    ['shader-microculture', 'sourceMix', 0.9],
    ['shader-prismatic-panels', 'style', 'pastel'],
    ['shader-prismatic-panels', 'widthVariation', 0],
    ['shader-prismatic-panels', 'refraction', 20],
    ['shader-prismatic-panels', 'edgeWidth', 0.3],
    ['shader-prismatic-panels', 'iridescence', 0],
    ['shader-prismatic-panels', 'softness', 1],
    ['shader-prismatic-panels', 'sourceMix', 0],
    ['pixel-stretch', 'style', 'bands'],
    ['pixel-stretch', 'style', 'radial'],
    ['pixel-stretch', 'axis', 'horizontal'],
    ['pixel-stretch', 'length', 65],
    ['pixel-stretch', 'stripWidth', 9],
    ['pixel-stretch', 'density', 1],
    ['pixel-stretch', 'threshold', 0.6],
    ['pixel-stretch', 'softness', 1],
    ['led-matrix', 'cellSize', 8],
    ['led-matrix', 'shape', 'square'],
    ['led-matrix', 'shape', 'ring'],
    ['led-matrix', 'gap', 0.8],
    ['led-matrix', 'brightness', 2],
    ['led-matrix', 'glow', 0],
    ['led-matrix', 'deadCells', 0.7],
    ['led-matrix', 'rotation', 39],
    ['led-matrix', 'coloring', 'chosen'],
  ] as const)('%s %s independently changes the treatment', (type, key, value) => {
    expect(render(effect(type, { [key]: value }))).not.toEqual(render(effect(type)));
  });
  it('preserves rows/columns along the unstretched axis and rejects dark anchors', () => {
    const w = 19,
      h = 17,
      bytes = Uint8Array.from({ length: w * h * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (Math.floor(i / 4) % w) * 12,
      );
    const src = { width: w, height: h, pixels: bytes.buffer };
    const e = effect('pixel-stretch', {
      style: 'bands',
      axis: 'vertical',
      density: 1,
      length: 100,
    });
    expect(new Uint8Array(renderEffects(src, [e], { masterSeed: 17 }).pixels)).toEqual(bytes);
    expect(
      new Uint8Array(
        renderEffects(
          src,
          [
            effect('pixel-stretch', {
              style: 'bands',
              axis: 'horizontal',
              density: 1,
              length: 100,
            }),
          ],
          { masterSeed: 17 },
        ).pixels,
      ),
    ).not.toEqual(bytes);
    expect(render(effect('pixel-stretch', { length: 0 }))).toEqual(pixels);
    expect(render(effect('pixel-stretch', { density: 0 }))).toEqual(pixels);
    expect(render(effect('pixel-stretch', { threshold: 1 }))).toEqual(pixels);
  });
  it('keeps original transparency for the LED display and removes every light at full failure', () => {
    const actual = render(effect('led-matrix', { deadCells: 1, backgroundColor: '#000000' }));
    for (let i = 0; i < actual.length; i += 4) {
      expect([...actual.subarray(i, i + 3)]).toEqual([0, 0, 0]);
      expect(actual[i + 3]).toBe(pixels[i + 3]);
    }
    expect(
      render(
        effect('led-matrix', {
          coloring: 'chosen',
          ledColorMode: 'gradient',
          ledColorEnd: '#33ffff',
        }),
      ),
    ).not.toEqual(render(effect('led-matrix', { coloring: 'chosen' })));
  });
  it('allows Liquid Marbling to share imported/procedural height fields', () => {
    expect(supportsHeightField(effect('shader-liquid-marbling'))).toBe(true);
    expect(render(effect('shader-liquid-marbling', { fieldSource: 'perlin' }))).not.toEqual(
      render(effect('shader-liquid-marbling')),
    );
    expect(render(effect('shader-liquid-marbling', { fieldInvert: 'on' }))).not.toEqual(
      render(effect('shader-liquid-marbling')),
    );
  });
});
