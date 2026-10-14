import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  assertPresetRecipe,
  createEffect,
  type EffectInstance,
  type LevelsCurvesEffect,
} from '@gleech/project-model';
import {
  createCurveSampler,
  renderEffects,
  renderEffectsAsync,
  RenderCancelledError,
} from './index';

const edit = (effect: EffectInstance, params: Record<string, number | string>) =>
  ({ ...effect, params: { ...effect.params, ...params } }) as EffectInstance;
const tone = (params: Record<string, number | string> = {}) =>
  edit(createEffect('levels-curves', 'tone'), params);
const glow = (params: Record<string, number | string> = {}) =>
  edit(createEffect('glow', 'glow'), params);
const image = (colors: number[][]) => ({
  width: colors.length,
  height: 1,
  pixels: new Uint8Array(colors.flat()).buffer,
});
const bytes = (source: ReturnType<typeof image>, effect: EffectInstance) =>
  new Uint8Array(renderEffects(source, [effect]).pixels);
const source = image([
  [0, 64, 128, 0],
  [51, 102, 153, 128],
  [204, 255, 200, 255],
]);

describe('Levels / Curves', () => {
  it('keeps both neutral modes exact, including hidden RGB, and leaves input immutable', () => {
    expect(renderEffects(source, [tone()]).pixels).toBe(source.pixels);
    expect(renderEffects(source, [tone({ mode: 'curves' })]).pixels).toBe(source.pixels);
    bytes(source, tone({ gamma: 2 }));
    expect(new Uint8Array(source.pixels)).toEqual(
      new Uint8Array([0, 64, 128, 0, 51, 102, 153, 128, 204, 255, 200, 255]),
    );
  });
  it('remaps input black/white and gamma with independent color vectors', () => {
    expect(bytes(source, tone({ inputBlack: 0.2, inputWhite: 0.8 }))).toEqual(
      new Uint8Array([0, 22, 128, 0, 0, 85, 170, 128, 255, 255, 248, 255]),
    );
    expect(bytes(image([[64, 128, 255, 128]]), tone({ gamma: 2 }))).toEqual(
      new Uint8Array([128, 181, 255, 128]),
    );
    expect(bytes(image([[64, 128, 255, 128]]), tone({ gamma: 0.5 }))).toEqual(
      new Uint8Array([16, 64, 255, 128]),
    );
    expect(bytes(image([[0, 128, 255, 64]]), tone({ outputBlack: 0.1, outputWhite: 0.9 }))).toEqual(
      new Uint8Array([26, 128, 230, 64]),
    );
  });
  it('supports inverted output ranges, targeted channels and opacity', () => {
    expect(
      bytes(image([[20, 80, 140, 128]]), tone({ outputBlack: 1, outputWhite: 0, channel: 'red' })),
    ).toEqual(new Uint8Array([235, 80, 140, 128]));
    expect(
      bytes(
        image([[20, 80, 140, 128]]),
        tone({ outputBlack: 1, outputWhite: 0, channel: 'blue', amount: 0.5 }),
      ),
    ).toEqual(new Uint8Array([20, 80, 128, 128]));
  });
  it('uses literal curve points, linear segments and shape-preserving smooth interpolation', () => {
    const effect = tone({
      mode: 'curves',
      curveShadows: 0,
      curveDark: 0.1,
      curveMid: 0.8,
      curveLight: 0.9,
      curveHighlights: 1,
    }) as LevelsCurvesEffect;
    const smooth = createCurveSampler(effect.params);
    const linear = createCurveSampler({ ...effect.params, interpolation: 'linear' });
    for (const [x, y] of [
      [0, 0],
      [0.25, 0.1],
      [0.5, 0.8],
      [0.75, 0.9],
      [1, 1],
    ])
      expect(smooth(x!)).toBe(y);
    expect(linear(0.125)).toBe(0.05);
    expect(smooth(0.125)).toBe(0.028125);
    expect(smooth(-1)).toBe(0);
    expect(smooth(2)).toBe(1);
    const points = [0.7, 0.1, 0.8, 0.2, 0.6];
    const folded = createCurveSampler({
      ...effect.params,
      curveShadows: points[0]!,
      curveDark: points[1]!,
      curveMid: points[2]!,
      curveLight: points[3]!,
      curveHighlights: points[4]!,
    });
    for (let interval = 0; interval < 4; interval++)
      for (let i = 0; i <= 100; i++) {
        const y = folded((interval + i / 100) / 4);
        expect(y).toBeGreaterThanOrEqual(Math.min(points[interval]!, points[interval + 1]!));
        expect(y).toBeLessThanOrEqual(Math.max(points[interval]!, points[interval + 1]!));
      }
  });
  it('can invert the curve without touching alpha', () => {
    const inverted = tone({
      mode: 'curves',
      curveShadows: 1,
      curveDark: 0.75,
      curveMid: 0.5,
      curveLight: 0.25,
      curveHighlights: 0,
    });
    expect(bytes(source, inverted)).toEqual(
      new Uint8Array([255, 191, 127, 0, 204, 153, 102, 128, 51, 0, 55, 255]),
    );
  });
});

