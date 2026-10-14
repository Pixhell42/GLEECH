import { describe, expect, it } from 'vitest';
import { EFFECT_DEFINITIONS } from './index';
import { EFFECT_CATEGORIES, EFFECT_CATEGORY, filterEffectCatalog } from './effect-catalog';

describe('effect catalog', () => {
  it('assigns every current tile to exactly one nonempty category and keeps All complete', () => {
    expect(Object.keys(EFFECT_CATEGORY).sort()).toEqual(Object.keys(EFFECT_DEFINITIONS).sort());
    expect(filterEffectCatalog('')).toHaveLength(Object.keys(EFFECT_DEFINITIONS).length);
    const types = EFFECT_CATEGORIES.slice(1).flatMap((category) =>
      filterEffectCatalog('', category),
    );
    expect(new Set(types).size).toBe(Object.keys(EFFECT_DEFINITIONS).length);
    expect(types).toHaveLength(Object.keys(EFFECT_DEFINITIONS).length);
    for (const category of EFFECT_CATEGORIES.slice(1))
      expect(filterEffectCatalog('', category).length).toBeGreaterThan(0);
  });
  it('finds familiar styles and requires all search terms inside the selected category', () => {
    expect(filterEffectCatalog(' JULIA ')).toEqual(['mandelbrot']);
    expect(filterEffectCatalog('vector map', 'Distortion')).toContain('motion-transfer');
    expect(filterEffectCatalog('vector map', 'Color')).toEqual([]);
    expect(filterEffectCatalog('worley')).toContain('noise-grain');
    expect(filterEffectCatalog('white balance')).toContain('photo-adjustments');
    expect(filterEffectCatalog('no-such-effect')).toEqual([]);
  });
});
