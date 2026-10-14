import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  parseGradientStops,
  gradientStops,
  type ScanlinesEffect,
  type GradientMapEffect,
} from '@gleech/project-model';
import { createColorSampler } from './color-gradient';
import { renderEffects } from './index';

const stops = JSON.stringify([
  { position: 0, color: '#ff0000' },
  { position: 0.25, color: '#00ff00' },
  { position: 1, color: '#0000ff' },
]);
describe('multi-stop gradients', () => {
  it('interpolates known colors using stop positions for fields and spatial ramps', () => {
    const p = { color: '#ff0000', colorEnd: '#0000ff', colorMode: 'gradient', colorStops: stops };
    const field = createColorSampler(p, 'color', '#000000', { width: 100, height: 100 }, true);
    expect([...field(0, 0, 0.125)]).toEqual([127.5, 127.5, 0]);
    expect([...field(0, 0, 0.25)]).toEqual([0, 255, 0]);
    expect([...field(0, 0, 0.625)]).toEqual([0, 127.5, 127.5]);
    const spatial = createColorSampler(p, 'color', '#000000', { width: 100, height: 100 });
    expect([...spatial(0.25, 0.5)]).toEqual([0, 255, 0]);
    expect([...field(0, 0, -1)]).toEqual([255, 0, 0]);
    expect([...field(0, 0, 2)]).toEqual([0, 0, 255]);
  });
  it('supports hard boundaries and legacy endpoint edits without discarding intermediate colors', () => {
    const hard = JSON.stringify([
      { position: 0, color: '#000000' },
      { position: 0.5, color: '#000000' },
      { position: 0.5, color: '#ffffff' },
      { position: 1, color: '#ffffff' },
    ]);
    const sample = createColorSampler(
      { color: '#000000', colorEnd: '#ffffff', colorMode: 'gradient', colorStops: hard },
      'color',
      '#000000',
      { width: 1, height: 1 },
      true,
    );
    expect([...sample(0, 0, 0.499)]).toEqual([0, 0, 0]);
    expect([...sample(0, 0, 0.5)]).toEqual([255, 255, 255]);
    expect(
      gradientStops({ colorStops: stops }, 'color', '#ffffff', '#000000').map((x) => x.color),
    ).toEqual(['#ffffff', '#00ff00', '#000000']);
  });
  it('rejects malformed, unsorted, unbounded and oversized stop data', () => {
    for (const value of [
      '{}',
      '[{}]',
      'not json',
      JSON.stringify([
        { position: 0.1, color: '#ff0000' },
        { position: 1, color: '#ffffff' },
      ]),
      JSON.stringify([
        { position: 0, color: '#ffffff' },
        { position: 0.8, color: '#ffffff' },
        { position: 0.2, color: '#ffffff' },
        { position: 1, color: '#ffffff' },
      ]),
      JSON.stringify(
        Array.from({ length: 17 }, (_, i) => ({ position: i / 16, color: '#ffffff' })),
      ),
    ])
      expect(() => parseGradientStops(value)).toThrow();
    const e = createEffect('scanlines', 'multi') as ScanlinesEffect;
    expect(() => assertEffect({ ...e, params: { ...e.params, colorStops: stops } })).not.toThrow();
    expect(() => assertEffect({ ...e, params: { ...e.params, colorStops: '[]x' } })).toThrow();
  });
  it('renders Gradient Map through its middle stop while retaining alpha', () => {
    const e = createEffect('gradient-map', 'map') as GradientMapEffect;
    const image = { width: 1, height: 1, pixels: new Uint8Array([128, 128, 128, 64]).buffer };
    const map = {
      ...e,
      params: {
        ...e.params,
        shadows: '#ff0000',
        highlights: '#0000ff',
        shadowsStops: JSON.stringify([
          { position: 0, color: '#ff0000' },
          { position: 128 / 255, color: '#00ff00' },
          { position: 1, color: '#0000ff' },
        ]),
      },
    };
    expect([...new Uint8Array(renderEffects(image, [map]).pixels)]).toEqual([0, 255, 0, 64]);
  });
});
