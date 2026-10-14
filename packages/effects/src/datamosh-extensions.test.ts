import { describe, expect, it } from 'vitest';
import {
  createEffect,
  assertEffect,
  DIRECTION_KEYS,
  type MotionMoshEffect,
  type ReferenceMoshEffect,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const width = 43,
  height = 31;
const input = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 64, 128, 255][Math.floor(i / 4) % 4]! : (i * 37) % 256,
);
const image = { width, height, pixels: input.buffer };
const motion = (params: Partial<MotionMoshEffect['params']> = {}) => {
  const base = createEffect('motion-mosh', 'mosh') as MotionMoshEffect;
  return { ...base, params: { ...base.params, ...params } };
};
const render = (effect: MotionMoshEffect) =>
  new Uint8Array(renderEffects(image, [effect], { masterSeed: 8172 }).pixels);

describe('datamosh extensions', () => {
  it('positions the reference independently of dragged patches and preserves centered legacy recipes', () => {
    const base = createEffect('reference-mosh', 'position') as ReferenceMoshEffect;
    const other = {
      width: 4,
      height: 3,
      pixels: Uint8Array.from({ length: 48 }, (_, i) => (i % 4 === 3 ? 255 : i * 3)).buffer,
    };
    const source = { width: 4, height: 3, pixels: new Uint8Array(48).buffer };
    const reference = {
      source: {
        id: 'reference',
        name: 'reference.png',
        width: 4,
        height: 3,
        format: 'png' as const,
        hasAlpha: false,
      },
      png: 'data:image/png;base64,',
    };
    const effect = {
      ...base,
      image: reference,
      params: { ...base.params, progression: 1, placement: 'fit' as const },
    };
    const render = (params: Partial<ReferenceMoshEffect['params']>) =>
      new Uint8Array(
        renderEffects(source, [{ ...effect, params: { ...effect.params, ...params } }], {
          layerImages: new Map([['reference', other]]),
        }).pixels,
      );
    expect(render({})).toEqual(new Uint8Array(other.pixels));
    const moved = render({ referenceX: 25, referenceY: 100 / 3 });
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 4; x++) {
        const pixel = moved.subarray((y * 4 + x) * 4, (y * 4 + x + 1) * 4);
        if (x === 0 || y === 0) expect(pixel[3]).toBe(0);
        else
          expect(pixel).toEqual(
            new Uint8Array(other.pixels).subarray(((y - 1) * 4 + x - 1) * 4, ((y - 1) * 4 + x) * 4),
          );
      }
    const legacyParams = { ...effect.params };
    delete legacyParams.referenceX;
    delete legacyParams.referenceY;
    assertEffect({ ...base, params: legacyParams });
    expect(
      renderEffects(source, [{ ...effect, params: legacyParams }], {
        layerImages: new Map([['reference', other]]),
      }),
    ).toEqual(renderEffects(source, [effect], { layerImages: new Map([['reference', other]]) }));
    expect(render({ progression: 0, referenceX: 25 })).toEqual(new Uint8Array(source.pixels));
  });
  it('keeps legacy Motion Mosh exact, and zero field influence keeps native motion', () => {
    const base = motion();
    const params = Object.fromEntries(
      Object.entries(base.params).filter(
        ([key]) => key !== 'coherence' && !(DIRECTION_KEYS as string[]).includes(key),
      ),
    ) as MotionMoshEffect['params'];
    const legacy = { ...base, params };
    assertEffect(legacy);
    expect(render(legacy)).toEqual(render(base));
    expect(render(motion({ directionSource: 'spiral', directionInfluence: 0 }))).toEqual(
      render(base),
    );
    expect(render(motion({ directionSource: 'linear' }))).toEqual(render(base));
  });
  it('steers block trails with fields and applies deterministic coherence disorder', () => {
    const base = motion({ density: 1, direction: 90 });
    expect(
      render(motion({ density: 1, directionSource: 'linear', directionRotation: 90 })),
    ).toEqual(render(base));
    expect(render(motion({ density: 1, directionSource: 'spiral' }))).not.toEqual(render(base));
    const loose = motion({ density: 1, coherence: 0.2 });
    expect(render(loose)).toEqual(render(loose));
    expect(render(loose)).not.toEqual(render(motion({ density: 1 })));
    expect(render({ ...loose, seedOffset: 1 })).not.toEqual(render(loose));
    expect(render(motion({ travel: 0, coherence: 0, directionSource: 'flow' }))).toEqual(input);
  });
  it('independently gates stable Reference Mosh patches without changing older recipes', () => {
    const base = createEffect('reference-mosh', 'reference') as ReferenceMoshEffect;
    const other = {
      ...image,
      pixels: Uint8Array.from(input, (v, i) => (i % 4 === 3 ? 255 : 255 - v)).buffer,
    };
    const attachment = {
      source: {
        id: 'other',
        name: 'other.png',
        width,
        height,
        format: 'png' as const,
        hasAlpha: true,
      },
      png: '',
    };
    const renderReference = (density: number | undefined, progression = 1) => {
      const params = { ...base.params };
      delete params.replacementDensity;
      const effect = {
        ...base,
        image: attachment,
        params: {
          ...params,
          progression,
          ...(density === undefined ? {} : { replacementDensity: density }),
        },
      };
      // Render fixtures use a decoded immutable attachment; storage validates PNGs separately.
      return new Uint8Array(
        renderEffects(image, [effect], {
          masterSeed: 8172,
          layerImages: new Map([['other', other]]),
        }).pixels,
      );
    };
    expect(renderReference(undefined, 0.55)).toEqual(renderReference(1, 0.55));
    expect(renderReference(0)).toEqual(input);
    expect(renderReference(0.5, 0)).toEqual(input);
    const sparse = renderReference(0.3),
      dense = renderReference(0.7),
      complete = renderReference(1);
    expect(complete).toEqual(new Uint8Array(other.pixels));
    expect(sparse).not.toEqual(input);
    expect(sparse).not.toEqual(complete);
    expect(renderReference(0.3)).toEqual(sparse);
    for (let i = 0; i < input.length; i += 4) {
      const original = input.subarray(i, i + 4);
      if (!sparse.subarray(i, i + 4).every((v, c) => v === original[c]))
        expect(dense.subarray(i, i + 4)).toEqual(complete.subarray(i, i + 4));
      else expect(sparse.subarray(i, i + 4)).toEqual(original);
    }
  });
  it('runs sequential JPEG generations with bounded quality and shared masks/opacity', async () => {
    const base = createEffect('jpeg-recompression', 'jpeg');
    if (base.type !== 'jpeg-recompression') throw new Error('Invalid fixture');
    const calls: number[] = [];
    const output = await renderEffectsAsync(
      image,
      [
        {
          ...base,
          params: { ...base.params, quality: 5, qualityLoss: 3, generations: 4, amount: 0.5 },
          application: { region: 'left', coverage: 0.5, softness: 0 },
        },
      ],
      {
        yieldControl: async () => {},
        recompressJpeg: async (source, options) => {
          calls.push(options.quality);
          const bytes = new Uint8Array(source.pixels).slice();
          for (let i = 0; i < bytes.length; i += 4) bytes[i] = Math.min(255, bytes[i]! + 20);
          return bytes.buffer;
        },
      },
    );
    expect(calls).toEqual([5, 2, 1, 1]);
    const bytes = new Uint8Array(output.pixels);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        expect(bytes[i + 3]).toBe(input[i + 3]);
        if (x >= Math.ceil(width / 2))
          expect(bytes.subarray(i, i + 4)).toEqual(input.subarray(i, i + 4));
      }
    expect(bytes).not.toEqual(input);
    expect(() => renderEffects(image, [base])).toThrow('native JPEG codec');
  });
  it('skips disabled JPEG work and cancels before starting the next codec generation', async () => {
    const base = createEffect('jpeg-recompression', 'jpeg');
    expect(renderEffects(image, [{ ...base, enabled: false }]).pixels).toEqual(input.buffer);
    let cancelled = false,
      calls = 0;
    await expect(
      renderEffectsAsync(image, [base], {
        yieldControl: async () => {},
        isCancelled: () => cancelled,
        recompressJpeg: async (source) => {
          calls++;
          cancelled = true;
          return source.pixels.slice(0);
        },
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(calls).toBe(1);
  });
});
