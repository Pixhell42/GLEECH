import {
  ADVANCED_SHADER_SPECS,
  ADVANCED_EXTENSION_SPECS,
  ADVANCED_SHADER_TYPES,
  maskPatternAffine,
  type BuiltinShaderEffect,
  type EdgeHandling,
} from '@gleech/project-model';
import type { DirectionSampler } from './direction-field';
import type { HeightField } from './depth-field';
import { ADVANCED_CPU_MATERIALS, type AdvancedEnvironment } from './set2-advanced-cpu';
const f = Math.fround;
const mix = (a: number, b: number, t: number) => f(f(a * f(1 - t)) + f(b * t));
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const programs = [
  'contourmelt',
  'filamentflow',
  'signalorb',
  'hatchedsolids',
  'mandelbrotslices',
  'arcnetwork',
  'beadweave',
  'facetmandala',
  'particleweb',
  'liquidfoil',
  'signalslabs',
  'spectrumprojector',
] as const;
export function usesAdvancedMaterial(effect: BuiltinShaderEffect) {
  const p = effect.params as Readonly<Record<string, number | string>>;
  return (
    (effect.type === 'shader-signal-collapse' &&
      p.treatment !== undefined &&
      p.treatment !== 'folded') ||
    (effect.type === 'shader-diffraction' && p.treatment === 'projector')
  );
}
type Sampler = (
  input: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  into: Float64Array,
  edges: EdgeHandling,
) => void;
function hash(x: number, y: number, seed: number, lane: number) {
  let h =
    Math.imul(Math.floor(x), 0x8da6b343) ^
    Math.imul(Math.floor(y), 0xd8163841) ^
    seed ^
    Math.imul(Math.floor(lane), 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return f(((h ^ (h >>> 16)) >>> 0) / 4294967296);
}
/** Complex-plane offset of the selected flat/first stacked slice. */
export function mandelbrotSliceOffset(invocation: {
  uniforms: Float32Array;
  extra?: Float32Array;
}) {
  const seed = Math.floor(f(invocation.uniforms[7]! * 100000)) >>> 0;
  const index = invocation.extra?.[16] ?? 0;
  const variation = invocation.extra?.[6] ?? 0.3;
  const offset = (lane: number) =>
    f(f(f(hash(index, 0, seed, lane) - hash(0, 0, seed, lane)) * variation) * f(0.1));
  return { real: offset(1), imaginary: offset(2) };
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = f(x - ix),
    fy = f(y - iy),
    tx = f(f(fx * fx) * f(3 - f(2 * fx))),
    ty = f(f(fy * fy) * f(3 - f(2 * fy)));
  return mix(
    mix(hash(ix, iy, seed, 0), hash(ix + 1, iy, seed, 0), tx),
    mix(hash(ix, iy + 1, seed, 0), hash(ix + 1, iy + 1, seed, 0), tx),
    ty,
  );
}
// Q20 iteration prevents floating-point contraction from changing fractal
// escape paths between CPU and GPU. Interpolating the common Q13 coordinate
// grid avoids abrupt boundary changes from subpixel camera-rounding differences.
function mandelOrbit(cx: number, cy: number, limit: number) {
  let zx = 0,
    zy = 0,
    count = limit;
  for (let j = 0; j < limit; j++) {
    const next = Math.floor((zx * zx) / 1048576) - Math.floor((zy * zy) / 1048576) + cx;
    zy = 2 * Math.floor((zx * zy) / 1048576) + cy;
    zx = next;
    const ax = f(zx / 1048576),
      ay = f(zy / 1048576),
      norm = f(f(ax * ax) + f(ay * ay));
    if (norm > 64) {
      count = f(f(j + 1) - f(f(Math.log(Math.max(1, f(Math.log(norm))))) / f(0.693147)));
      break;
    }
  }
  return f(Math.max(0, Math.min(1, f(count / limit))));
}
function mandel(x: number, y: number, limit: number) {
  const px = f(x * 8192),
    py = f(y * 8192),
    ix = Math.floor(px),
    iy = Math.floor(py),
    tx = f(px - ix),
    ty = f(py - iy);
  return mix(
    mix(mandelOrbit(ix * 128, iy * 128, limit), mandelOrbit((ix + 1) * 128, iy * 128, limit), tx),
    mix(
      mandelOrbit(ix * 128, (iy + 1) * 128, limit),
      mandelOrbit((ix + 1) * 128, (iy + 1) * 128, limit),
      tx,
    ),
    ty,
  );
}
function grid(
  data: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
  offset = 0,
  channels = 1,
  ch = 0,
) {
  const x = f(Math.max(0, Math.min(width - 1, f(f(u * width) - 0.5)))),
    y = f(Math.max(0, Math.min(height - 1, f(f(v * height) - 0.5))));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    jx = Math.min(ix + 1, width - 1),
    jy = Math.min(iy + 1, height - 1);
  const at = (xx: number, yy: number) => data[offset + (yy * width + xx) * channels + ch]!;
  return mix(
    mix(at(ix, iy), at(jx, iy), f(x - ix)),
    mix(at(ix, jy), at(jx, jy), f(x - ix)),
    f(y - iy),
  );
}
export function advancedShaderInvocation(
  effect: BuiltinShaderEffect,
  seedPhase: number,
  reference: { width: number; height: number },
  field?: HeightField,
  direction?: DirectionSampler,
) {
  const p = effect.params as Readonly<Record<string, number | string>>,
    spec = (ADVANCED_SHADER_SPECS[effect.type] ?? ADVANCED_EXTENSION_SPECS[effect.type])!,
    short = Math.min(reference.width, reference.height),
    m = maskPatternAffine(effect.paintedMask);
  const width = direction
    ? Math.max(1, Math.round((128 * reference.width) / Math.max(reference.width, reference.height)))
    : 1;
  const height = direction
    ? Math.max(
        1,
        Math.round((128 * reference.height) / Math.max(reference.width, reference.height)),
      )
    : 1;
  const extra = new Float32Array(66 + width * height * 2);
  Object.entries(spec.controls).forEach(([key, control], i) => {
    const value = p[key] ?? control.default;
    extra[i] =
      control.kind === 'choice'
        ? control.options.findIndex((o) => o.value === value)
        : Number(value);
  });
  extra[64] = width;
  extra[65] = height;
  const rotation = f((Number(p.rotation) * Math.PI) / 180);
  extra[52] = f(Math.cos(rotation));
  extra[53] = f(Math.sin(rotation));
  const vector = new Float64Array(2);
  if (direction)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        direction((x + 0.5) / width, (y + 0.5) / height, vector);
        extra[66 + (y * width + x) * 2] = vector[0]!;
        extra[67 + (y * width + x) * 2] = vector[1]!;
      }
  const kind =
    effect.type === 'shader-signal-collapse'
      ? 10
      : effect.type === 'shader-diffraction'
        ? 11
        : ADVANCED_SHADER_TYPES.indexOf(effect.type as (typeof ADVANCED_SHADER_TYPES)[number]);
  if (kind === 4) {
    // Resolve seeded complex-plane centers once on the host. Both backends
    // receive the same f32 centers, avoiding per-pixel hash work and reassociated
    // offset additions at sensitive escape boundaries.
    const seed = Math.floor(f(f(seedPhase) * 100000)) >>> 0;
    const originX = hash(0, 0, seed, 1),
      originY = hash(0, 0, seed, 2);
    const yaw = f(extra[11]! * f(0.0174533));
    const pitch = f(extra[12]! * f(0.0174533));
    extra[54] = f(Math.cos(yaw));
    extra[55] = f(Math.sin(yaw));
    extra[56] = f(Math.cos(pitch));
    extra[57] = f(Math.sin(pitch));
    for (let slice = 0; slice < 16; slice++) {
      const index = slice + extra[16]!;
      extra[20 + slice * 2] = f(
        extra[8]! + f(f(hash(index, 0, seed, 1) - originX) * extra[6]!) * f(0.1),
      );
      extra[21 + slice * 2] = f(
        extra[9]! + f(f(hash(index, 0, seed, 2) - originY) * extra[6]!) * f(0.1),
      );
    }
  }
  return {
    program: programs[kind]!,
    extra,
    heightField: field ?? { width: 1, height: 1, values: new Float32Array([0]) },
    uniforms: new Float32Array([
      reference.width / short,
      reference.height / short,
      Number(p.scale),
      Number(p.strength),
      (Number(p.phase) % 1) * Math.PI * 2,
      Number(p.centerX) / 100,
      Number(p.centerY) / 100,
      seedPhase,
      p.edgeHandling === 'wrap' ? 1 : p.edgeHandling === 'mirror' ? 2 : 0,
      p.alpha === 'opaque' ? 1 : 0,
      Number(p.threshold ?? 0),
      Number(p.colorMix),
      m[0],
      m[2],
      m[4],
      field?.width ?? 1,
      m[1],
      m[3],
      m[5],
      field?.height ?? 1,
      Number(p.structure ?? 0),
      Number(p.accent ?? 0),
      (Number(p.rotation) * Math.PI) / 180,
      direction ? 1 : 0,
      ...rgb(String(p.patternColor)),
      0,
      ...rgb(String(p.backgroundColor)),
      Number(p.directionInfluence ?? 1),
    ]),
  };
}
export function* advancedShaderPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: BuiltinShaderEffect,
  invocation: ReturnType<typeof advancedShaderInvocation>,
  sample: Sampler,
): Generator<void> {
  void effect;
  const u = invocation.uniforms,
    extra = invocation.extra,
    field = invocation.heightField,
    seed = Math.floor(f(u[7]! * 100000)) >>> 0;
  if (u[3] === 0) {
    output.set(input);
    return;
  }
  const color = new Float64Array(4),
    out = new Float32Array(3),
    kind = programs.indexOf(invocation.program);
  const shade = ADVANCED_CPU_MATERIALS[kind]!;
  const a = u[12]!,
    b = u[16]!,
    c = u[13]!,
    d = u[17]!,
    det = f(f(a * d) - f(b * c));
  const edges: EdgeHandling = u[8] === 1 ? 'wrap' : u[8] === 2 ? 'mirror' : 'extend';
  let index = 0,
    currentU = 0,
    currentV = 0;
  let sampledX = NaN,
    sampledY = NaN;
  const env: AdvancedEnvironment = {
    P: (i) => extra[i]!,
    U: (i) => u[i]!,
    AA: () => f(Math.max(f(u[0]! / width), f(u[1]! / height))),
    I: (ch) => f(input[index + ch]! / 255),
    O: (ch, value) => {
      out[ch] = value;
    },
    H: (x, y) => grid(field.values, field.width, field.height, x, y),
    D: (x, y, ch) => grid(extra, extra[64]!, extra[65]!, x, y, 66, 2, ch),
    R: (x, y, lane) => hash(x, y, seed, lane),
    N: (x, y) => noise(x, y, seed),
    M: mandel,
    T: (x, y, ch) => {
      if (x === currentU && y === currentV) return f(input[index + ch]! / 255);
      const ox = f(x - u[14]!),
        oy = f(y - u[18]!);
      const cx = f(f(f(d * ox) - f(c * oy)) / det),
        cy = f(f(f(a * oy) - f(b * ox)) / det);
      if (x !== sampledX || y !== sampledY) {
        sample(input, width, height, f(f(cx * width) - 0.5), f(f(cy * height) - 0.5), color, edges);
        sampledX = x;
        sampledY = y;
      }
      return f(color[ch]! / 255);
    },
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      index = (y * width + x) * 4;
      const cx = f(f(x + 0.5) / width),
        cy = f(f(y + 0.5) / height);
      const ux = f(f(f(a * cx) + f(c * cy)) + u[14]!),
        uy = f(f(f(b * cx) + f(d * cy)) + u[18]!);
      currentU = ux;
      currentV = uy;
      shade(env, ux, uy, x, y);
      for (let ch = 0; ch < 3; ch++)
        output[index + ch] = Math.round(
          Math.max(0, Math.min(1, mix(f(input[index + ch]! / 255), out[ch]!, u[3]!))) * 255,
        );
      output[index + 3] = Math.round(
        mix(f(input[index + 3]! / 255), u[9]! > 0.5 ? 1 : f(input[index + 3]! / 255), u[3]!) * 255,
      );
    }
    yield;
  }
}
