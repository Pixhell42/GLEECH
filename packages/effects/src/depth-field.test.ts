import { describe, expect, it } from 'vitest';
import { assertEffect, createEffect, type DepthFieldEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
const effect = (params: Partial<DepthFieldEffect['params']> = {}) => {
  const e = createEffect('depth-field', 'height') as DepthFieldEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const image = (width = 17, height = 13) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : (i * 13) % 256,
  ).buffer,
});
const bytes = (source: ReturnType<typeof image>, e: DepthFieldEffect) =>
  new Uint8Array(renderEffects(source, [e]).pixels);
describe('Manufactured height fields', () => {
  it('renders independent linear/radial heights and maps invert and range endpoints', () => {
    const source = { width: 5, height: 5, pixels: new Uint8Array(100).fill(255).buffer };
    const e = effect({ operation: 'field', fieldSource: 'linear', fieldScale: 100 });
    const out = bytes(source, e);
    // Height storage is float32; final byte rounding can differ by one at half values.
    [26, 77, 128, 179, 230].forEach((expected, x) =>
      expect(Math.abs(out[x * 4]! - expected)).toBeLessThanOrEqual(1),
    );
    const inverted = bytes(source, effect({ ...e.params, fieldInvert: 'on' }));
    expect(inverted[0]).toBe(229);
    expect(bytes(source, effect({ ...e.params, fieldNear: 0.5, fieldFar: 0.5 }))[0]).toBe(0);
    const radial = bytes(source, effect({ ...e.params, fieldSource: 'radial' }));
    expect(radial[(2 * 5 + 2) * 4]).toBe(255);
    expect(radial[0]).toBe(0);
  });
  it('uses immutable stage brightness through upstream edits and excludes hidden colors', () => {
    const source = {
      width: 2,
      height: 1,
      pixels: new Uint8Array([255, 255, 255, 0, 128, 128, 128, 255]).buffer,
    };
    const field = effect({ operation: 'field', fieldSource: 'brightness' });
    const out = bytes(source, field);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(128);
    const upstream = createEffect('hue-saturation', 'upstream');
    const white = { ...upstream, params: { ...upstream.params, lightness: 1 } } as typeof upstream;
    expect(new Uint8Array(renderEffects(source, [white, field]).pixels)).toEqual(out);
  });
  it('uses the color source height while tracking a subject through output alignment', () => {
    const source = { width: 12, height: 10, pixels: new Uint8Array(480).fill(255).buffer };
    const values = new Uint8Array(120);
    for (const x of [3, 4]) for (const y of [3, 4]) values[y * 12 + x] = 255;
    const reflection = createEffect('mirroring', 'aligned');
    const aligned = {
      ...reflection,
      params: {
        ...reflection.params,
        positionX: 0,
        sourceSide: 'opposite',
        outputAlignment: 'bottom-right',
      },
    } as typeof reflection;
    const options = { subjectMask: { width: 12, height: 10, values: values.buffer } };
    const brightness = effect({ fieldSource: 'brightness', strength: 20 });
    // A white photo and a thresholded ramp both produce height 1 everywhere.
    // The subject-tracking matte must use that same height, not its black RGB.
    const constant = effect({
      ...brightness.params,
      fieldSource: 'linear',
      fieldNear: 0,
      fieldFar: 0,
    });
    expect(new Uint8Array(renderEffects(source, [brightness, aligned], options).pixels)).toEqual(
      new Uint8Array(renderEffects(source, [constant, aligned], options).pixels),
    );
  });
  it('reuses the same saved field seed independently of effect identity, master seed and treatment', () => {
    const source = image(),
      e = effect({ fieldSource: 'perlin', fieldScale: 12, operation: 'field' });
    const out = bytes(source, e);
    expect(
      new Uint8Array(
        renderEffects(source, [{ ...e, instanceId: 'copy' }], { masterSeed: 123 }).pixels,
      ),
    ).toEqual(out);
    expect(bytes(source, effect({ ...e.params, fieldSeed: e.params.fieldSeed + 1 }))).not.toEqual(
      out,
    );
    for (const fieldSource of ['simplex', 'value', 'voronoi', 'shapes'] as const)
      expect(bytes(source, effect({ ...e.params, fieldSource }))).not.toEqual(out);
    for (const operation of ['displace', 'contours', 'relief'] as const)
      expect(bytes(source, effect({ ...e.params, operation }))).not.toEqual(out);
  });
  it('keeps uniform relief neutral, zero displacement exact and application masks effective', () => {
    const source = {
      width: 5,
      height: 5,
      pixels: Uint8Array.from({ length: 100 }, (_, i) => [80, 120, 160, 128][i % 4]!).buffer,
    };
    expect(bytes(source, effect({ operation: 'relief', fieldSource: 'brightness' }))).toEqual(
      new Uint8Array(source.pixels),
    );
    expect(bytes(source, effect({ strength: 0 }))).toEqual(new Uint8Array(source.pixels));
    const e = effect({ fieldSource: 'shapes' });
    expect(
      bytes(source, { ...e, application: { region: 'all', coverage: 0, softness: 0 } }),
    ).toEqual(new Uint8Array(source.pixels));
  });
  it('smooths and normalizes finite bounded fields and cancels expensive generation', async () => {
    const source = image(256, 192),
      e = effect({
        fieldSource: 'voronoi',
        fieldNormalize: 'on',
        fieldSmoothing: 4,
        operation: 'field',
      });
    const out = bytes(source, e);
    expect(out.length).toBe(source.width * source.height * 4);
    expect(() => assertEffect(effect({ fieldDetail: 7 }))).toThrow();
    let polls = 0;
    await expect(
      renderEffectsAsync(source, [e], {
        isCancelled: () => ++polls > 4,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
