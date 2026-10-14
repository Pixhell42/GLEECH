import type { BetaShaderEffect, EdgeHandling } from '@gleech/project-model';

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
const add = (a: number, b: number) => f(a + b);
const mul = (a: number, b: number) => f(a * b);
const sin = (a: number) => f(Math.sin(a));
const cos = (a: number) => f(Math.cos(a));
const clamp = (a: number) => Math.max(0, Math.min(1, a));
const fract = (a: number) => f(a - Math.floor(a));
const mix = (a: number, b: number, t: number) => add(mul(a, f(1 - t)), mul(b, t));
const length = (x: number, y: number) => f(Math.sqrt(add(mul(x, x), mul(y, y))));
const smooth = (a: number, b: number, value: number) => {
  const t = f(clamp(f(f(value - a) / f(b - a))));
  return mul(mul(t, t), f(3 - mul(2, t)));
};
// Integer hashing keeps discrete cell choices identical on CPU and GPU.
function hash(x: number, y: number, seed: number, lane = 0) {
  let h =
    (Math.imul(x | 0, 0x8da6b343) ^
      Math.imul(y | 0, 0xd8163841) ^
      seed ^
      Math.imul(lane, 0xcb1ab31f)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return f(((h ^ (h >>> 16)) >>> 0) / 4294967296);
}

export function* betaShaderPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: BetaShaderEffect,
  u: Float32Array,
  sample: Sampler,
): Generator<void> {
  const pi = f(Math.PI),
    tau = mul(pi, 2);
  const a = u[20]!,
    b = u[21]!,
    angle = u[22]!,
    variant = u[23]!;
  const c = cos(angle),
    s = sin(angle),
    seed = Math.floor(mul(u[7]!, 100000)) >>> 0;
  const aa = f(Math.max(u[0]! / width, u[1]! / height) * u[2]! * 0.85);
  const color = new Float64Array(4),
    extra = new Float64Array(4),
    total = new Float32Array(3);
  const determinant = f(mul(u[12]!, u[17]!) - mul(u[13]!, u[16]!));
  const sampleOffset = (x: number, y: number, dx: number, dy: number, into = color) => {
    const rx = add(mul(c, dx), mul(s, dy)),
      ry = add(-mul(s, dx), mul(c, dy));
    const ox = f(rx / u[0]!),
      oy = f(ry / u[1]!);
    const worldX = f(f(mul(u[17]!, ox) - mul(u[13]!, oy)) / determinant);
    const worldY = f(f(-mul(u[16]!, ox) + mul(u[12]!, oy)) / determinant);
    sample(
      input,
      width,
      height,
      add(x, mul(worldX, width)),
      add(y, mul(worldY, height)),
      into,
      effect.params.edgeHandling ?? 'extend',
    );
  };
  const palette = (v: number, channel: number) => mix(u[28 + channel]!, u[24 + channel]!, clamp(v));
  const material = (value: number, channel: number) => mix(value, palette(value, channel), u[11]!);
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
      const rx = add(mul(c, px), -mul(s, py)),
        ry = add(mul(s, px), mul(c, py));
      const qx = add(mul(rx, u[2]!), mul(sin(u[4]!), 0.2));
      const qy = add(mul(ry, u[2]!), mul(cos(u[4]!), 0.2));
      const fx = fract(qx),
        fy = fract(qy),
        ix = Math.floor(qx),
        iy = Math.floor(qy);
      let field = 0,
        rim = 0,
        warped = false,
        light = 0;
      if (effect.type === 'shader-cellular-membrane') {
        let first = 1e9,
          second = 1e9,
          dx = 0,
          dy = 0;
        for (let yy = -1; yy <= 1; yy++)
          for (let xx = -1; xx <= 1; xx++) {
            const cx = ix + xx,
              cy = iy + yy;
            const tx = f(add(add(cx, 0.5), mul(f(hash(cx, cy, seed) - 0.5), b)) - qx);
            const ty = f(add(add(cy, 0.5), mul(f(hash(cx, cy, seed, 1) - 0.5), b)) - qy);
            const distance = variant === 2 ? add(Math.abs(tx), Math.abs(ty)) : length(tx, ty);
            if (distance < first) {
              second = first;
              first = distance;
              dx = tx;
              dy = ty;
            } else if (distance < second) second = distance;
          }
        const gap = variant === 1 ? Math.abs(f(first - 0.35)) : f(second - first);
        rim = f(1 - smooth(mul(a, 0.25), add(mul(a, 0.25), aa), gap));
        sampleOffset(x, y, mul(mul(dx, u[3]!), f(1 - rim)), mul(mul(dy, u[3]!), f(1 - rim)));
        light = rim;
        warped = true;
      } else if (
        effect.type === 'shader-digital-fracture' ||
        effect.type === 'shader-crystal-facets'
      ) {
        let xx = qx,
          yy = qy;
        if (variant === 1) yy = mul(yy, effect.type === 'shader-digital-fracture' ? 0.25 : 1);
        if (variant === 2 && effect.type === 'shader-digital-fracture') xx = add(xx, mul(yy, 0.5));
        if (variant === 0 && effect.type === 'shader-crystal-facets') {
          xx = mul(add(qx, qy), 0.70710678);
          yy = mul(f(qy - qx), 0.70710678);
        }
        let cx = Math.floor(xx),
          cy = Math.floor(yy);
        const lx = fract(xx),
          ly = fract(yy);
        let edge = Math.min(lx, f(1 - lx), ly, f(1 - ly));
        if (variant === 2 && effect.type === 'shader-crystal-facets') {
          const row = Math.floor(f(qy / f(0.8660254)));
          let first = 1e9,
            second = 1e9;
          for (let yy = -1; yy <= 1; yy++)
            for (let xx = -1; xx <= 1; xx++) {
              const hx = ix + xx,
                hy = row + yy;
              const dx = f(add(hx, (hy & 1) * 0.5) - qx),
                dy = f(mul(hy, f(0.8660254)) - qy);
              const distance = length(dx, dy);
              // At a shared edge, tiny GPU arithmetic differences must not
              // select another cell's entirely different refraction vector.
              // Resolve near ties in the fixed traversal order on both backends.
              if (add(distance, 0.00001) < first) {
                second = first;
                first = distance;
                cx = hx;
                cy = hy;
              } else if (distance < second) second = distance;
            }
          edge = Math.max(0, f(second - first));
        }
        if (variant === 1 && effect.type === 'shader-crystal-facets')
          edge = Math.min(edge, f(Math.abs(f(lx + ly - 1)) * 0.70710678));
        const dx = f(hash(cx, cy, seed) * 2 - 1),
          dy = f(hash(cx, cy, seed, 1) * 2 - 1);
        const tilt =
          effect.type === 'shader-crystal-facets' && variant === 1 && lx + ly > 1 ? -1 : 1;
        sampleOffset(x, y, mul(mul(mul(dx, b), u[3]!), tilt), mul(mul(mul(dy, b), u[3]!), tilt));
        rim = f(1 - smooth(mul(a, 0.2), add(mul(a, 0.2), aa), edge));
        light =
          effect.type === 'shader-crystal-facets'
            ? mul(rim, add(0.45, mul(hash(cx, cy, seed, 2), 0.55)))
            : rim;
        warped = true;
      } else if (effect.type === 'shader-infinity-tunnel') {
        let radius = length(rx, ry);
        if (variant === 1) radius = Math.max(Math.abs(rx), Math.abs(ry));
        if (variant === 2)
          radius = Math.max(
            Math.abs(rx),
            add(mul(Math.abs(rx), 0.5), mul(Math.abs(ry), 0.8660254)),
          );
        radius = Math.max(mul(mul(radius, u[2]!), 0.5), 0.0001);
        const depth = add(mul(f(Math.log2(radius)), a), add(f(u[4]! / tau), u[7]!));
        const polarAngle = length(rx, ry) > 0.000001 ? f(Math.atan2(ry, rx)) : 0;
        const turn = add(polarAngle, mul(mul(f(Math.log2(radius)), b), 2));
        const target = add(0.06, mul(fract(depth), 0.48));
        const amount = f(u[3]! / 0.15);
        sampleOffset(
          x,
          y,
          mul(f(mul(cos(turn), target) - rx), amount),
          mul(f(mul(sin(turn), target) - ry), amount),
        );
        rim = f(1 - smooth(0, Math.min(0.2, mul(aa, a)), fract(depth)));
        light = mul(rim, 0.3);
        warped = true;
      } else if (effect.type === 'shader-diffraction') {
        const rays = Math.round(a);
        total.fill(0);
        for (let ray = 0; ray < rays; ray++) {
          const direction =
            variant === 1
              ? add(mul(ray % 4, f(pi / 2)), mul(Math.floor(ray / 4), 0.04))
              : mul(f(ray / rays), tau);
          const theta = add(add(direction, mul(u[7]!, 0.05)), mul(sin(u[4]!), 0.25));
          for (let step = 1; step <= 6; step++) {
            const distance = f(mul(mul(b, 0.16), f(step / 6)) / u[2]!);
            sampleOffset(x, y, mul(cos(theta), distance), mul(sin(theta), distance), extra);
            const luminance = add(
              add(mul(f(extra[0]! / 255), 0.2126), mul(f(extra[1]! / 255), 0.7152)),
              mul(f(extra[2]! / 255), 0.0722),
            );
            const bright = f(Math.max(0, f(luminance - u[10]!)) / Math.max(0.001, f(1 - u[10]!)));
            const weight = f(mul(mul(bright, f(extra[3]! / 255)), f(1 - step / 8)) / rays);
            for (let channel = 0; channel < 3; channel++) {
              const spectral =
                variant === 2 ? add(0.5, mul(0.5, cos(add(theta, mul(channel, f(tau / 3)))))) : 1;
              total[channel] = add(
                total[channel]!,
                mul(mul(f(extra[channel]! / 255), weight), spectral),
              );
            }
          }
        }
        const envelope = f(1 / add(1, mul(length(rx, ry), 0.5)));
        const brightness = clamp(add(add(total[0]!, total[1]!), total[2]!));
        for (let channel = 0; channel < 3; channel++)
          color[channel] = mul(
            clamp(
              add(
                f(input[i + channel]! / 255),
                mul(
                  mul(mul(total[channel]!, u[3]!), envelope),
                  mix(1, palette(brightness, channel), u[11]!),
                ),
              ),
            ),
            255,
          );
        color[3] = input[i + 3]!;
        warped = true;
      } else if (effect.type === 'shader-moire') {
        const theta = mul(a, f(pi / 2)),
          ca = cos(theta),
          sa = sin(theta);
        let one = mul(qx, tau),
          two = mul(add(mul(qx, ca), -mul(qy, sa)), tau);
        if (variant === 1) {
          one = mul(length(qx, qy), tau);
          two = mul(length(add(qx, a), qy), tau);
        }
        if (variant === 2) {
          one = add(one, mul(sin(mul(qy, tau)), 1.5));
          two = add(two, mul(cos(mul(qy, tau)), 1.5));
        }
        field = clamp(
          add(0.5, mul(mul(sin(add(one, u[7]!)), sin(add(two, u[4]!))), add(0.5, mul(b, 3)))),
        );
      } else if (effect.type === 'shader-circuit-matrix') {
        const hx = hash(ix, iy, seed),
          hy = hash(ix, iy, seed, 1);
        const lineX = hx < 0.5 ? 0.25 : 0.75,
          lineY = hy < 0.5 ? 0.25 : 0.75;
        let distance = Math.min(Math.abs(f(fx - lineX)), Math.abs(f(fy - lineY)));
        if (variant === 1) distance = Math.min(distance, f(Math.abs(f(fx + fy - 1)) * 0.70710678));
        if (variant === 2) distance = Math.abs(f(length(f(fx - 0.5), f(fy - 0.5)) - 0.32));
        const trace = f(1 - smooth(mul(a, 0.18), add(mul(a, 0.18), aa), distance));
        const junction = f(
          1 - smooth(0.03, add(0.04, mul(b, 0.25)), length(f(fx - lineX), f(fy - lineY))),
        );
        field = clamp(add(trace, mul(junction, b)));
      } else if (effect.type === 'shader-data-lattice') {
        const row = Math.floor(qy),
          shift = mul(f(hash(0, row, seed, 2) - 0.5), mul(b, 2));
        const xx = add(qx, add(shift, variant === 1 ? mul(row % 2, 0.5) : 0));
        const cx = Math.floor(xx),
          cy = variant === 2 ? Math.floor(mul(qy, 0.2)) : row;
        const occupied = hash(cx, cy, seed) < a ? 1 : 0;
        const edgeX = Math.min(fract(xx), f(1 - fract(xx)));
        const edgeY = variant === 2 ? 0.5 : Math.min(fy, f(1 - fy));
        const cut = hash(cx, cy, seed, 1) < mul(b, 0.35) ? 0 : 1;
        field = mul(mul(occupied, cut), smooth(0.08, add(0.08, aa), Math.min(edgeX, edgeY)));
      } else if (effect.type === 'shader-op-art') {
        const xx = add(qx, mul(mul(sin(add(mul(qy, 1.7), u[7]!)), a), 1.5));
        const yy = add(qy, mul(mul(cos(add(qx, u[4]!)), a), 1.5));
        const wave =
          variant === 0
            ? mul(sin(mul(xx, tau)), sin(mul(yy, tau)))
            : variant === 1
              ? sin(mul(xx, tau))
              : sin(add(mul(length(xx, yy), tau), u[7]!));
        field = smooth(-Math.max(0.02, f(1 - b)), Math.max(0.02, f(1 - b)), wave);
      } else {
        const radius = length(qx, qy),
          theta = f(Math.atan2(qy, qx));
        const spiral = variant === 1 ? mul(radius, 0.75) : 0;
        const spokes = Math.abs(sin(add(mul(add(theta, spiral), mul(a, 0.5)), u[7]!)));
        const rings = Math.abs(sin(add(mul(radius, tau), u[4]!)));
        field = f(
          1 -
            smooth(
              mul(b, 0.8),
              add(mul(b, 0.8), Math.min(0.4, mul(aa, 3))),
              Math.min(spokes, rings),
            ),
        );
        if (variant === 2)
          field = mul(field, add(0.25, mul(0.75, f(0.5 + 0.5 * cos(f(theta - u[4]! - u[7]!))))));
      }
      if (!warped) {
        for (let channel = 0; channel < 3; channel++)
          color[channel] = mul(
            mix(f(input[i + channel]! / 255), material(field, channel), u[3]!),
            255,
          );
        color[3] = input[i + 3]!;
      } else if (light > 0) {
        for (let channel = 0; channel < 3; channel++)
          color[channel] = mul(
            clamp(
              add(f(color[channel]! / 255), mul(light, mix(0.4, palette(rim, channel), u[11]!))),
            ),
            255,
          );
      }
      for (let channel = 0; channel < 4; channel++)
        output[i + channel] = Math.round(Math.max(0, Math.min(255, color[channel]!)));
    }
    yield;
  }
}
