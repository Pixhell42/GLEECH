import { describe, expect, it } from 'vitest';
import {
  createEffect,
  DITHER_ALGORITHMS,
  INDEXED_PALETTES,
  assertEffect,
  type DitherEffect,
  type IndexedPaletteEffect,
  type ThresholdEffect,
  type EffectInstance,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync, RenderCancelledError } from './index';
import { fixedPalette, nearestPalette, sampledPalette } from './indexed-palette';
import { BLUE_NOISE_RANKS, BLUE_NOISE_SIZE } from './blue-noise';
import { thresholdTone } from './threshold';

const palette = (params: Partial<IndexedPaletteEffect['params']> = {}): IndexedPaletteEffect => {
  const e = createEffect('indexed-palette', 'palette') as IndexedPaletteEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const dither = (params: Partial<DitherEffect['params']> = {}): DitherEffect => {
  const e = createEffect('dither', 'dither') as DitherEffect;
  return { ...e, params: { ...e.params, ...params } };
};
const threshold = (params: Partial<ThresholdEffect['params']> = {}): ThresholdEffect => {
  const e = createEffect('threshold', 'threshold') as ThresholdEffect;
  return { ...e, params: { ...e.params, inkColor: '#000000', paperColor: '#ffffff', ...params } };
};
const gray = (values: number[], width = values.length) => ({
  width,
  height: values.length / width,
  pixels: Uint8Array.from(values.flatMap((v) => [v, v, v, 255])).buffer,
});
const fixture = (width = 29, height = 23) => ({
  width,
  height,
  pixels: Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 41 + Math.floor(i / 4) * 17) % 256,
  ).buffer,
});
const run = (source: ReturnType<typeof gray>, e: EffectInstance) =>
  new Uint8Array(renderEffects(source, [e], { masterSeed: 8172 }).pixels);
const reds = (bytes: Uint8Array) =>
  Array.from({ length: bytes.length / 4 }, (_, i) => bytes[i * 4]!);
const exhaust = <T>(work: Generator<void, T>) => {
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
};

describe('indexed palettes', () => {
  it('selects exact nearest RGB with stable index ties', () => {
    const colors = fixedPalette(palette({ palette: 'rgb332', colors: 256 }).params),
      nearest = nearestPalette(colors);
    for (let i = 0; i < 400; i++) {
      const r = (i * 71) % 256,
        g = (i * 17 + 23) % 256,
        b = (i * 113 + 9) % 256;
      let best = 0,
        distance = Infinity;
      for (let j = 0; j < colors.length; j++) {
        const c = colors[j]!,
          d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
        if (d < distance) {
          distance = d;
          best = j;
        }
      }
      expect(nearest(r, g, b)).toBe(best);
    }
    expect(
      nearestPalette([
        [0, 0, 0],
        [255, 255, 255],
      ])(127.5, 127.5, 127.5),
    ).toBe(0);
  });
  it('samples weighted visible source colors and never imports hidden transparent RGB', () => {
    const image = {
      width: 3,
      height: 1,
      pixels: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]).buffer,
    };
    expect(exhaust(sampledPalette(image, 16))).toEqual([
      [255, 0, 0],
      [0, 255, 0],
    ]);
    const other = { ...image, pixels: image.pixels.slice(0) };
    new Uint8Array(other.pixels).set([255, 0, 255], 8);
    expect(exhaust(sampledPalette(other, 16))).toEqual(exhaust(sampledPalette(image, 16)));
    const weighted = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([100, 50, 20, 255, 103, 52, 22, 1]).buffer,
    };
    expect(exhaust(sampledPalette(weighted, 2))).toEqual([[100, 50, 20]]);
  });
  it('keeps every fixed/custom palette within its total color budget and native limits', () => {
    const image = fixture();
    for (const source of INDEXED_PALETTES)
      for (const count of [2, 4, 16, 256]) {
        const e = palette({ palette: source, colors: count });
        const output = run(image, e),
          colors = new Set(
            Array.from({ length: image.width * image.height }, (_, i) =>
              [...output.slice(i * 4, i * 4 + 3)].join(','),
            ),
          );
        expect(colors.size).toBeLessThanOrEqual(count);
        expect([...output].every(Number.isFinite)).toBe(true);
      }
    expect(fixedPalette(palette({ palette: 'gameboy', colors: 256 }).params)).toHaveLength(4);
    expect(fixedPalette(palette({ palette: 'monochrome', colors: 256 }).params)).toHaveLength(2);
    expect(
      fixedPalette(
        palette({
          palette: 'custom',
          colors: 3,
          paletteStart: '#000000',
          paletteEnd: '#ffffff',
          paletteStartStops:
            '[{"position":0,"color":"#000000"},{"position":0.5,"color":"#ff0000"},{"position":1,"color":"#ffffff"}]',
        }).params,
      ),
    ).toEqual([
      [0, 0, 0],
      [255, 0, 0],
      [255, 255, 255],
    ]);
  });
  it('uses the stage input for source palettes, independently of preceding effects', () => {
    const image = gray([20, 220]);
    const solid = createEffect('solid', 'solid');
    const output = new Uint8Array(renderEffects(image, [solid, palette({ colors: 2 })]).pixels);
    expect(reds(output).every((v) => v === 20 || v === 220)).toBe(true);
  });
  it('keeps source palettes stable when a draft has averaged away source colors', () => {
    const source = gray([20, 220]),
      draft = gray([128]);
    const sourceBytes = source.pixels.slice(0),
      draftBytes = draft.pixels.slice(0);
    const e = palette({ colors: 2 });
    expect(reds(new Uint8Array(renderEffects(draft, [e]).pixels))).toEqual([128]);
    expect(
      reds(new Uint8Array(renderEffects(draft, [e], { paletteSource: source }).pixels)),
    ).toEqual([220]);
    expect(source.pixels).toEqual(sourceBytes);
    expect(draft.pixels).toEqual(draftBytes);
  });
  it('maps dithering into the same palette and reproduces seeded corruption', () => {
    const image = fixture(31, 25);
    for (const mode of ['none', 'ordered', 'floyd-steinberg', 'blue-noise', 'random'] as const) {
      const e = palette({ palette: 'cga', colors: 4, dither: mode });
      const legal = new Set(fixedPalette(e.params).map((c) => c.join(','))),
        output = run(image, e);
      for (let i = 0; i < output.length; i += 4)
        expect(legal.has([...output.slice(i, i + 3)].join(','))).toBe(true);
    }
    for (const params of [
      { colorSwap: 1 },
      { hueDamage: 1 },
      { saturationDamage: 1 },
      { drift: 0.9 },
    ]) {
      const e = palette({ palette: 'cga', colors: 16, ...params }),
        out = run(image, e);
      expect(out).toEqual(run(image, e));
      expect(out).not.toEqual(run(image, { ...e, seedOffset: 1 }));
    }
  });
});

