import { describe, expect, it } from 'vitest';
import {
  createEffect,
  deriveEffectSeed,
  SCANLINE_FINISH_DEFAULTS,
  type ScanlinesEffect,
} from '@gleech/project-model';
import { cellRandom, renderEffects, renderEffectsAsync, RenderCancelledError } from './index';

const base = createEffect('scanlines', 'raster') as ScanlinesEffect;
const effect = (params: Partial<ScanlinesEffect['params']> = {}): ScanlinesEffect => ({
  ...base,
  params: { ...base.params, frequency: 4, thickness: 0.5, intensity: 0.75, ...params },
});
function fixture(width = 32, height = 32) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set([240, 120, 60, [0, 64, 128, 255][x % 4]!], (y * width + x) * 4);
  return { width, height, pixels: pixels.buffer };
}
const bytes = (buffer: ArrayBuffer) => new Uint8Array(buffer);

describe('scanlines version 1', () => {
  it('retains exact legacy output when all new controls are omitted', () => {
    const image = fixture();
    for (const style of ['monitor', 'tv', 'interlaced', 'grille'] as const) {
      const current = effect({ style, amount: 0.37, rotation: 17, offset: 0.23 });
      const params = { ...current.params };
      for (const key of Object.keys(
        SCANLINE_FINISH_DEFAULTS,
      ) as (keyof typeof SCANLINE_FINISH_DEFAULTS)[])
        delete params[key];
      expect(bytes(renderEffects(image, [{ ...current, params }]).pixels)).toEqual(
        bytes(renderEffects(image, [current]).pixels),
      );
    }
  });
  it('positions only the signal failure in original image coordinates', () => {
    const image = fixture();
    const input = bytes(image.pixels);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) input.set([x * 8, y * 7, 100, 255], (y * 32 + x) * 4);
    const seed = deriveEffectSeed(19, base.instanceId);
    const shifted = effect({
      thickness: 0,
      signalError: 'jitter',
      errorStrength: 1,
      errorPositionY: 25,
    });
    const output = bytes(renderEffects(image, [shifted], { masterSeed: 19 }).pixels);
    for (let y = 0; y < 32; y++) {
      const delta = (cellRandom(seed, Math.floor((y + 0.5 - 8) / 8), 0, 6) * 2 - 1) * 32 * 0.08;
      for (let x = 0; x < 32; x++)
        expect(output[(y * 32 + x) * 4]).toBe(Math.round(Math.max(0, Math.min(31, x + delta)) * 8));
    }
    for (const signalError of ['jitter', 'sync-loss', 'tear', 'dropout'] as const) {
      const original = effect({ signalError, errorStrength: 0.6, rotation: 37 });
      const moved = effect({ ...original.params, errorPositionX: -20, errorPositionY: 30 });
      expect(bytes(renderEffects(image, [moved], { masterSeed: 19 }).pixels)).not.toEqual(
        bytes(renderEffects(image, [original], { masterSeed: 19 }).pixels),
      );
      expect(
        bytes(renderEffects(image, [effect({ ...moved.params, errorStrength: 0 })]).pixels),
      ).toEqual(
        bytes(renderEffects(image, [effect({ ...original.params, errorStrength: 0 })]).pixels),
      );
    }
    // Tangential translation of a full-width band has no effect.
    expect(
      bytes(
        renderEffects(image, [effect({ ...shifted.params, errorPositionX: 80 })], {
          masterSeed: 19,
        }).pixels,
      ),
    ).toEqual(output);
    const stable = effect({ signalError: 'none', errorPositionX: 70, errorPositionY: -90 });
    expect(bytes(renderEffects(image, [stable]).pixels)).toEqual(
      bytes(renderEffects(image, [effect()]).pixels),
    );
  });
  it('paints selected colors with six independently checked blend modes and color inversion', () => {
    const image = fixture();
    const expected = {
      normal: [108, 150, 183],
      multiply: [105, 86, 55],
      screen: [243, 184, 188],
      add: [251, 221, 206],
      overlay: [234, 143, 94],
      difference: [192, 60, 138],
    } as const;
    for (const blendMode of Object.keys(expected) as (keyof typeof expected)[]) {
      const output = bytes(renderEffects(image, [effect({ color: '#40a0e0', blendMode })]).pixels);
      expect([...output.subarray(3 * 32 * 4, 3 * 32 * 4 + 3)]).toEqual(expected[blendMode]);
      for (let i = 3; i < output.length; i += 4) expect(output[i]).toBe(bytes(image.pixels)[i]);
    }
    const white = bytes(renderEffects(image, [effect({ invert: 'on' })]).pixels);
    expect([...white.subarray(3 * 32 * 4, 3 * 32 * 4 + 3)]).toEqual([251, 221, 206]);
    expect(white).toEqual(bytes(renderEffects(image, [effect({ color: '#ffffff' })]).pixels));
    const inverted = bytes(
      renderEffects(image, [effect({ color: '#40a0e0', invert: 'on' })]).pixels,
    );
    expect([...inverted.subarray(3 * 32 * 4, 3 * 32 * 4 + 3)]).toEqual([203, 101, 38]);
    for (const neutral of [
      effect({ color: '#ffffff', blendMode: 'multiply' }),
      effect({ blendMode: 'screen' }),
    ])
      expect(bytes(renderEffects(image, [neutral]).pixels)).toEqual(bytes(image.pixels));
  });
  it('spreads a colored halo or black shadow outside the bands while preserving transparency', () => {
    const image = fixture();
    const noHalo = bytes(renderEffects(image, [effect({ color: '#ffffff' })]).pixels);
    const halo = bytes(
      renderEffects(image, [effect({ color: '#ffffff', glow: 1, glowSize: 6.25 })]).pixels,
    );
    const outside = 32 * 4;
    expect(noHalo[outside]).toBe(240);
    expect(halo[outside]).toBeGreaterThan(240);
    const shadow = bytes(renderEffects(image, [effect({ glow: 1, glowSize: 6.25 })]).pixels);
    expect(shadow[outside]).toBeLessThan(240);
    for (let i = 3; i < halo.length; i += 4) expect(halo[i]).toBe(bytes(image.pixels)[i]);
    expect(halo).not.toEqual(
      bytes(renderEffects(image, [effect({ color: '#ffffff', glow: 1, glowSize: 0.1 })]).pixels),
    );
  });
  it('jitter displaces whole raster intervals by the seeded original-coordinate offset', () => {
    const image = fixture();
    const input = bytes(image.pixels);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) input.set([x * 8, y * 7, 100, 255], (y * 32 + x) * 4);
    const raster = effect({ thickness: 0, signalError: 'jitter', errorStrength: 1 });
    const seed = deriveEffectSeed(19, raster.instanceId);
    const output = bytes(renderEffects(image, [raster], { masterSeed: 19 }).pixels);
    for (let y = 0; y < 32; y++) {
      const delta = (cellRandom(seed, Math.floor(y / 8), 0, 6) * 2 - 1) * 32 * 0.08;
      for (let x = 0; x < 32; x++) {
        const coordinate = Math.max(0, Math.min(31, x + delta)),
          i = (y * 32 + x) * 4;
        expect([...output.subarray(i, i + 4)]).toEqual([
          Math.round(coordinate * 8),
          y * 7,
          100,
          255,
        ]);
      }
    }
  });
  it('reproduces seeded signal errors, varies layouts, respects edge modes, and supports a stable zero strength', () => {
    const image = fixture();
    const input = bytes(image.pixels);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        input.set(
          [x * 8, y * 7, (x * 3 + y * 5) % 256, [0, 64, 128, 255][x % 4]!],
          (y * 32 + x) * 4,
        );
    for (const signalError of ['jitter', 'sync-loss', 'tear', 'dropout'] as const) {
      const raster = effect({ signalError, errorStrength: 0.7, frequency: 16 });
      const output = bytes(renderEffects(image, [raster], { masterSeed: 19 }).pixels);
      expect(output).toEqual(bytes(renderEffects(image, [raster], { masterSeed: 19 }).pixels));
      expect(output).not.toEqual(bytes(renderEffects(image, [raster], { masterSeed: 20 }).pixels));
      expect(output).not.toEqual(
        bytes(renderEffects(image, [{ ...raster, seedOffset: 1 }], { masterSeed: 19 }).pixels),
      );
      const zero = effect({ ...raster.params, errorStrength: 0 });
      expect(bytes(renderEffects(image, [zero]).pixels)).toEqual(
        bytes(renderEffects(image, [effect({ ...raster.params, signalError: 'none' })]).pixels),
      );
      if (signalError !== 'dropout') {
        expect(output).not.toEqual(
          bytes(
            renderEffects(image, [effect({ ...raster.params, edgeHandling: 'wrap' })], {
              masterSeed: 19,
            }).pixels,
          ),
        );
        expect(output).not.toEqual(
          bytes(
            renderEffects(image, [effect({ ...raster.params, edgeHandling: 'mirror' })], {
              masterSeed: 19,
            }).pixels,
          ),
        );
      } else for (let i = 3; i < output.length; i += 4) expect(output[i]).toBe(input[i]);
    }
  });
  it('handles finishing and failures asynchronously with masks, alpha and cancellation', async () => {
    const image = fixture();
    for (const signalError of ['jitter', 'sync-loss', 'tear', 'dropout'] as const) {
      const raster = {
        ...effect({
          signalError,
          glow: 0.5,
          color: '#4080ff',
          blendMode: 'screen',
          edgeHandling: 'wrap',
        }),
        application: { region: 'top' as const, coverage: 0.5, softness: 0 },
      };
      const output = renderEffects(image, [raster]);
      expect(bytes(output.pixels).subarray(32 * 16 * 4)).toEqual(
        bytes(image.pixels).subarray(32 * 16 * 4),
      );
      expect(
        bytes((await renderEffectsAsync(image, [raster], { yieldControl: async () => {} })).pixels),
      ).toEqual(bytes(output.pixels));
    }
    let rows = 0;
    await expect(
      renderEffectsAsync(fixture(256, 256), [effect({ signalError: 'sync-loss', glow: 1 })], {
        isCancelled: () => ++rows > 4,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
  });
  it('draws exact crisp monitor bands, rotates them, and preserves alpha and the input', () => {
    const image = fixture(),
      source = bytes(image.pixels).slice();
    for (const rotation of [0, 90]) {
      const output = bytes(renderEffects(image, [effect({ rotation })]).pixels);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const coordinate = rotation === 0 ? y : x;
          const dark = coordinate % 8 >= 2 && coordinate % 8 < 6;
          const i = (y * 32 + x) * 4;
          expect([...output.subarray(i, i + 4)]).toEqual(
            dark ? [60, 30, 15, source[i + 3]] : [...source.subarray(i, i + 4)],
          );
        }
    }
    expect(bytes(image.pixels)).toEqual(source);
  });
  it('softens TV bands using the integrated rounded profile, including rotated negative coordinates', () => {
    const image = fixture();
    for (const rotation of [0, 37, 90]) {
      const output = bytes(
        renderEffects(image, [effect({ style: 'tv', rotation, offset: 0.17 })]).pixels,
      );
      const angle = (rotation * Math.PI) / 180,
        nx = -Math.sin(angle),
        ny = Math.cos(angle);
      const footprint = (Math.abs(nx) + Math.abs(ny)) / 8;
      for (const [x, y] of [
        [0, 0],
        [3, 7],
        [31, 31],
        [17, 2],
      ]) {
        const position = (nx * (x! + 0.5) + ny * (y! + 0.5)) / 8 + 0.17;
        let average = 0;
        // Independent numerical integration of the visible TV-band shape.
        for (let k = 0; k < 4096; k++) {
          const t = position + ((k + 0.5) / 4096 - 0.5) * footprint;
          const phase = t - Math.floor(t),
            distance = (phase - 0.5) / 0.5;
          if (Math.abs(distance) < 0.5)
            average += (1 + Math.cos(distance * Math.PI * 2)) / 2 / 4096;
        }
        const i = (y! * 32 + x!) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const expected = Math.round([240, 120, 60][channel]! * (1 - average * 0.75));
          expect(Math.abs(output[i + channel]! - expected)).toBeLessThanOrEqual(1);
        }
        expect(output[i + 3]).toBe(bytes(image.pixels)[i + 3]);
      }
    }
  });
  it('selects complementary odd/even interlaced intervals, with periodic offsets', () => {
    const image = fixture();
    const even = effect({ style: 'interlaced', frequency: 8, thickness: 1, intensity: 1 });
    const a = bytes(renderEffects(image, [even]).pixels);
    const b = bytes(renderEffects(image, [effect({ ...even.params, field: 'odd' })]).pixels);
    for (let y = 0; y < 32; y++) {
      expect(a[y * 32 * 4]).toBe(Math.floor(y / 4) % 2 === 0 ? 0 : 240);
      expect(b[y * 32 * 4]).toBe(Math.floor(y / 4) % 2 === 1 ? 0 : 240);
    }
    expect(bytes(renderEffects(image, [effect({ ...even.params, offset: 0.5 })]).pixels)).toEqual(
      b,
    );
    expect(bytes(renderEffects(image, [effect({ ...even.params, offset: 1 })]).pixels)).toEqual(a);
  });
  it('creates vertical RGB phosphor stripes with optional black gaps and unchanged alpha', () => {
    const image = fixture(24, 24);
    const grille = effect({ style: 'grille', frequency: 2, thickness: 0, intensity: 1 });
    const output = bytes(renderEffects(image, [grille]).pixels);
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const i = (y * 24 + x) * 4,
          active = Math.floor((x % 12) / 4);
        const expected = [240, 120, 60].map((value, channel) => (channel === active ? value : 0));
        expected.push(bytes(image.pixels)[i + 3]!);
        expect([...output.subarray(i, i + 4)]).toEqual(expected);
      }
    const gaps = bytes(renderEffects(image, [effect({ ...grille.params, thickness: 0.5 })]).pixels);
    expect([...gaps.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect([...gaps.subarray(4, 7)]).toEqual([240, 0, 0]);
    const black = bytes(renderEffects(image, [effect({ ...grille.params, thickness: 1 })]).pixels);
    for (let i = 0; i < black.length; i += 4)
      expect([...black.subarray(i, i + 3)]).toEqual([0, 0, 0]);
  });
  it('averages subpixel frequencies and preserves original-coordinate proportions in previews', () => {
    const image = fixture();
    for (const [style, expected] of [
      ['monitor', [150, 75, 38]],
      ['tv', [195, 98, 49]],
      ['grille', [90, 45, 23]],
    ] as const) {
      const output = bytes(
        renderEffects(image, [effect({ style, frequency: 96, thickness: 0.5 })]).pixels,
      );
      for (let i = 0; i < output.length; i += 4)
        for (let channel = 0; channel < 3; channel++)
          expect(Math.abs(output[i + channel]! - expected[channel]!)).toBeLessThanOrEqual(1);
    }
    const original = fixture(64, 64),
      preview = fixture(16, 16);
    const raster = effect({ frequency: 8 });
    const full = bytes(renderEffects(original, [raster]).pixels);
    const small = bytes(renderEffects(preview, [raster], { reference: original }).pixels);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        for (let channel = 0; channel < 3; channel++) {
          let average = 0;
          for (let dy = 0; dy < 4; dy++)
            for (let dx = 0; dx < 4; dx++)
              average += full[((y * 4 + dy) * 64 + x * 4 + dx) * 4 + channel]! / 16;
          expect(
            Math.abs(small[(y * 16 + x) * 4 + channel]! - Math.round(average)),
          ).toBeLessThanOrEqual(1);
        }
  });
  it('preserves exact no-ops, blends Amount, and is independent of the master seed for full coverage', () => {
    const image = fixture();
    for (const raster of [
      { ...effect(), enabled: false },
      effect({ intensity: 0 }),
      effect({ amount: 0 }),
      effect({ thickness: 0 }),
      { ...effect(), application: { region: 'all' as const, coverage: 0, softness: 0 } },
    ])
      expect(renderEffects(image, [raster]).pixels).toBe(image.pixels);
    const full = bytes(renderEffects(image, [effect()]).pixels);
    const half = bytes(renderEffects(image, [effect({ amount: 0.5 })]).pixels);
    for (let i = 0; i < full.length; i++)
      expect(
        Math.abs(half[i]! - Math.round((full[i]! + bytes(image.pixels)[i]!) / 2)),
      ).toBeLessThanOrEqual(1);
    expect(bytes(renderEffects(image, [effect()], { masterSeed: 99 }).pixels)).toEqual(full);
  });
  it('supports hard/soft and subject masks, cancellable rendering, and one-pixel images', async () => {
    const image = fixture();
    const hard = {
      ...effect(),
      application: { region: 'top' as const, coverage: 0.5, softness: 0 },
    };
    const output = bytes(renderEffects(image, [hard]).pixels);
    const full = bytes(renderEffects(image, [effect()]).pixels);
    expect(output.subarray(0, output.length / 2)).toEqual(full.subarray(0, full.length / 2));
    expect(output.subarray(output.length / 2)).toEqual(
      bytes(image.pixels).subarray(output.length / 2),
    );
    const soft = { ...hard, application: { ...hard.application, softness: 1 } };
    expect(bytes(renderEffects(image, [soft]).pixels)).not.toEqual(output);
    const subject = {
      ...hard,
      application: { region: 'subject' as const, coverage: 1, softness: 0 },
    };
    expect(
      bytes(
        renderEffects(image, [subject], {
          subjectMask: { width: 1, height: 2, values: new Uint8Array([255, 0]).buffer },
        }).pixels,
      ),
    ).toEqual(output);
    expect(
      bytes((await renderEffectsAsync(image, [soft], { yieldControl: async () => {} })).pixels),
    ).toEqual(bytes(renderEffects(image, [soft]).pixels));
    let rows = 0;
    await expect(
      renderEffectsAsync(fixture(256, 256), [effect()], {
        isCancelled: () => ++rows > 4,
        yieldControl: async () => {},
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    for (const style of ['monitor', 'tv', 'interlaced', 'grille'] as const) {
      const single = fixture(1, 1),
        result = bytes(renderEffects(single, [effect({ style })]).pixels);
      expect(result.length).toBe(4);
      expect(result[3]).toBe(0);
      expect(result[0]).toBeLessThanOrEqual(240);
    }
  });
});
