import { describe, expect, it, vi } from 'vitest';
import {
  createEffect,
  createPaintedMask,
  DEFAULT_MASK_BRUSH,
  type EffectInstance,
} from '@gleech/project-model';
import {
  PreviewStackCache,
  renderEffects,
  renderEffectsAsync,
  RenderCancelledError,
} from './index';

const image = {
  width: 48,
  height: 32,
  pixels: Uint8Array.from({ length: 48 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 17) % 251))
    .buffer,
};
const stack = (): EffectInstance[] => [
  createEffect('shader-ripple', 'one'),
  createEffect('shader-hologram', 'two'),
  createEffect('scanlines', 'last'),
];
const executor = () =>
  vi.fn(async (input: typeof image) => {
    const pixels = new Uint8Array(input.pixels).slice();
    for (let i = 0; i < pixels.length; i++) if (i % 4 !== 3) pixels[i] = (pixels[i]! + 7) % 255;
    return pixels.buffer;
  });
describe('draft stack checkpoints', () => {
  it('keeps adaptive resolution changes warm without reusing stale recipes', async () => {
    const effects = stack(),
      renderShader = executor(),
      previewStackCache = new PreviewStackCache();
    const small = { width: 24, height: 16, pixels: image.pixels.slice(0, 24 * 16 * 4) };
    const options = { previewStackCache, renderShader, yieldControl: async () => {} };
    await renderEffectsAsync(image, effects, options);
    await renderEffectsAsync(small, effects, options);
    renderShader.mockClear();
    await renderEffectsAsync(image, effects, options);
    await renderEffectsAsync(small, effects, options);
    expect(renderShader).toHaveBeenCalledTimes(0);
    const edited: EffectInstance[] = [{ ...effects[0]!, seedOffset: 3 }, ...effects.slice(1)];
    for (const source of [image, small]) {
      renderShader.mockClear();
      const actual = await renderEffectsAsync(source, edited, options);
      expect(renderShader).toHaveBeenCalledTimes(2);
      const expected = await renderEffectsAsync(source, edited, {
        ...options,
        previewStackCache: undefined,
      });
      expect(new Uint8Array(actual.pixels)).toEqual(new Uint8Array(expected.pixels));
    }
  });
  it('skips unchanged preceding shaders, retaining exact finishing and painted masks', async () => {
    const effects = stack(),
      renderShader = executor(),
      previewStackCache = new PreviewStackCache();
    const options = {
      previewStackCache,
      renderShader,
      yieldControl: async () => {},
      masterSeed: 27,
    };
    const before = await renderEffectsAsync(image, effects, options);
    structuredClone(before.pixels, { transfer: [before.pixels] });
    const mask = {
      ...createPaintedMask(48, 32),
      strokes: [{ ...DEFAULT_MASK_BRUSH, points: [{ x: 0.5, y: 0.5 }] }],
    };
    const edited: EffectInstance[] = [
      ...effects.slice(0, 2),
      { ...effects[2]!, paintedMask: mask },
    ];
    renderShader.mockClear();
    const actual = await renderEffectsAsync(image, edited, options);
    expect(renderShader).toHaveBeenCalledTimes(0);
    const expected = await renderEffectsAsync(image, edited, {
      ...options,
      previewStackCache: undefined,
    });
    expect(new Uint8Array(actual.pixels)).toEqual(new Uint8Array(expected.pixels));
  });
  it('invalidates downstream layers for a middle edit, reorder, seed, source and subject change', async () => {
    const effects = stack(),
      renderShader = executor(),
      previewStackCache = new PreviewStackCache();
    const options = {
      previewStackCache,
      renderShader,
      yieldControl: async () => {},
      masterSeed: 27,
    };
    await renderEffectsAsync(image, effects, options);
    renderShader.mockClear();
    const edited = [
      effects[0]!,
      { ...effects[1]!, seedOffset: 13 },
      effects[2]!,
    ] as EffectInstance[];
    const cached = await renderEffectsAsync(image, edited, options);
    expect(renderShader).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(cached.pixels)).toEqual(
      new Uint8Array(
        (await renderEffectsAsync(image, edited, { ...options, previewStackCache: undefined }))
          .pixels,
      ),
    );
    for (const [source, recipe, settings] of [
      [image, [edited[1]!, edited[0]!, edited[2]!], options],
      [image, edited, { ...options, masterSeed: 28 }],
      [{ ...image, pixels: image.pixels.slice(0) }, edited, options],
      [
        image,
        edited,
        { ...options, subjectMask: { width: 1, height: 1, values: new Uint8Array([255]).buffer } },
      ],
    ] as const) {
      renderShader.mockClear();
      await renderEffectsAsync(source, recipe, settings);
      expect(renderShader).toHaveBeenCalledTimes(2);
    }
  });
  it('cancelled rendering never publishes partial checkpoints', async () => {
    const effects = stack(),
      previewStackCache = new PreviewStackCache(),
      renderShader = executor();
    let cancelled = false;
    const options = { previewStackCache, yieldControl: async () => {}, renderShader };
    await expect(
      renderEffectsAsync(image, effects, {
        ...options,
        isCancelled: () => cancelled,
        renderShader: async (...args) => {
          const result = await renderShader(args[0]);
          cancelled = true;
          return result;
        },
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    renderShader.mockClear();
    await renderEffectsAsync(image, effects, options);
    expect(renderShader).toHaveBeenCalledTimes(2);
  });
  it('retains original stage heights and palette analysis when resuming midway', () => {
    const haze = createEffect('depth-haze', 'haze');
    if (haze.type !== 'depth-haze') throw new Error('Expected depth fixture.');
    const effects = [
      createEffect('channel-transform', 'channels'),
      haze,
      createEffect('indexed-palette', 'palette'),
    ];
    const previewStackCache = new PreviewStackCache();
    renderEffects(image, effects, { previewStackCache });
    const edited = [
      effects[0]!,
      { ...haze, params: { ...haze.params, amount: 0.7 } },
      effects[2]!,
    ] as EffectInstance[];
    expect(renderEffects(image, edited, { previewStackCache })).toEqual(
      renderEffects(image, edited),
    );
  });
  it('bypasses full-size images and alignment matte rendering', () => {
    const previewStackCache = new PreviewStackCache();
    expect(previewStackCache.begin({ ...image, width: 1024 }, stack(), {})).toBeNull();
    const e = createEffect('mirroring', 'aligned');
    if (e.type !== 'mirroring') throw new Error('Expected mirroring fixture.');
    const effects = [
      { ...e, params: { ...e.params, outputAlignment: 'center' } },
    ] as EffectInstance[];
    const subjectMask = { width: 1, height: 1, values: new Uint8Array([255]).buffer };
    expect(renderEffects(image, effects, { previewStackCache, subjectMask })).toEqual(
      renderEffects(image, effects, { subjectMask }),
    );
  });
});
