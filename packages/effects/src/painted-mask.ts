import {
  DEFAULT_MASK_FRAME,
  maskFrameAffine,
  invertMaskAffine,
  transformMaskPoint,
  type PaintedMask,
  type MaskStroke,
  type MaskPath,
  type MaskPoint,
  type MaskAffine,
  type CanvasDrawing,
} from '@gleech/project-model';

function pathPoints(
  path: MaskPath,
  matrix: MaskAffine,
  width: number,
  height: number,
): MaskPoint[] {
  const pixel = (p: MaskPoint) => {
    const transformed = transformMaskPoint(matrix, p);
    return { x: transformed.x * width, y: transformed.y * height };
  };
  const result: MaskPoint[] = [];
  const midpoint = (a: MaskPoint, b: MaskPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const curve = (a: MaskPoint, b: MaskPoint, c: MaskPoint, d: MaskPoint, depth: number) => {
    const chord = Math.hypot(d.x - a.x, d.y - a.y);
    const deviation = (p: MaskPoint) =>
      chord > 0
        ? Math.abs((p.x - a.x) * (d.y - a.y) - (p.y - a.y) * (d.x - a.x)) / chord
        : Math.hypot(p.x - a.x, p.y - a.y);
    if (depth >= 10 || (deviation(b) <= 0.25 && deviation(c) <= 0.25)) {
      result.push(d);
      return;
    }
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      cd = midpoint(c, d);
    const abc = midpoint(ab, bc),
      bcd = midpoint(bc, cd),
      center = midpoint(abc, bcd);
    curve(a, ab, abc, center, depth + 1);
    curve(center, bcd, cd, d, depth + 1);
  };
  result.push(pixel(path.nodes[0]!));
  for (let i = 0; i < path.nodes.length; i++) {
    const a = path.nodes[i]!,
      b = path.nodes[(i + 1) % path.nodes.length]!;
    if (path.kind === 'curve' && (a.outgoing || b.incoming))
      curve(pixel(a), pixel(a.outgoing ?? a), pixel(b.incoming ?? b), pixel(b), 0);
    else result.push(pixel(b));
  }
  return result;
}
function* pathCoverage(
  path: MaskPath,
  matrix: MaskAffine,
  width: number,
  height: number,
  radius: number,
): Generator<void, Float32Array> {
  const points = pathPoints(path, matrix, width, height);
  const values = new Float32Array(width * height);
  const minY = Math.max(0, Math.floor(points.reduce((v, p) => Math.min(v, p.y), Infinity)));
  const maxY = Math.min(
    height - 1,
    Math.ceil(points.reduce((v, p) => Math.max(v, p.y), -Infinity)),
  );
  for (let y = minY; y <= maxY; y++) {
    const crossings: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!,
        b = points[i + 1]!;
      if (a.y > y + 0.5 !== b.y > y + 0.5)
        crossings.push(a.x + ((y + 0.5 - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = Math.min(width, Math.max(0, Math.ceil(crossings[i]! - 0.5)));
      const right = Math.max(0, Math.min(width, Math.ceil(crossings[i + 1]! - 0.5)));
      if (right > left) values.fill(1, y * width + left, y * width + right);
    }
    yield;
  }
  if (radius > 0) {
    const distances = new Float32Array(width * height);
    distances.fill(Infinity);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!,
        b = points[i + 1]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const parts = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, radius)),
      );
      for (let part = 0; part < parts; part++) {
        const x0 = a.x + (dx * part) / parts,
          x1 = a.x + (dx * (part + 1)) / parts;
        const y0 = a.y + (dy * part) / parts,
          y1 = a.y + (dy * (part + 1)) / parts;
        const left = Math.max(0, Math.floor(Math.min(x0, x1) - radius)),
          right = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + radius));
        const top = Math.max(0, Math.floor(Math.min(y0, y1) - radius)),
          bottom = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + radius));
        for (let y = top; y <= bottom; y++) {
          for (let x = left; x <= right; x++) {
            const denominator = dx * dx + dy * dy;
            const t =
              denominator > 0
                ? Math.max(
                    0,
                    Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / denominator),
                  )
                : 0;
            const d = Math.hypot(x + 0.5 - a.x - t * dx, y + 0.5 - a.y - t * dy);
            const index = y * width + x;
            if (d < distances[index]!) distances[index] = d;
          }
          if (y % 16 === 15) yield;
        }
        yield;
      }
    }
    for (let i = 0; i < values.length; i++) {
      if (distances[i]! < radius) {
        const t = distances[i]! / radius;
        const fade = t * t * (3 - 2 * t);
        values[i] = values[i]! > 0 ? 0.5 + 0.5 * fade : 0.5 - 0.5 * fade;
      }
      if (i % 4096 === 4095) yield;
    }
  }
  return values;
}

