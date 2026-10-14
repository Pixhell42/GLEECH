import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  BIT_DAMAGE_DEFAULTS,
  type BitDamageEffect,
} from '@gleech/project-model';
import { renderEffects } from './index';
const base = createEffect('bit-damage', 'damage') as BitDamageEffect;
const effect = (params: Partial<BitDamageEffect['params']>): BitDamageEffect => ({
  ...base,
  params: { ...base.params, density: 1, lowBit: 0, highBit: 7, ...params },
});
const image = { width: 1, height: 1, pixels: new Uint8Array([100, 50, 150, 128]).buffer };
const render = (fx: BitDamageEffect, source = image, seed = 17) => {
  assertEffect(fx);
  return new Uint8Array(renderEffects(source, [fx], { masterSeed: seed }).pixels);
};
describe('Advanced Bit Damage completion', () => {
  it.each([
    ['xor', 170, 206],
    ['and', 170, 32],
    ['or', 170, 238],
  ] as const)(
    '%s uses a saved operand without changing other channels',
    (operation, operand, expected) => {
      expect([...render(effect({ operation, operand, target: 'red' }))]).toEqual([
        expected,
        50,
        150,
        128,
      ]);
    },
  );
  it('swaps absolute selected bit indices and keeps every other bit intact', () => {
    expect([
      ...render(effect({ operation: 'swap', target: 'red', swapBitA: 2, swapBitB: 7 })),
    ]).toEqual([224, 50, 150, 128]);
    expect(
      render(
        effect({
          operation: 'swap',
          target: 'red',
          swapBitA: 2,
          swapBitB: 7,
          lowBit: 0,
          highBit: 6,
        }),
      ),
    ).toEqual(new Uint8Array(image.pixels));
  });
  it('supports noncontiguous planes, with shifts operating in selected-plane order', () => {
    const selected = { bitSelection: 'custom' as const, bitMask: 137, target: 'red' as const };
    expect(render(effect({ ...selected, operation: 'xor', operand: 255 }))[0]).toBe(100 ^ 137);
    expect(render(effect({ ...selected, operation: 'set' }))[0]).toBe(100 | 137);
    expect(render(effect({ bitSelection: 'custom', bitMask: 0 }))).toEqual(
      new Uint8Array(image.pixels),
    );
    const one = { ...image, pixels: new Uint8Array([1, 2, 3, 255]).buffer };
    expect(render(effect({ ...selected, operation: 'shift', shift: 1 }), one)[0]).toBe(8);
  });
  it('crossfeeds input bits without order-dependent feedback and processes Luma or RGBA', () => {
    expect([
      ...render(effect({ operation: 'crossfeed', target: 'rgba', sourceChannel: 'blue' })),
    ]).toEqual([150, 150, 150, 150]);
    expect([...render(effect({ operation: 'xor', target: 'rgba', operand: 255 }))]).toEqual([
      155, 205, 105, 127,
    ]);
    const gray = { ...image, pixels: new Uint8Array([100, 100, 100, 128]).buffer };
    expect([...render(effect({ operation: 'xor', target: 'luma', operand: 255 }), gray)]).toEqual([
      155, 155, 155, 128,
    ]);
    const hidden = { ...image, pixels: new Uint8Array([250, 30, 200, 0]).buffer };
    expect([...render(effect({ operation: 'set', target: 'rgba' }), hidden)]).toEqual([
      0, 0, 0, 255,
    ]);
  });
  it('reproduces injected bits and gates them independently of cell density', () => {
    const source = {
      width: 128,
      height: 16,
      pixels: new Uint8Array(128 * 16 * 4).fill(255).buffer,
    };
    const fx = effect({ operation: 'inject', probability: 0.5, cellSize: 1 });
    expect(render(fx, source)).toEqual(render(fx, source));
    expect(render(fx, source)).not.toEqual(render(fx, source, 18));
    expect(render(effect({ ...fx.params, probability: 0 }), source)).toEqual(
      new Uint8Array(source.pixels),
    );
    expect(render(effect({ ...fx.params, density: 0 }), source)).toEqual(
      new Uint8Array(source.pixels),
    );
  });
  it('scrambles whole bytes within horizontal runs while preserving their multiset', () => {
    const pixels = Uint8Array.from(
      Array.from({ length: 16 }, (_, x) => [x * 15, 50, 150, 255]).flat(),
    );
    const source = { width: 16, height: 1, pixels: pixels.buffer };
    const fx = effect({ operation: 'byte-scramble', target: 'red', burstLength: 8, cellSize: 1 });
    const out = render(fx, source);
    expect(out).not.toEqual(pixels);
    for (let start = 0; start < 16; start += 8) {
      const red = (values: Uint8Array) =>
        Array.from({ length: 8 }, (_, x) => values[(start + x) * 4]!).sort((a, b) => a - b);
      expect(red(out)).toEqual(red(pixels));
    }
    for (let i = 0; i < out.length; i++) if (i % 4 !== 0) expect(out[i]).toBe(pixels[i]);
  });
  it('uses shared burst decisions without changing exact density endpoints', () => {
    const source = { width: 64, height: 12, pixels: new Uint8Array(64 * 12 * 4).fill(255).buffer };
    const fx = effect({
      operation: 'clear',
      target: 'red',
      density: 0.5,
      cellSize: 1,
      burstLength: 8,
      clustering: 1,
    });
    const out = render(fx, source);
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 64; x++)
        expect(out[(y * 64 + x) * 4]).toBe(
          out[(Math.floor(y / 3) * 3 * 64 + Math.floor(x / 8) * 8) * 4],
        );
    expect(new Set([...out].filter((_, i) => i % 4 === 0))).toEqual(new Set([0, 255]));
    expect(render(effect({ ...fx.params, density: 0 }), source)).toEqual(
      new Uint8Array(source.pixels),
    );
  });
  it('retains old recipes and validates all new integer and probability fields', () => {
    const fx = effect({ operation: 'scramble' }),
      params = { ...fx.params };
    for (const key of Object.keys(BIT_DAMAGE_DEFAULTS))
      delete (params as Record<string, unknown>)[key];
    expect(render({ ...fx, params })).toEqual(render(fx));
    for (const patch of [
      { bitMask: 256 },
      { operand: 1.5 },
      { swapBitA: 8 },
      { probability: -1 },
      { burstLength: 0 },
    ])
      expect(() => assertEffect(effect(patch))).toThrow();
  });
});