describe('diffusion and threshold patterns', () => {
  it('matches independent forward-scan diffusion examples', () => {
    const source = gray([50, 80, 100, 150, 200, 200, 150, 100, 80, 50, 120, 140, 160, 180, 200], 5);
    const goldens = {
      'floyd-steinberg': [0, 0, 255, 0, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255],
      atkinson: [0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255],
      sierra: [0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255],
      jarvis: [0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255],
    } as const;
    for (const [algorithm, expected] of Object.entries(goldens))
      expect(
        reds(
          run(
            source,
            dither({
              algorithm: algorithm as DitherEffect['params']['algorithm'],
              scan: 'forward',
            }),
          ),
        ),
      ).toEqual(expected);
  });
  it('supports all algorithms, tonal levels, RGB channels and editable ramps', () => {
    const source = fixture();
    for (const algorithm of DITHER_ALGORITHMS)
      for (const coloring of ['mono', 'rgb', 'ramp'] as const) {
        const e = dither({ algorithm, coloring, levels: 4, skippedCells: 0, cellSize: 2 }),
          out = run(source, e);
        expect(out).toEqual(run(source, e));
        expect(out).not.toEqual(new Uint8Array(source.pixels));
        for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
        if (coloring === 'mono')
          for (let i = 0; i < out.length; i += 4) {
            expect(out[i + 1]).toBe(out[i]);
            expect(out[i + 2]).toBe(out[i]);
            expect([0, 85, 170, 255]).toContain(out[i]);
          }
      }
    expect(reds(run(gray([0, 85, 170, 255]), dither({ algorithm: 'none', levels: 4 })))).toEqual([
      0, 85, 170, 255,
    ]);
    const e = dither({
      algorithm: 'none',
      coloring: 'ramp',
      levels: 3,
      rampStart: '#000000',
      rampEnd: '#ffffff',
      rampStartStops:
        '[{"position":0,"color":"#000000"},{"position":0.5,"color":"#ff0000"},{"position":1,"color":"#ffffff"}]',
    });
    expect([...run(gray([0, 128, 255]), e)]).toEqual([
      0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
    ]);
  });
  it('uses genuine blue-noise ranks with suppressed low-frequency energy', () => {
    expect(BLUE_NOISE_SIZE).toBe(64);
    expect(new Set(BLUE_NOISE_RANKS).size).toBe(4096);
    expect(Math.min(...BLUE_NOISE_RANKS)).toBe(0);
    expect(Math.max(...BLUE_NOISE_RANKS)).toBe(4095);
    const power = (fx: number, fy: number) => {
      let real = 0,
        imaginary = 0;
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const value = BLUE_NOISE_RANKS[y * 64 + x]! < 2048 ? 0.5 : -0.5,
            angle = (2 * Math.PI * (fx * x + fy * y)) / 64;
          real += value * Math.cos(angle);
          imaginary += value * Math.sin(angle);
        }
      return real * real + imaginary * imaginary;
    };
    const low = [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ].reduce((sum, [x, y]) => sum + power(x!, y!), 0);
    const high = [
      [17, 0],
      [0, 17],
      [20, 20],
      [13, 19],
      [19, 13],
      [25, 25],
    ].reduce((sum, [x, y]) => sum + power(x!, y!), 0);
    expect(low).toBeLessThan(high * 0.2);
    const source = gray(
      Array.from({ length: 128 * 128 }, () => 128),
      128,
    );
    const out = reds(run(source, dither({ algorithm: 'blue-noise' })));
    expect(Math.abs(out.reduce((a, b) => a + b, 0) / out.length - 128)).toBeLessThan(1);
  });
  it('limits quantization strength and keeps alpha/hidden RGB and invisible gaps intact', () => {
    const source = gray([100, 160, 230, 100, 160, 230]);
    const bytes = new Uint8Array(source.pixels);
    bytes[7] = 0;
    bytes[3] = 128;
    bytes[11] = 1;
    for (const algorithm of DITHER_ALGORITHMS) {
      const out = run(source, dither({ algorithm, skippedCells: 0 }));
      for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(bytes[i]);
      expect([...out.slice(4, 8)]).toEqual([...bytes.slice(4, 8)]);
      expect(
        run(
          source,
          dither({ algorithm, ditherStrength: 0, skippedCells: 0, blockInterruptions: 0 }),
        ),
      ).toEqual(run(source, dither({ algorithm: 'none' })));
    }
    const gap = gray([100, 0, 140]);
    new Uint8Array(gap.pixels)[7] = 0;
    const changed = { ...gap, pixels: gap.pixels.slice(0) };
    new Uint8Array(changed.pixels)[0] = 30;
    for (const algorithm of ['floyd-steinberg', 'atkinson', 'sierra', 'jarvis'] as const)
      expect(run(gap, dither({ algorithm })).slice(8)).toEqual(
        run(changed, dither({ algorithm })).slice(8),
      );
  });
  it('reproduces and independently exercises every corrupted-dither failure control', () => {
    const source = fixture(41, 37);
    const clean = dither({
      algorithm: 'corrupted',
      coloring: 'rgb',
      skippedCells: 0,
      errorDisplacement: 0,
      randomDirection: 0,
      blockInterruptions: 0,
      channelDivergence: 0,
    });
    expect(run(source, clean)).toEqual(
      run(source, dither({ algorithm: 'floyd-steinberg', coloring: 'rgb' })),
    );
    for (const params of [
      { skippedCells: 0.4 },
      { errorDisplacement: 8 },
      { randomDirection: 0.8 },
      { blockInterruptions: 0.5, blockSize: 4 },
      { channelDivergence: 0.8 },
    ]) {
      const e = { ...clean, params: { ...clean.params, ...params } },
        out = run(source, e);
      expect(out).not.toEqual(run(source, clean));
      expect(out).toEqual(run(source, e));
      expect(out).not.toEqual(run(source, { ...e, seedOffset: 1 }));
    }
    expect(run(source, { ...clean, params: { ...clean.params, skippedCells: 1 } })).toEqual(
      new Uint8Array(source.pixels),
    );
    expect(run(source, { ...clean, params: { ...clean.params, blockInterruptions: 1 } })).toEqual(
      run(source, dither({ algorithm: 'none', coloring: 'rgb' })),
    );
  });
  it('averages coarse cells with alpha weights rather than hidden colors', () => {
    const source = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 0]).buffer,
    };
    expect([...run(source, dither({ algorithm: 'none', coloring: 'rgb', cellSize: 2 }))]).toEqual([
      255, 0, 0, 255, 0, 255, 0, 0,
    ]);
  });
});

