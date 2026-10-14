import { describe, expect, it } from 'vitest';
import {
  createEffect,
  createPaintedMask,
  assertEffect,
  assertPaintedMask,
  DEFAULT_MASK_BRUSH,
  MAX_MASK_POINTS,
  type PaintedMask,
  attachMaskPattern,
  maskPatternAffine,
  maskFrameAffine,
  transformMaskPoint,
} from './index';
describe('painted mask model', () => {
  it('attaches and detaches patterns without changing the current mapping or seed', () => {
    const original = {
      ...createPaintedMask(400, 200),
      frame: { x: 20, y: 10, scaleX: 1.5, scaleY: 0.75, rotation: 45 },
    };
    const attached = attachMaskPattern(original, true);
    const before = maskPatternAffine(attached);
    for (let i = 0; i < before.length; i++)
      expect(before[i]).toBeCloseTo([1, 0, 0, 1, 0, 0][i]!, 12);
    const moved = { ...attached, frame: { ...original.frame, x: 40, rotation: 90 } };
    const local = { x: 0.3, y: 0.7 };
    const oldCanvas = transformMaskPoint(maskFrameAffine(original.frame, 400, 200), local);
    const newCanvas = transformMaskPoint(maskFrameAffine(moved.frame, 400, 200), local);
    const pattern = transformMaskPoint(maskPatternAffine(moved), newCanvas);
    expect(pattern.x).toBeCloseTo(oldCanvas.x, 12);
    expect(pattern.y).toBeCloseTo(oldCanvas.y, 12);
    const detached = attachMaskPattern(moved, false);
    expect(maskPatternAffine(detached)).toEqual(maskPatternAffine(moved));
    expect(maskPatternAffine({ ...detached, frame: original.frame })).toEqual(
      maskPatternAffine(detached),
    );
  });
  it('rejects malformed or singular mask frames and excessive geometry', () => {
    const original = createPaintedMask(100, 100);
    expect(() =>
      assertPaintedMask({ ...original, frame: { x: 0, y: 0, scaleX: 0, scaleY: 1, rotation: 0 } }),
    ).toThrow();
    expect(() =>
      assertPaintedMask({ ...original, pattern: { attached: true, matrix: [0, 0, 0, 0, 0, 0] } }),
    ).toThrow();
    expect(() =>
      assertPaintedMask({
        ...original,
        paths: [
          {
            id: 'bad',
            kind: 'polygon',
            mode: 'paint',
            opacity: 1,
            feather: 0,
            nodes: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: NaN, y: 1 },
            ],
          },
        ],
      }),
    ).toThrow();
  });
  it('keeps old effects valid without a mask and accepts saved strokes', () => {
    const effect = createEffect('blur', 'blur');
    expect(effect.paintedMask).toBeUndefined();
    assertEffect({
      ...effect,
      paintedMask: {
        ...createPaintedMask(4000, 3000),
        strokes: [
          {
            ...DEFAULT_MASK_BRUSH,
            points: [
              { x: -0.1, y: 0.5 },
              { x: 1.1, y: 0.5 },
            ],
          },
        ],
      },
    });
  });
  it('rejects malformed brush settings, dimensions, points and mask versions', () => {
    const base = createPaintedMask(101, 101),
      stroke = { ...DEFAULT_MASK_BRUSH, points: [{ x: 0.5, y: 0.5 }] };
    for (const changed of [
      { ...base, version: 2 },
      { ...base, enabled: 1 },
      { ...base, width: 0 },
      { ...base, inverted: 'on' },
      { ...base, base: 2 },
      ...[
        { size: 0 },
        { hardness: NaN },
        { shape: 'triangle' },
        { mode: 'wrong' },
        { falloff: 'wrong' },
        { points: [] },
        { points: [{ x: 3, y: 0.5 }] },
        { points: [{ x: Infinity, y: 0.5 }] },
      ].map((changes) => ({ ...base, strokes: [{ ...stroke, ...changes }] })),
    ])
      expect(() => assertPaintedMask(changed as PaintedMask)).toThrow();
    expect(() =>
      assertPaintedMask({
        ...base,
        strokes: [
          {
            ...stroke,
            points: Array.from({ length: MAX_MASK_POINTS + 1 }, () => ({ x: 0.5, y: 0.5 })),
          },
        ],
      }),
    ).toThrow('too many');
  });
});
