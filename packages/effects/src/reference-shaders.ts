import type {
  ReferenceShaderEffect,
  SpectralTerrainEffect,
  EdgeHandling,
} from '@gleech/project-model';
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
const f = Math.fround;
const add = (a: number, b: number) => f(a + b),
  mul = (a: number, b: number) => f(a * b);
const mix = (a: number, b: number, t: number) => add(mul(a, f(1 - t)), mul(b, t));
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const sin = (v: number) => f(Math.sin(v)),
  cos = (v: number) => f(Math.cos(v));
// Shared f32 field interpolation matches the storage-buffer shader path.
function fieldHeight(field: HeightField, u: number, v: number) {
  const x = f(Math.max(0, Math.min(field.width - 1, f(mul(u, field.width) - 0.5)))),
    y = f(Math.max(0, Math.min(field.height - 1, f(mul(v, field.height) - 0.5))));
  const ix = Math.floor(x),
    iy = Math.floor(y),
    jx = Math.min(field.width - 1, ix + 1),
    jy = Math.min(field.height - 1, iy + 1);
  return mix(
    mix(field.values[iy * field.width + ix]!, field.values[iy * field.width + jx]!, f(x - ix)),
    mix(field.values[jy * field.width + ix]!, field.values[jy * field.width + jx]!, f(x - ix)),
    f(y - iy),
  );
}
function* terrainPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  u: Float32Array,
  field: HeightField,
): Generator<void> {
  const cc = cos(u[22]!),
    ss = sin(u[22]!),
    tau = mul(f(Math.PI), 2),
    seed = Math.floor(mul(u[7]!, 100000)) >>> 0;
  const value = (x: number, y: number) => {
    const px = mul(f(x - u[5]!), u[0]!),
      py = mul(f(y - u[6]!), u[1]!);
    const ax = f(mul(add(mul(cc, px), -mul(ss, py)), f(u[2]! / 4)) / u[0]!);
    const ay = f(mul(add(mul(ss, px), mul(cc, py)), f(u[2]! / 4)) / u[1]!);
    return fieldHeight(
      field,
      add(add(u[5]!, ax), mul(sin(u[4]!), 0.06)),
      add(add(u[6]!, ay), mul(f(cos(u[4]!) - 1), 0.06)),
    );
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (u[3] === 0) {
        output.set(input.subarray(i, i + 4), i);
        continue;
      }
      const ux = f((x + 0.5) / width),
        uy = f((y + 0.5) / height);
      const vx = add(add(mul(u[12]!, ux), mul(u[13]!, uy)), u[14]!),
        vy = add(add(mul(u[16]!, ux), mul(u[17]!, uy)), u[18]!);
      let su = vx,
        sv = vy;
      if (u[23]! > 0.5) {
        const compress = add(1, mul(mul(u[31]!, f(1 - vy)), 2));
        su = add(u[5]!, f(f(vx - u[5]!) / Math.max(0.2, compress)));
        for (let j = 0; j < 8; j++) sv = add(vy, mul(mul(f(value(su, sv) - 0.5), u[21]!), 0.45));
      }
      const h = value(su, sv),
        dx = f(value(add(su, 0.005), sv) - value(f(su - 0.005), sv));
      const lighting = clamp(add(0.7, mul(mul(dx, u[21]!), 10)));
      const ridge = add(0.5, mul(0.5, cos(add(mul(mul(h, u[20]!), tau), u[4]!))));
      const line = f(Math.pow(ridge, Math.max(1, Math.round(1 / u[27]!))));
      const phase = add(add(mul(h, tau), u[4]!), mul(hash(0, 0, seed), tau));
      for (let k = 0; k < 3; k++) {
        const palette = mix(add(0.5, mul(0.5, cos(add(phase, f((k * tau) / 3))))), u[24 + k]!, 0.2);
        const ink = mix(f(input[i + k]! / 255), palette, u[11]!);
        const treatment = mix(u[28 + k]!, mul(ink, lighting), line);
        output[i + k] = Math.round(clamp(mix(f(input[i + k]! / 255), treatment, u[3]!)) * 255);
      }
      output[i + 3] = input[i + 3]!;
    }
    yield;
  }
}
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
function billowNoise(x: number, y: number, seed: number) {
  return add(
    add(
      mul(noise(x, y, seed), 0.58),
      mul(noise(add(mul(x, 2.07), 11), add(mul(y, 2.07), 11), seed), 0.28),
    ),
    mul(noise(add(mul(x, 4.19), 27), add(mul(y, 4.19), 27), seed), 0.14),
  );
}
function eddyPoint(
  x: number,
  y: number,
  phase: number,
  seed: number,
  strength: number,
  size: number,
): readonly [number, number] {
  if (strength === 0) return [x, y];
  const cx = Math.floor(f(x / size)),
    cy = Math.floor(f(y / size));
  let dx = 0,
    dy = 0,
    weights = 0;
  for (let yy = -1; yy <= 1; yy++)
    for (let xx = -1; xx <= 1; xx++) {
      const ax = cx + xx,
        ay = cy + yy;
      const lx = f(x - mul(add(ax, add(0.25, mul(hash(ax, ay, seed, 20), 0.5))), size)),
        ly = f(y - mul(add(ay, add(0.25, mul(hash(ax, ay, seed, 21), 0.5))), size));
      const falloff = clamp(f(1 - f(add(mul(lx, lx), mul(ly, ly)) / mul(mul(size, size), 1.21)))),
        weight = mul(falloff, falloff),
        angle = add(
          mul(phase, hash(ax, ay, seed, 22) < 0.5 ? -1 : 1),
          mul(hash(ax, ay, seed, 23), mul(f(Math.PI), 2)),
        ),
        c = cos(angle),
        s = sin(angle);
      dx = add(dx, mul(f(mul(c, lx) - mul(s, ly) - lx), weight));
      dy = add(dy, mul(f(mul(s, lx) + mul(c, ly) - ly), weight));
      weights = add(weights, weight);
    }
  return [
    add(x, f(mul(dx, strength) / Math.max(1, weights))),
    add(y, f(mul(dy, strength) / Math.max(1, weights))),
  ];
}
function paintDrip(
  x: number,
  y: number,
  ax: number,
  ay: number,
  seed: number,
  u: Float32Array,
  aa: number,
  c: number,
  s: number,
) {
  const run = mul(f(1 - u[31]!), f(1 - u[31]!));
  if (run === 0 || hash(ax, ay, seed, 0) >= u[20]!) return 0;
  const lx = f(x - add(ax, add(0.5, mul(f(hash(ax, ay, seed, 1) - 0.5), 0.5)))),
    ly = f(y - add(ay, add(0.5, mul(f(hash(ax, ay, seed, 2) - 0.5), 0.5)))),
    across = add(mul(c, lx), mul(s, ly)),
    down = add(-mul(s, lx), mul(c, ly));
  const spin = add(mul(hash(ax, ay, seed, 3), mul(f(Math.PI), 2)), u[4]!),
    radius = mul(u[21]!, add(0.75, mul(0.25, cos(spin))));
  let coverage = 0;
  for (let j = 0; j < 3; j++) {
    const start = mul(radius, 0.25),
      length = mul(
        mul(run, add(1.25, mul(radius, 1.5))),
        add(0.45, mul(hash(ax, ay, seed, 30 + j), 0.55)),
      ),
      end = add(start, length),
      along = Math.max(start, Math.min(end, down)),
      t = clamp(f((down - start) / Math.max(length, 0.00001))),
      offset = mul(radius, f(hash(ax, ay, seed, 33 + j) * 1.1 - 0.55));
    const bend = mul(mul(run, radius), mul(0.08, sin(add(mul(along, 3), spin)))),
      thickness = mul(
        mul(radius, add(0.05, mul(u[31]!, 0.04))),
        add(0.6, mul(hash(ax, ay, seed, 36 + j), 0.4)),
      ),
      width = mul(thickness, f(1 - mul(t, 0.45))),
      distance = f(Math.hypot(f(across - offset - bend), f(down - along)));
    coverage = Math.max(coverage, clamp(f((width - distance) / Math.max(aa, 0.00001) + 0.5)));
    const tip = f(Math.hypot(f(across - offset - bend), f(down - end)));
    coverage = Math.max(
      coverage,
      clamp(f((mul(thickness, 1.5) - tip) / Math.max(aa, 0.00001) + 0.5)),
    );
  }
  return coverage;
}
export function* referenceShaderPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: ReferenceShaderEffect | SpectralTerrainEffect,
  u: Float32Array,
  sample: Sampler,
  heightField?: HeightField,
): Generator<void> {
  if (effect.type === 'shader-spectral-terrain') {
    if (!heightField) throw new Error('Spectral Terrain requires a height field.');
    yield* terrainPixels(input, output, width, height, u, heightField);
    return;
  }
  if (
    [
      'shader-signal-collapse',
      'shader-paint-flow',
      'shader-billowing-smoke',
      'shader-neon-edges',
      'shader-wire-ghost',
      'shader-prismatic-shatter',
      'shader-radial-extrusion',
      'shader-cellular-mesh',
      'shader-particle-burst',
    ].includes(effect.type)
  ) {
    yield* materialPixels(input, output, width, height, effect, u, sample);
    return;
  }
  const color = new Float64Array(4),
    pi = f(Math.PI),
    tau = mul(pi, 2),
    seed = Math.floor(mul(u[7]!, 100000)) >>> 0;
  const cc = cos(u[22]!),
    ss = sin(u[22]!);
  const det = f(mul(u[12]!, u[17]!) - mul(u[13]!, u[16]!));
  const aa = f(Math.max(u[0]! / width, u[1]! / height) * u[2]!);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (u[3] === 0) {
        output.set(input.subarray(i, i + 4), i);
        continue;
      }
      const ux = f((x + 0.5) / width),
        uy = f((y + 0.5) / height);
      const vx = add(add(mul(u[12]!, ux), mul(u[13]!, uy)), u[14]!);
      const vy = add(add(mul(u[16]!, ux), mul(u[17]!, uy)), u[18]!);
      const px = mul(f(vx - u[5]!), u[0]!),
        py = mul(f(vy - u[6]!), u[1]!);
      const qx = mul(add(mul(cc, px), -mul(ss, py)), u[2]!);
      const qy = mul(add(mul(ss, px), mul(cc, py)), u[2]!);
      const result = [0, 0, 0];
      let alpha = input[i + 3]! / 255;
      if (effect.type === 'shader-bloom-field') {
        let coverage = 0;
        const row = Math.floor(qy),
          col = Math.floor(qx - (row & 1) * 0.5);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const cy = row + dy,
              cx = col + dx;
            const gate = noise(
              add(f(cx / u[31]!), cos(u[4]!)),
              add(f(cy / u[31]!), sin(u[4]!)),
              seed,
            );
            if (gate < f(1 - u[23]!)) continue;
            const localX = f(qx - f(cx + 0.5 + (cy & 1) * 0.5)),
              localY = f(qy - f(cy + 0.5));
            const rotation = add(mul(hash(cx, cy, seed, 2), tau), u[4]!);
            const radius = mul(u[21]!, add(0.8, mul(0.2, cos(add(rotation, u[4]!)))));
            for (let j = 0; j < u[20]!; j++) {
              const theta = add(rotation, f((j * tau) / u[20]!));
              const a = f(localX - mul(radius, cos(theta))),
                b = f(localY - mul(radius, sin(theta)));
              const distance = f(Math.sqrt(add(mul(a, a), mul(b, b))));
              coverage = Math.max(
                coverage,
                clamp(f((u[27]! - distance) / Math.max(aa, 0.00001) + 0.5)),
              );
            }
          }
        for (let k = 0; k < 3; k++) {
          const fg = mix(input[i + k]! / 255, u[24 + k]!, u[11]!);
          result[k] = mix(u[28 + k]!, fg, coverage);
        }
        if (u[9]! > 0.5) alpha = 1;
      } else {
        const field = noise(mul(qx, 0.7), mul(qy, 1.7), seed);
        const wave = sin(add(add(mul(qy, 5), mul(field, 9)), u[4]!));
        const travel = mul(mul(u[20]!, u[3]!), wave);
        const ox = f(mul(cc, travel) / u[0]!),
          oy = f(mul(ss, travel) / u[1]!);
        const dx = f(f(mul(u[17]!, ox) - mul(u[13]!, oy)) / det),
          dy = f(f(-mul(u[16]!, ox) + mul(u[12]!, oy)) / det);
        sample(
          input,
          width,
          height,
          add(x, mul(dx, width)),
          add(y, mul(dy, height)),
          color,
          effect.params.edgeHandling ?? 'extend',
        );
        alpha = color[3]! / 255;
        const luma = f((color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722) / 255);
        const band = Math.floor(add(mul(luma, u[21]!), mul(wave, 0.45)));
        const spectral = add(mul(f(band / u[21]!), tau), u[4]!);
        const eroded = luma < u[23]! && field > 0.35;
        for (let k = 0; k < 3; k++) {
          const hue = add(0.5, mul(0.5, cos(add(spectral, f((k * tau) / 3)))));
          const target = eroded ? u[28 + k]! : luma < u[23]! ? u[24 + k]! : hue;
          result[k] = mix(color[k]! / 255, target, u[11]!);
        }
      }
      for (let k = 0; k < 3; k++)
        output[i + k] = Math.round(clamp(mix(input[i + k]! / 255, result[k]!, u[3]!)) * 255);
      output[i + 3] = Math.round(clamp(mix(input[i + 3]! / 255, alpha, u[3]!)) * 255);
    }
    yield;
  }
}

function* materialPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: ReferenceShaderEffect,
  u: Float32Array,
  sample: Sampler,
): Generator<void> {
  const tau = mul(f(Math.PI), 2),
    seed = Math.floor(mul(u[7]!, 100000)) >>> 0,
    cc = cos(u[22]!),
    ss = sin(u[22]!);
  const det = f(mul(u[12]!, u[17]!) - mul(u[13]!, u[16]!));
  const color = new Float64Array(4),
    a = new Float64Array(4),
    b = new Float64Array(4);
  const luminance = (v: Float64Array) =>
    mul(f((v[0]! * 0.2126 + v[1]! * 0.7152 + v[2]! * 0.0722) / 255), f(v[3]! / 255));
  let x = 0,
    y = 0;
  const at = (ox: number, oy: number, out: Float64Array) => {
    const dx = f(f(mul(u[17]!, ox) - mul(u[13]!, oy)) / det),
      dy = f(f(-mul(u[16]!, ox) + mul(u[12]!, oy)) / det);
    sample(
      input,
      width,
      height,
      add(x, mul(dx, width)),
      add(y, mul(dy, height)),
      out,
      effect.params.edgeHandling ?? 'extend',
    );
  };
  const gradient = (ox: number, oy: number, r: number) => {
    at(f(ox - r / u[0]!), oy, a);
    at(f(ox + r / u[0]!), oy, b);
    const dx = f(luminance(b) - luminance(a));
    at(ox, f(oy - r / u[1]!), a);
    at(ox, f(oy + r / u[1]!), b);
    const dy = f(luminance(b) - luminance(a));
    return f(Math.sqrt(add(mul(dx, dx), mul(dy, dy))));
  };
  for (y = 0; y < height; y++) {
    for (x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (u[3] === 0) {
        output.set(input.subarray(i, i + 4), i);
        continue;
      }
      const ux = f((x + 0.5) / width),
        uy = f((y + 0.5) / height);
      const vx = add(add(mul(u[12]!, ux), mul(u[13]!, uy)), u[14]!),
        vy = add(add(mul(u[16]!, ux), mul(u[17]!, uy)), u[18]!);
      const px = mul(f(vx - u[5]!), u[0]!),
        py = mul(f(vy - u[6]!), u[1]!);
      const qx = mul(add(mul(cc, px), -mul(ss, py)), u[2]!),
        qy = mul(add(mul(ss, px), mul(cc, py)), u[2]!);
      const spectral = add(add(mul(add(qx, qy), 0.6), u[4]!), mul(noise(qx, qy, seed), tau));
      const palette = [0, 1, 2].map((k) =>
        mix(add(0.5, mul(0.5, cos(add(spectral, f((k * tau) / 3))))), u[24 + k]!, 0.25),
      );
      let alpha = f(input[i + 3]! / 255);
      const result = [0, 0, 0];
      if (effect.type === 'shader-signal-collapse') {
        const qxStable = f(Math.floor(mul(qx, 4096) + 0.5) / 4096),
          qyStable = f(Math.floor(mul(qy, 4096) + 0.5) / 4096),
          cx = Math.floor(qxStable),
          cy = Math.floor(qyStable),
          row = Math.floor(mul(qyStable, 3));
        const ribbon =
            u[31] === 0
              ? 0
              : u[31] === 1
                ? 1
                : mul(u[31]!, clamp(f((u[31]! - hash(0, row, seed, 3)) / 0.25 + 0.5))),
          wave = sin(
            add(
              add(mul(qxStable, 2), mul(qyStable, 3)),
              add(u[4]!, mul(hash(0, row, seed, 4), tau)),
            ),
          );
        const anchor = add(mul(Math.floor(f(qxStable / 4)), 4), mul(hash(0, row, seed, 8), 4)),
          compressed = add(anchor, f((qxStable - anchor) / add(1, mul(u[21]!, 40))));
        const ox = add(
            mul(u[20]!, mul(0.22, add(f(hash(cx, cy, seed, 0) * 2 - 1), mul(wave, 0.45)))),
            mul(ribbon, f((compressed - qxStable) / u[2]!)),
          ),
          oy = mul(u[20]!, mul(0.16, f(hash(cx, cy, seed, 1) * 2 - 1)));
        at(f((mul(cc, ox) + mul(ss, oy)) / u[0]!), f((-mul(ss, ox) + mul(cc, oy)) / u[1]!), color);
        alpha = f(color[3]! / 255);
        const grain = mul(
          mul(
            f(hash(Math.floor(mul(qxStable, 24)), Math.floor(mul(qyStable, 24)), seed, 6) - 0.5),
            u[23]!,
          ),
          add(0.35, mul(0.65, ribbon)),
        );
        const luma = clamp(add(luminance(color), grain)),
          level = Math.min(4, Math.floor(f(Math.floor(mul(luma, 4096) + 0.5) / 4096) * 5));
        const inks = [
          [u[28]!, u[29]!, u[30]!],
          [0.1, 0.05, 1],
          [u[24]!, u[25]!, u[26]!],
          [0.1, 1, 0.05],
          [1, 1, 1],
        ];
        const missing = hash(cx, cy, seed, 7) < u[27]!;
        for (let k = 0; k < 3; k++)
          result[k] = missing
            ? u[28 + k]!
            : mix(clamp(add(f(color[k]! / 255), grain)), inks[level]![k]!, u[11]!);
      } else if (effect.type === 'shader-paint-flow') {
        const qxStable = f(Math.floor(mul(qx, 4096) + 0.5) / 4096),
          qyStable = f(Math.floor(mul(qy, 4096) + 0.5) / 4096),
          tx = mul(f(cos(u[4]!) - 1), 0.7),
          ty = mul(sin(u[4]!), 0.7);
        const nx = f(billowNoise(add(qxStable, tx), add(qyStable, ty), seed) - 0.5),
          ny = f(billowNoise(add(qxStable, add(tx, 19)), add(qyStable, add(ty, 7)), seed) - 0.5);
        const run = mul(f(1 - u[31]!), f(1 - u[31]!));
        const ox = mul(nx, u[27]!),
          oy = f(mul(ny, u[27]!) - (u[23]! > 0.5 ? mul(run, 0.12) : 0));
        at(f((mul(cc, ox) + mul(ss, oy)) / u[0]!), f((-mul(ss, ox) + mul(cc, oy)) / u[1]!), color);
        const aa = mul(Math.max(u[0]! / width, u[1]! / height), u[2]!);
        let coverage = 0,
          inkX = Math.floor(qxStable),
          inkY = Math.floor(qyStable);
        if (u[23]! > 0.5) {
          const ridge = Math.abs(sin(add(add(mul(qxStable, 1.3), mul(nx, 8)), u[4]!)));
          coverage =
            u[20]! === 0
              ? 0
              : clamp(
                  f(
                    (mul(u[20]!, add(0.1, mul(u[21]!, 0.8))) - ridge) / add(aa, mul(u[31]!, 0.15)) +
                      0.5,
                  ),
                );
        } else {
          const cx = Math.floor(qxStable),
            cy = Math.floor(qyStable);
          for (let yy = -1; yy <= 1; yy++)
            for (let xx = -1; xx <= 1; xx++) {
              const ax = cx + xx,
                ay = cy + yy;
              if (hash(ax, ay, seed, 0) >= u[20]!) continue;
              const lx = f(qxStable - add(ax, add(0.5, mul(f(hash(ax, ay, seed, 1) - 0.5), 0.5)))),
                ly = f(qyStable - add(ay, add(0.5, mul(f(hash(ax, ay, seed, 2) - 0.5), 0.5))));
              const spin = add(mul(hash(ax, ay, seed, 3), tau), u[4]!),
                theta = f(Math.atan2(ly, lx)),
                lobes = 3 + Math.floor(hash(ax, ay, seed, 4) * 5),
                radius = mul(u[21]!, add(0.75, mul(0.25, cos(spin)))),
                ragged = add(
                  1,
                  mul(
                    f(1 - u[31]!),
                    add(
                      mul(0.35, sin(add(mul(theta, lobes), spin))),
                      mul(0.22, sin(add(mul(theta, lobes + 3), mul(spin, 1.31)))),
                    ),
                  ),
                ),
                edge = add(aa, mul(u[31]!, 0.08));
              let clusterCoverage = clamp(
                f((mul(radius, ragged) - f(Math.hypot(lx, ly))) / edge + 0.5),
              );
              for (let dot = 0; dot < 3; dot++) {
                const angle = add(spin, mul(hash(ax, ay, seed, 6 + dot), tau)),
                  reach = mul(radius, add(1.3, mul(hash(ax, ay, seed, 9 + dot), 0.6))),
                  dx = f(lx - mul(cos(angle), reach)),
                  dy = f(ly - mul(sin(angle), reach));
                clusterCoverage = Math.max(
                  clusterCoverage,
                  clamp(
                    f(
                      (mul(radius, add(0.07, mul(hash(ax, ay, seed, 12 + dot), 0.15))) -
                        f(Math.hypot(dx, dy))) /
                        Math.max(aa, 0.00001) +
                        0.5,
                    ),
                  ),
                );
              }
              clusterCoverage = Math.max(
                clusterCoverage,
                paintDrip(qxStable, qyStable, ax, ay, seed, u, aa, cc, ss),
              );
              clusterCoverage = f(Math.floor(mul(clusterCoverage, 1024) + 0.5) / 1024);
              if (clusterCoverage > coverage) {
                coverage = clusterCoverage;
                inkX = ax;
                inkY = ay;
              }
            }
          // Search upstream along canvas gravity, including rotated patterns.
          // The bounded probes include long runs from splashes outside the 3x3 neighborhood.
          for (let step = 1; step <= 3; step++)
            for (let side = -1; side <= 1; side++) {
              const ax = Math.floor(add(add(qxStable, mul(ss, step)), mul(cc, side * 0.75))),
                ay = Math.floor(add(add(qyStable, -mul(cc, step)), mul(ss, side * 0.75)));
              const drip = f(
                Math.floor(
                  mul(paintDrip(qxStable, qyStable, ax, ay, seed, u, aa, cc, ss), 1024) + 0.5,
                ) / 1024,
              );
              if (drip > coverage) {
                coverage = drip;
                inkX = ax;
                inkY = ay;
              }
            }
        }
        const hue = mul(
            u[23]! > 0.5
              ? billowNoise(mul(qxStable, 0.45), mul(qyStable, 0.45), seed)
              : hash(inkX, inkY, seed, 45),
            tau,
          ),
          brightness = add(0.6, mul(hash(inkX, inkY, seed, 46), 0.4));
        for (let k = 0; k < 3; k++) {
          const base = mix(u[28 + k]!, f(input[i + k]! / 255), u[10]!);
          const uniformPaint = mix(f(color[k]! / 255), u[24 + k]!, u[11]!),
            variedPaint = mul(
              add(0.15, mul(0.85, add(0.5, mul(0.5, cos(add(hue, f((k * tau) / 3))))))),
              brightness,
            ),
            paint = mix(uniformPaint, variedPaint, u[15]!);
          result[k] = mix(base, paint, coverage);
        }
      } else if (effect.type === 'shader-billowing-smoke') {
        const qxStable = f(Math.floor(mul(qx, 4096) + 0.5) / 4096),
          qyStable = f(Math.floor(mul(qy, 4096) + 0.5) / 4096),
          tx = mul(f(cos(u[4]!) - 1), 0.12),
          ty = mul(sin(u[4]!), 0.12);
        const [ex, ey] = eddyPoint(qxStable, qyStable, u[4]!, seed, u[15]!, u[19]!);
        const warpX = mul(f(billowNoise(add(ex, tx), add(ey, ty), seed) - 0.5), mul(u[21]!, 3)),
          warpY = mul(
            f(billowNoise(add(ex, add(tx, 19)), add(ey, add(ty, 7)), seed) - 0.5),
            mul(u[21]!, 3),
          );
        const wx = add(add(ex, tx), warpX),
          wy = add(add(ey, ty), warpY);
        let thickness = 0,
          lighting = 0;
        for (let j = 0; j < u[10]!; j++) {
          const z = f(j / Math.max(1, u[10]! - 1)),
            sx = add(wx, mul(z, 0.7)),
            sy = add(wy, mul(z, 0.43)),
            field = billowNoise(sx, sy, seed);
          const cloud =
            u[20]! === 0 ? 0 : clamp(f((field - f(1 - u[20]!)) / add(0.08, mul(u[31]!, 0.35))));
          const shade = clamp(
            add(
              0.5,
              mul(
                f(billowNoise(sx, add(sy, -0.08), seed) - billowNoise(sx, add(sy, 0.08), seed)),
                5,
              ),
            ),
          );
          thickness = add(thickness, f(mul(mul(cloud, u[23]!), 3) / u[10]!));
          lighting = add(lighting, f(mix(0.85, add(0.25, mul(shade, 0.85)), u[27]!) / u[10]!));
        }
        const coverage = f(1 - f(Math.exp(-thickness)));
        for (let k = 0; k < 3; k++) {
          const smoke = mul(mix(f(input[i + k]! / 255), u[24 + k]!, u[11]!), lighting);
          result[k] = mix(u[28 + k]!, smoke, coverage);
        }
        if (u[9]! > 0.5) alpha = 1;
      } else if (effect.type === 'shader-radial-extrusion') {
        const radius = f(Math.sqrt(add(mul(px, px), mul(py, py)))),
          angle = f((f(Math.atan2(qy, qx)) + f(Math.PI)) / tau);
        const angular = f(Math.floor(mul(mul(angle, u[20]!), 4096) + 0.5) / 4096),
          sector = Math.floor(angular) % u[20]!,
          local = f(angular - Math.floor(angular));
        const incomingLuma = f(
          (((input[i]! * 0.2126 + input[i + 1]! * 0.7152 + input[i + 2]! * 0.0722) / 255) *
            input[i + 3]!) /
            255,
        );
        const height = mul(
          add(0.25, mul(0.75, hash(sector, 0, seed, 0))),
          add(0.25, mul(0.75, incomingLuma)),
        );
        const length = add(1, mul(u[21]!, height));
        const rr = add(u[23]!, f(Math.max(0, radius - u[23]!) / length));
        const theta = f(((sector + 0.5) / u[20]!) * tau - f(Math.PI) - u[22]!);
        const su = add(u[5]!, f(mul(cos(theta), rr) / u[0]!)),
          sv = add(u[6]!, f(mul(sin(theta), rr) / u[1]!));
        at(f(su - vx), f(sv - vy), color);
        const plate = f(radius * u[2]! * 0.8 - u[21]! * height + Math.sin(u[4]!) * 0.2),
          step = f(plate - Math.floor(plate));
        const side = f(1 - Math.abs(local - 0.5) * 2),
          shade = mix(1, add(0.2, mul(0.8, side)), u[31]!);
        const light = mul(shade, add(0.35, mul(0.65, step)));
        for (let k = 0; k < 3; k++)
          result[k] =
            radius < u[23]! ? u[28 + k]! : mul(mix(f(color[k]! / 255), palette[k]!, u[11]!), light);
      } else if (effect.type === 'shader-cellular-mesh') {
        const cx = Math.floor(qx),
          cy = Math.floor(qy);
        let nearest = Infinity,
          second = Infinity,
          nx = 0,
          ny = 0;
        for (let yy = -1; yy <= 1; yy++)
          for (let xx = -1; xx <= 1; xx++) {
            const ax = cx + xx,
              ay = cy + yy;
            const dx = f(qx - add(ax, add(0.1, mul(0.8, hash(ax, ay, seed, 0))))),
              dy = f(qy - add(ay, add(0.1, mul(0.8, hash(ax, ay, seed, 1)))));
            const d = f(Math.sqrt(add(mul(dx, dx), mul(dy, dy))));
            if (d < nearest) {
              second = nearest;
              nearest = d;
              nx = ax;
              ny = ay;
            } else second = Math.min(second, d);
          }
        const aa = mul(Math.max(u[0]! / width, u[1]! / height), u[2]!),
          boundary = f(second - nearest);
        const hole = clamp(f((nearest - mul(u[20]!, 0.4)) / add(aa, mul(u[21]!, 0.08)) + 0.5));
        const rounded = clamp(f(boundary / add(0.02, mul(u[21]!, 0.15))));
        const face = hash(nx, ny, seed, 2) < u[23]! ? 0 : mul(hole, rounded);
        const wire = mul(clamp(f(1 - boundary / add(aa, 0.04))), u[27]!);
        const shade = add(0.6, mul(0.4, cos(mul(nearest, f(Math.PI)))));
        for (let k = 0; k < 3; k++) {
          const material = mul(mix(f(input[i + k]! / 255), palette[k]!, u[11]!), shade);
          result[k] = add(mix(u[28 + k]!, material, face), mul(u[24 + k]!, wire));
        }
      } else if (effect.type === 'shader-particle-burst') {
        const cx = Math.floor(qx),
          cy = Math.floor(qy);
        const orbit = mul(hash(cx, cy, seed, 5), tau);
        const shiftX = mul(0.3, f(cos(add(orbit, u[4]!)) - cos(orbit))),
          shiftY = mul(0.3, f(sin(add(orbit, u[4]!)) - sin(orbit)));
        const centerX = add(add(cx, add(0.5, mul(f(hash(cx, cy, seed, 0) - 0.5), u[23]!))), shiftX),
          centerY = add(add(cy, add(0.5, mul(f(hash(cx, cy, seed, 1) - 0.5), u[23]!))), shiftY);
        const lx = f(qx - centerX),
          ly = f(qy - centerY);
        const ax = f(centerX / u[2]!),
          ay = f(centerY / u[2]!);
        const sx = add(u[5]!, f((mul(cc, ax) + mul(ss, ay)) / u[0]!)),
          sy = add(u[6]!, f((-mul(ss, ax) + mul(cc, ay)) / u[1]!));
        at(f(sx - vx), f(sy - vy), color);
        const luma = luminance(color),
          aa = mul(Math.max(u[0]! / width, u[1]! / height), u[2]!);
        const radius = mul(u[21]!, add(0.5, luma));
        const dot = clamp(f((radius - f(Math.hypot(lx, ly))) / aa + 0.5));
        const theta = add(mul(hash(cx, cy, seed, 4), tau), u[4]!),
          bx = mul(cos(theta), u[27]!),
          by = mul(sin(theta), u[27]!);
        const length = add(mul(bx, bx), mul(by, by)),
          t = length > 0 ? clamp(f(add(mul(lx, bx), mul(ly, by)) / length)) : 0;
        const distance = f(Math.hypot(f(lx - mul(t, bx)), f(ly - mul(t, by))));
        const branch = mul(clamp(f((mul(radius, 0.3) - distance) / aa + 0.5)), u[27]!);
        const gate = hash(cx, cy, seed, 2) < mul(u[20]!, add(0.15, mul(0.85, luma))) ? 1 : 0;
        const coverage = mul(Math.max(dot, branch), gate);
        const focal =
          u[10]! > 0
            ? mul(
                add(
                  mul(
                    f(Math.exp((-Math.abs(px) * 70) / (u[10]! + 0.05))),
                    f(Math.exp(-Math.abs(py) / (u[10]! + 0.02))),
                  ),
                  mul(
                    f(Math.exp((-Math.abs(py) * 70) / (u[10]! + 0.05))),
                    f(Math.exp(-Math.abs(px) / (u[10]! + 0.02))),
                  ),
                ),
                u[31]!,
              )
            : 0;
        for (let k = 0; k < 3; k++) {
          const ink = mix(f(color[k]! / 255), u[24 + k]!, u[11]!);
          result[k] = add(mix(u[28 + k]!, ink, coverage), mul(u[24 + k]!, focal));
        }
      } else if (effect.type === 'shader-prismatic-shatter') {
        const cx = Math.floor(qx),
          cy = Math.floor(qy),
          rx = hash(cx, cy, seed, 0),
          ry = hash(cx, cy, seed, 1);
        const travel = mul(u[20]!, add(0.7, mul(0.3, sin(u[4]!))));
        const ax = mul(f(rx * 2 - 1), travel),
          ay = mul(f(ry * 2 - 1), travel);
        const ox = f((mul(cc, ax) - mul(ss, ay)) / u[0]!),
          oy = f((mul(ss, ax) + mul(cc, ay)) / u[1]!);
        at(ox, oy, color);
        const edge = clamp(mul(gradient(0, 0, f(0.01)), 2));
        alpha = hash(cx, cy, seed, 2) < mul(u[23]!, edge) ? 0 : f(color[3]! / 255);
        const stripe = add(0.5, mul(0.5, sin(add(mul(add(qx, qy), 18), u[4]!))));
        const light = add(0.45, add(mul(0.55, stripe), mul(u[27]!, f(rx - 0.5))));
        for (let k = 0; k < 3; k++) {
          const spectralColor = mix(f(color[k]! / 255), mul(palette[k]!, light), u[11]!);
          result[k] = mix(f(color[k]! / 255), spectralColor, u[21]!);
        }
      } else if (effect.type === 'shader-neon-edges') {
        const sharp = clamp(mul(gradient(0, 0, u[20]!), 3));
        const wide = clamp(mul(gradient(0, 0, mul(u[20]!, 3)), 1.5));
        const light = add(sharp, mul(mul(wide, u[21]!), 0.65));
        for (let k = 0; k < 3; k++) {
          const base = mix(f(input[i + k]! / 255), u[28 + k]!, u[23]!);
          const ink = mix(f(input[i + k]! / 255), palette[k]!, u[11]!);
          result[k] = add(base, mul(ink, light));
        }
      } else {
        for (let k = 0; k < 3; k++) result[k] = mix(f(input[i + k]! / 255), u[28 + k]!, 0.8);
        const row = Math.floor(mul(qy, 4)),
          jitter = mul(f(hash(row, 0, seed, 3) * 2 - 1), u[27]!);
        for (let j = 0; j < u[23]!; j++) {
          const t = f(j / Math.max(1, u[23]! - 1)),
            travel = mul(mul(u[21]!, t), add(0.75, mul(0.25, sin(u[4]!))));
          const ox = f((mul(cc, travel) + mul(jitter, 0.04)) / u[0]!),
            oy = f(mul(ss, travel) / u[1]!);
          const edge = clamp(mul(gradient(ox, oy, mul(u[20]!, add(1, mul(u[31]!, 2)))), 3));
          at(ox, oy, color);
          const fade = mul(f(1 - t * 0.65), f(1 / u[23]!)),
            hue = add(spectral, mul(t, tau));
          for (let k = 0; k < 3; k++) {
            const ink = mix(
              f(color[k]! / 255),
              mix(add(0.5, mul(0.5, cos(add(hue, f((k * tau) / 3))))), u[24 + k]!, 0.25),
              u[11]!,
            );
            result[k] = add(result[k]!, mul(mul(ink, edge), mul(fade, 2)));
          }
        }
      }
      for (let k = 0; k < 3; k++)
        output[i + k] = Math.round(clamp(mix(f(input[i + k]! / 255), result[k]!, u[3]!)) * 255);
      output[i + 3] = Math.round(clamp(mix(f(input[i + 3]! / 255), alpha, u[3]!)) * 255);
    }
    yield;
  }
}
