import type {
  PhotoAdjustmentsEffect,
  DetailEffect,
  HalationEffect,
  VignetteEffect,
} from '@gleech/project-model';
import type { ReductionBlend } from './dither';
import { createColorSampler } from './color-gradient';
import { softField, type FieldEdge } from './soft-field';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encoded = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export function photoIsNeutral(p: PhotoAdjustmentsEffect['params']): boolean {
  return [p.exposure, p.contrast, p.highlights, p.shadows, p.vibrance, p.temperature, p.tint].every(
    (v) => v === 0,
  );
}
export function* photoAdjustmentPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: PhotoAdjustmentsEffect['params'],
  blend: ReductionBlend,
): Generator<void> {
  if (photoIsNeutral(p)) {
    output.set(input);
    return;
  }
  const gains = [
    2 ** (p.exposure + p.temperature * 0.5 + p.tint * 0.2),
    2 ** (p.exposure - p.tint * 0.4),
    2 ** (p.exposure - p.temperature * 0.5 + p.tint * 0.2),
  ];
  const tables = gains.map((g) =>
    Float64Array.from({ length: 256 }, (_, i) =>
      clamp((encoded(linear(i / 255) * g) - 0.5) * 2 ** (p.contrast * 2) + 0.5),
    ),
  );
  const color = new Float64Array(4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (input[i + 3] === 0) output.set(input.subarray(i, i + 4), i);
      else {
        for (let c = 0; c < 3; c++) color[c] = tables[c]![input[i + c]!]!;
        const light = luma(color[0]!, color[1]!, color[2]!);
        const tone =
          0.5 *
          (p.shadows * (1 - smooth(light / 0.5)) + p.highlights * smooth((light - 0.5) / 0.5));
        for (let c = 0; c < 3; c++)
          color[c] = clamp(color[c]! + tone * (tone > 0 ? 1 - color[c]! : color[c]!));
        const lum = luma(color[0]!, color[1]!, color[2]!);
        const max = Math.max(color[0]!, color[1]!, color[2]!),
          min = Math.min(color[0]!, color[1]!, color[2]!);
        const saturation = max > 0 ? (max - min) / max : 0;
        let saturationGain = p.vibrance < 0 ? 1 + p.vibrance : 1 + p.vibrance * (1 - saturation);
        // Bound saturation by RGB gamut while preserving luminance.
        for (let c = 0; c < 3; c++) {
          const d = color[c]! - lum;
          if (d > 0) saturationGain = Math.min(saturationGain, (1 - lum) / d);
          else if (d < 0) saturationGain = Math.min(saturationGain, -lum / d);
        }
        for (let c = 0; c < 3; c++) color[c] = (lum + (color[c]! - lum) * saturationGain) * 255;
        color[3] = input[i + 3]!;
        blend(output, input, i, color, p.amount);
      }
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
export function* detailPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: DetailEffect['params'],
  reference: { width: number; height: number },
  blend: ReductionBlend,
  edge: FieldEdge,
): Generator<void> {
  if (p.sharpen === 0 && p.clarity === 0) {
    output.set(input);
    return;
  }
  const field = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 4) {
    const alpha = input[i + 3]! / 255;
    for (let c = 0; c < 3; c++) field[i + c] = input[i + c]! * alpha;
    field[i + 3] = alpha;
    if (i % 512 === 508) yield;
  }
  const fine =
    p.sharpen !== 0
      ? yield* softField(
          field,
          width,
          height,
          (p.radius * width) / reference.width,
          (p.radius * height) / reference.height,
          p.edgeHandling,
          edge,
        )
      : undefined;
  const radius = (Math.min(reference.width, reference.height) * p.clarityRadius) / 100;
  const broad =
    p.clarity !== 0
      ? yield* softField(
          field,
          width,
          height,
          (radius * width) / reference.width,
          (radius * height) / reference.height,
          p.edgeHandling,
          edge,
        )
      : undefined;
  const color = new Float64Array(4);
  for (let i = 0; i < input.length; i += 4) {
    if (input[i + 3] === 0) output.set(input.subarray(i, i + 4), i);
    else {
      const light = luma(input[i]!, input[i + 1]!, input[i + 2]!) / 255;
      const broadLuma =
        broad && broad[i + 3]! > 0
          ? luma(broad[i]!, broad[i + 1]!, broad[i + 2]!) / broad[i + 3]!
          : light * 255;
      const clarity = p.clarity * (light * 255 - broadLuma) * 4 * light * (1 - light);
      for (let c = 0; c < 3; c++) {
        const blurred = fine && fine[i + 3]! > 0 ? fine[i + c]! / fine[i + 3]! : input[i + c]!;
        const difference = input[i + c]! - blurred;
        // A continuous deadband avoids jumping when a difference meets threshold.
        const detail =
          Math.sign(difference) * Math.max(0, Math.abs(difference) - p.threshold * 255);
        color[c] = Math.max(0, Math.min(255, input[i + c]! + p.sharpen * detail + clarity));
      }
      color[3] = input[i + 3]!;
      blend(output, input, i, color, p.amount);
    }
    if (i % 512 === 508 || i === input.length - 4) yield;
  }
}
export function* halationPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: HalationEffect['params'],
  reference: { width: number; height: number },
  blend: ReductionBlend,
  edge: FieldEdge,
): Generator<void> {
  if (p.strength === 0) {
    output.set(input);
    return;
  }
  const field = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 4) {
    const light = luma(input[i]!, input[i + 1]!, input[i + 2]!) / 255;
    const soft = Math.max(0, Math.min(2 * p.knee, light - p.threshold + p.knee));
    const energy = Math.max(light - p.threshold, p.knee > 0 ? (soft * soft) / (4 * p.knee) : 0);
    field[i] = (energy * input[i + 3]!) / 255;
    if (i % 512 === 508) yield;
  }
  const radius = (Math.min(reference.width, reference.height) * p.radius) / 100;
  const halo = yield* softField(
    field,
    width,
    height,
    (radius * width) / reference.width,
    (radius * height) / reference.height,
    p.edgeHandling,
    edge,
  );
  const ink = createColorSampler(p, 'haloColor', p.haloColor, reference),
    color = new Float64Array(4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (input[i + 3] === 0) output.set(input.subarray(i, i + 4), i);
      else {
        const light = luma(input[i]!, input[i + 1]!, input[i + 2]!) / 255;
        const energy = clamp(halo[i]! * p.strength * (1 - p.edgeBias * smooth(light)));
        const rgb = ink((x + 0.5) / width, (y + 0.5) / height);
        for (let c = 0; c < 3; c++)
          color[c] = 255 * (1 - (1 - input[i + c]! / 255) * (1 - (rgb[c]! / 255) * energy));
        color[3] = input[i + 3]!;
        blend(output, input, i, color, p.amount);
      }
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
export function* vignettePixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: VignetteEffect['params'],
  reference: { width: number; height: number },
  blend: ReductionBlend,
): Generator<void> {
  if (p.strength === 0) {
    output.set(input);
    return;
  }
  const short = Math.min(reference.width, reference.height);
  const rx = ((reference.width * (1 - p.roundness) + short * p.roundness) * p.size) / 2;
  const ry = ((reference.height * (1 - p.roundness) + short * p.roundness) * p.size) / 2;
  const angle = (p.rotation * Math.PI) / 180,
    cs = Math.cos(angle),
    sn = Math.sin(angle);
  const ink = createColorSampler(p, 'vignetteColor', p.vignetteColor, reference),
    color = new Float64Array(4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (input[i + 3] === 0) output.set(input.subarray(i, i + 4), i);
      else {
        const dx = ((x + 0.5) / width - p.centerX / 100) * reference.width;
        const dy = ((y + 0.5) / height - p.centerY / 100) * reference.height;
        const d = Math.hypot((cs * dx + sn * dy) / rx, (-sn * dx + cs * dy) / ry);
        const fall =
          p.softness === 0 ? (d >= 1 ? 1 : 0) : smooth((d - 1 + p.softness) / p.softness);
        const weight = p.strength * (p.invert === 'on' ? 1 - fall : fall);
        const rgb = ink((x + 0.5) / width, (y + 0.5) / height);
        for (let c = 0; c < 3; c++) color[c] = input[i + c]! * (1 - weight) + rgb[c]! * weight;
        color[3] = input[i + 3]!;
        blend(output, input, i, color, p.amount);
      }
      if ((x & 127) === 127 || x === width - 1) yield;
    }
}
