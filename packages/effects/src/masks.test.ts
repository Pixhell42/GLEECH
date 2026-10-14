import { describe, expect, it } from 'vitest';
import { createEffect, type EffectApplication, type EffectInstance } from '@gleech/project-model';
import { renderEffects } from './index';

const pixels = new Uint8Array(64 * 64 * 4);
for (let y = 0; y < 64; y++)
  for (let x = 0; x < 64; x++) pixels.set([x * 3, y * 3, x * 2 + y, 255], (y * 64 + x) * 4);
const image = { width: 64, height: 64, pixels: pixels.buffer };
const effect = {
  ...createEffect('rgb-split', 'mask-test'),
  params: { amount: 1, horizontal: 10, vertical: 10 },
} as EffectInstance;
const render = (
  application: Omit<EffectApplication, 'softness'> & { softness?: number },
  seed = 9,
) =>
  new Uint8Array(
    renderEffects(image, [{ ...effect, application: { softness: 0, ...application } }], {
      masterSeed: seed,
    }).pixels,
  );
const unchanged = (output: Uint8Array, x: number, y: number) => {
  const index = (y * 64 + x) * 4;
  expect(Array.from(output.subarray(index, index + 4))).toEqual(
    Array.from(pixels.subarray(index, index + 4)),
  );
};

