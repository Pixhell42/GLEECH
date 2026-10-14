import { describe, expect, it } from 'vitest';
import {
  createEffect,
  type EffectInstance,
  type MotionMoshEffect,
  type ShapesEffect,
  type MandelbrotEffect,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

function fixture(width = 40, height = 30, opaque = false) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set(
        [
          (x * 17) % 256,
          (y * 23) % 256,
          ((x ^ y) * 5) % 256,
          opaque ? 255 : [0, 64, 128, 255][x % 4]!,
        ],
        (y * width + x) * 4,
      );
  return { width, height, pixels: pixels.buffer };
}
const mosh = (params: Partial<MotionMoshEffect['params']> = {}) =>
  ({
    ...createEffect('motion-mosh', 'motion'),
    params: { ...createEffect('motion-mosh', 'motion').params, ...params },
  }) as MotionMoshEffect;
const shape = (params: Partial<ShapesEffect['params']> = {}) =>
  ({
    ...createEffect('shapes', 'primitive'),
    params: { ...createEffect('shapes', 'primitive').params, ...params },
  }) as ShapesEffect;
const fractal = (params: Partial<MandelbrotEffect['params']> = {}) =>
  ({
    ...createEffect('mandelbrot', 'fractal'),
    params: { ...createEffect('mandelbrot', 'fractal').params, operation: 'texture', ...params },
  }) as MandelbrotEffect;
const render = (image: ReturnType<typeof fixture>, effect: EffectInstance, masterSeed = 0) =>
  new Uint8Array(renderEffects(image, [effect], { masterSeed }).pixels);
const pixel = (pixels: Uint8Array, width: number, x: number, y: number) => [
  ...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];

describe('Motion Mosh', () => {
  it('averages retained samples in premultiplied color instead of replacing the entire trail with its head', () => {
    const image = fixture(20, 10);
    // At (3,1), the original sample is [51,23,10,255] and the final sample
    // two pixels left is [17,23,0,64]. Equal weights give alpha 159.5,
    // with RGB weighted by the original alphas rather than by hidden colors.
    expect(
      pixel(
        render(image, mosh({ density: 1, travel: 20, trailLength: 1, samples: 2, persistence: 1 })),
        20,
        3,
        1,
      ),
    ).toEqual([44, 23, 8, 160]);
  });
  it('moves source blocks in the selected direction with independently known integer coordinates and alpha', () => {
    const image = fixture(20, 10);
    const source = new Uint8Array(image.pixels);
    for (const [direction, dx, dy] of [
      [0, 1, 0],
      [90, 0, 1],
      [180, -1, 0],
      [270, 0, -1],
    ] as const) {
      const out = render(image, mosh({ density: 1, travel: 10, direction, samples: 1 }));
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 20; x++) {
          expect(pixel(out, 20, x, y)).toEqual(
            pixel(
              source,
              20,
              Math.max(0, Math.min(19, x - dx!)),
              Math.max(0, Math.min(9, y - dy!)),
            ),
          );
        }
    }
  });
  it('Wrap samples the opposite edge and Mirror reflects it', () => {
    const image = fixture(20, 10);
    const source = new Uint8Array(image.pixels);
    expect(
      pixel(
        render(image, mosh({ density: 1, travel: 20, samples: 1, edgeHandling: 'wrap' })),
        20,
        0,
        0,
      ),
    ).toEqual(pixel(source, 20, 18, 0));
    expect(
      pixel(
        render(image, mosh({ density: 1, travel: 20, samples: 1, edgeHandling: 'mirror' })),
        20,
        0,
        0,
      ),
    ).toEqual(pixel(source, 20, 1, 0));
  });
  it('retains earlier block positions, controls their decay, and reproduces seed variations', () => {
    const image = fixture(80, 60);
    const base = mosh({
      blockSize: 8,
      density: 0.35,
      travel: 40,
      trailLength: 1,
      persistence: 0.8,
      samples: 12,
    });
    const out = render(image, base, 8172);
    expect(out).toEqual(render(image, base, 8172));
    expect(out).not.toEqual(render(image, { ...base, seedOffset: 1 }, 8172));
    expect(out).not.toEqual(render(image, base, 19));
    expect(out).not.toEqual(render(image, mosh({ ...base.params, trailLength: 0 }), 8172));
    expect(out).not.toEqual(render(image, mosh({ ...base.params, persistence: 0.2 }), 8172));
    expect(render(image, mosh({ ...base.params, density: 1 }), 8172)).not.toEqual(
      render(image, mosh({ ...base.params, density: 1, trailLength: 0 }), 8172),
    );
    expect(render(image, mosh({ ...base.params, persistence: 0 }), 8172)).toEqual(
      render(image, mosh({ ...base.params, samples: 1 }), 8172),
    );
    for (const params of [{ travel: 0 }, { density: 0 }, { amount: 0 }])
      expect(renderEffects(image, [mosh(params)]).pixels).toBe(image.pixels);
  });
  it('keeps original-coordinate displacement at reduced preview resolutions', () => {
    const image = fixture(20, 10);
    const effect = mosh({ density: 1, travel: 10, samples: 1 });
    const fullReference = new Uint8Array(
      renderEffects(image, [effect], { reference: { width: 200, height: 100 } }).pixels,
    );
    expect(fullReference).toEqual(render(image, effect));
  });
});

