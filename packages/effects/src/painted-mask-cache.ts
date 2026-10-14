import type { PaintedMask, MaskPoint, MaskStroke } from '@gleech/project-model';
import { paintedMaskSteps, strokeCoverageSteps } from './painted-mask';

interface CacheEntry {
  geometry: string;
  strokes: readonly string[];
  brush: string;
  points: readonly MaskPoint[];
  prefix: Float32Array;
  coverage: Float32Array;
  result: Float32Array;
}

const brushKey = (stroke: MaskStroke) =>
  JSON.stringify(Object.entries(stroke).filter(([key]) => key !== 'points'));
const samePrefix = (a: readonly string[], b: readonly string[], count: number) =>
  a.slice(0, count).every((key, i) => key === b[i]);

/** A bounded, caller-owned preview cache. Outputs remain independent arrays.
 * Cache publication is atomic: cancelled generators cannot contaminate a later stroke.
 */
export class PaintedMaskRasterizer {
  private entry: CacheEntry | null = null;
  clear(): void {
    this.entry = null;
  }

  *steps(mask: PaintedMask, width: number, height: number): Generator<void, Float32Array> {
    if (width * height > 1024 * 1024) {
      this.clear();
      return yield* paintedMaskSteps(mask, width, height);
    }
    const geometry = JSON.stringify([
      width,
      height,
      mask.width,
      mask.height,
      mask.base,
      mask.frame,
      mask.paths,
    ]);
    const strokes = mask.strokes.map((stroke) => JSON.stringify(stroke));
    const old = this.entry?.geometry === geometry ? this.entry : null;
    let result: Float32Array;
    if (
      old &&
      old.strokes.length === strokes.length &&
      samePrefix(old.strokes, strokes, strokes.length)
    ) {
      result = old.result.slice();
    } else {
      const last = mask.strokes.at(-1);
      const brush = last ? brushKey(last) : '';
      let prefix: Float32Array;
      let coverage: Float32Array;
      let start = 0;
      let extending = false;
      if (
        old &&
        last &&
        old.strokes.length === strokes.length &&
        samePrefix(old.strokes, strokes, strokes.length - 1) &&
        old.brush === brush &&
        old.points.length <= last.points.length &&
        old.points.every(
          (point, i) => point.x === last.points[i]!.x && point.y === last.points[i]!.y,
        )
      ) {
        prefix = old.prefix;
        // A one-point dab becomes the first segment. Recompute that segment's
        // coverage rather than retaining the dab's differently rounded distance.
        coverage =
          old.points.length === 1 ? new Float32Array(width * height) : old.coverage.slice();
        start = Math.max(0, old.points.length - 1);
        extending = true;
      } else if (
        old &&
        last &&
        old.strokes.length + 1 === strokes.length &&
        samePrefix(old.strokes, strokes, old.strokes.length)
      ) {
        prefix = old.result;
        coverage = new Float32Array(width * height);
      } else {
        prefix = yield* paintedMaskSteps(
          { ...mask, inverted: false, strokes: last ? mask.strokes.slice(0, -1) : [] },
          width,
          height,
        );
        coverage = new Float32Array(width * height);
      }
      result = extending ? old!.result.slice() : prefix.slice();
      if (last) {
        const bounds = yield* strokeCoverageSteps(mask, last, width, height, coverage, start);
        // Only the new segments' bounds changed. Recompose against the stroke's
        // original prefix, so repeated soft/partial-opacity samples do not darken.
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
          for (let x = bounds.minX; x <= bounds.maxX; x++) {
            const i = y * width + x;
            const weight = coverage[i]! * (last.opacity ?? 1);
            result[i] =
              last.mode === 'paint'
                ? prefix[i]! + (1 - prefix[i]!) * weight
                : prefix[i]! * (1 - weight);
          }
          if (y % 16 === 15) yield;
        }
      }
      this.entry = {
        geometry,
        strokes,
        brush,
        points: last ? last.points.map((p) => ({ ...p })) : [],
        prefix,
        coverage,
        result: result.slice(),
      };
    }
    if (mask.inverted)
      for (let i = 0; i < result.length; i++) {
        result[i] = 1 - result[i]!;
        if (i % 4096 === 4095) yield;
      }
    return result;
  }
}