describe('shared application masks', () => {
  it('keeps soft falloff proportional between reduced previews and original-resolution export', () => {
    const values = new Uint8Array(32 * 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) values[y * 32 + x] = x < 16 ? 255 : 0;
    const subjectMask = { width: 32, height: 32, values: values.buffer };
    const source = (size: number) => {
      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) data.set([x, 0, x, 255], (y * size + x) * 4);
      return { width: size, height: size, pixels: data.buffer };
    };
    const original = source(128),
      preview = source(64);
    for (const region of [
      'all',
      'top',
      'bottom',
      'left',
      'right',
      'center',
      'edges',
      'subject',
      'background',
    ] as const) {
      const recipe = {
        ...effect,
        params: { amount: 1, horizontal: 25, vertical: 0 },
        application: { region, coverage: 0.5, softness: 0.5 },
      } as EffectInstance;
      const options = { reference: original, masterSeed: 9, subjectMask };
      const full = new Uint8Array(renderEffects(original, [recipe], options).pixels);
      const small = new Uint8Array(renderEffects(preview, [recipe], options).pixels);
      for (const y of [8, 16, 24, 32, 40, 48, 56])
        for (const x of [16, 24, 32, 40]) {
          const fullWeight = (full[(y * 2 * 128 + x * 2) * 4 + 2]! - x * 2) / 32;
          const smallWeight = (small[(y * 64 + x) * 4 + 2]! - x) / 16;
          expect(Math.abs(fullWeight - smallWeight)).toBeLessThanOrEqual(0.07);
        }
    }
  });
  it('feathers a directional boundary progressively and preserves fully covered and untouched pixels', () => {
    const hard = render({ region: 'top', coverage: 0.5 });
    const soft = render({ region: 'top', coverage: 0.5, softness: 0.5 });
    const full = render({ region: 'all', coverage: 1 });
    const strengths: number[] = [];
    for (let y = 0; y < 64; y++) {
      const index = (y * 64 + 32) * 4 + 2;
      expect(hard[index]).toBe((y < 32 ? full : pixels)[index]);
      strengths.push((soft[index]! - pixels[index]!) / (full[index]! - pixels[index]!));
    }
    expect(strengths[8]).toBe(1);
    expect(strengths[55]).toBe(0);
    expect(strengths[30]).toBeGreaterThan(strengths[34]!);
    expect(strengths[30]).toBeLessThan(1);
    expect(strengths[34]).toBeGreaterThan(0);
    expect(new Set(strengths).size).toBeGreaterThan(8);
    for (let y = 1; y < 64; y++) expect(strengths[y]).toBeLessThanOrEqual(strengths[y - 1]!);
    for (const region of ['all', 'top', 'bottom', 'left', 'right', 'center', 'edges'] as const)
      expect(Array.from(render({ region, coverage: 1, softness: 1 }))).toEqual(Array.from(full));
  });
  it('softens seeded patches without moving their seed or changing their coverage into strength', () => {
    const hard = render({ region: 'all', coverage: 0.25 });
    const soft = render({ region: 'all', coverage: 0.25, softness: 0.3 });
    const full = render({ region: 'all', coverage: 1 });
    let intermediate = 0,
      sum = 0,
      count = 0;
    for (let y = 8; y < 56; y++)
      for (let x = 8; x < 56; x++) {
        const index = (y * 64 + x) * 4 + 2;
        const weight = (soft[index]! - pixels[index]!) / (full[index]! - pixels[index]!);
        if (weight > 0 && weight < 1) intermediate++;
        sum += weight;
        count++;
      }
    expect(intermediate).toBeGreaterThan(count / 2);
    expect(sum / count).toBeGreaterThan(0.2);
    expect(sum / count).toBeLessThan(0.3);
    expect(Array.from(render({ region: 'all', coverage: 0.25 }))).toEqual(Array.from(hard));
    expect(Array.from(render({ region: 'all', coverage: 0.25, softness: 0.3 }))).toEqual(
      Array.from(soft),
    );
  });
  it('clips detected confidence at zero softness and feathers subject/background as complements', () => {
    const values = new Uint8Array(64 * 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) values[y * 64 + x] = x < 32 ? 192 : 64;
    const subjectMask = { width: 64, height: 64, values: values.buffer };
    const apply = (region: 'subject' | 'background', softness: number) =>
      new Uint8Array(
        renderEffects(image, [{ ...effect, application: { region, coverage: 1, softness } }], {
          subjectMask,
        }).pixels,
      );
    const full = render({ region: 'all', coverage: 1 });
    const hard = apply('subject', 0),
      subject = apply('subject', 0.5),
      background = apply('background', 0.5);
    for (let x = 0; x < 64; x++) {
      const index = (32 * 64 + x) * 4 + 2;
      expect(hard[index]).toBe((x < 32 ? full : pixels)[index]);
      expect(
        Math.abs(subject[index]! + background[index]! - pixels[index]! - full[index]!),
      ).toBeLessThanOrEqual(1);
    }
    const edge = (32 * 64 + 32) * 4 + 2;
    expect(subject[edge]).toBeGreaterThan(pixels[edge]!);
    expect(subject[edge]).toBeLessThan(full[edge]!);
    unchanged(subject, 60, 32);
    unchanged(background, 3, 32);
  });
  it('preserves zero coverage and the existing all/full result on every effect', () => {
    for (const type of ['rgb-split', 'block-corruption', 'spatial-crush'] as const) {
      const effect = createEffect(type, 'a');
      expect(
        renderEffects(image, [
          { ...effect, application: { region: 'subject', coverage: 0, softness: 0 } },
        ]).pixels,
      ).toBe(image.pixels);
      const full = new Uint8Array(renderEffects(image, [effect]).pixels);
      const masked = new Uint8Array(
        renderEffects(image, [
          { ...effect, application: { region: 'top', coverage: 0.5, softness: 0 } },
        ]).pixels,
      );
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const index = (y * 64 + x) * 4;
          expect(Array.from(masked.subarray(index, index + 4))).toEqual(
            Array.from((y < 32 ? full : pixels).subarray(index, index + 4)),
          );
        }
    }
  });
  it('applies directional masks to the requested fraction without changing other pixels', () => {
    for (const region of ['top', 'bottom', 'left', 'right'] as const) {
      const output = render({ region, coverage: 0.25 });
      unchanged(
        output,
        region === 'left' ? 48 : region === 'right' ? 16 : 32,
        region === 'top' ? 48 : region === 'bottom' ? 16 : 32,
      );
      const changed = Array.from(output).some((value, index) => value !== pixels[index]);
      expect(changed).toBe(true);
      const larger = render({ region, coverage: 0.75 });
      expect(Array.from(larger)).not.toEqual(Array.from(output));
    }
  });
  it('covers the central area or the complementary frame with the same area convention', () => {
    const center = render({ region: 'center', coverage: 0.25 });
    const edges = render({ region: 'edges', coverage: 0.75 });
    const full = render({ region: 'all', coverage: 1 });
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const index = (y * 64 + x) * 4;
        const inside = x >= 16 && x < 48 && y >= 16 && y < 48;
        expect(Array.from(center.subarray(index, index + 4))).toEqual(
          Array.from((inside ? full : pixels).subarray(index, index + 4)),
        );
        expect(Array.from(edges.subarray(index, index + 4))).toEqual(
          Array.from((inside ? pixels : full).subarray(index, index + 4)),
        );
      }
  });
  it('selects stable seeded patches with increasing coverage rather than weakening the effect', () => {
    const a = render({ region: 'all', coverage: 0.25 });
    const b = render({ region: 'all', coverage: 0.75 });
    const full = render({ region: 'all', coverage: 1 });
    let selected = 0;
    for (let index = 0; index < a.length; index += 4) {
      if (a[index] !== pixels[index] || a[index + 2] !== pixels[index + 2]) {
        selected++;
        expect(Array.from(a.subarray(index, index + 4))).toEqual(
          Array.from(full.subarray(index, index + 4)),
        );
        expect(Array.from(b.subarray(index, index + 4))).toEqual(
          Array.from(full.subarray(index, index + 4)),
        );
      }
    }
    expect(selected / (64 * 64)).toBeGreaterThan(0.2);
    expect(selected / (64 * 64)).toBeLessThan(0.3);
    expect(Array.from(render({ region: 'all', coverage: 0.25 }))).toEqual(Array.from(a));
    expect(Array.from(render({ region: 'all', coverage: 0.25 }, 10))).not.toEqual(Array.from(a));
  });
  it('uses a detected probability map on opaque photos and protects the complement', () => {
    const subjectMask = { width: 2, height: 2, values: new Uint8Array([255, 0, 255, 0]).buffer };
    const subject = new Uint8Array(
      renderEffects(
        image,
        [{ ...effect, application: { region: 'subject', coverage: 1, softness: 0 } }],
        {
          subjectMask,
        },
      ).pixels,
    );
    const background = new Uint8Array(
      renderEffects(
        image,
        [{ ...effect, application: { region: 'background', coverage: 1, softness: 0 } }],
        {
          subjectMask,
        },
      ).pixels,
    );
    unchanged(subject, 60, 32);
    unchanged(background, 3, 32);
    expect(subject[32 * 64 * 4 + 3 * 4 + 2]).not.toBe(pixels[32 * 64 * 4 + 3 * 4 + 2]);
    expect(background[32 * 64 * 4 + 60 * 4]).not.toBe(pixels[32 * 64 * 4 + 60 * 4]);
    expect(() =>
      renderEffects(image, [
        { ...effect, application: { region: 'subject', coverage: 1, softness: 0 } },
      ]),
    ).toThrow('Subject detection');
    expect(
      Array.from(pixels)
        .filter((_, index) => index % 4 === 3)
        .every((alpha) => alpha === 255),
    ).toBe(true);
  });
});