describe('Glow', () => {
  it('bypasses zero strength and adds the selected highlight excess at zero radius', () => {
    expect(renderEffects(source, [glow({ strength: 0 })]).pixels).toBe(source.pixels);
    expect(
      bytes(
        image([[200, 200, 200, 255]]),
        glow({ radius: 0, threshold: 0.5, knee: 0, strength: 0.25 }),
      ),
    ).toEqual(new Uint8Array([218, 218, 218, 255]));
    expect(
      bytes(image([[204, 204, 204, 128]]), glow({ radius: 0, threshold: 0.8, knee: 0 })),
    ).toEqual(new Uint8Array([204, 204, 204, 128]));
    expect(
      bytes(image([[204, 204, 204, 255]]), glow({ radius: 0, threshold: 0.8, knee: 0.2 })),
    ).toEqual(new Uint8Array([217, 217, 217, 255]));
  });
  it('recolors only the added halo and mixes opacity with unchanged alpha', () => {
    const fixture = image([
      [128, 128, 128, 255],
      [128, 128, 128, 128],
    ]);
    const params = {
      radius: 0,
      threshold: 0,
      knee: 0,
      strength: 0.5,
      glowColor: '#0000ff',
      colorMix: 1,
    };
    expect(bytes(fixture, glow(params))).toEqual(
      new Uint8Array([128, 128, 192, 255, 128, 128, 160, 128]),
    );
    expect(bytes(fixture, glow({ ...params, amount: 0.5 }))).toEqual(
      new Uint8Array([128, 128, 160, 255, 128, 128, 144, 128]),
    );
  });
  it('spreads an impulse with the independently convolved three-box kernel', () => {
    const pixels = new Uint8Array(7 * 7 * 4);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.set([255, 255, 255, 255], (3 * 7 + 3) * 4);
    const fixture = { width: 7, height: 7, pixels: pixels.buffer };
    const result = bytes(fixture, glow({ radius: 10, threshold: 0, knee: 0 }));
    const kernel = [1, 3, 6, 7, 6, 3, 1];
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const expected =
          x === 3 && y === 3 ? 255 : Math.round((255 * kernel[x]! * kernel[y]!) / 729);
        expect([...result.subarray((y * 7 + x) * 4, (y * 7 + x) * 4 + 4)]).toEqual([
          expected,
          expected,
          expected,
          255,
        ]);
      }
  });
  it('ignores hidden RGB when building the halo and preserves alpha at image edges', () => {
    const fixture = image([
      [0, 0, 0, 255],
      [220, 220, 220, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 0],
      [0, 0, 0, 128],
      [0, 0, 0, 128],
      [0, 0, 0, 128],
    ]);
    const changed = image([
      [0, 0, 0, 255],
      [220, 220, 220, 255],
      [0, 0, 0, 255],
      [255, 0, 255, 0],
      [0, 0, 0, 128],
      [0, 0, 0, 128],
      [0, 0, 0, 128],
    ]);
    for (const edgeHandling of ['extend', 'wrap', 'mirror']) {
      const effect = glow({ radius: 10, threshold: 0, knee: 0, edgeHandling });
      const options = { reference: { width: 7, height: 7 } };
      const a = new Uint8Array(renderEffects(fixture, [effect], options).pixels);
      const b = new Uint8Array(renderEffects(changed, [effect], options).pixels);
      expect(a.subarray(0, 12)).toEqual(b.subarray(0, 12));
      expect(a.subarray(16)).toEqual(b.subarray(16));
      expect(Array.from({ length: 7 }, (_, i) => a[i * 4 + 3])).toEqual([
        255, 255, 255, 0, 128, 128, 128,
      ]);
      expect(a[8]).toBeGreaterThan(0);
    }
  });
  it('wraps the halo across a tiled edge while extend and mirror remain local', () => {
    const fixture = image([
      [255, 255, 255, 255],
      ...Array.from({ length: 6 }, () => [0, 0, 0, 255]),
    ]);
    for (const edgeHandling of ['extend', 'mirror', 'wrap']) {
      const result = new Uint8Array(
        renderEffects(fixture, [glow({ radius: 10, threshold: 0, knee: 0, edgeHandling })], {
          reference: { width: 7, height: 7 },
        }).pixels,
      );
      expect(result[24]).toBe(edgeHandling === 'wrap' ? 57 : 0);
    }
  });
});