// Brush coordinates live in the saved canvas, independently of any image warp
// before/after this effect. Rasterize at the requested output resolution.
function distance(x: number, y: number, dx: number, dy: number, stroke: MaskStroke): number {
  if (dx === 0 && dy === 0)
    return stroke.shape === 'circle'
      ? Math.hypot(x, y)
      : stroke.shape === 'square'
        ? Math.max(Math.abs(x), Math.abs(y))
        : Math.abs(x) + Math.abs(y);
  if (stroke.shape === 'circle') {
    const t = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - t * dx, y - t * dy);
  }
  const metric = (t: number) =>
    stroke.shape === 'square'
      ? Math.max(Math.abs(x - t * dx), Math.abs(y - t * dy))
      : Math.abs(x - t * dx) + Math.abs(y - t * dy);
  let best = Math.min(metric(0), metric(1));
  const candidate = (t: number) => {
    if (t > 0 && t < 1) best = Math.min(best, metric(t));
  };
  if (stroke.shape === 'square') {
    if (dx !== dy) candidate((x - y) / (dx - dy));
    if (dx !== -dy) candidate((x + y) / (dx + dy));
  } else {
    if (dx !== 0) candidate(x / dx);
    if (dy !== 0) candidate(y / dy);
  }
  return best;
}
export function brushCoverage(d: number, stroke: MaskStroke): number {
  if (d > 1) return 0;
  if (d <= stroke.hardness || stroke.hardness === 1) return 1;
  const t = (d - stroke.hardness) / (1 - stroke.hardness);
  return stroke.falloff === 'linear'
    ? 1 - t
    : stroke.falloff === 'smooth'
      ? 1 - t * t * (3 - 2 * t)
      : (Math.exp(-4 * t * t) - Math.exp(-4)) / (1 - Math.exp(-4));
}
/** Extend a stroke's maximum coverage without compositing its opacity again. */
export function* strokeCoverageSteps(
  mask: PaintedMask,
  stroke: MaskStroke,
  width: number,
  height: number,
  coverage: Float32Array,
  startPoint = 0,
): Generator<void, { minX: number; minY: number; maxX: number; maxY: number }> {
  const shorter = Math.min(mask.width, mask.height);
  const frame = mask.frame ?? DEFAULT_MASK_FRAME;
  const matrix = maskFrameAffine(frame, mask.width, mask.height);
  const inverse = invertMaskAffine(matrix);
  const transformed =
    frame.x !== 0 ||
    frame.y !== 0 ||
    frame.scaleX !== 1 ||
    frame.scaleY !== 1 ||
    frame.rotation !== 0;
  const rx = (((shorter * stroke.size) / 200) * width) / mask.width;
  const ry = (((shorter * stroke.size) / 200) * height) / mask.height;
  const boundRx = Math.abs(matrix[0]) * rx + (Math.abs(matrix[2]) * ry * width) / height;
  const boundRy = (Math.abs(matrix[1]) * rx * height) / width + Math.abs(matrix[3]) * ry;
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let point = startPoint; point < Math.max(1, stroke.points.length - 1); point++) {
    const a = stroke.points[point]!,
      b = stroke.points[Math.min(point + 1, stroke.points.length - 1)]!;
    const ax = a.x * width,
      ay = a.y * height;
    const dx = b.x * width - ax,
      dy = b.y * height - ay;
    const aa = transformMaskPoint(matrix, a),
      bb = transformMaskPoint(matrix, b);
    const globalX = aa.x * width,
      globalY = aa.y * height;
    const globalDx = transformed ? (bb.x - aa.x) * width : dx,
      globalDy = transformed ? (bb.y - aa.y) * height : dy;
    // Subdivide long segments to avoid scanning their entire diagonal box.
    const parts = Math.max(
      1,
      Math.min(
        width + height,
        Math.ceil(Math.max(Math.abs(globalDx) / boundRx, Math.abs(globalDy) / boundRy)),
      ),
    );
    for (let part = 0; part < parts; part++) {
      const x0 = globalX + (globalDx * part) / parts,
        y0 = globalY + (globalDy * part) / parts;
      const x1 = globalX + (globalDx * (part + 1)) / parts,
        y1 = globalY + (globalDy * (part + 1)) / parts;
      const left = Math.max(0, Math.floor(Math.min(x0, x1) - boundRx)),
        right = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + boundRx));
      const top = Math.max(0, Math.floor(Math.min(y0, y1) - boundRy)),
        bottom = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + boundRy));
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, right);
      minY = Math.min(minY, top);
      maxY = Math.max(maxY, bottom);
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const i = y * width + x;
          if (coverage[i] === 1) continue;
          const localX =
            inverse[0] * (x + 0.5) + (inverse[2] * (y + 0.5) * width) / height + inverse[4] * width;
          const localY =
            (inverse[1] * (x + 0.5) * height) / width +
            inverse[3] * (y + 0.5) +
            inverse[5] * height;
          const d = distance((localX - ax) / rx, (localY - ay) / ry, dx / rx, dy / ry, stroke);
          coverage[i] = Math.max(coverage[i]!, brushCoverage(d, stroke));
        }
        if (y % 16 === 15) yield;
      }
      yield;
    }
  }
  return { minX, minY, maxX, maxY };
}
export function* paintedMaskSteps(
  mask: PaintedMask,
  width: number,
  height: number,
): Generator<void, Float32Array> {
  const result = new Float32Array(width * height);
  if (mask.base) result.fill(mask.base);
  const frame = mask.frame ?? DEFAULT_MASK_FRAME;
  const matrix = maskFrameAffine(frame, mask.width, mask.height);
  for (const path of mask.paths ?? []) {
    const radius =
      ((Math.min(width, height) * path.feather) / 100) * Math.sqrt(frame.scaleX * frame.scaleY);
    const values = yield* pathCoverage(path, matrix, width, height, radius);
    for (let i = 0; i < result.length; i++) {
      const weight = values[i]! * path.opacity;
      result[i] =
        path.mode === 'paint' ? result[i]! + (1 - result[i]!) * weight : result[i]! * (1 - weight);
      if (i % 4096 === 4095) yield;
    }
  }
  const coverage = new Float32Array(result.length);
  for (const stroke of mask.strokes) {
    const { minX, minY, maxX, maxY } = yield* strokeCoverageSteps(
      mask,
      stroke,
      width,
      height,
      coverage,
    );
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = y * width + x,
          weight = coverage[i]! * (stroke.opacity ?? 1);
        result[i] =
          stroke.mode === 'paint'
            ? result[i]! + (1 - result[i]!) * weight
            : result[i]! * (1 - weight);
        coverage[i] = 0;
      }
      yield;
    }
  }
  if (mask.inverted)
    for (let i = 0; i < result.length; i++) {
      result[i] = 1 - result[i]!;
      if (i % 4096 === 4095) yield;
    }
  return result;
}
export function renderPaintedMask(mask: PaintedMask, width: number, height: number): Float32Array {
  const work = paintedMaskSteps(mask, width, height);
  while (true) {
    const step = work.next();
    if (step.done) return step.value;
  }
}
export function* canvasDrawingSteps(
  drawing: CanvasDrawing,
  width: number,
  height: number,
): Generator<void, Uint8Array> {
  const result = new Uint8Array(width * height * 4);
  const rgb = (color: string) => [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
  if (drawing.baseColor) {
    const color = rgb(drawing.baseColor);
    for (let i = 0; i < result.length; i += 4) {
      result.set([...color, 255], i);
      if (i % 16384 === 0) yield;
    }
  }
  for (const item of [...drawing.paths, ...drawing.strokes]) {
    const path = 'nodes' in item;
    const coverage = yield* paintedMaskSteps(
      {
        version: 1,
        width: drawing.width,
        height: drawing.height,
        base: 0,
        enabled: true,
        inverted: false,
        paths: path ? [{ ...item, mode: 'paint' }] : [],
        strokes: path ? [] : [{ ...item, mode: 'paint' }],
        ...(drawing.frame ? { frame: drawing.frame } : {}),
      },
      width,
      height,
    );
    const color = rgb(item.color);
    for (let pixel = 0; pixel < coverage.length; pixel++) {
      const index = pixel * 4,
        opacity = coverage[pixel]!,
        previous = result[index + 3]! / 255;
      if (item.mode === 'erase') result[index + 3] = Math.round(previous * (1 - opacity) * 255);
      else {
        const alpha = opacity + previous * (1 - opacity);
        if (alpha > 0)
          for (let channel = 0; channel < 3; channel++)
            result[index + channel] = Math.round(
              (color[channel]! * opacity + result[index + channel]! * previous * (1 - opacity)) /
                alpha,
            );
        result[index + 3] = Math.round(alpha * 255);
      }
      if (pixel % 4096 === 4095) yield;
    }
  }
  return result;
}
export async function renderPaintedMaskAsync(
  mask: PaintedMask,
  width: number,
  height: number,
  options: {
    isCancelled(): boolean;
    yieldControl(): Promise<void>;
    rasterizer?: {
      steps(mask: PaintedMask, width: number, height: number): Generator<void, Float32Array>;
    };
  },
): Promise<Float32Array | null> {
  const work =
    options.rasterizer?.steps(mask, width, height) ?? paintedMaskSteps(mask, width, height);
  let deadline = Date.now() + 8;
  while (true) {
    if (options.isCancelled()) return null;
    const step = work.next();
    if (step.done) return step.value;
    if (Date.now() >= deadline) {
      await options.yieldControl();
      deadline = Date.now() + 8;
    }
  }
}
