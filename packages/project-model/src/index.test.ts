import { describe, expect, it } from 'vitest';
import { deriveEffectSeed } from './index';

describe('derived effect seeds', () => {
  it('preserves the initial seed derivation vectors for future saved recipes', () => {
    expect(deriveEffectSeed(0, 'effect-a')).toBe(2318795280);
    expect(deriveEffectSeed(8172, 'effect-a')).toBe(1601876140);
    expect(deriveEffectSeed(0xffffffff, 'effect-a')).toBe(2969900672);
  });

  it('keeps each instance seed stable when effects are reordered', () => {
    const original = ['effect-a', 'effect-b', 'effect-c'];
    const seeds = Object.fromEntries(original.map((id) => [id, deriveEffectSeed(8172, id)]));
    for (const id of [...original].reverse()) {
      expect(deriveEffectSeed(8172, id)).toBe(seeds[id]);
    }
    expect(new Set(Object.values(seeds)).size).toBe(3);
    expect(deriveEffectSeed(8173, 'effect-a')).not.toBe(seeds['effect-a']);
  });

  it('accepts seed boundaries and produces unsigned 32-bit results', () => {
    for (const masterSeed of [0, 0xffffffff]) {
      const seed = deriveEffectSeed(masterSeed, 'effect-a');
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
