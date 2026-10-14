import { describe, expect, it } from 'vitest';
import type { RgbSplitEffect } from '@gleech/project-model';
import { renderEffects } from './index';

const pixels = new Uint8Array(
  Array.from({ length: 10 }, (_, x) => [x * 10, 50, 100 + x, x * 25]).flat(),
);
const image = { width: 10, height: 1, pixels: pixels.buffer };
const split: RgbSplitEffect = {
  instanceId: 'a',
  type: 'rgb-split',
  version: 1,
  enabled: true,
  seedOffset: 0,
  application: { region: 'all', coverage: 1, softness: 0 },
  params: { amount: 1, horizontal: 10, vertical: 0 },
};

describe('RGB split version 1', () => {
  it('displaces opposite channels with clamped edges while preserving green and alpha', () => {
    const output = new Uint8Array(renderEffects(image, [split]).pixels);
    expect(Array.from(output.subarray(4, 8))).toEqual([0, 50, 102, 25]);
    expect(Array.from(output.subarray(36, 40))).toEqual([80, 50, 109, 225]);
    for (let index = 0; index < 10; index++)
      expect(output[index * 4 + 3]).toBe(pixels[index * 4 + 3]);
    expect(Array.from(pixels.subarray(4, 8))).toEqual([10, 50, 101, 25]);
  });
  it('restores original pixels when disabled or at zero amount', () => {
    expect(renderEffects(image, [{ ...split, enabled: false }]).pixels).toBe(image.pixels);
    expect(
      renderEffects(image, [{ ...split, params: { ...split.params, amount: 0 } }]).pixels,
    ).toBe(image.pixels);
  });
  it('evaluates stack order and mixes against the incoming image', () => {
    const opposite = { ...split, instanceId: 'b', params: { ...split.params, horizontal: -10 } };
    const forward = new Uint8Array(renderEffects(image, [split, opposite]).pixels);
    const reverse = new Uint8Array(renderEffects(image, [opposite, split]).pixels);
    expect(forward[0]).toBe(0);
    expect(reverse[0]).toBe(10);
    const mixed = new Uint8Array(
      renderEffects(image, [{ ...split, params: { ...split.params, amount: 0.5 } }]).pixels,
    );
    expect(mixed[4]).toBe(5);
  });
});
