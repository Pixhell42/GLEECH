import { maskPatternAffine, type Set2ShaderEffect, type EdgeHandling } from '@gleech/project-model';
import type { HeightField } from './depth-field';

type Sampler = (
  input: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edges: EdgeHandling,
) => void;
const f = Math.fround,
  tau = f(Math.PI * 2);
const add = (a: number, b: number) => f(a + b),
  mul = (a: number, b: number) => f(a * b);
const mix = (a: number, b: number, t: number) => add(mul(a, f(1 - t)), mul(b, t));
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const sin = (x: number) => f(Math.sin(x)),
  cos = (x: number) => f(Math.cos(x));
const length = (x: number, y: number) => f(Math.sqrt(add(mul(x, x), mul(y, y))));
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function hash(x: number, y: number, seed: number, lane = 0) {
  let h =
    (Math.imul(x | 0, 0x8da6b343) ^
      Math.imul(y | 0, 0xd8163841) ^
      seed ^
      Math.imul(lane, 0xcb1ab31f)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return f(((h ^ (h >>> 16)) >>> 0) / 4294967296);
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = f(x - ix),
    fy = f(y - iy);
  const tx = mul(mul(fx, fx), f(3 - mul(2, fx))),
    ty = mul(mul(fy, fy), f(3 - mul(2, fy)));
  return mix(
    mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), tx),
    mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), tx),
    ty,
  );
}
function heightAt(field: HeightField, u: number, v: number) {
  const x = f(Math.max(0, Math.min(field.width - 1, f(mul(u, field.width) - 0.5)))),
    y = f(Math.max(0, Math.min(field.height - 1, f(mul(v, field.height) - 0.5))));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    jx = Math.min(ix + 1, field.width - 1),
    jy = Math.min(iy + 1, field.height - 1);
  return mix(
    mix(field.values[iy * field.width + ix]!, field.values[iy * field.width + jx]!, f(x - ix)),
    mix(field.values[jy * field.width + ix]!, field.values[jy * field.width + jx]!, f(x - ix)),
    f(y - iy),
  );
}
export function set2ShaderInvocation(
  effect: Set2ShaderEffect,
  seedPhase: number,
  reference: { width: number; height: number },
  field?: HeightField,
) {
  const p = effect.params,
    shorter = Math.min(reference.width, reference.height),
    matrix = maskPatternAffine(effect.paintedMask);
  const programs = {
    'shader-liquid-marbling': 'marbling',
    'shader-truchet-mosaic': 'truchet',
    'shader-microculture': 'microculture',
    'shader-prismatic-panels': 'prismpanels',
  } as const;
  const values = {
    'shader-liquid-marbling': [
      p.swirl ?? 0.65,
      p.bands ?? 8,
      p.sharpness ?? 0.65,
      (p.travel ?? 9) / 100,
      p.sourceMix,
    ],
    'shader-truchet-mosaic': [
      p.arcWidth ?? 0.14,
      p.dotSize ?? 0.21,
      p.dotDensity ?? 0.4,
      p.grid ?? 0.08,
      p.sourceMix,
    ],
    'shader-microculture': [
      p.radius ?? 0.38,
      p.membrane ?? 0.1,
      p.granules ?? 0.45,
      p.clustering ?? 0.55,
      p.sourceMix,
    ],
    'shader-prismatic-panels': [
      p.widthVariation ?? 0.55,
      (p.refraction ?? 10) / 100,
      p.edgeWidth ?? 0.09,
      p.iridescence ?? 0.8,
      p.softness ?? 0.35,
    ],
  }[effect.type];
  const mode =
    p.style === 'ink' || p.style === 'dots' || p.style === 'colonies' || p.style === 'pastel'
      ? 1
      : p.style === 'mixed'
        ? 2
        : 0;
  return {
    program: programs[effect.type],
    heightField: field ?? { width: 1, height: 1, values: new Float32Array([0]) },
    uniforms: new Float32Array([
      reference.width / shorter,
      reference.height / shorter,
      p.scale,
      p.strength,
      (p.phase % 1) * Math.PI * 2,
      p.centerX / 100,
      p.centerY / 100,
      seedPhase,
      p.edgeHandling === 'wrap' ? 1 : p.edgeHandling === 'mirror' ? 2 : 0,
      p.alpha === 'opaque' ? 1 : 0,
      mode + (effect.type === 'shader-microculture' ? Number(p.lens ?? 0) * 0.49 : 0),
      effect.type === 'shader-prismatic-panels' ? p.sourceMix : (p.colorMix ?? 0.85),
      matrix[0],
      matrix[2],
      matrix[4],
      field?.width ?? 1,
      matrix[1],
      matrix[3],
      matrix[5],
      field?.height ?? 1,
      values[0]!,
      values[1]!,
      (p.rotation / 180) * Math.PI,
      values[2]!,
      ...rgb(p.patternColor),
      values[3]!,
      ...rgb(p.backgroundColor),
      values[4]!,
    ]),
  };
}

