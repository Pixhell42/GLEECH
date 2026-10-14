import { describe, expect, it } from 'vitest';
import {
  assertEffect,
  createEffect,
  CUTOUT_REFINEMENT_DEFAULTS,
  type CutoutEffect,
} from '@gleech/project-model';
import { refineCutoutMask } from './cutout-refinement';
import { renderEffects, RenderCancelledError } from './index';
const base = createEffect('cutout', 'cutout') as CutoutEffect;
const params = (patch: Partial<CutoutEffect['params']>) => ({ ...base.params, ...patch });
function refine(
  mask: Float32Array,
  width: number,
  height: number,
  patch: Partial<CutoutEffect['params']>,
) {
  const steps = refineCutoutMask(mask, width, height, params(patch));
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
const square = () =>
  Float32Array.from({ length: 21 * 21 }, (_, i) =>
    Number(i % 21 >= 8 && i % 21 <= 12 && Math.floor(i / 21) >= 8 && Math.floor(i / 21) <= 12),
  );
describe('Cutout boundary refinement', () => {
  it('fills enclosed holes without filling background connected to the border', () => {
    const mask = Float32Array.from({ length: 100 }, (_, i) =>
      Number(i % 10 >= 2 && i % 10 <= 7 && Math.floor(i / 10) >= 2 && Math.floor(i / 10) <= 7),
    );
    mask[44] = 0;
    mask[45] = 0;
    const out = refine(mask, 10, 10, { fillHoles: 'on' });
    expect(out[44]).toBe(1);
    expect(out[45]).toBe(1);
    expect(out[0]).toBe(0);
    mask[24] = mask[34] = 0;
    expect(refine(mask, 10, 10, { fillHoles: 'on' })[44]).toBe(0);
    expect(mask[45]).toBe(0);
  });
  it('removes only islands below the area threshold', () => {
    const mask = Float32Array.from({ length: 100 }, (_, i) =>
      Number(i % 10 >= 3 && i % 10 <= 6 && Math.floor(i / 10) >= 3 && Math.floor(i / 10) <= 6),
    );
    mask[11] = 1;
    const out = refine(mask, 10, 10, { removeSpecks: 1 });
    expect(out[11]).toBe(0);
    expect(out[44]).toBe(1);
    expect([...out].reduce((a, b) => a + b, 0)).toBe(16);
    expect(refine(mask, 10, 10, { removeSpecks: 0 })).toEqual(mask);
  });
  it('expands and contracts the actual boundary with round distance geometry', () => {
    const mask = square(),
      grow = refine(mask, 21, 21, { expand: 10 }),
      shrink = refine(mask, 21, 21, { expand: -10 });
    expect(grow[10 * 21 + 6]).toBe(1);
    expect(grow[10 * 21 + 5]).toBe(0);
    expect(grow[6 * 21 + 6]).toBe(0);
    expect(shrink[10 * 21 + 10]).toBe(1);
    expect(shrink[10 * 21 + 9]).toBe(0);
    expect([...shrink].reduce((a, b) => a + b, 0)).toBe(1);
    const filled = new Float32Array(21 * 21).fill(1);
    expect(refine(filled, 21, 21, { expand: -10 })[0]).toBe(0);
    expect(
      refine(new Float32Array(21 * 21), 21, 21, { expand: 10 }).every((value) => value === 0),
    ).toBe(true);
  });
  it('provides spatial feathering and cleanup smoothing independently of confidence thresholds', () => {
    const mask = square(),
      feather = refine(mask, 21, 21, { feather: 10 }),
      smoothed = refine(mask, 21, 21, { cleanupSmoothing: 5 });
    expect(feather[10 * 21 + 8]).toBeGreaterThan(0.5);
    expect(feather[10 * 21 + 8]).toBeLessThan(1);
    expect(feather[10 * 21 + 7]).toBeGreaterThan(0);
    expect(feather[10 * 21 + 7]).toBeLessThan(0.5);
    expect(feather[10 * 21 + 10]).toBe(1);
    expect(smoothed[10 * 21 + 8]).toBeLessThan(1);
    expect(smoothed[10 * 21 + 7]).toBeGreaterThan(0);
  });
  it('retains legacy Cutout output and exports refinement as alpha without replacing RGB', () => {
    const width = 21,
      height = 21,
      mask = square(),
      pixels = Uint8Array.from(
        Array.from(mask, (value) => [30, 80, 160, value ? 255 : 255]).flat(),
      );
    const image = { width, height, pixels: pixels.buffer };
    const subjectMask = {
      width,
      height,
      values: Uint8Array.from(mask, (value) => value * 255).buffer,
    };
    const effect = { ...base, params: params({ mode: 'subject', softness: 0, expand: 10 }) };
    assertEffect(effect);
    const out = new Uint8Array(renderEffects(image, [effect], { subjectMask }).pixels);
    expect([...out.slice((10 * width + 6) * 4, (10 * width + 6) * 4 + 4)]).toEqual([
      30, 80, 160, 255,
    ]);
    expect([...out.slice(0, 4)]).toEqual([30, 80, 160, 0]);
    const old = { ...base, params: { ...base.params } };
    for (const key of Object.keys(CUTOUT_REFINEMENT_DEFAULTS))
      delete (old.params as Record<string, unknown>)[key];
    assertEffect(old);
    expect(renderEffects(image, [old], { subjectMask }).pixels).toEqual(
      renderEffects(image, [base], { subjectMask }).pixels,
    );
  });
  it('cancels inside refinement and retains the original stage pixels', () => {
    const width = 256,
      height = 128;
    const image = { width, height, pixels: new Uint8Array(width * height * 4).fill(255).buffer };
    const before = image.pixels.slice(0);
    const effect = {
      ...base,
      params: params({
        mode: 'depth',
        fieldSource: 'linear',
        fillHoles: 'on',
        removeSpecks: 1,
        expand: 2,
        feather: 2,
      }),
    };
    let checks = 0;
    expect(() => renderEffects(image, [effect], { isCancelled: () => ++checks > 300 })).toThrow(
      RenderCancelledError,
    );
    expect(image.pixels).toEqual(before);
  });
});
