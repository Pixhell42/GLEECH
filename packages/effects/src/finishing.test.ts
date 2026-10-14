import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  assertPresetRecipe,
  createEffect,
  type EffectInstance,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const image = (colors: number[][]) => ({
  width: colors.length,
  height: 1,
  pixels: new Uint8Array(colors.flat()).buffer,
});
const edit = (effect: EffectInstance, params: Record<string, number | string>) =>
  ({ ...effect, params: { ...effect.params, ...params } }) as EffectInstance;
const hue = (params: Record<string, number | string> = {}) =>
  edit(createEffect('hue-saturation', 'hue'), params);
const map = (params: Record<string, number | string> = {}) =>
  edit(createEffect('gradient-map', 'map'), {
    shadows: '#0000ff',
    highlights: '#ff0000',
    ...params,
  });
const bytes = (source: ReturnType<typeof image>, effect: EffectInstance) =>
  new Uint8Array(renderEffects(source, [effect]).pixels);
const primaries = image([
  [255, 0, 0, 255],
  [0, 255, 0, 128],
  [0, 0, 255, 0],
  [128, 128, 128, 1],
]);

describe('Hue / Saturation', () => {
  it('leaves the neutral adjustment byte-exact, including hidden RGB, without mutating input', () => {
    expect(renderEffects(primaries, [hue()]).pixels).toBe(primaries.pixels);
    expect(bytes(primaries, hue({ hue: 120 }))).toEqual(
      new Uint8Array([0, 255, 0, 255, 0, 0, 255, 128, 255, 0, 0, 0, 128, 128, 128, 1]),
    );
    expect(new Uint8Array(primaries.pixels)).toEqual(
      new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 128, 128, 128, 1]),
    );
  });
  it('wraps negative hue and gives equivalent opposite endpoints', () => {
    expect(bytes(primaries, hue({ hue: -120 }))).toEqual(
      new Uint8Array([0, 0, 255, 255, 255, 0, 0, 128, 0, 255, 0, 0, 128, 128, 128, 1]),
    );
    expect(bytes(primaries, hue({ hue: -180 }))).toEqual(bytes(primaries, hue({ hue: 180 })));
  });
  it('desaturates using HSL lightness and boosts existing color without inventing gray hues', () => {
    expect(bytes(primaries, hue({ saturation: -1 }))).toEqual(
      new Uint8Array([128, 128, 128, 255, 128, 128, 128, 128, 128, 128, 128, 0, 128, 128, 128, 1]),
    );
    const source = image([
      [192, 64, 64, 254],
      [128, 128, 128, 64],
    ]);
    expect(bytes(source, hue({ saturation: 1 }))).toEqual(
      new Uint8Array([255, 1, 1, 254, 128, 128, 128, 64]),
    );
    expect(bytes(image([[255, 0, 0, 255]]), hue({ saturation: -0.5 }))).toEqual(
      new Uint8Array([191, 64, 64, 255]),
    );
  });
  it('moves lightness to black or white and mixes opacity without changing alpha', () => {
    expect(bytes(primaries, hue({ lightness: -1 }))).toEqual(
      new Uint8Array([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 1]),
    );
    expect(bytes(primaries, hue({ lightness: 1 }))).toEqual(
      new Uint8Array([255, 255, 255, 255, 255, 255, 255, 128, 255, 255, 255, 0, 255, 255, 255, 1]),
    );
    expect(bytes(image([[255, 0, 0, 128]]), hue({ hue: 120, amount: 0.5 }))).toEqual(
      new Uint8Array([128, 128, 0, 128]),
    );
  });
});

