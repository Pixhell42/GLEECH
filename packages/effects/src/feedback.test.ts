import { describe, expect, it } from 'vitest';
import { createEffect, assertEffect, type FeedbackBloomEffect } from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const fixture = (width = 17, height = 13) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : (i * 13) % 256,
  ).buffer,
});
const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);
const effect = (params: Partial<FeedbackBloomEffect['params']> = {}) => {
  const e = createEffect('feedback-bloom', 'feedback') as FeedbackBloomEffect;
  return { ...e, params: { ...e.params, ...params } };
};
describe('Feedback Bloom / Melt', () => {
  it('repeatedly rotates the preceding result rather than sampling only the source', () => {
    const image = fixture(5, 5);
    const e = effect({
      iterations: 2,
      rotation: 30,
      scale: 1,
      displacement: 0,
      persistence: 1,
      refresh: 0,
      decay: 0,
    });
    const once = effect({ ...e.params, iterations: 1 });
    const intermediate = renderEffects(image, [once]);
    expect(bytes(renderEffects(image, [e]).pixels)).toEqual(
      bytes(renderEffects(intermediate, [once]).pixels),
    );
    expect(bytes(renderEffects(image, [e]).pixels)).not.toEqual(bytes(intermediate.pixels));
  });
  it('preserves hidden RGB and alpha exactly for identity, zero opacity and no persistence', () => {
    const image = fixture();
    for (const p of [
      { persistence: 0 },
      { amount: 0 },
      { displacement: 0, scale: 1, rotation: 0, decay: 0 },
      { refresh: 1 },
    ])
      expect(bytes(renderEffects(image, [effect(p)]).pixels)).toEqual(bytes(image.pixels));
  });
  it('decays transparency using premultiplied sampling without introducing hidden color fringes', () => {
    const image = { width: 1, height: 1, pixels: new Uint8Array([120, 80, 40, 200]).buffer };
    const p = effect({
      iterations: 2,
      displacement: 0,
      scale: 1,
      rotation: 0,
      persistence: 1,
      decay: 0.5,
      refresh: 0,
    });
    expect([...new Uint8Array(renderEffects(image, [p]).pixels)]).toEqual([120, 80, 40, 50]);
  });
  it('reproduces seeded patches, distinguishes styles and obeys masks and edges', () => {
    const image = fixture();
    const e = effect({ refresh: 0.4, coherence: 10, displacement: 8 });
    const out = renderEffects(image, [e], { masterSeed: 9 });
    expect(renderEffects(image, [e], { masterSeed: 9 })).toEqual(out);
    expect(
      bytes(renderEffects(image, [{ ...e, seedOffset: 1 }], { masterSeed: 9 }).pixels),
    ).not.toEqual(bytes(out.pixels));
    expect(
      bytes(renderEffects(image, [effect({ ...e.params, style: 'melt' })]).pixels),
    ).not.toEqual(bytes(out.pixels));
    expect(
      bytes(
        renderEffects(image, [
          effect({ ...e.params, style: 'melt', scale: 0.8, edgeHandling: 'wrap' }),
        ]).pixels,
      ),
    ).not.toEqual(
      bytes(
        renderEffects(image, [
          effect({ ...e.params, style: 'melt', scale: 0.8, edgeHandling: 'extend' }),
        ]).pixels,
      ),
    );
    expect(
      bytes(
        renderEffects(image, [{ ...e, application: { region: 'all', coverage: 0, softness: 0 } }])
          .pixels,
      ),
    ).toEqual(bytes(image.pixels));
  });
  it('bounds iterations and cancels during feedback passes without altering the input', async () => {
    expect(() => assertEffect(effect({ iterations: 25 }))).toThrow();
    const image = fixture(128, 96),
      before = image.pixels.slice(0);
    let polls = 0;
    await expect(
      renderEffectsAsync(image, [effect({ iterations: 24 })], {
        isCancelled: () => ++polls > 4,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(bytes(image.pixels)).toEqual(bytes(before));
  });
});
