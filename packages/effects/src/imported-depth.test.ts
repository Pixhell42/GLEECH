import { describe, expect, it } from 'vitest';
import {
  createEffect,
  type DepthFieldEffect,
  type BlurEffect,
  type RecursiveSpaceEffect,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync } from './index';
import { createHeightField } from './depth-field';
import { heightFieldParams } from '@gleech/project-model';
const source = { width: 5, height: 1, pixels: new Uint8Array(20).fill(255).buffer };
const map = {
  width: 5,
  height: 1,
  pixels: Uint8Array.from([
    0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 192, 192, 192, 255, 255, 255, 255, 255,
  ]).buffer,
};
const attached = {
  source: {
    id: 'map',
    name: 'map.png',
    width: 5,
    height: 1,
    format: 'png' as const,
    hasAlpha: false,
  },
  png: '',
};
const field = (params: Partial<DepthFieldEffect['params']> = {}): DepthFieldEffect => {
  const e = createEffect('depth-field', 'field') as DepthFieldEffect;
  return {
    ...e,
    fieldImage: attached,
    params: {
      ...e.params,
      operation: 'field',
      fieldSource: 'image',
      fieldScale: 100,
      fieldSmoothing: 0,
      fieldFalloff: 0,
      ...params,
    },
  };
};
const layers = new Map([['map', map]]);
const values = (e: DepthFieldEffect) =>
  Array.from(new Uint8Array(renderEffects(source, [e], { layerImages: layers }).pixels)).filter(
    (_, i) => i % 4 === 0,
  );
describe('imported depth maps', () => {
  it('bounds draft field work to the requested grid while leaving full field resolution intact', () => {
    const p = heightFieldParams({ fieldSource: 'image', fieldScale: 100 });
    const imported = {
      width: 512,
      height: 512,
      pixels: new Uint8Array(512 * 512 * 4).fill(255).buffer,
    };
    let samples = 0;
    const sample = (
      _pixels: Uint8Array,
      _width: number,
      _height: number,
      _x: number,
      _y: number,
      color: Float64Array,
    ) => {
      samples++;
      color.fill(255);
    };
    function run(maximum?: number) {
      const generator = createHeightField(
        source,
        { width: 512, height: 384 },
        p,
        sample,
        () => 0,
        imported,
        maximum,
      );
      for (;;) {
        const result = generator.next();
        if (result.done) return result.value;
      }
    }
    const full = run();
    expect([full.width, full.height, samples]).toEqual([512, 384, 512 * 384]);
    samples = 0;
    const draft = run(64);
    expect([draft.width, draft.height, samples]).toEqual([64, 48, 64 * 48]);
    expect(draft.values.every((value) => value === 1)).toBe(true);
    expect(run().values).toEqual(full.values);
    expect(() => run(NaN)).toThrow('Invalid draft field');
  });
  it('reads grayscale height instead of the stage image', () =>
    expect(values(field())).toEqual([0, 64, 128, 192, 255]));
  it('retains Invert, Normalize, Near/Far, Contrast and hard falloff', () => {
    expect(values(field({ fieldInvert: 'on' }))).toEqual([255, 191, 127, 63, 0]);
    expect(values(field({ fieldFar: 0.25, fieldNear: 0.75 }))).toEqual([0, 1, 129, 255, 255]);
    expect(values(field({ fieldContrast: 2 }))).toEqual([0, 1, 129, 255, 255]);
    const low = {
      ...map,
      pixels: Uint8Array.from([
        64, 64, 64, 255, 96, 96, 96, 255, 128, 128, 128, 255, 160, 160, 160, 255, 192, 192, 192,
        255,
      ]).buffer,
    };
    const result = renderEffects(source, [field({ fieldNormalize: 'on' })], {
      layerImages: new Map([['map', low]]),
    });
    expect(Array.from(new Uint8Array(result.pixels)).filter((_, i) => i % 4 === 0)).toEqual([
      0, 64, 128, 191, 255,
    ]);
  });
  it('positions and rotates the map independently from the image', () => {
    expect(values(field({ fieldX: 70 }))).toEqual([0, 0, 64, 128, 192]);
    expect(values(field({ fieldRotation: 180 }))).toEqual([255, 192, 128, 64, 0]);
  });
  it('skips an unchosen map and reports unavailable attached pixels', () => {
    const e = field();
    delete (e as { fieldImage?: unknown }).fieldImage;
    expect(renderEffects(source, [e]).pixels).toBe(source.pixels);
    expect(() => renderEffects(source, [field()])).toThrow('Choose a depth map');
  });
  it('accepts the same map in all three field consumers', async () => {
    const blur = createEffect('blur', 'blur') as BlurEffect;
    const recursive = createEffect('recursive-space', 'recursive') as RecursiveSpaceEffect;
    for (const e of [
      field(),
      {
        ...blur,
        fieldImage: attached,
        params: {
          ...blur.params,
          style: 'depth' as const,
          fieldSource: 'image' as const,
          fieldScale: 100,
        },
      },
      {
        ...recursive,
        fieldImage: attached,
        params: {
          ...recursive.params,
          fieldEnabled: 'on' as const,
          fieldSource: 'image' as const,
          fieldScale: 100,
        },
      },
    ]) {
      expect(
        await renderEffectsAsync(source, [e], {
          layerImages: layers,
          yieldControl: async () => {},
        }),
      ).toEqual(renderEffects(source, [e], { layerImages: layers }));
    }
  });
  it('keeps imported details beyond the old 256px field grid', () => {
    const width = 1024,
      image = { width, height: 1, pixels: new Uint8Array(width * 4).fill(255).buffer };
    const details = {
      ...image,
      pixels: Uint8Array.from({ length: width * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (Math.floor(i / 4) % 2) * 255,
      ).buffer,
    };
    const e = { ...field(), fieldImage: { ...attached, source: { ...attached.source, width } } };
    expect(renderEffects(image, [e], { layerImages: new Map([['map', details]]) })).toEqual(
      details,
    );
  });
});
