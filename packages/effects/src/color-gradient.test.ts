import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  EFFECT_DEFINITIONS,
  type EffectInstance,
  type EffectType,
} from '@gleech/project-model';
import { createColorSampler } from './color-gradient';
import { renderEffects, renderEffectsAsync } from './index';

const edit = (effect: EffectInstance, params: Record<string, number | string>) =>
  ({ ...effect, params: { ...effect.params, ...params } }) as EffectInstance;
const bytes = (effect: EffectInstance, image = strip) =>
  new Uint8Array(renderEffects(image, [effect]).pixels);
const bytesWithCodec = async (effect: EffectInstance) =>
  effect.type === 'jpeg-recompression'
    ? new Uint8Array(
        (
          await renderEffectsAsync(strip, [effect], {
            yieldControl: async () => {},
            recompressJpeg: async (image) => {
              const pixels = new Uint8Array(image.pixels.slice(0));
              for (let i = 0; i < pixels.length; i++)
                if (i % 4 !== 3) pixels[i] = Math.floor(pixels[i]! * 0.8);
              return pixels.buffer;
            },
          })
        ).pixels,
      )
    : bytes(effect);
const strip = {
  width: 4,
  height: 1,
  pixels: new Uint8Array([
    255, 255, 255, 255, 255, 255, 255, 128, 255, 255, 255, 0, 255, 255, 255, 255,
  ]).buffer,
};
const ramp = {
  color: '#ff0000',
  colorMode: 'gradient',
  colorEnd: '#0000ff',
};
const expected = [223, 0, 32, 255, 159, 0, 96, 128, 96, 0, 159, 0, 32, 0, 223, 255];

