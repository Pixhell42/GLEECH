import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  assertPresetRecipe,
  createEffect,
  effectsNeedSubject,
  getEffectDefinition,
  isShaderEffect,
  supportsHeightField,
  supportsLayerImage,
  type EffectInstance,
  type EffectType,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
const types = [
  'shader-chromatic-erosion',
  'shader-radial-extrusion',
  'shader-cellular-mesh',
  'shader-particle-burst',
  'shader-spectral-terrain',
  'shader-neon-edges',
  'shader-wire-ghost',
  'shader-prismatic-shatter',
  'shader-bloom-field',
  'window-fragments',
  'contour-waves',
  'pixel-dissolve',
  'neon-print',
  'system-crash',
  'terminal-wireframe',
  'signal-weave',
  'data-weave',
  'micro-collage',
] as const;
const width = 71,
  height = 53;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3
    ? [0, 64, 128, 255][Math.floor(i / 4) % 4]!
    : Math.floor((Math.sin((Math.floor(i / 4) / 71) * 3 + (i % 4)) * 0.5 + 0.5) * 255),
);
const image = { width, height, pixels: pixels.buffer };
const effect = (type: EffectType, params: Readonly<Record<string, string | number>> = {}) => {
  const e = createEffect(type, 'reference');
  return { ...e, params: { ...e.params, ...params } } as EffectInstance;
};
const render = (e: EffectInstance) =>
  new Uint8Array(renderEffects(image, [e], { masterSeed: 8172 }).pixels);
