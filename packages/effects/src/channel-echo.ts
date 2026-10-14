import type {
  ChannelTransformEffect,
  TemporalEchoEffect,
  EdgeHandling,
} from '@gleech/project-model';
import { createColorSampler } from './color-gradient';
import type { ReductionBlend } from './dither';
type Sample = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edges: EdgeHandling,
) => void;
const channels = ['red', 'green', 'blue'] as const;
const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function channelIsNeutral(p: ChannelTransformEffect['params']): boolean {
  return channels.every(
    (c) =>
      p[`${c}X`] === 0 &&
      p[`${c}Y`] === 0 &&
      p[`${c}Scale`] === 100 &&
      p[`${c}Rotation`] === 0 &&
      p[`${c}Mirror`] === 'off' &&
      (p.crossfeed === 0 || p[`${c}Source`] === c),
  );
}
export function echoIsNeutral(p: TemporalEchoEffect['params']): boolean {
  return (
    p.strength === 0 ||
    (p.style === 'copies' && p.spacing === 0 && p.scaleStep === 1 && p.rotationStep === 0)
  );
}

export function* channelTransformPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: ChannelTransformEffect['params'],
  reference: { width: number; height: number },
  sample: Sample,
  blend: ReductionBlend,
): Generator<void> {
  if (channelIsNeutral(p)) {
    output.set(input);
    return;
  }
  const fx = reference.width / width,
    fy = reference.height / height;
  const cx = (reference.width * p.centerX) / 100,
    cy = (reference.height * p.centerY) / 100;
  const transforms = channels.map((c, i) => {
    const angle = (p[`${c}Rotation`] * Math.PI) / 180,
      scale = p[`${c}Scale`] / 100;
    const mirror = p[`${c}Mirror`];
    return {
      x: (reference.width * p[`${c}X`]) / 100,
      y: (reference.height * p[`${c}Y`]) / 100,
      cosine: Math.cos(angle) / scale,
      sine: Math.sin(angle) / scale,
      mx: mirror === 'horizontal' || mirror === 'both' ? -1 : 1,
      my: mirror === 'vertical' || mirror === 'both' ? -1 : 1,
      source: channels.indexOf(p[`${c}Source`] as typeof c),
      identity:
        p[`${c}X`] === 0 && p[`${c}Y`] === 0 && scale === 1 && angle === 0 && mirror === 'off',
      i,
    };
  });
  const sampled = new Float64Array(4),
    color = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        alpha = input[i + 3]!;
      if (alpha === 0) {
        output.set(input.subarray(i, i + 4), i);
        continue;
      }
      const rx = (x + 0.5) * fx - cx,
        ry = (y + 0.5) * fy - cy;
      for (const t of transforms) {
        if (t.identity) for (let c = 0; c < 4; c++) sampled[c] = input[i + c]!;
        else {
          const dx = rx - t.x,
            dy = ry - t.y;
          sample(
            input,
            width,
            height,
            ((t.cosine * dx + t.sine * dy) * t.mx + cx) / fx - 0.5,
            ((-t.sine * dx + t.cosine * dy) * t.my + cy) / fy - 0.5,
            sampled,
            p.edgeHandling,
          );
        }
        const routed =
          t.source < 0
            ? 0.299 * sampled[0]! + 0.587 * sampled[1]! + 0.114 * sampled[2]!
            : sampled[t.source]!;
        // Original alpha stays fixed. Relative coverage avoids darkening uniform
        // partial transparency while excluding hidden colors from moved channels.
        color[t.i] =
          (sampled[t.i]! * (1 - p.crossfeed) + routed * p.crossfeed) *
          Math.min(1, sampled[3]! / alpha);
      }
      color[3] = alpha;
      blend(output, input, i, color, p.amount);
      if ((x & 127) === 127) yield;
    }
    yield;
  }
}

export function* temporalEchoPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  p: TemporalEchoEffect['params'],
  reference: { width: number; height: number },
  sample: Sample,
  blend: ReductionBlend,
  random: (x: number, y: number, lane: number) => number,
): Generator<void> {
  if (echoIsNeutral(p)) {
    output.set(input);
    return;
  }
  const fx = reference.width / width,
    fy = reference.height / height;
  const spacing = (Math.min(reference.width, reference.height) * p.spacing) / 100;
  const direction = (p.direction * Math.PI) / 180;
  const cx = (reference.width * p.centerX) / 100,
    cy = (reference.height * p.centerY) / 100;
  const start = channels.indexOf(p.channelStart);
  const transforms = Array.from({ length: p.copies }, (_, i) => {
    const k = i + 1,
      angle = (p.rotationStep * k * Math.PI) / 180,
      scale = p.scaleStep ** k;
    return {
      x: spacing * (k * Math.cos(direction) + p.jitter * (random(k, 0, 0) * 2 - 1)),
      y: spacing * (k * Math.sin(direction) + p.jitter * (random(k, 0, 1) * 2 - 1)),
      cosine: Math.cos(angle) / scale,
      sine: Math.sin(angle) / scale,
      weight: p.strength * p.falloff ** i,
      channel: (start + i) % 3,
    };
  }).reverse();
  const sampled = new Float64Array(4),
    color = new Float64Array(4);
  const echoColor =
    p.style === 'silhouette'
      ? createColorSampler(p, 'echoColor', p.echoColor, reference)
      : undefined;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let alpha = input[i + 3]! / 255;
      for (let c = 0; c < 3; c++) color[c] = input[i + c]! * alpha;
      const ink = echoColor?.((x + 0.5) / width, (y + 0.5) / height);
      const rx = (x + 0.5) * fx - cx,
        ry = (y + 0.5) * fy - cy;
      for (const t of transforms) {
        if (t.weight === 0) continue;
        const dx = rx - t.x,
          dy = ry - t.y;
        const sx = (t.cosine * dx + t.sine * dy + cx) / fx - 0.5;
        const sy = (-t.sine * dx + t.cosine * dy + cy) / fy - 0.5;
        // Bilinear transparent-border coverage avoids repeating edge pixels when
        // clipping. Edge Handling is available deliberately when clipping is off.
        const coverage =
          p.clipCopies === 'on'
            ? clamp(sx + 1) * clamp(width - sx) * clamp(sy + 1) * clamp(height - sy)
            : 1;
        if (coverage === 0) continue;
        sample(
          input,
          width,
          height,
          sx,
          sy,
          sampled,
          p.clipCopies === 'on' ? 'extend' : p.edgeHandling,
        );
        const a = (sampled[3]! / 255) * t.weight * coverage;
        if (a === 0) continue;
        for (let c = 0; c < 3; c++) {
          const rgb = ink
            ? ink[c]!
            : p.style === 'color-separated' && c !== t.channel
              ? 0
              : sampled[c]!;
          color[c] = rgb * a + color[c]! * (1 - a);
        }
        alpha = a + alpha * (1 - a);
      }
      for (let c = 0; c < 3; c++) color[c] = alpha > 0 ? color[c]! / alpha : input[i + c]!;
      color[3] = alpha * 255;
      blend(output, input, i, color, p.amount);
      if ((x & 127) === 127) yield;
    }
    yield;
  }
}