describe('threshold / bitmap / photocopy', () => {
  it('clips levels, applies gamma and inverts exact threshold/bitmap colors', () => {
    expect(reds(run(gray([0, 80, 128, 180, 255]), threshold()))).toEqual([0, 0, 255, 255, 255]);
    expect(reds(run(gray([0, 80, 128, 180, 255]), threshold({ invert: 'on' })))).toEqual([
      255, 255, 0, 0, 0,
    ]);
    expect(reds(run(gray([0, 85, 170, 255]), threshold({ style: 'bitmap', levels: 4 })))).toEqual([
      0, 85, 170, 255,
    ]);
    expect(thresholdTone(0.35, { inputBlack: 0.2, inputWhite: 0.8, gamma: 2 })).toBeCloseTo(0.5);
    expect(() => assertEffect(threshold({ inputBlack: 0.8, inputWhite: 0.2 }))).toThrow();
  });
  it('matches an independent alpha-weighted clipped-neighborhood local threshold', () => {
    const source = fixture(7, 5),
      input = new Uint8Array(source.pixels);
    for (let i = 3; i < input.length; i += 12) input[i] = 0;
    const e = threshold({ local: 'on', localRadius: 0.1 }),
      out = run(source, e);
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 7; x++) {
        const i = (y * 7 + x) * 4;
        if (input[i + 3] === 0) {
          expect([...out.slice(i, i + 4)]).toEqual([...input.slice(i, i + 4)]);
          continue;
        }
        let sum = 0,
          weight = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(4, y + 1); yy++)
          for (let xx = Math.max(0, x - 1); xx <= Math.min(6, x + 1); xx++) {
            const j = (yy * 7 + xx) * 4,
              a = input[j + 3]!;
            sum += (0.2126 * input[j]! + 0.7152 * input[j + 1]! + 0.0722 * input[j + 2]!) * a;
            weight += a;
          }
        const value = 0.2126 * input[i]! + 0.7152 * input[i + 1]! + 0.0722 * input[i + 2]!;
        expect(out[i], `${x},${y}: tone ${value} mean ${sum / weight}`).toBe(
          value >= sum / weight - 1e-9 ? 255 : 0,
        );
      }
  });
  it('adds controllable edge emphasis and reproducible photocopy dirt without changing alpha', () => {
    const edge = gray([220, 220, 20, 220, 220]);
    expect(run(edge, threshold({ style: 'photocopy', dirt: 0, edgeEmphasis: 2 }))).not.toEqual(
      run(edge, threshold({ style: 'photocopy', dirt: 0, edgeEmphasis: 0 })),
    );
    const source = fixture(),
      e = threshold({ style: 'photocopy', dirt: 0.8, dirtSize: 2 }),
      out = run(source, e);
    expect(out).toEqual(run(source, e));
    expect(out).not.toEqual(run(source, { ...e, seedOffset: 1 }));
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });
  it('supports colors, gradient ink/paper, opacity and shared application masks', () => {
    const source = gray([200, 200, 200, 200]);
    const base = threshold({ inkColor: '#ff0000', paperColor: '#00ff00' });
    expect([...run(source, base)]).toEqual(
      Array.from({ length: 4 }, () => [0, 255, 0, 255]).flat(),
    );
    expect(reds(run(source, threshold({ amount: 0.5 })))).toEqual([228, 228, 228, 228]);
    expect(
      reds(
        run(source, {
          ...threshold(),
          application: { region: 'left', coverage: 0.5, softness: 0 },
        }),
      ),
    ).toEqual([255, 255, 200, 200]);
    const gradient = threshold({
      paperColor: '#ff0000',
      paperColorMode: 'gradient',
      paperColorEnd: '#0000ff',
    });
    const out = run(source, gradient);
    expect(out[0]).toBeGreaterThan(out[12]!);
    expect(out[2]).toBeLessThan(out[14]!);
  });
  it('has exact disabled/zero-opacity bypasses and responsive cancellation for all three filters', async () => {
    const source = fixture();
    for (const e of [palette(), threshold(), dither()]) {
      expect(run(source, { ...e, enabled: false })).toEqual(new Uint8Array(source.pixels));
      expect(run(source, { ...e, params: { ...e.params, amount: 0 } } as EffectInstance)).toEqual(
        new Uint8Array(source.pixels),
      );
      let polls = 0;
      await expect(
        renderEffectsAsync(fixture(2048, 1024), [e], {
          isCancelled: () => ++polls > 4,
          yieldControl: async () => {},
        }),
      ).rejects.toBeInstanceOf(RenderCancelledError);
    }
  });
});