describe('reference collection', () => {
  it.each(types)('%s is editable, deterministic, portable and neutral at zero opacity', (type) => {
    const e = effect(type),
      actual = render(e);
    assertEffect(e);
    expect(render(e)).toEqual(actual);
    expect(actual).not.toEqual(pixels);
    expect(render(effect(type, { amount: 0 }))).toEqual(pixels);
    expect(render({ ...e, enabled: false })).toEqual(pixels);
    if (getEffectDefinition(e).parameters.phase)
      expect(render(effect(type, { phase: 1 }))).toEqual(actual);
    const recipe = { schemaVersion: 1, masterSeed: 8172, effects: [e] };
    assertPresetRecipe(JSON.parse(JSON.stringify(recipe)));
    expect(render(JSON.parse(JSON.stringify(e)))).toEqual(actual);
    expect(effectsNeedSubject([e])).toBe(false);
    for (const control of Object.values(getEffectDefinition(e).parameters))
      expect(control.description.length).toBeGreaterThan(5);
  });
  it.each(types)('%s participates in masks, common finishing, and history', (type) => {
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
  it.each(types.filter((type) => type.startsWith('shader-')))(
    '%s is a real built-in shader with a neutral intensity',
    (type) => {
      expect(isShaderEffect(effect(type))).toBe(true);
      expect(render(effect(type, { strength: 0 }))).toEqual(pixels);
      expect(render(effect(type, { phase: 0.23 }))).not.toEqual(render(effect(type)));
      expect(render({ ...effect(type), seedOffset: 1 })).not.toEqual(render(effect(type)));
    },
  );
  it.each([
    [
      'shader-neon-edges',
      { edgeWidth: 1, glow: 0, darkness: 0.2, phase: 0.3, rotation: 35, colorMix: 0 },
    ],
    [
      'shader-wire-ghost',
      {
        edgeWidth: 1,
        trails: 2,
        travel: 20,
        disruption: 0.8,
        glow: 1,
        phase: 0.3,
        rotation: 35,
        colorMix: 0,
      },
    ],
    [
      'shader-prismatic-shatter',
      {
        distortion: 20,
        interference: 0,
        shredding: 0,
        grain: 1,
        phase: 0.3,
        rotation: 35,
        colorMix: 0,
      },
    ],
  ] as const)('%s has independent material controls', (type, changes) => {
    const initial = render(effect(type));
    for (const [key, value] of Object.entries(changes))
      expect(render(effect(type, { [key]: value })), key).not.toEqual(initial);
  });
  it.each([
    [
      'shader-radial-extrusion',
      { spokes: 24, depth: 0.2, tunnel: 0.3, facets: 0.1, phase: 0.3, rotation: 35 },
    ],
    [
      'shader-cellular-mesh',
      { holes: 0.7, rounding: 0.1, fractures: 0.7, wireframe: 1, phase: 0.3, rotation: 35 },
    ],
    [
      'shader-particle-burst',
      {
        density: 0.9,
        particleSize: 0.3,
        scatter: 1,
        branches: 1,
        focalGlow: 1,
        focalLength: 0.6,
        phase: 0.3,
        rotation: 35,
      },
    ],
    [
      'shader-spectral-terrain',
      {
        height: 0.9,
        ridges: 7,
        lineWidth: 0.5,
        scale: 2,
        fieldSource: 'brightness',
        phase: 0.3,
        rotation: 35,
      },
    ],
  ] as const)('%s has independent geometry controls', (type, changes) => {
    const initial = render(effect(type));
    for (const [key, value] of Object.entries(changes))
      expect(render(effect(type, { [key]: value })), key).not.toEqual(initial);
  });
  it('spectral terrain defaults to flat, with optional perspective and reusable imported heights', () => {
    const flat = effect('shader-spectral-terrain');
    if (flat.type !== 'shader-spectral-terrain') throw Error('Expected terrain');
    expect(flat.params.mode).toBe('flat');
    expect(supportsHeightField(flat)).toBe(true);
    expect(render(effect(flat.type, { perspective: 0 }))).toEqual(render(flat));
    expect(render(effect(flat.type, { mode: 'terrain' }))).not.toEqual(render(flat));
    expect(render(effect(flat.type, { mode: 'terrain', perspective: 0 }))).not.toEqual(
      render(effect(flat.type, { mode: 'terrain' })),
    );
  });
  it('keeps erosion displacement independent from spectral coloring', () => {
    const base = effect('shader-chromatic-erosion', { strength: 1, colorMix: 0, distortion: 0 });
    expect(render(base)).toEqual(pixels);
    expect(
      render(effect('shader-chromatic-erosion', { strength: 1, colorMix: 0, distortion: 15 })),
    ).not.toEqual(pixels);
    expect(
      render(effect('shader-chromatic-erosion', { strength: 1, colorMix: 1, distortion: 0 })),
    ).not.toEqual(pixels);
  });
  it('flower controls alter the construction', () => {
    const initial = render(effect('shader-bloom-field'));
    for (const [key, value] of Object.entries({
      petals: 3,
      radius: 0.4,
      dotSize: 0.2,
      density: 1,
      noiseScale: 8,
      rotation: 50,
      scale: 5,
      colorMix: 0,
      patternColor: '#ff0044',
      backgroundColor: '#133055',
    }))
      expect(render(effect('shader-bloom-field', { [key]: value })), key).not.toEqual(initial);
    const opaque = render(effect('shader-bloom-field', { alpha: 'opaque', strength: 1 }));
    for (let i = 3; i < opaque.length; i += 4) expect(opaque[i]).toBe(255);
  });
  it('window controls change visible fragments and borders', () => {
    const initial = render(effect('window-fragments'));
    for (const [key, value] of Object.entries({
      count: 2,
      width: 50,
      height: 55,
      sizeVariation: 0,
      travel: 0,
      zoom: 3,
      colorShift: 1,
      borderWidth: 1,
      borderColor: '#ff0066',
      decorations: 'on',
      phase: 0.2,
    }))
      expect(render(effect('window-fragments', { [key]: value })), key).not.toEqual(initial);
    expect(supportsLayerImage(effect('window-fragments'))).toBe(true);
  });
  it('contours use reusable height fields and preserve source transparency', () => {
    expect(supportsHeightField(effect('contour-waves'))).toBe(true);
    const initial = render(effect('contour-waves'));
    for (const [key, value] of Object.entries({
      lines: 24,
      amplitude: 0,
      lineWidth: 0.7,
      rotation: 35,
      sourceMix: 0.5,
      colorSource: 'source',
      lineColor: '#ff8800',
      backgroundColor: '#111e55',
      fieldSource: 'radial',
      phase: 0.2,
    }))
      expect(render(effect('contour-waves', { [key]: value })), key).not.toEqual(initial);
    for (let i = 3; i < initial.length; i += 4) expect(initial[i]).toBe(pixels[i]);
  });
  it('invalid controls cannot enter a recipe', () => {
    expect(() => assertEffect(effect('shader-bloom-field', { petals: 99 }))).toThrow();
    expect(() => assertEffect(effect('window-fragments', { count: 1000 }))).toThrow();
    expect(() => assertEffect(effect('contour-waves', { lines: 0 }))).toThrow();
  });
  it('dissolve retains source colors and has exact removal endpoints', () => {
    const identity = effect('pixel-dissolve', { dissolve: 0, breakup: 0 });
    expect(render(identity)).toEqual(pixels);
    const gone = render(effect('pixel-dissolve', { dissolve: 1 }));
    for (let i = 3; i < gone.length; i += 4) expect(gone[i]).toBe(0);
    const broken = render(effect('pixel-dissolve', { breakup: 0, dissolve: 0.5, softness: 0 }));
    for (let i = 0; i < broken.length; i += 4)
      if (broken[i + 3]) expect([...broken.slice(i, i + 3)]).toEqual([...pixels.slice(i, i + 3)]);
    for (const [key, value] of Object.entries({
      cellSize: 4,
      breakup: 0,
      scatter: 30,
      direction: 60,
      softness: 0.8,
      phase: 0.2,
      bias: 'dark',
      fill: 'background',
    }))
      expect(render(effect('pixel-dissolve', { [key]: value })), key).not.toEqual(
        render(effect('pixel-dissolve')),
      );
  });
  it('neon print uses only its inks at zero outline mixing and preserves transparency', () => {
    const result = render(effect('neon-print', { outlines: 0 })),
      e = effect('neon-print');
    const palette = ['#0d1e29', '#00a9e8', '#f4499b', '#f6dc57', '#f1eee3'].map((hex) =>
      [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(','),
    );
    for (let i = 0; i < result.length; i += 4) {
      expect(palette).toContain([...result.slice(i, i + 3)].join(','));
      expect(result[i + 3]).toBe(pixels[i + 3]);
    }
    for (const [key, value] of Object.entries({
      cellSize: 2,
      grain: 0,
      contrast: 2,
      outlines: 0,
      outlineWidth: 1,
      inkColor1: '#ff0000',
      inkColor2: '#00ff00',
      inkColor3: '#ffffff',
      paperColor: '#af89ff',
      backgroundColor: '#2e0000',
    }))
      expect(render(effect('neon-print', { [key]: value })), key).not.toEqual(render(e));
    expect(
      Object.keys(getEffectDefinition(e).parameters).some((key) =>
        /grid|symbol|number|frame|mono/i.test(key),
      ),
    ).toBe(false);
  });
  it.each([
    [
      'signal-weave',
      {
        rasterSpacing: 2,
        rasterWidth: 0.9,
        bands: 7,
        colorMix: 0,
        dropouts: 0.8,
        distortion: 20,
        phase: 0.3,
        backgroundColor: '#aa0055',
      },
    ],
    [
      'data-weave',
      {
        dashLength: 5,
        spacing: 1.3,
        rowSpacing: 3,
        thickness: 0.2,
        disruption: 0.8,
        sourceMix: 0.6,
        phase: 0.3,
        colorSource: 'chosen',
        backgroundColor: '#3300bb',
      },
    ],
    [
      'micro-collage',
      {
        fragmentSize: 8,
        spacing: 0.5,
        travel: 35,
        zoom: 3,
        rotation: 90,
        sourceMix: 0.7,
        phase: 0.3,
        backgroundColor: '#aa1133',
      },
    ],
  ] as const)('%s has independent visible controls', (type, changes) => {
    const initial = render(effect(type));
    for (const [key, value] of Object.entries(changes))
      expect(render(effect(type, { [key]: value })), key).not.toEqual(initial);
  });
  it.each([
    [
      'system-crash',
      {
        text: 'HELLO GLEECH',
        textSize: 3,
        textDensity: 0.2,
        threshold: 0.7,
        sourceMix: 0.7,
        windowCount: 0,
        windowSize: 40,
        windowTravel: 40,
        phase: 0.3,
        textColor: '#ffaa00',
        backgroundColor: '#001100',
      },
    ],
    [
      'terminal-wireframe',
      {
        cellSize: 3,
        edgeStrength: 9,
        continuity: 0.1,
        density: 0.9,
        perspective: 0.8,
        sourceMix: 0.6,
        phase: 0.3,
        frame: 'on',
        colorSource: 'source',
        lineColor: '#ff1100',
        accentColor: '#ffff00',
        backgroundColor: '#000000',
      },
    ],
  ] as const)('%s has independent terminal controls', (type, changes) => {
    const initial = render(effect(type));
    for (const [key, value] of Object.entries(changes))
      expect(render(effect(type, { [key]: value })), key).not.toEqual(initial);
  });
  it('micro collage embeds and samples an optional reference rather than recoloring the source', () => {
    const e = effect('micro-collage', { spacing: 0, sourceMix: 0 });
    if (e.type !== 'micro-collage') throw Error('Expected collage');
    const reference = {
      source: {
        id: 'ref',
        name: 'ref.png',
        width: 1,
        height: 1,
        format: 'png' as const,
        hasAlpha: true,
      },
      png: 'data:image/png;base64,a',
    };
    expect(supportsLayerImage(e)).toBe(true);
    const withReference = { ...e, image: reference };
    expect(() => renderEffects(image, [withReference])).toThrow('unavailable');
    const result = new Uint8Array(
      renderEffects(image, [withReference], {
        layerImages: new Map([
          ['ref', { width: 1, height: 1, pixels: Uint8Array.from([210, 40, 90, 255]).buffer }],
        ]),
      }).pixels,
    );
    for (let i = 0; i < result.length; i += 4)
      expect([...result.slice(i, i + 4)]).toEqual([210, 40, 90, 255]);
  });
  it('raster and dash backgrounds retain the source alpha', () => {
    for (const type of ['signal-weave', 'data-weave'] as const) {
      const result = render(effect(type));
      for (let i = 3; i < result.length; i += 4) expect(result[i]).toBe(pixels[i]);
    }
  });
  it('bounded rendering can be cancelled', async () => {
    let polls = 0;
    await expect(
      renderEffectsAsync(image, [effect('contour-waves')], {
        yieldControl: async () => {},
        isCancelled: () => ++polls > 4,
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
