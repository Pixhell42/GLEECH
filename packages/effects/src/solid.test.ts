import { describe, expect, it } from 'vitest';
import { createEffect, type SolidEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const image = (width: number, height: number, pixel: number[]) => ({
  width,
  height,
  pixels: Uint8Array.from(Array.from({ length: width * height }, () => pixel).flat()).buffer,
});
const solid = (params: Partial<SolidEffect['params']> = {}): SolidEffect => {
  const e = createEffect('solid', 'layer') as SolidEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const bytes = (value: { pixels: ArrayBuffer }) => Array.from(new Uint8Array(value.pixels));
const attached = (placement: 'fit' | 'fill' | 'stretch'): SolidEffect => ({
  ...solid({ content: 'image', placement }),
  image: {
    source: {
      id: 'layer-image',
      name: 'layer.png',
      width: 4,
      height: 2,
      format: 'png',
      hasAlpha: true,
    },
    png: '',
  },
});

describe('Solid content layers', () => {
  it('uses source-over alpha and preserves opaque backgrounds, including hidden colors', () => {
    expect(
      bytes(
        renderEffects(image(1, 1, [90, 200, 30, 0]), [
          solid({ fillColor: '#ff0000', amount: 0.5 }),
        ]),
      ),
    ).toEqual([255, 0, 0, 128]);
    expect(
      bytes(
        renderEffects(image(1, 1, [0, 0, 255, 255]), [
          solid({ fillColor: '#ff0000', amount: 0.5 }),
        ]),
      ),
    ).toEqual([128, 0, 128, 255]);
    // Both source and backdrop half-transparent: 2/3 red, 1/3 blue, alpha 3/4.
    expect(
      bytes(
        renderEffects(image(1, 1, [0, 0, 255, 128]), [
          solid({ fillColor: '#ff0000', amount: 0.5 }),
        ]),
      ),
    ).toEqual([170, 0, 85, 192]);
  });
  it('combines blend modes with backdrop transparency at the layer boundary', () => {
    expect(
      bytes(
        renderEffects(image(1, 1, [128, 64, 255, 255]), [
          solid({ fillColor: '#808080', blendMode: 'multiply' }),
        ]),
      ),
    ).toEqual([64, 32, 128, 255]);
    expect(
      bytes(
        renderEffects(image(1, 1, [12, 250, 75, 0]), [
          solid({ fillColor: '#808080', blendMode: 'multiply' }),
        ]),
      ),
    ).toEqual([128, 128, 128, 255]);
  });
  it('supports multiple gradient stops, angle and coverage over transparent pixels', () => {
    const source = image(4, 1, [13, 21, 47, 0]);
    const e = solid({
      content: 'gradient',
      fillColor: '#ff0000',
      fillColorEnd: '#0000ff',
      fillColorStops:
        '[{"position":0,"color":"#ff0000"},{"position":0.5,"color":"#00ff00"},{"position":1,"color":"#0000ff"}]',
    });
    expect(bytes(renderEffects(source, [e]))).toEqual([
      191, 64, 0, 255, 64, 191, 0, 255, 0, 191, 64, 255, 0, 64, 191, 255,
    ]);
    const masked = { ...e, application: { region: 'left' as const, coverage: 0.5, softness: 0 } };
    expect(bytes(renderEffects(source, [masked]))).toEqual([
      191, 64, 0, 255, 64, 191, 0, 255, 13, 21, 47, 0, 13, 21, 47, 0,
    ]);
  });
  it('restores the immutable stage input rather than duplicating the incoming processed image', () => {
    const source = image(3, 2, [90, 170, 230, 255]);
    const crushed = createEffect('bit-crush', 'crush');
    const red = solid({ fillColor: '#ff0000' });
    expect(bytes(renderEffects(source, [crushed, red, solid({ content: 'source' })]))).toEqual(
      bytes(source),
    );
  });
  it('centers Fit margins, crops Fill and stretches imported images independently of canvas aspect', () => {
    const source = image(4, 4, [0, 0, 255, 255]),
      layer = image(4, 2, [255, 0, 0, 255]);
    const options = { layerImages: new Map([['layer-image', layer]]) };
    const fit = bytes(renderEffects(source, [attached('fit')], options));
    expect(fit.slice(0, 16)).toEqual(bytes(image(4, 1, [0, 0, 255, 255])));
    expect(fit.slice(16, 48)).toEqual(bytes(image(4, 2, [255, 0, 0, 255])));
    expect(fit.slice(48)).toEqual(bytes(image(4, 1, [0, 0, 255, 255])));
    for (const placement of ['fill', 'stretch'] as const)
      expect(bytes(renderEffects(source, [attached(placement)], options))).toEqual(
        bytes(image(4, 4, [255, 0, 0, 255])),
      );
  });
  it('uses embedded image alpha, painted masks, and treats an unchosen New Image as empty', () => {
    const source = image(4, 2, [0, 0, 255, 255]);
    expect(bytes(renderEffects(source, [solid({ content: 'image' })]))).toEqual(bytes(source));
    const e = {
      ...attached('stretch'),
      paintedMask: {
        version: 1 as const,
        enabled: true,
        inverted: false,
        base: 0 as const,
        width: 4,
        height: 2,
        strokes: [],
      },
    };
    const options = { layerImages: new Map([['layer-image', image(4, 2, [255, 0, 0, 128])]]) };
    expect(bytes(renderEffects(source, [attached('stretch')], options))).toEqual(
      bytes(image(4, 2, [128, 0, 127, 255])),
    );
    expect(bytes(renderEffects(source, [e], options))).toEqual(bytes(source));
    expect(() => renderEffects(source, [attached('fit')])).toThrow('not available');
  });
  it('agrees between async and sync rendering, supports cancellation and exact neutral bypasses', async () => {
    const source = image(32, 24, [13, 71, 92, 1]),
      e = solid({ content: 'gradient', amount: 0.7 });
    expect(
      await renderEffectsAsync(source, [e], { yieldControl: () => Promise.resolve() }),
    ).toEqual(renderEffects(source, [e]));
    await expect(
      renderEffectsAsync(source, [e], {
        yieldControl: () => Promise.resolve(),
        isCancelled: () => true,
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    for (const next of [
      solid({ amount: 0 }),
      { ...e, enabled: false },
      { ...e, application: { region: 'all' as const, coverage: 0, softness: 0 } },
    ])
      expect(bytes(renderEffects(source, [next]))).toEqual(bytes(source));
  });
});
