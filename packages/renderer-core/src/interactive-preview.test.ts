import { describe, expect, it } from 'vitest';
import {
  InteractivePreviewBudget,
  needsInteractivePreview,
  previewSize,
} from './interactive-preview';

describe('interactive previews', () => {
  it('bounds the source without changing aspect or enlarging small images', () => {
    expect(previewSize(4096, 3072, 256)).toEqual({ width: 256, height: 192 });
    expect(previewSize(100, 4000, 256)).toEqual({ width: 6, height: 256 });
    expect(previewSize(1, 4000, 256)).toEqual({ width: 1, height: 256 });
    expect(previewSize(129, 65, 256)).toEqual({ width: 129, height: 65 });
  });
  it('uses progressive rendering only for active expensive filters on larger images', () => {
    const image = { width: 2048, height: 1536 };
    const effect = {
      type: 'blur',
      enabled: true,
      params: { amount: 1 },
      application: { coverage: 1 },
    };
    expect(needsInteractivePreview(image, [effect])).toBe(true);
    expect(needsInteractivePreview(image, [{ ...effect, type: 'noise-grain' }])).toBe(true);
    for (const type of [
      'shader-ripple',
      'shader-plasma',
      'shader-liquid-glass',
      'shader-iridescence',
      'shader-hologram',
      'shader-flow-field',
      'shader-caustics',
      'shader-liquid-chrome',
      'shader-heat-mirage',
      'shader-nebula',
      'vector-corruption',
      'reference-mosh',
      'motion-transfer',
      'depth-parallax',
      'depth-haze',
      'depth-color-map',
      'cutout',
      'lens-distortion',
      'feedback-bloom',
      'bit-damage',
      'freeze-dropout',
      'photo-adjustments',
      'detail',
      'halation',
      'vignette',
      'depth-field',
      'recursive-space',
      'compression-breakup',
      'indexed-palette',
      'threshold',
      'dither',
      'glyph',
      'crt',
      'signal-tearing',
      'channel-transform',
      'temporal-echo',
    ]) {
      expect(needsInteractivePreview(image, [{ ...effect, type }])).toBe(true);
      expect(needsInteractivePreview(image, [{ ...effect, type, enabled: false }])).toBe(false);
      expect(needsInteractivePreview(image, [{ ...effect, type, params: { amount: 0 } }])).toBe(
        false,
      );
      expect(
        needsInteractivePreview(image, [{ ...effect, type, application: { coverage: 0 } }]),
      ).toBe(false);
    }
    expect(needsInteractivePreview({ width: 129, height: 65 }, [effect])).toBe(false);
    expect(needsInteractivePreview(image, [{ ...effect, enabled: false }])).toBe(false);
    expect(needsInteractivePreview(image, [{ ...effect, params: { amount: 0 } }])).toBe(false);
    expect(needsInteractivePreview(image, [{ ...effect, application: { coverage: 0 } }])).toBe(
      false,
    );
    expect(needsInteractivePreview(image, [{ ...effect, type: 'rgb-split' }])).toBe(false);
    expect(
      needsInteractivePreview(
        image,
        Array.from({ length: 3 }, () => ({ ...effect, type: 'rgb-split' })),
      ),
    ).toBe(true);
    expect(
      needsInteractivePreview(
        image,
        Array.from({ length: 3 }, () => ({ ...effect, type: 'rgb-split', enabled: false })),
      ),
    ).toBe(false);
  });
  it('adapts expensive drafts, recovers with hysteresis and resets for a different source', () => {
    const budget = new InteractivePreviewBudget();
    expect(budget.maximum).toBe(256);
    budget.record(300);
    expect(budget.maximum).toBe(128);
    budget.record(80);
    expect(budget.maximum).toBe(96);
    budget.record(2000);
    expect(budget.maximum).toBe(96);
    for (let i = 0; i < 5; i++) budget.record(10);
    expect(budget.maximum).toBe(96);
    budget.record(10);
    expect(budget.maximum).toBe(128);
    budget.record(NaN);
    budget.record(-1);
    expect(budget.maximum).toBe(128);
    budget.reset();
    expect(budget.maximum).toBe(256);
    for (let i = 0; i < 10; i++) budget.record(25);
    expect(budget.maximum).toBe(256);
  });
});