describe('Gradient Map', () => {
  it('maps encoded RGB luminance to literal endpoints with continuous midtones', () => {
    const source = image([
      [0, 0, 0, 0],
      [255, 255, 255, 255],
      [128, 128, 128, 128],
      [255, 0, 0, 1],
      [0, 255, 0, 64],
      [0, 0, 255, 254],
    ]);
    expect(bytes(source, map())).toEqual(
      new Uint8Array([
        0, 0, 255, 0, 255, 0, 0, 255, 128, 0, 127, 128, 54, 0, 201, 1, 182, 0, 73, 64, 18, 0, 237,
        254,
      ]),
    );
  });
  it('moves the halfway tone and reverses the ramp without changing chosen colors', () => {
    const source = image([
      [0, 0, 0, 255],
      [51, 51, 51, 128],
      [255, 255, 255, 0],
    ]);
    expect(bytes(source, map({ midpoint: 0.2 }))).toEqual(
      new Uint8Array([0, 0, 255, 255, 128, 0, 128, 128, 255, 0, 0, 0]),
    );
    expect(bytes(source, map({ midpoint: 0.2, reverse: 'on' }))).toEqual(
      new Uint8Array([255, 0, 0, 255, 128, 0, 128, 128, 0, 0, 255, 0]),
    );
    expect(bytes(source, map({ shadows: '#208040', highlights: '#208040' }))).toEqual(
      new Uint8Array([32, 128, 64, 255, 32, 128, 64, 128, 32, 128, 64, 0]),
    );
  });
});

describe('finishing filter integration', () => {
  it('bypasses disabled, zero-opacity and zero-coverage effects and applies directional masks', () => {
    for (const effect of [hue({ hue: 120 }), map()]) {
      for (const bypass of [
        { ...effect, enabled: false },
        edit(effect, { amount: 0 }),
        { ...effect, application: { ...effect.application, coverage: 0 } },
      ])
        expect(renderEffects(primaries, [bypass]).pixels).toBe(primaries.pixels);
      const masked = {
        ...effect,
        application: { region: 'left' as const, coverage: 0.5, softness: 0 },
      };
      const result = bytes(primaries, masked);
      expect(result.subarray(0, 8)).toEqual(bytes(primaries, effect).subarray(0, 8));
      expect(result.subarray(8)).toEqual(new Uint8Array(primaries.pixels).subarray(8));
    }
  });
  it('processes the incoming stack in order and remains seed- and preview-size independent', () => {
    const effects = [hue({ hue: 120 }), map()];
    const forward = renderEffects(primaries, effects);
    expect(new Uint8Array(forward.pixels)).toEqual(
      new Uint8Array(renderEffects(renderEffects(primaries, [effects[0]!]), [effects[1]!]).pixels),
    );
    expect(new Uint8Array(forward.pixels)).not.toEqual(
      new Uint8Array(renderEffects(primaries, [...effects].reverse()).pixels),
    );
    expect(new Uint8Array(forward.pixels)).toEqual(
      new Uint8Array(
        renderEffects(primaries, effects, {
          masterSeed: 1234,
          reference: { width: 4000, height: 1000 },
        }).pixels,
      ),
    );
  });
  it('matches async rendering and cancels within a wide scanline', async () => {
    const source = image(Array.from({ length: 10000 }, () => [90, 150, 220, 128]));
    for (const effect of [hue({ hue: 53, saturation: 0.4 }), map({ midpoint: 0.3 })]) {
      expect(
        new Uint8Array(
          (await renderEffectsAsync(source, [effect], { yieldControl: async () => {} })).pixels,
        ),
      ).toEqual(new Uint8Array(renderEffects(source, [effect]).pixels));
      let checks = 0;
      await expect(
        renderEffectsAsync(source, [effect], {
          yieldControl: async () => {},
          isCancelled: () => ++checks > 3,
        }),
      ).rejects.toThrow(RenderCancelledError);
      expect(checks).toBe(4);
    }
  });
  it('validates portable recipes and rejects unsafe or malformed controls', () => {
    const effects = [
      hue({ hue: -73, saturation: 0.23, lightness: -0.12 }),
      map({ midpoint: 0.3, reverse: 'on' }),
    ];
    const recipe = JSON.parse(JSON.stringify({ masterSeed: 42, effects }));
    expect(() => assertPresetRecipe(recipe)).not.toThrow();
    expect(recipe.effects).toEqual(effects);
    for (const invalid of [
      hue({ hue: 181 }),
      hue({ saturation: -1.01 }),
      hue({ lightness: NaN }),
      map({ midpoint: 0 }),
      map({ midpoint: 1 }),
      map({ shadows: '#fff' }),
      map({ reverse: 'maybe' }),
    ])
      expect(() => assertEffect(invalid)).toThrow();
  });
});
