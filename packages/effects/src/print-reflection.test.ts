import { describe, expect, it } from 'vitest';
import {
  createEffect,
  type EffectInstance,
  type HalftoneEffect,
  type MirroringEffect,
  type KaleidoscopeEffect,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);
function fixture(width = 16, height = 12) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set([x * 13, y * 17, (x + y) * 7, [0, 64, 128, 255][x % 4]!], (y * width + x) * 4);
  return { width, height, pixels: pixels.buffer };
}
function flat(width = 100, height = 100, value = 128, alpha = 128) {
  return {
    width,
    height,
    pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) => (i % 4 === 3 ? alpha : value))
      .buffer,
  };
}
const halftone = (params: Partial<HalftoneEffect['params']> = {}) =>
  ({
    ...createEffect('halftone', 'print'),
    params: { ...createEffect('halftone', 'print').params, rotation: 0, spacing: 10, ...params },
  }) as HalftoneEffect;
const mirror = (params: Partial<MirroringEffect['params']> = {}) =>
  ({
    ...createEffect('mirroring', 'reflection'),
    params: { ...createEffect('mirroring', 'reflection').params, ...params },
  }) as MirroringEffect;
const kaleido = (params: Partial<KaleidoscopeEffect['params']> = {}) =>
  ({
    ...createEffect('kaleidoscope', 'radial'),
    params: { ...createEffect('kaleidoscope', 'radial').params, ...params },
  }) as KaleidoscopeEffect;
const render = (image: ReturnType<typeof fixture>, effect: EffectInstance) =>
  bytes(renderEffects(image, [effect]).pixels);