describe('two-color gradients', () => {
  it('preserves omitted legacy settings and rejects malformed or inapplicable additions', async () => {
    for (const type of Object.keys(EFFECT_DEFINITIONS) as EffectType[]) {
      const effect = createEffect(type, type);
      const params = { ...effect.params } as Record<string, number | string>;
      for (const [key, control] of Object.entries(EFFECT_DEFINITIONS[type].parameters))
        if (control.colorSource) delete params[key];
      const legacy = { ...effect, params } as EffectInstance;
      expect(() => assertEffect(legacy)).not.toThrow();
      expect(await bytesWithCodec(effect)).toEqual(await bytesWithCodec(legacy));
    }
    const effect = createEffect('scanlines', 'gradient');
    for (const params of [
      { colorMode: 'rainbow' },
      { colorEnd: '#123' },
      { colorAngle: 361 },
      { colorCenterX: -1 },
      { colorSpan: 0 },
      { colorCenterY: Number.NaN },
    ])
      expect(() => assertEffect(edit(effect, params))).toThrow();
    expect(() =>
      assertEffect(edit(createEffect('mandelbrot', 'fractal'), { insideColorMode: 'gradient' })),
    ).toThrow();
  });

  it('uses literal endpoints, clamping, physical direction, midpoint and span', () => {
    const reference = { width: 200, height: 100 };
    const sample = createColorSampler(ramp, 'color', '#ffffff', reference);
    expect(sample(0, 0.5)).toEqual([255, 0, 0]);
    expect(sample(1, 0.5)).toEqual([0, 0, 255]);
    expect(sample(0.5, 0.5)).toEqual([127.5, 0, 127.5]);
    expect(sample(-1, 0.5)).toEqual([255, 0, 0]);
    const down = createColorSampler({ ...ramp, colorAngle: 90 }, 'color', '#ffffff', reference);
    expect(down(1, 0.25)).toEqual([191.25, 0, 63.75]);
    const diagonal = createColorSampler({ ...ramp, colorAngle: 45 }, 'color', '#ffffff', reference);
    const value = [...diagonal(1, 0)];
    expect(value[0]).toBeCloseTo(85, 5);
    expect(value[2]).toBeCloseTo(170, 5);
    const moved = createColorSampler(
      { ...ramp, colorCenterX: 75, colorSpan: 50 },
      'color',
      '#ffffff',
      reference,
    );
    expect(moved(0.5, 0)).toEqual([255, 0, 0]);
    expect(moved(0.75, 0)).toEqual([127.5, 0, 127.5]);
    expect(moved(1, 0)).toEqual([0, 0, 255]);
    const field = createColorSampler(ramp, 'color', '#ffffff', reference, true);
    expect(field(1, 0, 0.25)).toEqual([191.25, 0, 63.75]);
    expect(field(0, 1, 0.25)).toEqual([191.25, 0, 63.75]);
  });

  it('tints an unchanged image with independently calculated RGBA, including transparent pixels', () => {
    const effect = edit(createEffect('bit-crush', 'tint'), {
      bits: 8,
      tintEnabled: 'on',
      tintStrength: 1,
      ...ramp,
    });
    expect([...bytes(effect)]).toEqual(expected);
    expect([...bytes(edit(effect, { colorAngle: 180 }))]).toEqual([
      32, 0, 223, 255, 96, 0, 159, 128, 159, 0, 96, 0, 223, 0, 32, 255,
    ]);
    expect(bytes(edit(effect, { tintEnabled: 'off' }))).toEqual(new Uint8Array(strip.pixels));
    expect(bytes(edit(effect, { amount: 0 }))).toEqual(new Uint8Array(strip.pixels));
    expect(bytes({ ...effect, enabled: false })).toEqual(new Uint8Array(strip.pixels));
  });

  it('colors scanline halos and halftone paper without changing alpha; inversion complements the entire ramp', () => {
    const lines = edit(createEffect('scanlines', 'lines'), {
      ...ramp,
      style: 'monitor',
      thickness: 1,
      intensity: 1,
      glow: 0.7,
    });
    expect([...bytes(lines)]).toEqual(expected);
    expect([...bytes(edit(lines, { invert: 'on' }))]).toEqual(
      expected.map((value, i) => (i % 4 === 3 ? value : 255 - value)),
    );
    const paper = edit(createEffect('halftone', 'paper'), {
      size: 0,
      backgroundColor: ramp.color,
      backgroundColorMode: 'gradient',
      backgroundColorEnd: ramp.colorEnd,
    });
    expect([...bytes(paper)]).toEqual(expected);
  });

  it('anchors single and tiled Shape overlays to the same canvas; size and layout do not restart the ramp', () => {
    const shape = edit(createEffect('shapes', 'shape'), {
      operation: 'overlay',
      shape: 'circle',
      size: 200,
      scale: 4,
      feather: 0,
      shapeColor: ramp.color,
      shapeColorMode: 'gradient',
      shapeColorEnd: ramp.colorEnd,
    });
    expect([...bytes(shape)]).toEqual(expected);
    const tiles = edit(shape, { layout: 'tiled', spacing: 100 });
    expect([...bytes(tiles)]).toEqual(expected);
    expect(bytes(edit(shape, { shapeColorMode: 'solid' }))).toEqual(
      bytes(
        edit(shape, { shapeColorMode: 'solid', shapeColorEnd: '#00ff00', shapeColorAngle: 90 }),
      ),
    );
  });

  it('keeps white ramps neutral at fractional Amount across all image effects and respects application masks', async () => {
    for (const type of Object.keys(EFFECT_DEFINITIONS) as EffectType[]) {
      if (EFFECT_DEFINITIONS[type].finish !== 'image') continue;
      const effect = edit(createEffect(type, type), { amount: 0.37 });
      expect(
        await bytesWithCodec(
          edit(effect, {
            color: '#ffffff',
            colorMode: 'gradient',
            colorEnd: '#ffffff',
            tintEnabled: 'on',
            tintStrength: 1,
          }),
        ),
      ).toEqual(await bytesWithCodec(effect));
    }
    const effect = edit(createEffect('bit-crush', 'masked'), {
      bits: 8,
      ...ramp,
      tintEnabled: 'on',
      tintStrength: 1,
    });
    const masked = {
      ...effect,
      application: { region: 'left' as const, coverage: 0.5, softness: 0 },
    };
    expect([...bytes(masked)]).toEqual([
      ...expected.slice(0, 8),
      ...new Uint8Array(strip.pixels).slice(8),
    ]);
  });

  it('maps only escaped fractal bands to the ramp, keeping the bounded interior fill', () => {
    const image = { width: 1, height: 1, pixels: new Uint8Array([70, 90, 110, 128]).buffer };
    const effect = edit(createEffect('mandelbrot', 'field'), {
      operation: 'texture',
      centerReal: 0,
      centerImaginary: 0,
      outsideColor: '#ff0000',
      outsideColorMode: 'gradient',
      outsideColorEnd: '#0000ff',
      insideColor: '#123456',
    });
    expect([...bytes(effect, image)]).toEqual([18, 52, 86, 128]);
    const escaped = edit(effect, { centerReal: 3, paletteCycles: 0, paletteOffset: 0 });
    expect([...bytes(escaped, image)]).toEqual([0, 0, 255, 128]);
    expect([...bytes(edit(escaped, { paletteOffset: 0.5 }), image)]).toEqual([255, 0, 0, 128]);
  });

  it('replays gradients exactly across scaled reference dimensions and async rendering', async () => {
    const effect = edit(createEffect('scanlines', 'replay'), {
      ...ramp,
      colorAngle: 32,
      colorCenterX: 63,
      colorSpan: 75,
    });
    const image = { width: 16, height: 8, pixels: new Uint8Array(16 * 8 * 4).fill(255).buffer };
    const first = renderEffects(image, [effect], { reference: image });
    const scaled = edit(effect, {
      frequency: effect.type === 'scanlines' ? effect.params.frequency : 160,
    });
    expect(
      new Uint8Array(
        renderEffects(image, [scaled], { reference: { width: 160, height: 80 } }).pixels,
      ),
    ).toEqual(new Uint8Array(first.pixels));
    expect(await renderEffectsAsync(image, [effect], { yieldControl: async () => {} })).toEqual(
      first,
    );
  });
});
