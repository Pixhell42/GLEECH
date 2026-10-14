import { describe, expect, it } from 'vitest';
import { createEffect, deriveEffectSeed, type WaveDistortionEffect } from '@gleech/project-model';
import { cellRandom, renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const wave = createEffect('wave-distortion', 'wave') as WaveDistortionEffect;
const withParams = (params: Partial<WaveDistortionEffect['params']>): WaveDistortionEffect => ({
  ...wave,
  params: { ...wave.params, ...params },
});
function ramp(width = 32, height = 16, alpha = 255) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set(
        [Math.round(((x + 0.5) * 255) / width), Math.round(((y + 0.5) * 255) / height), 71, alpha],
        (y * width + x) * 4,
      );
  return { width, height, pixels: pixels.buffer };
}
const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);

describe('wave distortion version 1', () => {
  it('moves pixels by the sine displacement at 0° and 90°, clamping borders and leaving the input unchanged', () => {
    const image = ramp();
    const original = bytes(image.pixels).slice();
    const phase = cellRandom(deriveEffectSeed(19, wave.instanceId), 0, 0, 5) * Math.PI * 2;
    for (const direction of [0, 90]) {
      const effect = withParams({ strength: 25, frequency: 2, direction });
      const output = bytes(renderEffects(image, [effect], { masterSeed: 19 }).pixels);
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const coordinate =
            direction === 0 ? y + 0.5 - image.height / 2 : -(x + 0.5 - image.width / 2);
          const delta =
            Math.sin((coordinate * Math.PI * 4) / image.height + phase) * image.height * 0.25;
          const sx = Math.max(0, Math.min(image.width - 1, x - (direction === 0 ? delta : 0)));
          const sy = Math.max(0, Math.min(image.height - 1, y - (direction === 90 ? delta : 0)));
          const index = (y * image.width + x) * 4;
          // Independent interpolation oracle for these two axis-aligned ramps.
          const lowX = Math.floor(sx),
            lowY = Math.floor(sy);
          const redA = original[(y * image.width + lowX) * 4]!;
          const redB = original[(y * image.width + Math.min(lowX + 1, image.width - 1)) * 4]!;
          const greenA = original[(lowY * image.width + x) * 4 + 1]!;
          const greenB =
            original[(Math.min(lowY + 1, image.height - 1) * image.width + x) * 4 + 1]!;
          expect(output[index]).toBe(Math.round(redA + (redB - redA) * (sx - lowX)));
          expect(output[index + 1]).toBe(Math.round(greenA + (greenB - greenA) * (sy - lowY)));
          expect(output[index + 2]).toBe(71);
          expect(output[index + 3]).toBe(255);
        }
    }
    expect(bytes(image.pixels)).toEqual(original);
  });
  it('interpolates transparency without contaminating visible colors with hidden RGB', () => {
    const image = {
      width: 2,
      height: 1,
      pixels: new Uint8Array([255, 0, 0, 0, 0, 200, 0, 255]).buffer,
    };
    let seed = 0;
    while (
      Math.sin(cellRandom(deriveEffectSeed(seed, wave.instanceId), 0, 0, 5) * Math.PI * 2) < 0.5
    )
      seed++;
    const shift =
      Math.sin(cellRandom(deriveEffectSeed(seed, wave.instanceId), 0, 0, 5) * Math.PI * 2) * 0.25;
    const effect = withParams({ strength: 25 });
    const output = bytes(renderEffects(image, [effect], { masterSeed: seed }).pixels);
    expect([...output.subarray(4)]).toEqual([0, 200, 0, Math.round(255 * (1 - shift))]);
    expect([...output.subarray(0, 4)]).toEqual([255, 0, 0, 0]);
    const transparent = { ...image, pixels: new Uint8Array([255, 0, 0, 0, 0, 200, 0, 0]).buffer };
    const hidden = bytes(renderEffects(transparent, [effect], { masterSeed: seed }).pixels);
    expect([...hidden.subarray(4)]).toEqual([
      Math.round(255 * shift),
      Math.round(200 * (1 - shift)),
      0,
      0,
    ]);
  });
  it('reproduces seeded waves and varies with the master seed, instance ID and New pattern offset', () => {
    const image = ramp();
    const rendered = renderEffects(image, [wave], { masterSeed: 8172 }).pixels;
    expect(bytes(renderEffects(image, [wave], { masterSeed: 8172 }).pixels)).toEqual(
      bytes(rendered),
    );
    for (const [effect, seed] of [
      [wave, 8173],
      [{ ...wave, instanceId: 'other' }, 8172],
      [{ ...wave, seedOffset: 1 }, 8172],
    ] as const)
      expect(bytes(renderEffects(image, [effect], { masterSeed: seed }).pixels)).not.toEqual(
        bytes(rendered),
      );
    expect(
      bytes(renderEffects(image, [withParams({ direction: 360 })], { masterSeed: 8172 }).pixels),
    ).toEqual(bytes(rendered));
    expect(
      bytes(renderEffects(image, [withParams({ direction: 45 })], { masterSeed: 8172 }).pixels),
    ).not.toEqual(bytes(rendered));
  });
  it('preserves every byte for disabled, zero strength, zero amount and zero coverage, and blends Amount', () => {
    const image = ramp();
    for (const effect of [
      { ...wave, enabled: false },
      withParams({ strength: 0 }),
      withParams({ amount: 0 }),
      { ...wave, application: { ...wave.application, coverage: 0 } },
    ])
      expect(renderEffects(image, [effect]).pixels).toBe(image.pixels);
    const full = bytes(renderEffects(image, [wave]).pixels);
    const half = bytes(renderEffects(image, [withParams({ amount: 0.5 })]).pixels);
    for (let i = 0; i < full.length; i++)
      expect(
        Math.abs(half[i]! - Math.round((bytes(image.pixels)[i]! + full[i]!) / 2)),
      ).toBeLessThanOrEqual(1);
  });
  it('keeps wave geometry consistent between preview and original resolution', () => {
    const original = ramp(48, 48),
      preview = ramp(16, 16);
    const effect = withParams({ strength: 10, direction: 37, frequency: 2 });
    const full = bytes(renderEffects(original, [effect], { masterSeed: 29 }).pixels);
    const small = bytes(
      renderEffects(preview, [effect], { masterSeed: 29, reference: original }).pixels,
    );
    for (let y = 3; y < 13; y++)
      for (let x = 3; x < 13; x++)
        for (let channel = 0; channel < 4; channel++)
          expect(
            Math.abs(
              small[(y * 16 + x) * 4 + channel]! -
                full[((y * 3 + 1) * 48 + x * 3 + 1) * 4 + channel]!,
            ),
          ).toBeLessThanOrEqual(1);
  });
  it('respects hard/soft application masks and detected subject regions', () => {
    const image = ramp();
    const full = bytes(renderEffects(image, [wave]).pixels);
    const top = { ...wave, application: { region: 'top' as const, coverage: 0.5, softness: 0 } };
    const hard = bytes(renderEffects(image, [top]).pixels);
    expect(hard.subarray(0, hard.length / 2)).toEqual(full.subarray(0, full.length / 2));
    expect(hard.subarray(hard.length / 2)).toEqual(bytes(image.pixels).subarray(hard.length / 2));
    const soft = bytes(
      renderEffects(image, [{ ...top, application: { ...top.application, softness: 1 } }]).pixels,
    );
    expect(soft).not.toEqual(hard);
    const subjectMask = { width: 2, height: 2, values: new Uint8Array([255, 255, 0, 0]).buffer };
    const subject = {
      ...wave,
      application: { region: 'subject' as const, coverage: 1, softness: 0 },
    };
    expect(bytes(renderEffects(image, [subject], { subjectMask }).pixels)).toEqual(hard);
  });
  it('matches the cancellable renderer and stops obsolete previews', async () => {
    const image = ramp(256, 256);
    const effects = [withParams({ direction: 27 }), withParams({ direction: 113, frequency: 5 })];
    const options = { masterSeed: 8172 };
    expect(
      bytes(
        (await renderEffectsAsync(image, effects, { ...options, yieldControl: async () => {} }))
          .pixels,
      ),
    ).toEqual(bytes(renderEffects(image, effects, options).pixels));
    let rows = 0;
    await expect(
      renderEffectsAsync(image, effects, {
        ...options,
        isCancelled: () => ++rows > 4,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
});