describe('Shapes', () => {
  it('keeps a centered disk, cuts its complement, and preserves hidden source colors', () => {
    const image = fixture(21, 21, true);
    const keep = render(image, shape({ size: 50 }));
    const cut = render(image, shape({ size: 50, operation: 'cut-out' }));
    expect(pixel(keep, 21, 10, 10)[3]).toBe(255);
    expect(pixel(keep, 21, 0, 0)[3]).toBe(0);
    expect(pixel(cut, 21, 10, 10)[3]).toBe(0);
    for (let i = 0; i < keep.length; i += 4) {
      expect(keep[i + 3]! + cut[i + 3]!).toBe(255);
      expect(keep.subarray(i, i + 3)).toEqual(new Uint8Array(image.pixels).subarray(i, i + 3));
    }
  });
  it('renders all four primitives, rotates the triangle, positions/scales independently, and fills a 100% ring', () => {
    const image = fixture(41, 41, true);
    const outputs = ['triangle', 'square', 'circle', 'ring'].map((primitive) =>
      render(image, shape({ shape: primitive as ShapesEffect['params']['shape'], size: 70 })),
    );
    expect(new Set(outputs.map((out) => out.join(','))).size).toBe(4);
    expect(pixel(outputs[3]!, 41, 20, 20)[3]).toBe(0);
    expect(render(image, shape({ shape: 'ring', ringThickness: 1 }))).toEqual(
      render(image, shape({ shape: 'circle' })),
    );
    expect(pixel(render(image, shape({ shape: 'triangle', size: 80 })), 41, 8, 30)[3]).toBe(255);
    expect(
      pixel(render(image, shape({ shape: 'triangle', size: 80, rotation: 180 })), 41, 8, 30)[3],
    ).toBe(0);
    expect(render(image, shape({ scale: 2, size: 30 }))).toEqual(
      render(image, shape({ scale: 1, size: 60 })),
    );
    const moved = render(image, shape({ size: 25, positionX: 25, positionY: 25 }));
    expect(pixel(moved, 41, 10, 10)[3]).toBe(255);
    expect(pixel(moved, 41, 20, 20)[3]).toBe(0);
  });
  it('feathers edges, colors overlays without creating opacity, and distorts content independently of the boundary', () => {
    const image = fixture(41, 41, true);
    const sharp = render(image, shape({ size: 50 }));
    const soft = render(image, shape({ size: 50, feather: 15 }));
    expect(soft).not.toEqual(sharp);
    expect(
      [...soft].filter((value, i) => i % 4 === 3 && value > 0 && value < 255).length,
    ).toBeGreaterThan(
      [...sharp].filter((value, i) => i % 4 === 3 && value > 0 && value < 255).length,
    );
    const transparent = fixture(41, 41);
    const overlay = render(
      transparent,
      shape({ operation: 'overlay', shapeColor: '#4080e0', size: 200 }),
    );
    for (let i = 3; i < overlay.length; i += 4)
      expect(overlay[i]).toBe(new Uint8Array(transparent.pixels)[i]);
    expect(pixel(overlay, 41, 20, 20).slice(0, 3)).toEqual([64, 128, 224]);
    expect(render(image, shape({ operation: 'distort' }))).not.toEqual(
      new Uint8Array(image.pixels),
    );
    expect(
      renderEffects(image, [shape({ operation: 'distort', distortionScale: 1, twist: 0 })]).pixels,
    ).toBe(image.pixels);
  });
});

