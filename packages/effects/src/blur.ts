import type { BlurEffect, EdgeHandling, FieldPointKey, SubjectMask } from '@gleech/project-model';
type Edge = (value: number, size: number, mode: EdgeHandling) => number;
type Sample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  result: Float64Array,
  mode: EdgeHandling,
) => void;
type Random = (x: number, y: number, lane: number) => number;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};

// Separable Gaussian quadrature uses at most 129 taps per axis; very large
// radii keep their footprint instead of being silently clipped to a smaller blur.
export function* separableBlur(
  input: Float32Array,
  width: number,
  height: number,
  rx: number,
  ry: number,
  mode: EdgeHandling,
  edge: Edge,
  box = false,
): Generator<void, Float32Array> {
  if (!box && (rx > 64 || ry > 64)) {
    // Average the gaps between quadrature taps before a large Gaussian pass.
    // This avoids striped/phase-dependent output on high-frequency textures.
    input = yield* separableBlur(
      input,
      width,
      height,
      rx > 64 ? Math.ceil(rx / 128) : 0,
      ry > 64 ? Math.ceil(ry / 128) : 0,
      mode,
      edge,
      true,
    );
  }
  let source = input;
  const scratch = new Float32Array(input.length);
  for (let axis = 0; axis < 2; axis++) {
    const radius = axis === 0 ? rx : ry;
    if (radius <= 0) continue;
    const destination = source === input ? scratch : input;
    const length = axis === 0 ? width : height,
      lines = axis === 0 ? height : width;
    const r = Math.max(1, Math.round(radius));
    const index = (line: number, t: number, c: number) =>
      (axis === 0 ? line * width + edge(t, width, mode) : edge(t, height, mode) * width + line) *
        4 +
      c;
    const taps = Math.min(64, r),
      step = r / taps;
    const weights = Array.from({ length: taps * 2 + 1 }, (_, i) =>
      Math.exp(-0.5 * (((i - taps) * step) / Math.max(0.333, radius / 3)) ** 2),
    );
    const norm = weights.reduce((a, b) => a + b, 0);
    const tapCount = taps * 2 + 1;
    // Reuse pixel addresses across scanlines, with a bounded lookup allocation.
    const addresses =
      !box && length * tapCount <= 1_000_000 ? new Int32Array(length * tapCount) : undefined;
    const upperAddresses = addresses && step !== 1 ? new Int32Array(addresses.length) : undefined;
    const fractions = upperAddresses ? new Float64Array(upperAddresses.length) : undefined;
    if (addresses) {
      for (let t = 0; t < length; t++) {
        for (let k = -taps; k <= taps; k++) {
          const position = t + k * step,
            lo = Math.floor(position),
            at = t * tapCount + k + taps;
          addresses[at] = edge(lo, length, mode) * (axis === 0 ? 4 : width * 4);
          if (upperAddresses && fractions) {
            upperAddresses[at] = edge(lo + 1, length, mode) * (axis === 0 ? 4 : width * 4);
            fractions[at] = position - lo;
          }
        }
        if (t % 64 === 63) yield;
      }
    }
    for (let line = 0; line < lines; line++) {
      const sums = new Float64Array(4);
      if (box)
        for (let k = -r; k <= r; k++)
          for (let c = 0; c < 4; c++) sums[c] = sums[c]! + source[index(line, k, c)]!;
      for (let t = 0; t < length; t++) {
        const out = (axis === 0 ? line * width + t : t * width + line) * 4;
        if (box) {
          for (let c = 0; c < 4; c++) {
            destination[out + c] = sums[c]! / (r * 2 + 1);
            sums[c] =
              sums[c]! + source[index(line, t + r + 1, c)]! - source[index(line, t - r, c)]!;
          }
        } else {
          let red = 0,
            green = 0,
            blue = 0,
            alpha = 0;
          // Resolve each tap once for all four channels. The previous channel-first
          // loop repeated interpolation and edge mapping four times per sample.
          if (addresses) {
            const base = axis === 0 ? line * width * 4 : line * 4;
            if (upperAddresses && fractions)
              for (let k = 0; k < tapCount; k++) {
                const tap = t * tapCount + k,
                  a = base + addresses[tap]!,
                  b = base + upperAddresses[tap]!;
                const f = fractions[tap]!,
                  weight = weights[k]!;
                red += (source[a]! * (1 - f) + source[b]! * f) * weight;
                green += (source[a + 1]! * (1 - f) + source[b + 1]! * f) * weight;
                blue += (source[a + 2]! * (1 - f) + source[b + 2]! * f) * weight;
                alpha += (source[a + 3]! * (1 - f) + source[b + 3]! * f) * weight;
              }
            else
              for (let k = 0; k < tapCount; k++) {
                const at = base + addresses[t * tapCount + k]!,
                  weight = weights[k]!;
                red += source[at]! * weight;
                green += source[at + 1]! * weight;
                blue += source[at + 2]! * weight;
                alpha += source[at + 3]! * weight;
              }
          } else
            for (let k = -taps; k <= taps; k++) {
              const position = t + k * step,
                lo = Math.floor(position),
                f = position - lo;
              const a = index(line, lo, 0),
                b = index(line, lo + 1, 0),
                weight = weights[k + taps]!;
              red += (source[a]! * (1 - f) + source[b]! * f) * weight;
              green += (source[a + 1]! * (1 - f) + source[b + 1]! * f) * weight;
              blue += (source[a + 2]! * (1 - f) + source[b + 2]! * f) * weight;
              alpha += (source[a + 3]! * (1 - f) + source[b + 3]! * f) * weight;
            }
          destination[out] = red / norm;
          destination[out + 1] = green / norm;
          destination[out + 2] = blue / norm;
          destination[out + 3] = alpha / norm;
        }
        if (t % 64 === 63) yield;
      }
      yield;
    }
    source = destination;
  }
  return source;
}
export function fieldRadius(params: BlurEffect['params'], u: number, v: number): number {
  let sum = 0,
    weights = 0;
  for (let i = 0; i < params.pointCount; i++) {
    const px = params[`point${i}X` as FieldPointKey] / 100,
      py = params[`point${i}Y` as FieldPointKey] / 100;
    const d = (px - u) ** 2 + (py - v) ** 2;
    const radius = params[`point${i}Radius` as FieldPointKey];
    if (d < 1e-12) return radius;
    const w = 1 / d;
    sum += radius * w;
    weights += w;
  }
  return sum / weights;
}
export function* blurPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  params: BlurEffect['params'],
  reference: { width: number; height: number },
  edge: Edge,
  sample: Sample,
  random: Random,
  subject?: SubjectMask,
  heightAt?: (u: number, v: number) => number,
): Generator<void, Float32Array> {
  const result = new Float32Array(pixels.length);
  const neutral =
    params.style === 'field'
      ? Array.from(
          { length: params.pointCount },
          (_, i) => params[`point${i}Radius` as FieldPointKey],
        ).every((radius) => radius === 0)
      : ['spin', 'zoom', 'radial'].includes(params.style)
        ? params.travel === 0
        : params.radius === 0;
  if (neutral) {
    for (let i = 0; i < pixels.length; i++) {
      result[i] = pixels[i]!;
      if (i % 512 === 511) yield;
    }
    return result;
  }
  const shorter = Math.min(reference.width, reference.height),
    sx = width / reference.width,
    sy = height / reference.height;
  if (params.style === 'gaussian' || params.style === 'box') {
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3]! / 255;
      for (let c = 0; c < 3; c++) result[i + c] = pixels[i + c]! * a;
      result[i + 3] = a;
      if (i % 512 === 508) yield;
    }
    const blurred = yield* separableBlur(
      result,
      width,
      height,
      ((shorter * params.radius) / 100) * sx * (params.style === 'box' ? params.aspect : 1),
      ((shorter * params.radius) / 100) * sy,
      params.edgeHandling,
      edge,
      params.style === 'box',
    );
    for (let i = 0; i < blurred.length; i += 4) {
      const a = blurred[i + 3]!;
      for (let c = 0; c < 3; c++) blurred[i + c] = a > 1e-9 ? blurred[i + c]! / a : pixels[i + c]!;
      blurred[i + 3] = a * 255;
      if (i % 512 === 508) yield;
    }
    return blurred;
  }
  const mask = params.style === 'background' ? subject : undefined;
  if (
    params.style === 'background' &&
    (!mask || mask.values.byteLength !== mask.width * mask.height)
  )
    throw new Error('Subject detection is not available for Background Blur.');
  const values = mask ? new Uint8Array(mask.values) : undefined;
  const rawMask = (x: number, y: number) => {
    if (!mask || !values) return 0;
    const mx = Math.min(
      mask.width - 1,
      Math.floor(((edge(x, width, params.edgeHandling) + 0.5) * mask.width) / width),
    );
    const my = Math.min(
      mask.height - 1,
      Math.floor(((edge(y, height, params.edgeHandling) + 0.5) * mask.height) / height),
    );
    return smooth((values[my * mask.width + mx]! / 255 - (0.5 - params.refinement)) / 0.1 + 0.5);
  };
  let softMask: Float32Array | undefined;
  if (mask) {
    softMask = new Float32Array(pixels.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) softMask[(y * width + x) * 4] = rawMask(x, y);
      yield;
    }
    softMask = yield* separableBlur(
      softMask,
      width,
      height,
      ((shorter * params.maskSoftness) / 100) * sx,
      ((shorter * params.maskSoftness) / 100) * sy,
      'extend',
      edge,
    );
  }
  const color = new Float64Array(4);
  // Foreground exclusion happens on each bilinear neighbor, before interpolation.
  // Masking only the final color would allow protected colors to leak at edges.
  const backgroundSample = (x: number, y: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    color.fill(0);
    let mass = 0;
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const px = edge(ix + dx, width, params.edgeHandling),
          py = edge(iy + dy, height, params.edgeHandling);
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (1 - rawMask(px, py));
        const i = (py * width + px) * 4,
          a = pixels[i + 3]! / 255;
        for (let c = 0; c < 3; c++) color[c] = color[c]! + pixels[i + c]! * a * w;
        color[3] = color[3]! + a * w;
        mass += w;
      }
    const alpha = color[3]!;
    for (let c = 0; c < 3; c++) color[c] = alpha > 1e-9 ? color[c]! / alpha : 0;
    color[3] = mass > 1e-9 ? (alpha / mass) * 255 : 0;
    return mass;
  };
  const footprintStyle = params.style === 'lens' || params.style === 'shape';
  const footprintRotates =
    params.style === 'lens' ||
    (params.style === 'shape' && !['circle', 'ring'].includes(params.shape));
  const aspect = footprintStyle ? params.aspect : 1;
  const rotation = footprintRotates ? (params.apertureRotation * Math.PI) / 180 : 0,
    cos = Math.cos(rotation),
    sin = Math.sin(rotation);
  const angle = (params.angle * Math.PI) / 180,
    ax = Math.cos(angle),
    ay = Math.sin(angle);
  const cx = (params.centerX / 100) * reference.width,
    cy = (params.centerY / 100) * reference.height;
  const count = params.style === 'grainy' ? params.density : 48;
  const radial = ['spin', 'zoom', 'radial'].includes(params.style);
  const edgeAware = params.style === 'surface' || params.style === 'smart';
  const sums = new Float64Array(4);
  // Aperture geometry and radial transforms depend on the controls, not the pixel.
  // Preserve the original arithmetic order so existing projects render identically.
  const footprintX = new Float64Array(count),
    footprintY = new Float64Array(count),
    radialCos = new Float64Array(count),
    radialSin = new Float64Array(count),
    radialScale = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0 : k / (count - 1) - 0.5;
    if (radial) {
      const spin =
        params.style === 'zoom' ? 0 : params.style === 'radial' ? 1 - params.radialBalance : 1;
      const zoom =
        params.style === 'spin' ? 0 : params.style === 'radial' ? params.radialBalance : 1;
      const theta = ((t * params.travel) / 100) * Math.PI * 2 * spin;
      radialCos[k] = Math.cos(theta);
      radialSin[k] = Math.sin(theta);
      radialScale[k] = 1 + ((t * params.travel) / 100) * zoom;
    } else if (params.style === 'motion') {
      footprintX[k] = ((t * params.radius) / 100) * shorter * ax;
      footprintY[k] = ((t * params.radius) / 100) * shorter * ay;
    } else if (params.style !== 'grainy') {
      const fraction = (k + 0.5) / count;
      const theta = k * 0.6180339887498949 * Math.PI * 2;
      let r = Math.sqrt(fraction);
      const footprint = params.style === 'lens' ? 'polygon' : params.shape;
      if (!footprintStyle) r = Math.sqrt(-2 * Math.log(1 - fraction * (1 - Math.exp(-4.5)))) / 3;
      else if (footprint === 'ring') r = 0.85 + r * 0.15;
      else if (footprint !== 'circle') {
        const sides = footprint === 'triangle' ? 3 : footprint === 'square' ? 4 : params.sides;
        const sector = (Math.PI * 2) / sides;
        const local = ((theta + Math.PI / sides) % sector) - Math.PI / sides;
        r *= Math.cos(Math.PI / sides) / Math.cos(local);
      }
      footprintX[k] = Math.cos(theta) * r;
      footprintY[k] = Math.sin(theta) * r;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        u = (x + 0.5) / width,
        v = (y + 0.5) / height;
      const refX = u * reference.width,
        refY = v * reference.height;
      let radius = params.style === 'field' ? fieldRadius(params, u, v) : params.radius;
      let focus = softMask ? 1 - softMask[i]! : 1;
      if (params.style === 'depth') {
        if (!heightAt) throw new Error('Depth blur needs a height field.');
        const distance =
          Math.abs(heightAt(u, v) - (params.focusPosition ?? 0.5)) - (params.focusRange ?? 0.2) / 2;
        const falloff = params.focusFalloff ?? 0.3;
        radius *= falloff === 0 ? (distance > 0 ? 1 : 0) : smooth(distance / falloff);
        radius *=
          heightAt(u, v) >= (params.focusPosition ?? 0.5)
            ? (params.nearBlur ?? 1)
            : (params.farBlur ?? 1);
      }
      if (params.style === 'tilt-shift') {
        const normal =
          -Math.sin(angle) * (refX - reference.width / 2) +
          Math.cos(angle) * (refY - reference.height / 2) -
          (params.position / 100 - 0.5) * shorter;
        const distance = Math.abs(normal) - (params.width / 200) * shorter;
        focus =
          params.falloff === 0
            ? distance > 0
              ? 1
              : 0
            : smooth(distance / ((params.falloff / 100) * shorter));
      }
      if (params.style === 'motion' || radial) {
        if (params.style !== 'motion') radius = Math.abs(params.travel);
      }
      if (radius === 0 || focus === 0) {
        for (let c = 0; c < 4; c++) result[i + c] = pixels[i + c]!;
        continue;
      }
      sums.fill(0);
      let weights = 0;
      for (let k = 0; k < count; k++) {
        let dx: number,
          dy: number,
          weight = 1;
        if (params.style === 'motion') {
          dx = footprintX[k]!;
          dy = footprintY[k]!;
        } else if (radial) {
          const px = refX - cx,
            py = refY - cy;
          dx = cx + (px * radialCos[k]! - py * radialSin[k]!) * radialScale[k]! - refX;
          dy = cy + (px * radialSin[k]! + py * radialCos[k]!) * radialScale[k]! - refY;
        } else {
          const jitter = params.style === 'grainy';
          let unitX = footprintX[k]!,
            unitY = footprintY[k]!;
          if (jitter) {
            const theta = random(Math.floor(refX), Math.floor(refY), k * 2) * Math.PI * 2;
            const fraction = (k + 0.5) / count;
            const r = Math.sqrt(-2 * Math.log(1 - fraction * (1 - Math.exp(-4.5)))) / 3;
            unitX = Math.cos(theta) * r;
            unitY = Math.sin(theta) * r;
          }
          const px = ((unitX * radius) / 100) * shorter * aspect,
            py = ((unitY * radius) / 100) * shorter;
          dx = px * cos - py * sin;
          dy = px * sin + py * cos;
        }
        if (params.style === 'background') weight = backgroundSample(x + dx * sx, y + dy * sy);
        else sample(pixels, width, height, x + dx * sx, y + dy * sy, color, params.edgeHandling);
        const difference =
          edgeAware && pixels[i + 3]! > 0 && color[3]! > 0
            ? Math.sqrt(
                ((color[0]! - pixels[i]!) ** 2 +
                  (color[1]! - pixels[i + 1]!) ** 2 +
                  (color[2]! - pixels[i + 2]!) ** 2) /
                  3,
              ) / 255
            : 0;
        if (params.style === 'surface') weight *= difference <= params.threshold ? 1 : 0;
        if (params.style === 'smart')
          weight *= Math.exp(-0.5 * (difference / params.sensitivity) ** 2);
        if (params.style === 'lens' && color[3]! > 0)
          weight *= 1 + params.highlights * (Math.max(color[0]!, color[1]!, color[2]!) / 255) ** 4;
        const alpha = color[3]! / 255;
        for (let c = 0; c < 3; c++) sums[c] = sums[c]! + color[c]! * alpha * weight;
        sums[3] = sums[3]! + alpha * weight;
        weights += weight;
      }
      // Including the center sample avoids empty threshold neighborhoods.
      const originalAlpha = pixels[i + 3]! / 255;
      if (weights < 1e-9 || params.style === 'surface' || params.style === 'smart') {
        for (let c = 0; c < 3; c++) sums[c] = sums[c]! + pixels[i + c]! * originalAlpha;
        sums[3] = sums[3]! + originalAlpha;
        weights += 1;
      }
      if (params.style === 'smart') focus *= 1 - params.preservation;
      const a = sums[3]! / weights;
      const blendedAlpha = originalAlpha * (1 - focus) + a * focus;
      for (let c = 0; c < 3; c++) {
        const blurred = sums[3]! > 1e-9 ? sums[c]! / sums[3]! : pixels[i + c]!;
        result[i + c] =
          blendedAlpha > 1e-9
            ? (pixels[i + c]! * originalAlpha * (1 - focus) + blurred * a * focus) / blendedAlpha
            : pixels[i + c]!;
      }
      result[i + 3] = blendedAlpha * 255;
      if (x % 32 === 31) yield;
    }
    yield;
  }
  return result;
}
