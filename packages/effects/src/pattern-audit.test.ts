import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  EFFECT_DEFINITIONS,
  supportsSeedVariation,
  type EffectInstance,
  type EffectType,
} from '@gleech/project-model';
import { renderEffects } from './index';

const width = 96,
  height = 72;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : (i * 37 + Math.floor(i / 384) * 11) % 256,
);
const image = { width, height, pixels: pixels.buffer };
const reference = {
  source: {
    id: 'reference',
    name: 'reference.png',
    width: 1,
    height: 1,
    format: 'png' as const,
    hasAlpha: false,
  },
  png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
};
const referencePixels = Uint8Array.from([255, 0, 0, 255]);
const options = {
  masterSeed: 8172,
  layerImages: new Map([['reference', { width: 1, height: 1, pixels: referencePixels.buffer }]]),
};
const render = (effect: EffectInstance) =>
  new Uint8Array(renderEffects(image, [effect], options).pixels);
const prepare = (type: EffectType, params: Record<string, string | number> = {}) => {
  const e = createEffect(type, 'pattern-audit');
  return {
    ...e,
    ...(type === 'reference-mosh' ? { image: reference } : {}),
    params: { ...e.params, ...params },
  } as EffectInstance;
};
const defaults = (Object.keys(EFFECT_DEFINITIONS) as EffectType[]).map((type) => prepare(type));
const modes: [EffectType, Record<string, string | number>][] = [
  ['glyph', { rotationJitter: 35, cellSize: 10, glyphScale: 1 }],
  ['glyph', { style: 'emoji', emojiMapping: 'random', cellSize: 10, glyphScale: 1 }],
  ['depth-parallax', { style: 'tearing' }],
  ['temporal-echo', { jitter: 0.6, spacing: 5 }],
  ['bit-damage', { operation: 'scramble', density: 1 }],
  ['bit-damage', { operation: 'inject', density: 1 }],
  ['bit-damage', { operation: 'byte-scramble', density: 1 }],
  ['indexed-palette', { colorSwap: 0.7 }],
  ['indexed-palette', { dither: 'random', ditherStrength: 1 }],
  ['indexed-palette', { dither: 'blue-noise', ditherStrength: 1 }],
  ['threshold', { style: 'photocopy', dirt: 0.7 }],
  ['dither', { algorithm: 'random', ditherStrength: 1 }],
  ['dither', { algorithm: 'blue-noise', ditherStrength: 1 }],
  ['dither', { algorithm: 'corrupted', skippedCells: 0.5 }],
  ['pixel-sort', { density: 0.5, breakup: 0.3 }],
  ['blur', { style: 'grainy', radius: 5, density: 24 }],
  ['shapes', { shape: 'triangle', layout: 'tiled', rotationStyle: 'random' }],
  ['shapes', { shape: 'polygon', layout: 'tiled', polygonStyle: 'random' }],
  ['scanlines', { signalError: 'jitter', errorStrength: 0.8 }],
  ['bit-crush', { dither: 'random', ditherAmount: 1 }],
  ['spatial-crush', { sampling: 'random', blockSize: 15 }],
  ['spatial-crush', { sampling: 'dirty-nearest', jitter: 0.8, blockSize: 15 }],
  ['spatial-crush', { sampling: 'corrupted', corruption: 0.8, blockSize: 15 }],
];
describe('New pattern library audit', () => {
  const cases = [
    ...defaults.filter(supportsSeedVariation),
    ...modes.map(([type, p]) => prepare(type, p)),
  ];
  it.each(cases.map((e) => [e.type, e] as const))(
    '%s changes visible pixels and replays the previous pattern',
    (_, effect) => {
      assertEffect(effect);
      expect(supportsSeedVariation(effect)).toBe(true);
      const original = render(effect);
      expect(render({ ...effect, seedOffset: 1 })).not.toEqual(original);
      expect(render(effect)).toEqual(original);
      expect(render(JSON.parse(JSON.stringify({ ...effect, seedOffset: 1 })))).toEqual(
        render({ ...effect, seedOffset: 1 }),
      );
    },
  );
  it.each(['window-fragments', 'micro-collage', 'data-weave', 'shader-particle-burst'] as const)(
    '%s has a visible frozen phase independent of the seed',
    (type) => {
      const effect = prepare(
        type,
        type === 'shader-particle-burst' ? { branches: 0, scatter: 0, focalGlow: 0 } : {},
      );
      const original = render(effect);
      expect(
        render({ ...effect, params: { ...effect.params, phase: 0.23 } } as EffectInstance),
      ).not.toEqual(original);
      expect(
        render({ ...effect, params: { ...effect.params, phase: 1 } } as EffectInstance),
      ).toEqual(original);
    },
  );
  it('offers seed variation for partial procedural application masks even on an unseeded filter', () => {
    const base = prepare('solid');
    expect(supportsSeedVariation(base)).toBe(false);
    const effect = { ...base, application: { ...base.application, coverage: 0.4 } };
    expect(supportsSeedVariation(effect)).toBe(true);
    expect(render({ ...effect, seedOffset: 1 })).not.toEqual(render(effect));
  });
});
