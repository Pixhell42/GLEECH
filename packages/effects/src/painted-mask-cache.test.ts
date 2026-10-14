import { describe, expect, it } from 'vitest';
import {
  createPaintedMask,
  DEFAULT_MASK_BRUSH,
  type PaintedMask,
  type MaskStroke,
} from '@gleech/project-model';
import { PaintedMaskRasterizer } from './painted-mask-cache';
import { paintedMaskSteps, renderPaintedMask } from './painted-mask';

function drain(work: Generator<void, Float32Array>) {
  let steps = 0;
  while (true) {
    const step = work.next();
    if (step.done) return { values: step.value, steps };
    steps++;
  }
}
const points = Array.from({ length: 80 }, (_, i) => ({
  x: 0.1 + i / 100,
  y: 0.5 + Math.sin(i / 7) * 0.25,
}));
const make = (shape: MaskStroke['shape'], mode: MaskStroke['mode']): MaskStroke => ({
  ...DEFAULT_MASK_BRUSH,
  shape,
  mode,
  hardness: 0.3,
  opacity: 0.37,
  size: 15,
  points,
});

function fractionalBrushCases() {
  let seed = 1729;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: 18 }, (_, trial) => {
    const shape = (['circle', 'square', 'diamond'] as const)[trial % 3]!;
    const stroke: MaskStroke = {
      ...make(shape, trial % 2 ? 'paint' : 'erase'),
      size: 1 + random() * 40,
      hardness: random(),
      opacity: random(),
      falloff: (['linear', 'smooth', 'gaussian'] as const)[trial % 3]!,
      points: Array.from({ length: 12 }, () => ({
        x: random() * 1.2 - 0.1,
        y: random() * 1.2 - 0.1,
      })),
    };
    const mask = {
      ...createPaintedMask(1090, 790),
      base: trial % 2 ? (0 as const) : (1 as const),
      frame: {
        x: random() * 30,
        y: -random() * 30,
        rotation: random() * 90,
        scaleX: 0.7 + random(),
        scaleY: 0.7 + random(),
      },
    };
    return [trial, { mask, stroke }] as const;
  });
}
describe('incremental mask rasterization', () => {
  it.each(fractionalBrushCases())(
    'trial %i matches fresh rasterization for fractional brushes and transformed endpoints',
    (_trial, { mask, stroke }) => {
      const rasterizer = new PaintedMaskRasterizer();
      for (let count = 1; count <= stroke.points.length; count++) {
        const next = { ...mask, strokes: [{ ...stroke, points: stroke.points.slice(0, count) }] };
        expect(drain(rasterizer.steps(next, 73, 61)).values).toEqual(
          renderPaintedMask(next, 73, 61),
        );
      }
    },
  );
  it.each(['circle', 'square', 'diamond'] as const)(
    '%s retains exact soft coverage while extending, appending, inverting and undoing strokes',
    (shape) => {
      const rasterizer = new PaintedMaskRasterizer();
      let mask: PaintedMask = { ...createPaintedMask(1600, 900), strokes: [] };
      const compare = (current: PaintedMask) => {
        const values = drain(rasterizer.steps(current, 129, 73)).values;
        expect(values).toEqual(renderPaintedMask(current, 129, 73));
        // A consumer is free to modify its own output without corrupting future cache hits.
        values.fill(0.123);
        expect(drain(rasterizer.steps(current, 129, 73)).values).toEqual(
          renderPaintedMask(current, 129, 73),
        );
      };
      compare(mask);
      for (const mode of ['paint', 'erase', 'paint'] as const) {
        const stroke = make(shape, mode);
        for (const count of [1, 2, 12, 40, 80])
          compare({
            ...mask,
            strokes: [...mask.strokes, { ...stroke, points: points.slice(0, count) }],
          });
        mask = { ...mask, strokes: [...mask.strokes, stroke] };
        compare(mask);
        compare({ ...mask, inverted: true });
      }
      compare({ ...mask, strokes: mask.strokes.slice(0, -1) });
      compare(mask);
      compare({ ...mask, frame: { x: 13, y: -21, rotation: 38, scaleX: 1.3, scaleY: 0.7 } });
      compare({ ...mask, base: 1, strokes: [make(shape, 'erase')] });
      compare({
        ...mask,
        paths: [
          {
            id: 'shape',
            kind: 'polygon',
            mode: 'erase',
            opacity: 0.5,
            feather: 3,
            nodes: [
              { x: 0.2, y: 0.2 },
              { x: 0.7, y: 0.2 },
              { x: 0.5, y: 0.8 },
            ],
          },
        ],
      });
    },
  );
  it('reuses completed strokes and only scans newly added segments', () => {
    const rasterizer = new PaintedMaskRasterizer();
    const base = createPaintedMask(1024, 768);
    const strokes = Array.from({ length: 20 }, (_, i) => ({
      ...make('circle', i % 2 ? 'erase' : 'paint'),
      points: points.slice(0, 50),
    }));
    drain(rasterizer.steps({ ...base, strokes }, 256, 192));
    const extended = {
      ...base,
      strokes: [...strokes.slice(0, -1), { ...strokes.at(-1)!, points: points.slice(0, 51) }],
    };
    const cached = drain(rasterizer.steps(extended, 256, 192));
    const full = drain(paintedMaskSteps(extended, 256, 192));
    expect(cached.values).toEqual(full.values);
    expect(cached.steps).toBeLessThan(full.steps / 10);
    const hit = drain(rasterizer.steps(extended, 256, 192));
    expect(hit.steps).toBe(0);
  });
  it('does not publish partial cancelled coverage, and invalidates edits to existing points or brush parameters', () => {
    const rasterizer = new PaintedMaskRasterizer();
    const base = {
      ...createPaintedMask(400, 400),
      strokes: [{ ...make('square', 'paint'), points: points.slice(0, 30) }],
    };
    drain(rasterizer.steps(base, 128, 128));
    const cancelled = rasterizer.steps({ ...base, strokes: [make('square', 'paint')] }, 128, 128);
    cancelled.next();
    cancelled.return(new Float32Array());
    for (const mask of [
      base,
      { ...base, strokes: [{ ...base.strokes[0]!, hardness: 0.9 }] },
      {
        ...base,
        strokes: [{ ...base.strokes[0]!, points: [...points.slice(0, 10), { x: 0.8, y: 0.1 }] }],
      },
    ])
      expect(drain(rasterizer.steps(mask, 128, 128)).values).toEqual(
        renderPaintedMask(mask, 128, 128),
      );
    expect(drain(rasterizer.steps(base, 64, 128)).values).toEqual(renderPaintedMask(base, 64, 128));
    rasterizer.clear();
    expect(drain(rasterizer.steps(base, 128, 128)).values).toEqual(
      renderPaintedMask(base, 128, 128),
    );
  });
});