describe('Mandelbrot', () => {
  it('classifies known interior/exterior complex points and paints the selected interior color', () => {
    const image = fixture(1, 1, true);
    for (const real of [0, -1, -0.5]) {
      expect(
        pixel(
          render(image, fractal({ centerReal: real, zoom: 100, insideColor: '#123456' })),
          1,
          0,
          0,
        ),
      ).toEqual([18, 52, 86, 255]);
      expect(
        render(image, fractal({ operation: 'keep-set', centerReal: real, zoom: 100 }))[3],
      ).toBe(255);
      expect(render(image, fractal({ operation: 'cut-out', centerReal: real, zoom: 100 }))[3]).toBe(
        0,
      );
    }
    expect(render(image, fractal({ operation: 'keep-set', centerReal: 1, zoom: 100 }))[3]).toBe(0);
    expect(render(image, fractal({ operation: 'cut-out', centerReal: 1, zoom: 100 }))[3]).toBe(255);
  });
  it('uses z²+c escape steps for exterior palette bands, independently of image resolution', () => {
    // c=1: 0 -> 1 -> 2 -> 5 escapes after exactly three steps.
    const image = fixture(1, 1, true);
    const out = render(
      image,
      fractal({
        centerReal: 1,
        centerImaginary: 0,
        paletteCycles: 2,
        paletteOffset: 0.2,
        outsideColor: '#ffffff',
        insideColor: '#000000',
      }),
    );
    const expected = Math.round(
      255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * ((2 * Math.log(4)) / Math.log(65) + 0.2))),
    );
    expect([...out]).toEqual([expected, expected, expected, 255]);
  });
  it('changes viewport, palette and orbit distortion; retains alpha for texture and exact zero-distortion no-op', () => {
    const image = fixture(40, 30);
    const out = render(image, fractal());
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(new Uint8Array(image.pixels)[i]);
    for (const params of [
      { zoom: 2 },
      { centerImaginary: 0.4 },
      { rotation: 45 },
      { paletteOffset: 0.2 },
      { iterations: 16 },
    ])
      expect(render(image, fractal(params))).not.toEqual(out);
    const distorted = fractal({ operation: 'distort', distortion: 20 });
    expect(render(image, distorted)).not.toEqual(new Uint8Array(image.pixels));
    expect(render(image, distorted)).toEqual(render(image, distorted));
    expect(renderEffects(image, [fractal({ operation: 'distort', distortion: 0 })]).pixels).toBe(
      image.pixels,
    );
  });
});

describe('new filter integration', () => {
  it('applies amount, directional and subject masks after the result, with identical async output', async () => {
    const image = fixture();
    for (const effect of [mosh(), shape(), fractal()]) {
      const source = new Uint8Array(image.pixels);
      const masked = {
        ...effect,
        application: { region: 'left', coverage: 0.5, softness: 0 },
      } as EffectInstance;
      const out = render(image, masked);
      for (let y = 0; y < image.height; y++)
        for (let x = 21; x < image.width; x++)
          expect(pixel(out, image.width, x, y)).toEqual(pixel(source, image.width, x, y));
      const subject = {
        ...effect,
        application: { region: 'subject', coverage: 1, softness: 0 },
      } as EffectInstance;
      expect(
        new Uint8Array(
          renderEffects(image, [subject], {
            subjectMask: { width: 1, height: 1, values: new Uint8Array([0]).buffer },
          }).pixels,
        ),
      ).toEqual(source);
      expect(
        new Uint8Array(
          (await renderEffectsAsync(image, [effect], { yieldControl: async () => {} })).pixels,
        ),
      ).toEqual(render(image, effect));
      expect(renderEffects(image, [{ ...effect, enabled: false }]).pixels).toBe(image.pixels);
      expect(
        renderEffects(image, [
          { ...effect, params: { ...effect.params, amount: 0 } } as EffectInstance,
        ]).pixels,
      ).toBe(image.pixels);
      expect(
        render(image, { ...effect, params: { ...effect.params, amount: 0.5 } } as EffectInstance),
      ).not.toEqual(render(image, effect));
    }
  });
  it('cancels bounded work, including within wide fractal rows, without modifying its source', async () => {
    const image = fixture(2048, 4);
    const source = new Uint8Array(image.pixels).slice();
    for (const effect of [
      mosh({ samples: 16 }),
      shape(),
      fractal({ iterations: 192, operation: 'distort' }),
    ]) {
      let checks = 0;
      expect(() => renderEffects(image, [effect], { isCancelled: () => ++checks > 3 })).toThrow(
        RenderCancelledError,
      );
      checks = 0;
      await expect(
        renderEffectsAsync(image, [effect], {
          isCancelled: () => ++checks > 3,
          yieldControl: async () => {},
        }),
      ).rejects.toThrow(RenderCancelledError);
      expect(new Uint8Array(image.pixels)).toEqual(source);
    }
  });
});