describe('tonal/glow integration', () => {
  it('applies finish and masks after the effect, with exact zero-opacity and zero-coverage bypass', () => {
    const fixture = image(Array.from({ length: 4 }, () => [128, 128, 128, 128]));
    for (const effect of [tone({ gamma: 2 }), glow({ radius: 0, threshold: 0, knee: 0 })]) {
      const processed = bytes(fixture, effect);
      const masked = {
        ...effect,
        application: { region: 'left' as const, coverage: 0.5, softness: 0 },
      };
      const result = bytes(fixture, masked);
      expect(result.subarray(0, 8)).toEqual(processed.subarray(0, 8));
      expect(result.subarray(8)).toEqual(new Uint8Array(fixture.pixels).subarray(8));
      for (const candidate of [
        edit(effect, { amount: 0 }),
        { ...effect, enabled: false },
        { ...effect, application: { ...effect.application, coverage: 0 } },
      ])
        expect(renderEffects(fixture, [candidate]).pixels).toBe(fixture.pixels);
    }
  });
  it('matches async output and cancels during highlight blur and curve lookup', async () => {
    const fixture = image(Array.from({ length: 8192 }, () => [150, 100, 70, 128]));
    for (const effect of [tone({ mode: 'curves', curveMid: 0.7 }), glow({ radius: 10 })]) {
      const options = { reference: { width: 8192, height: 8192 } };
      expect(
        new Uint8Array(
          (
            await renderEffectsAsync(fixture, [effect], {
              ...options,
              yieldControl: async () => {},
            })
          ).pixels,
        ),
      ).toEqual(new Uint8Array(renderEffects(fixture, [effect], options).pixels));
      let checks = 0;
      await expect(
        renderEffectsAsync(fixture, [effect], {
          ...options,
          yieldControl: async () => {},
          isCancelled: () => ++checks > (effect.type === 'glow' ? 70 : 3),
        }),
      ).rejects.toThrow(RenderCancelledError);
    }
  });
  it('retains both modes and halo gradients in portable recipes and rejects invalid controls', () => {
    const effects = [
      tone({ mode: 'curves', inputBlack: 0.2, inputWhite: 0.8, curveMid: 0.75 }),
      glow({ glowColorMode: 'gradient', glowColorEnd: '#4080e0', colorMix: 0.7 }),
    ];
    const recipe = JSON.parse(JSON.stringify({ masterSeed: 42, effects }));
    expect(() => assertPresetRecipe(recipe)).not.toThrow();
    expect(recipe.effects).toEqual(effects);
    for (const effect of [
      tone({ inputBlack: 0.9, inputWhite: 0.8 }),
      tone({ inputBlack: 0.5, inputWhite: 0.5 }),
      tone({ gamma: 0 }),
      tone({ curveMid: 1.1 }),
      tone({ channel: 'alpha' }),
      glow({ radius: -1 }),
      glow({ strength: 3.1 }),
      glow({ glowColor: '#fff' }),
    ])
      expect(() => assertEffect(effect)).toThrow();
  });
});