describe('halftone print', () => {
  it('places round dots on the original grid and preserves every alpha byte', () => {
    const image = flat();
    const output = render(image, halftone());
    expect([...output.subarray((5 * 100 + 5) * 4, (5 * 100 + 5) * 4 + 4)]).toEqual([0, 0, 0, 128]);
    expect([...output.subarray(0, 4)]).toEqual([255, 255, 255, 128]);
    for (let i = 3; i < output.length; i += 4) expect(output[i]).toBe(128);
    expect(render(image, halftone({ size: 2 }))[0]).toBe(0);
  });
  it('never paints phantom dots in white or fully transparent source cells', () => {
    for (const value of [255]) {
      const image = flat(99, 99, value, 255);
      const output = render(image, halftone({ spacing: 3 }));
      for (let i = 0; i < output.length; i += 4) expect(output[i]).toBe(255);
    }
  });
  it('draws tone-dependent line widths with horizontal/vertical rotation', () => {
    const image = flat();
    const vertical = render(image, halftone({ style: 'lines' }));
    expect(vertical[0]).toBe(255);
    expect(vertical[5 * 4]).toBe(0);
    const horizontal = render(image, halftone({ style: 'lines', rotation: 90 }));
    expect(horizontal[5 * 100 * 4]).toBe(0);
    expect(horizontal[5 * 4]).toBe(255);
    const white = render(flat(100, 100, 255), halftone({ style: 'lines' }));
    const black = render(flat(100, 100, 0), halftone({ style: 'lines' }));
    expect(white[5 * 4]).toBe(255);
    expect(black[0]).toBe(0);
  });
  it('supports independent mark size, spacing, contrast and both colors', () => {
    const image = flat();
    const paper = render(image, halftone({ size: 0, backgroundColor: '#4080e0' }));
    expect([...paper.subarray(0, 4)]).toEqual([64, 128, 224, 128]);
    const ink = render(image, halftone({ foregroundColor: '#40a0e0' }));
    expect([...ink.subarray((5 * 100 + 5) * 4, (5 * 100 + 5) * 4 + 4)]).toEqual([
      64, 160, 224, 128,
    ]);
    expect(render(image, halftone({ spacing: 5 }))).not.toEqual(render(image, halftone()));
    expect(render(flat(100, 100, 0), halftone({ contrast: 0 }))).toEqual(
      render(flat(100, 100, 255), halftone({ contrast: 0 })),
    );
    expect(render(flat(100, 100, 180), halftone({ contrast: 3 }))).not.toEqual(
      render(flat(100, 100, 180), halftone({ contrast: 1 })),
    );
  });
  it('averages subpixel dot areas and lines instead of phase aliasing', () => {
    const image = flat(20, 10, 128, 255);
    for (const style of ['dots', 'lines'] as const) {
      const output = bytes(
        renderEffects(image, [halftone({ spacing: 0.2, style })], {
          reference: { width: 200, height: 100 },
        }).pixels,
      );
      for (let i = 0; i < output.length; i += 4) expect(output[i]).toBe(128);
    }
  });
  it('uses the shared blend formulas at the pattern boundary', () => {
    const image = flat(1, 1, 128, 255);
    const expected = {
      normal: 64,
      multiply: 32,
      screen: 160,
      add: 192,
      overlay: 65,
      difference: 64,
    };
    for (const [blendMode, red] of Object.entries(expected))
      expect(
        render(
          image,
          halftone({
            size: 0,
            backgroundColor: '#404040',
            blendMode: blendMode as NonNullable<HalftoneEffect['params']['blendMode']>,
          }),
        )[0],
      ).toBe(red);
  });
  it('ignores hidden source RGB when choosing ink tone', () => {
    const a = flat(20, 20, 0, 0),
      b = flat(20, 20, 255, 0);
    expect(render(a, halftone())).toEqual(render(b, halftone()));
  });
});
describe('mirroring geometry', () => {
  it('reflects each chosen vertical/horizontal half exactly, including alpha', () => {
    const image = fixture(),
      input = bytes(image.pixels);
    for (const axis of ['vertical', 'horizontal'] as const)
      for (const sourceSide of ['first', 'opposite'] as const) {
        const output = render(image, mirror({ axis, sourceSide }));
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            const coordinate = axis === 'vertical' ? x : y,
              limit = axis === 'vertical' ? image.width : image.height;
            const keep = sourceSide === 'first' ? coordinate < limit / 2 : coordinate >= limit / 2;
            const sx = axis === 'vertical' && !keep ? image.width - 1 - x : x;
            const sy = axis === 'horizontal' && !keep ? image.height - 1 - y : y;
            expect(
              output.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
            ).toEqual(input.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4));
          }
      }
  });
  it('reflects an angled axis analytically and honors shifted positions', () => {
    const image = fixture(8, 8),
      input = bytes(image.pixels);
    const diagonal = render(image, mirror({ axis: 'angled', rotation: 135 }));
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const sx = y > x ? y : x,
          sy = y > x ? x : y;
        const i = (y * 8 + x) * 4,
          j = (sy * 8 + sx) * 4;
        expect(diagonal.subarray(i, i + 4)).toEqual(input.subarray(j, j + 4));
      }
    const shifted = render(image, mirror({ positionX: 25 }));
    expect(shifted.subarray(2 * 4, 3 * 4)).toEqual(input.subarray(1 * 4, 2 * 4));
    expect(render(image, mirror({ positionX: 0, sourceSide: 'opposite' }))).toEqual(input);
  });
  it('uses Extend, Wrap and Mirror when the reflection crosses the image edge', () => {
    const image = fixture(8, 8),
      input = bytes(image.pixels);
    for (const [edgeHandling, sample] of [
      ['extend', 0],
      ['wrap', 4],
      ['mirror', 3],
    ] as const) {
      const output = render(image, mirror({ positionX: 25, edgeHandling }));
      expect(output.subarray(7 * 4, 8 * 4)).toEqual(input.subarray(sample * 4, (sample + 1) * 4));
    }
  });
  it('keeps a reflection axis in original coordinates across preview sizes', () => {
    const large = fixture(16, 12),
      small = fixture(8, 6);
    const effect = mirror({ positionX: 50 });
    const direct = render(small, effect),
      reference = bytes(renderEffects(small, [effect], { reference: large }).pixels);
    expect(direct).toEqual(reference);
  });
});
describe('kaleidoscope geometry', () => {
  it('folds four sectors into the positive first-octant wedge exactly', () => {
    const image = fixture(8, 8),
      input = bytes(image.pixels);
    const output = render(image, kaleido({ segments: 4 }));
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const ax = Math.abs(x - 3.5),
          ay = Math.abs(y - 3.5);
        const sx = 3.5 + Math.max(ax, ay),
          sy = 3.5 + Math.min(ax, ay);
        const i = (y * 8 + x) * 4,
          j = (sy * 8 + sx) * 4;
        expect(output.subarray(i, i + 4)).toEqual(input.subarray(j, j + 4));
      }
  });
  it('stabilizes polar round-trip alpha ties on the sampling grid', () => {
    const width = 129,
      height = 65;
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? [0, 1, 64, 128, 254, 255][(Math.floor(i / 4) % width) % 6]! : 128,
    ).buffer;
    const image = { width, height, pixels };
    const output = render(
      image,
      kaleido({ segments: 8, rotation: 27, centerX: 40, centerY: 65, zoom: 0.5 }),
    );
    for (const y of [7, 11, 24]) expect(output[(y * width + 20) * 4 + 3]).toBe(179);
  });
  it('has deterministic sectors, center, rotation, zoom and edge choices', () => {
    const image = fixture(37, 29),
      effect = kaleido();
    const base = render(image, effect);
    for (const params of [
      { segments: 9 },
      { rotation: 37 },
      { centerX: 20 },
      { centerY: 75 },
      { zoom: 2 },
      { zoom: 0.25, edgeHandling: 'wrap' as const },
      { zoom: 0.25, edgeHandling: 'mirror' as const },
    ]) {
      const changed = kaleido(params);
      expect(render(image, changed)).not.toEqual(base);
      expect(bytes(renderEffects(image, [changed], { masterSeed: 12 }).pixels)).toEqual(
        bytes(renderEffects(image, [changed], { masterSeed: 999 }).pixels),
      );
    }
    for (let i = 0; i < base.length; i += 4)
      for (let c = 0; c < 4; c++) expect(Number.isFinite(base[i + c])).toBe(true);
  });
});
describe('shared print/reflection editing behavior', () => {
  it('aligns visible object bounds to all edges/corners and the center independently of the pattern', () => {
    const image = flat(12, 10, 0, 0);
    const pixels = bytes(image.pixels);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ])
      pixels.set([80 + x!, 120 + y!, 200, 255], (y! * 12 + x!) * 4);
    for (const [outputAlignment, tx, ty] of [
      ['center', 5, 4],
      ['top', 5, 0],
      ['bottom', 5, 8],
      ['left', 0, 4],
      ['right', 10, 4],
      ['top-left', 0, 0],
      ['top-right', 10, 0],
      ['bottom-left', 0, 8],
      ['bottom-right', 10, 8],
    ] as const) {
      const output = render(
        image,
        mirror({ positionX: 0, sourceSide: 'opposite', outputAlignment }),
      );
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 12; x++) {
          const i = (y * 12 + x) * 4;
          if (x >= tx && x < tx + 2 && y >= ty && y < ty + 2)
            expect([...output.subarray(i, i + 4)]).toEqual([
              80 + x - tx + 1,
              120 + y - ty + 1,
              200,
              255,
            ]);
          else expect([...output.subarray(i, i + 4)]).toEqual([0, 0, 0, 0]);
        }
    }
  });
  it('translates the complete kaleidoscope result without changing its source wedge', () => {
    const image = fixture(20, 20);
    const base = render(image, kaleido());
    for (const edgeHandling of ['extend', 'wrap', 'mirror'] as const) {
      const effect = kaleido({ outputOffsetX: 20, outputOffsetY: -10, edgeHandling });
      const unplaced = render(image, kaleido({ edgeHandling }));
      const moved = render(image, effect);
      for (let y = 0; y < 20; y++)
        for (let x = 0; x < 20; x++) {
          const i = (y * 20 + x) * 4;
          if (x >= 4 && y < 18) {
            const j = ((y + 2) * 20 + x - 4) * 4;
            expect(moved.subarray(i, i + 4)).toEqual(unplaced.subarray(j, j + 4));
          } else expect([...moved.subarray(i, i + 4)]).toEqual([0, 0, 0, 0]);
        }
    }
    expect(render(image, kaleido({ outputOffsetX: 0, outputOffsetY: 0 }))).toEqual(base);
  });
  it('centers the rendered radial object independently of its off-center sampling origin', () => {
    const image = flat(20, 16, 180, 0);
    for (let y = 1; y <= 5; y++)
      for (let x = 2; x <= 6; x++) bytes(image.pixels)[(y * 20 + x) * 4 + 3] = 255;
    const effect = kaleido({ centerX: 20, centerY: 18.75 });
    const output = render(image, effect);
    const bounds = (pixels: Uint8Array) => {
      let left = 20,
        right = -1,
        top = 16,
        bottom = -1;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 20; x++) {
          if (!pixels[(y * 20 + x) * 4 + 3]) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      return { left, right, top, bottom };
    };
    const before = bounds(output);
    expect(before.right).toBeLessThan(12);
    expect(before.bottom).toBeLessThan(10);
    const centered = render(image, {
      ...effect,
      params: { ...effect.params, outputAlignment: 'center' },
    });
    const after = bounds(centered);
    expect(after.left + after.right).toBe(19);
    expect(after.top + after.bottom).toBe(15);
    const explicit = render(image, {
      ...effect,
      params: {
        ...effect.params,
        outputOffsetX: ((19 - before.left - before.right) / 2 / 20) * 100,
        outputOffsetY: ((15 - before.top - before.bottom) / 2 / 16) * 100,
      },
    });
    expect(centered).toEqual(explicit);
  });
  it('uses premultiplied fractional placement, transparent padding, and offsets after automatic alignment', () => {
    const image = flat(4, 4, 0, 0);
    const pixels = bytes(image.pixels);
    pixels.set([255, 0, 0, 255], (1 * 4 + 1) * 4);
    pixels.set([0, 0, 255, 0], (1 * 4 + 2) * 4);
    const effect = mirror({ positionX: 0, sourceSide: 'opposite', outputOffsetX: 12.5 });
    const output = render(image, effect);
    expect([...output.subarray(20, 24)]).toEqual([255, 0, 0, 128]);
    expect([...output.subarray(24, 28)]).toEqual([255, 0, 0, 128]);
    const corner = render(
      image,
      mirror({
        positionX: 0,
        sourceSide: 'opposite',
        outputAlignment: 'top-left',
        outputOffsetX: 25,
        outputOffsetY: 50,
      }),
    );
    expect([...corner.subarray((2 * 4 + 1) * 4, (2 * 4 + 1) * 4 + 4)]).toEqual([255, 0, 0, 255]);
  });
  it('tracks a photo subject through previous transforms and aligns the rendered object rather than the image rectangle', () => {
    const photo = flat(12, 10, 90, 255);
    const cutout = flat(12, 10, 90, 0);
    const mask = new Uint8Array(120);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]) {
      mask[y! * 12 + x!] = 255;
      bytes(cutout.pixels)[(y! * 12 + x!) * 4 + 3] = 255;
    }
    const earlier = mirror({ positionX: 0, sourceSide: 'opposite', outputOffsetX: 25 });
    const aligned = mirror({
      positionX: 0,
      sourceSide: 'opposite',
      outputAlignment: 'bottom-right',
    });
    const subjectMask = { width: 12, height: 10, values: mask.buffer };
    const output = bytes(renderEffects(photo, [earlier, aligned], { subjectMask }).pixels);
    // The first step moves the subject to x=4..5. The second shifts that result
    // by +6,+7, placing it at x=10..11,y=8..9 while moving the photo background.
    expect(output[(8 * 12 + 10) * 4 + 3]).toBe(255);
    expect(output[(7 * 12 + 8) * 4 + 3]).toBe(0);
    expect([...output.subarray((7 * 12 + 9) * 4, (7 * 12 + 9) * 4 + 4)]).toEqual([90, 90, 90, 255]);
    expect(() => renderEffects(photo, [aligned])).toThrow('Subject detection');
    const invisible = { ...subjectMask, values: new Uint8Array(120).buffer };
    expect(bytes(renderEffects(photo, [aligned], { subjectMask: invisible }).pixels)).toEqual(
      bytes(photo.pixels),
    );
    const cutoutOutput = bytes(renderEffects(cutout, [earlier, aligned]).pixels);
    expect(cutoutOutput[(8 * 12 + 10) * 4 + 3]).toBe(255);
  });
  it('blends and masks placed output, preserves legacy recipes, and cancels alignment work', async () => {
    const image = fixture(160, 120);
    for (const original of [mirror(), kaleido()]) {
      const params = { ...original.params };
      delete params.outputAlignment;
      delete params.outputOffsetX;
      delete params.outputOffsetY;
      expect(render(image, { ...original, params } as EffectInstance)).toEqual(
        render(image, original),
      );
      const placed = {
        ...original,
        params: { ...original.params, outputAlignment: 'top-left', outputOffsetX: 10 },
      } as EffectInstance;
      expect(
        render(image, { ...placed, params: { ...placed.params, amount: 0 } } as EffectInstance),
      ).toEqual(bytes(image.pixels));
      const full = render(image, placed);
      const top = {
        ...placed,
        application: { region: 'top' as const, coverage: 0.5, softness: 0 },
      };
      const masked = render(image, top);
      expect(masked.subarray(0, 160 * 60 * 4)).toEqual(full.subarray(0, 160 * 60 * 4));
      expect(masked.subarray(160 * 60 * 4)).toEqual(bytes(image.pixels).subarray(160 * 60 * 4));
      const asyncResult = await renderEffectsAsync(image, [placed], {
        yieldControl: async () => {},
      });
      expect(bytes(asyncResult.pixels)).toEqual(full);
      let checks = 0;
      await expect(
        renderEffectsAsync(image, [placed], {
          isCancelled: () => ++checks > 8,
          yieldControl: async () => {},
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    }
  });
  it('applies masks and exact no-ops after each new filter', () => {
    const image = fixture();
    const input = bytes(image.pixels);
    for (const effect of [halftone(), mirror(), kaleido()]) {
      for (const candidate of [
        { ...effect, enabled: false },
        { ...effect, params: { ...effect.params, amount: 0 } },
        { ...effect, application: { ...effect.application, coverage: 0 } },
      ] as EffectInstance[])
        expect(render(image, candidate)).toEqual(input);
      const top = {
        ...effect,
        application: { region: 'top' as const, coverage: 0.5, softness: 0 },
      };
      const masked = render(image, top),
        full = render(image, effect);
      expect(masked.subarray(image.width * image.height * 2)).toEqual(
        input.subarray(image.width * image.height * 2),
      );
      expect(masked.subarray(0, image.width * image.height * 2)).toEqual(
        full.subarray(0, image.width * image.height * 2),
      );
      expect(
        render(image, { ...top, application: { ...top.application, softness: 0.75 } }),
      ).not.toEqual(masked);
    }
  });
  it('applies subject/background masks to all three filters', () => {
    const image = fixture(16, 12),
      input = bytes(image.pixels);
    const values = Uint8Array.from({ length: 16 * 12 }, (_, i) => (i % 16 < 8 ? 255 : 0)).buffer;
    for (const effect of [halftone(), mirror(), kaleido()])
      for (const region of ['subject', 'background'] as const) {
        const masked = bytes(
          renderEffects(image, [{ ...effect, application: { region, coverage: 1, softness: 0 } }], {
            subjectMask: { width: 16, height: 12, values },
          }).pixels,
        );
        const full = render(image, effect);
        for (let y = 0; y < 12; y++)
          for (let x = 0; x < 16; x++) {
            const i = (y * 16 + x) * 4,
              selected = region === 'subject' ? x < 8 : x >= 8;
            expect(masked.subarray(i, i + 4)).toEqual((selected ? full : input).subarray(i, i + 4));
          }
      }
  });
  it('runs tint and layer blending on both reflection filters', () => {
    const image = fixture();
    for (const effect of [mirror(), kaleido()]) {
      const tinted = {
        ...effect,
        params: {
          ...effect.params,
          color: '#4080e0',
          tintStrength: 0.8,
          tintEnabled: 'on' as const,
          blendMode: 'difference' as const,
          amount: 0.7,
        },
      };
      expect(render(image, tinted as EffectInstance)).not.toEqual(render(image, effect));
    }
  });
  it('matches asynchronous rendering and remains cancellable', async () => {
    const image = fixture(160, 120),
      effects = [halftone(), mirror(), kaleido()];
    expect(
      bytes((await renderEffectsAsync(image, effects, { yieldControl: async () => {} })).pixels),
    ).toEqual(bytes(renderEffects(image, effects).pixels));
    for (const effect of effects) {
      let checks = 0;
      await expect(
        renderEffectsAsync(image, [effect], {
          isCancelled: () => ++checks > 5,
          yieldControl: async () => {},
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    }
  });
});