export function* set2ShaderPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: Set2ShaderEffect,
  u: Float32Array,
  sample: Sampler,
  field?: HeightField,
): Generator<void> {
  const phase = u[4]!,
    seed = Math.floor(mul(u[7]!, 100000)) >>> 0,
    c = cos(u[22]!),
    s = sin(u[22]!);
  const aa = f(Math.max(f(u[0]! / width), f(u[1]! / height)) * u[2]!);
  const sampled = new Float64Array(4),
    result = new Float32Array(3);
  const edges: EdgeHandling = u[8] === 1 ? 'wrap' : u[8] === 2 ? 'mirror' : 'extend';
  const sourceAt = (x: number, y: number, ox: number, oy: number) => {
    const a = u[12]!,
      b = u[16]!,
      cc = u[13]!,
      d = u[17]!,
      det = f(mul(a, d) - mul(b, cc));
    const dx = f(f(mul(d, ox) - mul(cc, oy)) / det),
      dy = f(f(mul(a, oy) - mul(b, ox)) / det);
    sample(input, width, height, add(x, mul(dx, width)), add(y, mul(dy, height)), sampled, edges);
  };
  const boundary = (index: number) =>
    add(index, mul(f(hash(index, 0, seed, 9) - 0.5), mul(u[20]!, 0.75)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (u[3] === 0) {
        output.set(input.subarray(i, i + 4), i);
        continue;
      }
      const nx = f((x + 0.5) / width),
        ny = f((y + 0.5) / height);
      const ux = add(add(mul(u[12]!, nx), mul(u[13]!, ny)), u[14]!),
        uy = add(add(mul(u[16]!, nx), mul(u[17]!, ny)), u[18]!);
      const px = mul(f(ux - u[5]!), u[0]!),
        py = mul(f(uy - u[6]!), u[1]!);
      let qx = mul(f(mul(c, px) - mul(s, py)), u[2]!),
        qy = mul(add(mul(s, px), mul(c, py)), u[2]!);
      if (effect.type === 'shader-liquid-marbling') {
        if (!field) throw new Error('Liquid Marbling needs its height field.');
        let wx = qx,
          wy = qy;
        for (let j = 0; j < 3; j++) {
          const n = noise(
            add(mul(wx, 0.7), mul(sin(phase), 0.2)),
            add(mul(wy, 0.7), mul(cos(phase), 0.2)),
            seed,
          );
          const turn = mul(u[20]!, f(0.55 / (j + 1)));
          wx = add(wx, mul(turn, sin(add(add(mul(wy, 2), mul(n, 6)), phase))));
          wy = add(wy, mul(turn, cos(add(f(mul(wx, 2) - mul(n, 5)), phase))));
        }
        const h = heightAt(field, ux, uy);
        const line = add(add(mul(add(wx, mul(mul(h, 4), u[11]!)), u[21]!), phase), u[7]!);
        const wave = sin(u[10]! > 0.5 ? add(line, mul(sin(wy), 2)) : line);
        const tone = clamp(add(f(mul(wave, 0.5) / Math.max(0.05, f(1 - mul(u[23]!, 0.92)))), 0.5));
        const dx = f(mul(f(wx - qx), u[27]!) / u[2]!),
          dy = f(mul(f(wy - qy), u[27]!) / u[2]!);
        sourceAt(
          x,
          y,
          f(f(mul(c, dx) + mul(s, dy)) / u[0]!),
          f(f(-mul(s, dx) + mul(c, dy)) / u[1]!),
        );
        for (let k = 0; k < 3; k++)
          result[k] = mix(mix(u[28 + k]!, u[24 + k]!, tone), f(sampled[k]! / 255), u[31]!);
      } else if (effect.type === 'shader-truchet-mosaic') {
        qx = add(qx, add(mul(sin(phase), 0.22), hash(0, 0, seed, 6)));
        qy = add(qy, add(mul(f(cos(phase) - 1), 0.22), hash(0, 0, seed, 7)));
        const ix = Math.floor(qx),
          iy = Math.floor(qy),
          fx = f(qx - ix),
          fy = f(qy - iy);
        const dots = u[10] === 1 || (u[10] === 2 && hash(ix, iy, seed, 1) < u[23]!);
        let distance: number, radius: number;
        if (dots) {
          distance = length(f(fx - 0.5), f(fy - 0.5));
          radius = mul(
            u[21]!,
            add(0.85, mul(sin(add(phase, mul(hash(ix, iy, seed, 2), tau))), 0.15)),
          );
          if (u[10] === 1 && hash(ix, iy, seed, 1) >= u[23]!) radius = -1;
        } else {
          const xx = hash(ix, iy, seed) < 0.5 ? fx : f(1 - fx);
          distance = Math.min(
            Math.abs(f(length(xx, fy) - 0.5)),
            Math.abs(f(length(f(1 - xx), f(1 - fy)) - 0.5)),
          );
          radius = mul(u[20]!, 0.5);
        }
        const coverage =
          radius <= 0 ? 0 : clamp(add(f(f(radius - distance) / Math.max(aa, 0.00001)), 0.5));
        const border = Math.min(fx, fy, f(1 - fx), f(1 - fy));
        const grid = mul(clamp(f(f(0.012 - border) / Math.max(aa, 0.00001))), u[27]!);
        for (let k = 0; k < 3; k++) {
          const ink = mix(f(input[i + k]! / 255), u[24 + k]!, u[11]!);
          const base = mix(u[28 + k]!, f(input[i + k]! / 255), u[31]!);
          result[k] = mix(mix(base, ink, coverage), ink, grid);
        }
      } else if (effect.type === 'shader-microculture') {
        const ix = Math.floor(qx),
          iy = Math.floor(qy);
        const clump = noise(
          add(mul(qx, 0.3), mul(sin(phase), 0.08)),
          add(mul(qy, 0.3), mul(cos(phase), 0.08)),
          seed,
        );
        for (let k = 0; k < 3; k++) result[k] = mix(u[28 + k]!, f(input[i + k]! / 255), u[31]!);
        for (let yy = -1; yy <= 1; yy++)
          for (let xx = -1; xx <= 1; xx++) {
            const ax = ix + xx,
              ay = iy + yy,
              spin = mul(hash(ax, ay, seed, 3), tau);
            const cx = add(
              add(ax, add(0.25, mul(hash(ax, ay, seed, 1), 0.5))),
              mul(sin(add(phase, spin)), 0.07),
            );
            const cy = add(
              add(ay, add(0.25, mul(hash(ax, ay, seed, 2), 0.5))),
              mul(cos(add(phase, spin)), 0.07),
            );
            const localX = f(qx - cx),
              localY = f(qy - cy);
            const angle = f(Math.atan2(localY, localX));
            const irregularity = add(1, mul(mul(sin(add(mul(angle, 3), spin)), u[27]!), 0.22));
            const rad = Math.min(
              1,
              mul(mul(u[20]!, mix(0.7, add(0.3, mul(clump, 1.4)), u[27]!)), irregularity),
            );
            const d = length(localX, localY);
            const body = rad <= 0 ? 0 : clamp(add(f(f(rad - d) / Math.max(aa, 0.00001)), 0.5));
            const ring =
              rad <= 0 || u[21] === 0
                ? 0
                : clamp(
                    add(f(f(mul(rad, u[21]!) - Math.abs(f(d - rad))) / Math.max(aa, 0.00001)), 0.5),
                  );
            const flecks = noise(
              add(add(mul(qx, 121.37), mul(ax, 3)), 0.37),
              add(add(mul(qy, 121.37), mul(ay, 3)), 0.37),
              seed,
            );
            const nucleusDistance = length(
              f(localX - mul(mul(rad, 0.18), cos(spin))),
              f(localY - mul(mul(rad, 0.18), sin(spin))),
            );
            const nucleus =
              rad <= 0
                ? 0
                : clamp(add(f(f(mul(rad, 0.2) - nucleusDistance) / Math.max(aa, 0.00001)), 0.5));
            const pigment = clamp(
              add(
                add(add(mul(body, u[10]! > 0.5 ? 0.65 : 0.4), mul(ring, 0.5)), mul(nucleus, 0.3)),
                mul(mul(mul(f(flecks - 0.5), u[23]!), body), 0.5),
              ),
            );
            const alternate = hash(ax, ay, seed, 5) > 0.5;
            for (let k = 0; k < 3; k++) {
              const ink = mul(
                u[24 + (alternate && u[10]! < 0.5 ? (k + 2) % 3 : k)]!,
                f(1 - mul(nucleus, 0.35)),
              );
              result[k] = mix(result[k]!, mix(f(input[i + k]! / 255), ink, u[11]!), pigment);
            }
          }
      } else {
        let cell = Math.floor(qx),
          left = boundary(cell),
          right = boundary(cell + 1);
        if (qx < left) {
          cell--;
          right = left;
          left = boundary(cell);
        } else if (qx > right) {
          cell++;
          left = right;
          right = boundary(cell + 1);
        }
        const t = clamp(f(f(qx - left) / f(right - left)));
        const eased = mix(t, f(0.5 - mul(cos(mul(t, f(Math.PI))), 0.5)), u[31]!);
        const bend = add(
          f(0.5 - eased),
          mul(sin(add(phase, mul(hash(cell, 0, seed, 3), tau))), 0.16),
        );
        const displacement = mul(bend, u[21]!);
        sourceAt(x, y, f(mul(c, displacement) / u[0]!), f(-mul(s, displacement) / u[1]!));
        const edge = clamp(f(f(u[23]! - Math.min(t, f(1 - t))) / Math.max(u[23]!, aa)));
        const hue = add(add(mul(hash(cell, 0, seed, 4), tau), phase), mul(t, 4));
        const light = add(0.78, mul(sin(mul(t, f(Math.PI))), 0.22));
        for (let k = 0; k < 3; k++) {
          const face = mul(
            mix(u[24 + k]!, u[28 + k]!, mix(hash(cell, 0, seed, 6), eased, 0.35)),
            light,
          );
          const material = mix(face, f(sampled[k]! / 255), mul(u[11]!, u[10]! > 0.5 ? 0.3 : 1));
          const spectral = add(0.5, mul(cos(add(hue, f((k * tau) / 3))), 0.5));
          result[k] = mix(material, mix(1, spectral, u[27]!), edge);
        }
      }
      if (effect.type === 'shader-microculture') {
        const lens = f(f(u[10]! - Math.floor(u[10]!)) / 0.49);
        const dx = mul(f(ux - 0.5), u[0]!),
          dy = mul(f(uy - 0.5), u[1]!);
        const edge = clamp(f((length(dx, dy) - 0.42) / 0.08));
        for (let k = 0; k < 3; k++) result[k] = mix(result[k]!, u[28 + k]!, mul(lens, edge));
      }
      for (let k = 0; k < 3; k++)
        output[i + k] = Math.round(clamp(mix(f(input[i + k]! / 255), result[k]!, u[3]!)) * 255);
      output[i + 3] = Math.round(
        mix(f(input[i + 3]! / 255), u[9]! > 0.5 ? 1 : f(input[i + 3]! / 255), u[3]!) * 255,
      );
    }
    yield;
  }
}
