// Generated from set2-advanced.kernel by tooling/generate-advanced-shaders.mjs.
/* eslint-disable no-useless-assignment, @typescript-eslint/no-unused-vars -- Specialized kernels retain shared declarations for CPU/GPU parity. */
const F = Math.fround;
const SIN = (x: number) => F(Math.sin(x)),
  COS = (x: number) => F(Math.cos(x)),
  SQRT = (x: number) => F(Math.sqrt(x)),
  ABS = Math.abs,
  MIN = Math.min,
  MAX = Math.max,
  FLOOR = Math.floor,
  ATAN = (y: number, x: number) => (Math.abs(x) + Math.abs(y) < 0.000001 ? 0 : F(Math.atan2(y, x))),
  EXP = (x: number) => F(Math.exp(x)),
  POW = (x: number, y: number) => F(Math.pow(x, y)),
  SIGN = Math.sign;
const CLAMP = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const MIX = (a: number, b: number, t: number) => F(F(a * F(1 - t)) + F(b * t));
export interface AdvancedEnvironment {
  P(i: number): number;
  U(i: number): number;
  H(u: number, v: number): number;
  N(x: number, y: number): number;
  R(x: number, y: number, lane: number): number;
  T(u: number, v: number, ch: number): number;
  D(u: number, v: number, ch: number): number;
  M(x: number, y: number, limit: number): number;
  I(ch: number): number;
  O(ch: number, value: number): void;
  AA(): number;
}
function Palette(env: AdvancedEnvironment, t: number, ch: number): number {
  void env;
  void t;
  void ch;
  const spectral = F(
    F(0.5) + F(F(0.5) * COS(F(F(F(t * F(6.283185)) + F(ch * F(2.094395))) + env.U(F(7))))),
  );
  return MIX(
    MIX(env.U(F(F(28) + ch)), env.U(F(F(24) + ch)), CLAMP(t, F(0), F(1))),
    spectral,
    env.U(F(11)),
  );
}
function Hue(
  env: AdvancedEnvironment,
  r: number,
  g: number,
  b: number,
  angle: number,
  ch: number,
): number {
  void env;
  void r;
  void g;
  void b;
  void angle;
  void ch;
  const c = COS(angle);
  const s = SIN(angle);
  const y = F(F(F(F(0.299) * r) + F(F(0.587) * g)) + F(F(0.114) * b));
  const i = F(F(F(F(0.596) * r) - F(F(0.274) * g)) - F(F(0.322) * b));
  const q = F(F(F(F(0.211) * r) - F(F(0.523) * g)) + F(F(0.312) * b));
  const ii = F(F(i * c) - F(q * s));
  const qq = F(F(i * s) + F(q * c));
  if (ch == F(0)) return CLAMP(F(F(y + F(F(0.956) * ii)) + F(F(0.621) * qq)), F(0), F(1));
  if (ch == F(1)) return CLAMP(F(F(y - F(F(0.272) * ii)) - F(F(0.647) * qq)), F(0), F(1));
  return CLAMP(F(F(y - F(F(1.106) * ii)) + F(F(1.703) * qq)), F(0), F(1));
}
function Lum(env: AdvancedEnvironment, u: number, v: number): number {
  void env;
  void u;
  void v;
  return F(
    F(
      F(F(env.T(u, v, F(0)) * F(0.2126)) + F(env.T(u, v, F(1)) * F(0.7152))) +
        F(env.T(u, v, F(2)) * F(0.0722)),
    ) * env.T(u, v, F(3)),
  );
}
function Segment(
  env: AdvancedEnvironment,
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  void env;
  void x;
  void y;
  void ax;
  void ay;
  void bx;
  void by;
  const dx = F(bx - ax);
  const dy = F(by - ay);
  const t = CLAMP(
    F(F(F(F(x - ax) * dx) + F(F(y - ay) * dy)) / MAX(F(0.000001), F(F(dx * dx) + F(dy * dy)))),
    F(0),
    F(1),
  );
  return SQRT(
    F(
      F(F(F(x - ax) - F(dx * t)) * F(F(x - ax) - F(dx * t))) +
        F(F(F(y - ay) - F(dy * t)) * F(F(y - ay) - F(dy * t))),
    ),
  );
}
function Mandel(env: AdvancedEnvironment, x: number, y: number, limit: number): number {
  void env;
  void x;
  void y;
  void limit;
  return env.M(x, y, limit);
}
function Safe(env: AdvancedEnvironment, x: number): number {
  void env;
  void x;
  if (ABS(x) < F(0.00001)) {
    if (x < F(0)) return F(-F(0.00001));
    return F(0.00001);
  }
  return x;
}
function Primitive(
  env: AdvancedEnvironment,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  r: number,
  shape: number,
): number {
  void env;
  void ox;
  void oy;
  void oz;
  void dx;
  void dy;
  void dz;
  void r;
  void shape;
  if (shape == F(2)) {
    const xa = F(F(F(-r) - ox) / Safe(env, dx));
    const xb = F(F(r - ox) / Safe(env, dx));
    const ya = F(F(F(-r) - oy) / Safe(env, dy));
    const yb = F(F(r - oy) / Safe(env, dy));
    const za = F(F(F(-r) - oz) / Safe(env, dz));
    const zb = F(F(r - oz) / Safe(env, dz));
    const entry = MAX(MAX(MIN(xa, xb), MIN(ya, yb)), MIN(za, zb));
    const exit = MIN(MIN(MAX(xa, xb), MAX(ya, yb)), MAX(za, zb));
    if (exit < MAX(F(0), entry)) return F(100);
    return MAX(F(0), entry);
  }
  let a = F(F(F(dx * dx) + F(dy * dy)) + F(dz * dz));
  let b = F(F(2) * F(F(F(ox * dx) + F(oy * dy)) + F(oz * dz)));
  let cc = F(F(F(F(ox * ox) + F(oy * oy)) + F(oz * oz)) - F(r * r));
  if (shape == F(3)) {
    a = F(F(dx * dx) + F(dz * dz));
    b = F(F(2) * F(F(ox * dx) + F(oz * dz)));
    cc = F(F(F(ox * ox) + F(oz * oz)) - F(r * r));
  }
  if (shape == F(4)) {
    a = F(F(F(dx * dx) + F(dz * dz)) - F(F(dy * dy) * F(0.25)));
    b = F(F(2) * F(F(F(ox * dx) + F(oz * dz)) + F(F(F(r - oy) * dy) * F(0.25))));
    cc = F(F(F(ox * ox) + F(oz * oz)) - F(F(F(r - oy) * F(r - oy)) * F(0.25)));
  }
  let shift = F(0);
  if (ABS(a) > F(0.00001)) {
    shift = F(b / F(F(-F(2)) * a));
    const x = F(ox + F(dx * shift));
    const y = F(oy + F(dy * shift));
    const z = F(oz + F(dz * shift));
    b = F(F(2) * F(F(F(x * dx) + F(y * dy)) + F(z * dz)));
    cc = F(F(F(F(x * x) + F(y * y)) + F(z * z)) - F(r * r));
    if (shape == F(3)) {
      b = F(F(2) * F(F(x * dx) + F(z * dz)));
      cc = F(F(F(x * x) + F(z * z)) - F(r * r));
    }
    if (shape == F(4)) {
      b = F(F(2) * F(F(F(x * dx) + F(z * dz)) + F(F(F(r - y) * dy) * F(0.25))));
      cc = F(F(F(x * x) + F(z * z)) - F(F(F(r - y) * F(r - y)) * F(0.25)));
    }
  }
  const disc = F(F(b * b) - F(F(F(4) * a) * cc));
  let result = F(100);
  if (disc >= F(0) && ABS(a) > F(0.00001)) {
    const root = SQRT(disc);
    const first = F(shift + F(F(b + root) / F(F(-F(2)) * a)));
    const second = F(shift + F(F(b - root) / F(F(-F(2)) * a)));
    for (let i = F(0); i < F(2); i++) {
      let t = first;
      if (i == F(1)) t = second;
      if (t >= F(0) && (shape < F(3) || ABS(F(oy + F(dy * t))) <= r)) result = MIN(result, t);
    }
  }
  if (shape >= F(3) && ABS(dy) > F(0.00001)) {
    for (let i = F(0); i < F(2); i++) {
      let cap = F(-r);
      if (i == F(1)) cap = r;
      const t = F(F(cap - oy) / dy);
      const x = F(ox + F(dx * t));
      const z = F(oz + F(dz * t));
      let capRadius = r;
      if (shape == F(4) && i == F(1)) capRadius = F(0);
      if (t >= F(0) && F(F(x * x) + F(z * z)) <= F(capRadius * capRadius)) result = MIN(result, t);
    }
  }
  return result;
}
function FoilDistance(
  env: AdvancedEnvironment,
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
): number {
  void env;
  void x;
  void y;
  void z;
  void u;
  void v;
  const yaw = F(env.P(F(5)) * F(0.0174533));
  const pitch = F(env.P(F(12)) * F(0.0174533));
  const rx = F(F(COS(yaw) * x) - F(SIN(yaw) * z));
  let rz = F(F(SIN(yaw) * x) + F(COS(yaw) * z));
  const ry = F(F(COS(pitch) * y) - F(SIN(pitch) * rz));
  rz = F(F(SIN(pitch) * y) + F(COS(pitch) * rz));
  const radius = env.P(F(4));
  let distance = F(SQRT(F(F(F(rx * rx) + F(ry * ry)) + F(rz * rz))) - radius);
  if (env.P(F(3)) > F(0)) {
    const q = F(SQRT(F(F(rx * rx) + F(rz * rz))) - F(radius * F(0.72)));
    distance = F(SQRT(F(F(q * q) + F(ry * ry))) - F(radius * F(0.22)));
    if (env.P(F(3)) > F(1)) {
      const q2 = F(SQRT(F(F(ry * ry) + F(rz * rz))) - F(radius * F(0.72)));
      distance = MIN(distance, F(SQRT(F(F(q2 * q2) + F(rx * rx))) - F(radius * F(0.22))));
    }
  }
  const phase = env.U(F(4));
  const materialX = F(
    F(F(F(F(COS(env.U(F(22))) * rx) - F(SIN(env.U(F(22))) * ry)) * env.P(F(6))) * env.U(F(2))) /
      F(5),
  );
  const materialY = F(
    F(F(F(F(SIN(env.U(F(22))) * rx) + F(COS(env.U(F(22))) * ry)) * env.P(F(6))) * env.U(F(2))) /
      F(5),
  );
  const folds = F(
    SIN(F(F(materialX * F(8)) + phase)) * SIN(F(F(F(materialY * F(6)) - phase) + env.U(F(7)))),
  );
  const relief = F(F(env.H(u, v) - F(0.5)) * env.P(F(10)));
  return F(distance + F(F(F(F(folds * env.P(F(7))) + relief) * radius) * F(0.065)));
}
function PrimitiveCoverage(
  env: AdvancedEnvironment,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  r: number,
  shape: number,
  pixel: number,
): number {
  void env;
  void ox;
  void oy;
  void oz;
  void dx;
  void dy;
  void dz;
  void r;
  void shape;
  void pixel;
  if (shape == F(2)) return F(1);
  let a = F(F(F(dx * dx) + F(dy * dy)) + F(dz * dz));
  let b = F(F(2) * F(F(F(ox * dx) + F(oy * dy)) + F(oz * dz)));
  if (shape == F(3)) {
    a = F(F(dx * dx) + F(dz * dz));
    b = F(F(2) * F(F(ox * dx) + F(oz * dz)));
  }
  if (shape == F(4)) {
    a = F(F(F(dx * dx) + F(dz * dz)) - F(F(dy * dy) * F(0.25)));
    b = F(F(2) * F(F(F(ox * dx) + F(oz * dz)) + F(F(F(r - oy) * dy) * F(0.25))));
  }
  let t = F(b / F(F(-F(2)) * Safe(env, a)));
  if (shape >= F(3) && ABS(dy) > F(0.00001)) {
    const first = F(F(F(-r) - oy) / dy);
    const last = F(F(r - oy) / dy);
    t = CLAMP(t, MIN(first, last), MAX(first, last));
    if (shape == F(4) && a < F(0)) {
      const x1 = F(ox + F(dx * first));
      const z1 = F(oz + F(dz * first));
      const x2 = F(ox + F(dx * last));
      const z2 = F(oz + F(dz * last));
      if (F(F(F(x1 * x1) + F(z1 * z1)) - F(r * r)) < F(F(x2 * x2) + F(z2 * z2))) t = first;
      else t = last;
    }
  }
  const x = F(ox + F(dx * t));
  const y = F(oy + F(dy * t));
  const z = F(oz + F(dz * t));
  let gap = F(SQRT(F(F(F(x * x) + F(y * y)) + F(z * z))) - r);
  if (shape >= F(3)) gap = F(SQRT(F(F(x * x) + F(z * z))) - r);
  if (shape == F(4)) {
    const radius = F(F(r - y) * F(0.5));
    gap = F(
      F(F(F(x * x) + F(z * z)) - F(radius * radius)) /
        MAX(F(0.00001), SQRT(F(F(F(F(F(4) * x) * x) + F(F(F(4) * z) * z)) + F(radius * radius)))),
    );
  }
  if (shape >= F(3) && ABS(dy) <= F(0.00001)) gap = MAX(gap, F(ABS(oy) - r));
  return CLAMP(F(F(0.5) - F(gap / MAX(F(0.00001), pixel))), F(0), F(1));
}
function Shade0(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  let sx = u;
  let sy = v;
  const lighting = F(1);
  {
    const grid = env.P(F(4));
    const ux = F(F(FLOOR(F(u / grid)) * grid) + F(grid * F(0.5)));
    const uy = F(F(FLOOR(F(v / grid)) * grid) + F(grid * F(0.5)));
    const wx = F(F(SIN(F(F(qy + phase) + F(env.N(qx, qy) * F(6)))) * env.P(F(3))) * F(0.12));
    const wy = F(F(COS(F(F(qx - phase) + seed)) * env.P(F(3))) * F(0.12));
    const height = env.H(F(ux + wx), F(uy + wy));
    const bands = F(F(height * env.P(F(2))) + F(SIN(F(F(qx + qy) + phase)) * env.P(F(3))));
    const wave = SIN(F(F(F(bands * F(6.283185)) + phase) + seed));
    coverage = CLAMP(
      F(F(F(wave - F(F(1) - F(env.P(F(5)) * F(2)))) / MAX(F(0.03), aa)) + F(0.5)),
      F(0),
      F(1),
    );
    tone = height;
    if (env.P(F(1)) > F(0)) tone = F(FLOOR(F(height * env.P(F(2)))) / env.P(F(2)));
    sx = F(ux + wx);
    sy = F(uy + wy);
  }
  {
    const hue = F(env.P(F(6)) * F(0.0174533));

    if (hue != F(0)) {
      const r = F(MIX(Palette(env, tone, F(0)), env.T(sx, sy, F(0)), env.P(F(0))) * lighting);
      const g = F(MIX(Palette(env, tone, F(1)), env.T(sx, sy, F(1)), env.P(F(0))) * lighting);
      const b = F(MIX(Palette(env, tone, F(2)), env.T(sx, sy, F(2)), env.P(F(0))) * lighting);
      for (let ch = F(0); ch < F(3); ch++)
        env.O(ch, MIX(env.U(F(F(28) + ch)), Hue(env, r, g, b, hue, ch), coverage));
      return;
    }
  }
  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade1(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  let sx = u;
  let sy = v;
  const lighting = F(1);
  {
    let flowx = SIN(F(F(F(qy * F(0.7)) + phase) + seed));
    let flowy = COS(F(F(qx * F(0.6)) - phase));
    if (env.U(F(23)) > F(0.5)) {
      flowx = MIX(flowx, env.D(u, v, F(0)), env.U(F(31)));
      flowy = MIX(flowy, env.D(u, v, F(1)), env.U(F(31)));
    }
    const dx = F(flowx * env.P(F(4)));
    const dy = F(flowy * env.P(F(4)));
    coverage = F(0);
    for (let j = F(0); j < F(6); j++) {
      if (j >= env.P(F(6))) break;
      const xx = F(F(qx + F(dx * SIN(F(F(qy + j) + phase)))) + F(j * F(0.37)));
      const yy = F(F(qy + F(dy * COS(F(F(qx - j) + phase)))) + F(j * F(0.61)));
      const cell = FLOOR(xx);
      const row = FLOOR(F(yy * F(0.25)));
      const r = env.R(cell, row, j);
      let width = env.P(F(5));
      if (env.P(F(1)) == F(1)) width = MIN(F(0.8), F(width * F(2.5)));
      const dist = ABS(F(F(xx - FLOOR(xx)) - F(0.5)));
      const line = CLAMP(F(F(F(width - dist) / aa) + F(0.5)), F(0), F(1));
      const along = F(F(yy * F(0.25)) - FLOOR(F(yy * F(0.25))));
      let length = env.P(F(3));
      if (env.P(F(1)) == F(2)) length = F(length * F(0.35));
      let taper = CLAMP(
        F(MIN(along, F(length - along)) / MAX(F(0.01), F(F(length * env.P(F(7))) * F(0.3)))),
        F(0),
        F(1),
      );
      if (env.P(F(7)) == F(0)) taper = F(1);
      if (r < env.P(F(2)) && along < length) coverage = MAX(coverage, F(line * taper));
    }
    sx = F(u - F(F(F(flowx * env.P(F(3))) * env.P(F(4))) * F(0.04)));
    sy = F(v - F(F(F(flowy * env.P(F(3))) * env.P(F(4))) * F(0.04)));
    tone = env.N(F(F(qx * F(0.15)) + F(phase * F(0.1))), F(qy * F(0.15)));
  }
  {
    let hue = F(env.P(F(6)) * F(0.0174533));
    hue = F(env.P(F(8)) * F(0.0174533));
    if (hue != F(0)) {
      const r = F(MIX(Palette(env, tone, F(0)), env.T(sx, sy, F(0)), env.P(F(0))) * lighting);
      const g = F(MIX(Palette(env, tone, F(1)), env.T(sx, sy, F(1)), env.P(F(0))) * lighting);
      const b = F(MIX(Palette(env, tone, F(2)), env.T(sx, sy, F(2)), env.P(F(0))) * lighting);
      for (let ch = F(0); ch < F(3); ch++)
        env.O(ch, MIX(env.U(F(F(28) + ch)), Hue(env, r, g, b, hue, ch), coverage));
      return;
    }
  }
  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade2(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  let sx = u;
  let sy = v;
  let lighting = F(1);
  {
    let rx = bx;
    let ry = by;
    let z = F(Lum(env, u, v) * env.P(F(5)));
    if (env.P(F(2)) > F(0)) {
      const r = env.P(F(3));
      const rr = F(F(F(bx * bx) + F(by * by)) / F(r * r));
      coverage = CLAMP(F(F(F(1) - rr) / MAX(F(0.01), F(env.AA() * F(4)))), F(0), F(1));
      z = SQRT(MAX(F(0), F(F(1) - rr)));
      rx = F(ATAN(F(bx / MAX(F(0.001), r)), z) + F(env.P(F(8)) * F(0.0174533)));
      ry = ATAN(F(by / MAX(F(0.001), r)), z);
      sx = F(F(0.5) + F(rx / F(3.141593)));
      sy = F(F(0.5) + F(ry / F(3.141593)));
      lighting = F(F(0.3) + F(z * F(0.7)));
    }
    const materialX = F(F(COS(angle) * rx) - F(SIN(angle) * ry));
    const materialY = F(F(SIN(angle) * rx) + F(COS(angle) * ry));
    const wave = SIN(
      F(
        F(
          F(
            F(
              F(
                F(F(F(materialY + F(materialX * F(0.35))) + F(z * env.P(F(5)))) * env.P(F(4))) *
                  env.U(F(2)),
              ) / F(5),
            ) * F(3.141593),
          ) + phase,
        ) + seed,
      ),
    );
    const jitter = F(F(env.N(F(F(qx * F(5)) + phase), F(qy * F(5))) - F(0.5)) * env.P(F(7)));
    tone = CLAMP(F(F(F(wave * F(0.5)) + F(0.5)) + jitter), F(0), F(1));
    if (env.P(F(1)) > F(0)) tone = F(FLOOR(F(tone * F(4))) / F(3));
    lighting = F(
      lighting *
        F(
          F(0.3) +
            CLAMP(
              F(F(F(F(0.08) + F(env.P(F(6)) * F(0.32))) - ABS(wave)) / MAX(F(0.04), aa)),
              F(0),
              F(1),
            ),
        ),
    );
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade3(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  let sx = u;
  let sy = v;
  let lighting = F(1);
  {
    let l = Lum(env, u, v);
    let nx = F(0);
    let ny = F(0);
    let nz = F(1);
    if (env.P(F(2)) > F(0)) {
      const yaw = F(env.P(F(8)) * F(0.0174533));
      const pitch = F(env.P(F(9)) * F(0.0174533));
      const rox = F(F(COS(yaw) * bx) - F(SIN(yaw) * F(-F(3))));
      const rz = F(F(SIN(yaw) * bx) + F(COS(yaw) * F(-F(3))));
      const roy = F(F(COS(pitch) * by) - F(SIN(pitch) * rz));
      const roz = F(F(SIN(pitch) * by) + F(COS(pitch) * rz));
      const dx = F(-SIN(yaw));
      let dz = COS(yaw);
      const dy = F(F(-SIN(pitch)) * dz);
      dz = F(COS(pitch) * dz);
      let nearest = F(100);
      coverage = F(0);
      for (let j = F(0); j < F(12); j++) {
        if (j >= env.P(F(4))) break;
        const cx = F(F(F(env.R(j, F(0), F(1)) - F(0.5)) * env.P(F(6))) * env.P(F(13)));
        const cy = F(F(F(env.R(j, F(0), F(2)) - F(0.5)) * env.P(F(6))) * env.P(F(14)));
        const cz = F(F(F(env.R(j, F(0), F(3)) - F(0.5)) * env.P(F(6))) * F(0.5));
        const rot = F(F(F(env.P(F(7)) * F(0.0174533)) + phase) + F(env.R(j, F(0), F(4)) * F(2)));
        const x = F(rox - cx);
        const y = F(roy - cy);
        const z = F(roz - cz);
        const lx = F(F(COS(rot) * x) - F(SIN(rot) * z));
        const lz = F(F(SIN(rot) * x) + F(COS(rot) * z));
        const vx = F(F(COS(rot) * dx) - F(SIN(rot) * dz));
        const vz = F(F(SIN(rot) * dx) + F(COS(rot) * dz));
        let shape = env.P(F(3));
        if (shape == F(0)) shape = F(F(1) + FLOOR(F(env.R(j, F(0), F(5)) * F(4))));
        const size = F(env.P(F(5)) * F(F(0.75) + F(env.R(j, F(0), F(6)) * F(0.5))));
        let t = Primitive(env, lx, y, lz, vx, dy, vz, size, shape);
        const silhouette = PrimitiveCoverage(env, lx, y, lz, vx, dy, vz, size, shape, env.AA());
        if (shape != F(2) && silhouette < F(1) && silhouette > F(0)) {
          const outer = Primitive(env, lx, y, lz, vx, dy, vz, F(size + F(env.AA() * F(2))), shape);
          if (t < F(100)) t = MIX(outer, t, CLAMP(F(F(silhouette - F(0.75)) * F(4)), F(0), F(1)));
          else t = outer;
        }
        if (t < nearest && silhouette > F(0)) {
          nearest = t;
          coverage = silhouette;
          const hx = F(lx + F(vx * t));
          const hy = F(y + F(dy * t));
          const hz = F(lz + F(vz * t));
          nx = F(hx / size);
          ny = F(hy / size);
          nz = F(hz / size);
          if (shape == F(2)) {
            const m = MAX(MAX(ABS(hx), ABS(hy)), ABS(hz));
            nx = F(0);
            ny = F(0);
            nz = F(0);
            if (ABS(hx) >= F(m - F(0.0001))) nx = SIGN(hx);
            else if (ABS(hy) >= F(m - F(0.0001))) ny = SIGN(hy);
            else nz = SIGN(hz);
          }
          if (shape >= F(3)) {
            if (ABS(F(ABS(hy) - size)) < F(0.001)) {
              nx = F(0);
              nz = F(0);
              ny = SIGN(hy);
            } else {
              ny = F(0);
              if (shape == F(4)) ny = F(0.5);
            }
          }
          const normalX = F(F(COS(rot) * nx) + F(SIN(rot) * nz));
          const normalZ = F(F(F(-SIN(rot)) * nx) + F(COS(rot) * nz));
          nx = normalX;
          nz = normalZ;
          sx = CLAMP(F(F(0.5) + F(hx / F(size * F(3)))), F(0), F(1));
          sy = CLAMP(F(F(0.5) + F(hy / F(size * F(3)))), F(0), F(1));
          l = F(F(0.5) + F(hy / F(size * F(4))));
        }
      }
    } else {
      nx = F(F(Lum(env, F(u + F(0.005)), v) - Lum(env, F(u - F(0.005)), v)) * F(10));
      ny = F(F(Lum(env, u, F(v + F(0.005))) - Lum(env, u, F(v - F(0.005)))) * F(10));
    }
    const light = F(env.P(F(12)) * F(0.0174533));
    lighting = MIX(
      F(1),
      CLAMP(
        F(
          F(F(F(0.45) + F(F(nx * COS(light)) * F(0.35))) - F(F(ny * SIN(light)) * F(0.35))) +
            F(ABS(nz) * F(0.3)),
        ),
        F(0.1),
        F(1),
      ),
      env.P(F(11)),
    );
    let hatch = ABS(SIN(F(F(F(qx * F(6.283185)) + phase) + seed)));
    if (env.P(F(1)) > F(0)) hatch = MIN(hatch, ABS(SIN(F(F(qy * F(6.283185)) - phase))));
    if (env.P(F(1)) > F(1)) hatch = SQRT(F(hatch * ABS(SIN(F(F(qy * F(6.283185)) + phase)))));
    const ink = CLAMP(
      F(
        F(F(F(env.P(F(10)) + F(F(F(1) - F(l * lighting)) * F(0.35))) - hatch) / MAX(F(0.02), aa)) +
          F(0.5),
      ),
      F(0),
      F(1),
    );
    tone = F(F(1) - ink);
    lighting = F(lighting * F(F(0.35) + F(tone * F(0.65))));
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade4(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  let sx = u;
  let sy = v;
  const lighting = F(1);
  {
    const fx = F(env.P(F(20)) + F(F(rotatedX * F(3)) / env.P(F(7))));
    const fy = F(env.P(F(21)) + F(F(rotatedY * F(3)) / env.P(F(7))));
    if (env.P(F(2)) > F(0)) {
      const ox = F(F(env.P(F(54)) * bx) + F(env.P(F(55)) * F(3)));
      const zz = F(F(env.P(F(55)) * bx) - F(env.P(F(54)) * F(3)));
      const oy = F(F(env.P(F(56)) * by) - F(env.P(F(57)) * zz));
      const oz = F(F(env.P(F(57)) * by) + F(env.P(F(56)) * zz));
      const dx = F(-env.P(F(55)));
      const dy = F(F(-env.P(F(57))) * env.P(F(54)));
      const dz = F(env.P(F(56)) * env.P(F(54)));
      let red = F(0);
      let green = F(0);
      let blue = F(0);
      coverage = F(0);
      for (let j = F(0); j < F(16); j++) {
        if (j >= env.P(F(3)) || coverage > F(0.9999)) break;
        const z = F(F(j - F(F(env.P(F(3)) - F(1)) * F(0.5))) * env.P(F(5)));
        const start = F(F(F(z - F(env.P(F(4)) * F(0.5))) - oz) / Safe(env, dz));
        const end = F(F(F(z + F(env.P(F(4)) * F(0.5))) - oz) / Safe(env, dz));
        let slabRed = F(0);
        let slabGreen = F(0);
        let slabBlue = F(0);
        let slabAlpha = F(0);
        for (let k = F(0); k < F(4); k++) {
          const t = MIX(start, end, F(k / F(3)));
          const x = F(ox + F(dx * t));
          const y = F(oy + F(dy * t));
          const box = CLAMP(
            F(F(F(F(0.56) - MAX(ABS(x), ABS(y))) / MAX(F(0.00001), env.AA())) + F(0.5)),
            F(0),
            F(1),
          );
          if (t < F(0) || box == F(0)) continue;
          const mx = F(
            env.P(F(F(20) + F(j * F(2)))) +
              F(F(F(F(env.P(F(52)) * x) - F(env.P(F(53)) * y)) * F(3)) / env.P(F(7))),
          );
          const my = F(
            env.P(F(F(21) + F(j * F(2)))) +
              F(F(F(F(env.P(F(53)) * x) + F(env.P(F(52)) * y)) * F(3)) / env.P(F(7))),
          );
          const m = Mandel(env, mx, my, env.P(F(10)));
          const weight = F(
            F(CLAMP(F(F(F(m - env.P(F(14))) + F(0.1)) / F(0.1)), F(0), F(1)) * box) * F(0.25),
          );
          const escape = F(F(m + F(j * F(0.07))) + F(phase * F(0.03)));
          const band = SIN(F(F(F(F(F(escape * F(25)) * env.U(F(2))) / F(2)) + phase) + seed));
          const tx = F(F(F(0.5) + x) + F(F(band * env.P(F(15))) * F(0.06)));
          const ty = F(
            F(F(0.5) + y) + F(F(COS(F(F(escape * F(31)) - phase)) * env.P(F(15))) * F(0.06)),
          );
          const paletteTone = CLAMP(F(F(0.5) + F(band * F(0.5))), F(0), F(1));
          const light = MIX(
            F(1),
            CLAMP(
              F(F(1) - F(F(z + F(F(F(env.P(F(3)) - F(1)) * env.P(F(5))) * F(0.5))) * F(0.9))),
              F(0.25),
              F(1),
            ),
            env.P(F(13)),
          );
          for (let ch = F(0); ch < F(3); ch++) {
            let value = env.T(tx, ty, ch);
            if (env.P(F(1)) == F(0)) value = MIX(Palette(env, paletteTone, ch), value, env.P(F(0)));
            value = F(F(value * light) * weight);
            if (ch == F(0)) slabRed = F(slabRed + value);
            else if (ch == F(1)) slabGreen = F(slabGreen + value);
            else slabBlue = F(slabBlue + value);
          }
          slabAlpha = F(slabAlpha + weight);
        }
        red = F(red + F(slabRed * F(F(1) - coverage)));
        green = F(green + F(slabGreen * F(F(1) - coverage)));
        blue = F(blue + F(slabBlue * F(F(1) - coverage)));
        coverage = F(coverage + F(slabAlpha * F(F(1) - coverage)));
      }
      env.O(F(0), F(F(env.U(F(28)) * F(F(1) - coverage)) + red));
      env.O(F(1), F(F(env.U(F(29)) * F(F(1) - coverage)) + green));
      env.O(F(2), F(F(env.U(F(30)) * F(F(1) - coverage)) + blue));
      return;
    }
    tone = Mandel(env, fx, fy, env.P(F(10)));
    coverage = CLAMP(F(F(F(tone - env.P(F(14))) + F(0.1)) / F(0.1)), F(0), F(1));
    const fractalBand = SIN(F(F(F(F(F(tone * F(25)) * env.U(F(2))) / F(2)) + phase) + seed));
    sx = F(sx + F(F(fractalBand * env.P(F(15))) * F(0.06)));
    sy = F(sy + F(F(COS(F(F(tone * F(31)) - phase)) * env.P(F(15))) * F(0.06)));
    tone = CLAMP(F(F(0.5) + F(fractalBand * F(0.5))), F(0), F(1));
    if (env.P(F(1)) > F(0)) {
      for (let ch = F(0); ch < F(3); ch++)
        env.O(ch, MIX(env.U(F(F(28) + ch)), F(env.T(sx, sy, ch) * lighting), coverage));
      return;
    }
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade5(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  const sx = u;
  const sy = v;
  let lighting = F(1);
  {
    const cellx = FLOOR(qx);
    const celly = FLOOR(qy);
    let energy = F(0);
    const reach = env.P(F(3));
    const width = env.P(F(7));
    const glow = env.P(F(6));
    const jitter = env.P(F(4));

    for (let yy = F(-F(1)); yy <= F(1); yy++) {
      for (let xx = F(-F(1)); xx <= F(1); xx++) {
        const cx = F(cellx + xx);
        const cy = F(celly + yy);
        const ax = F(
          F(cx + F(0.5)) +
            F(F(SIN(F(phase + F(env.R(cx, cy, F(1)) * F(6.283185)))) * jitter) * F(0.28)),
        );
        const ay = F(
          F(cy + F(0.5)) +
            F(F(COS(F(phase + F(env.R(cx, cy, F(2)) * F(6.283185)))) * jitter) * F(0.28)),
        );
        const gate = env.P(F(2));
        const core = EXP(
          F(F(-F(F(ax * ax) + F(ay * ay))) / F(F(F(env.U(F(2)) * env.U(F(2))) * F(0.1)) + F(0.1))),
        );

        if (env.R(cx, cy, F(0)) > gate) continue;
        if (
          F(5) == F(5) &&
          env.P(F(1)) == F(0) &&
          Lum(
            env,
            F(env.U(F(5)) + F(F(ax / env.U(F(2))) / env.U(F(0)))),
            F(env.U(F(6)) + F(F(ay / env.U(F(2))) / env.U(F(1)))),
          ) < F(0.15)
        )
          continue;
        const nodeDistance = SQRT(F(F(F(qx - ax) * F(qx - ax)) + F(F(qy - ay) * F(qy - ay))));
        energy = MAX(
          energy,
          EXP(F(F(F(-nodeDistance) * nodeDistance) / MAX(F(0.0001), F(F(width * width) * F(6))))),
        );
        for (let branch = F(0); branch < F(4); branch++) {
          let nx = F(cx + F(1));
          let ny = cy;
          if (branch == F(1)) {
            nx = cx;
            ny = F(cy + F(1));
          }
          if (branch == F(2)) {
            nx = F(cx + F(1));
            ny = F(cy + F(1));
          }
          if (branch == F(3)) {
            nx = F(cx - F(1));
            ny = F(cy + F(1));
          }
          if (env.R(nx, ny, F(0)) > gate) continue;
          const ex = F(
            F(nx + F(0.5)) +
              F(F(SIN(F(phase + F(env.R(nx, ny, F(1)) * F(6.283185)))) * jitter) * F(0.28)),
          );
          const ey = F(
            F(ny + F(0.5)) +
              F(F(COS(F(phase + F(env.R(nx, ny, F(2)) * F(6.283185)))) * jitter) * F(0.28)),
          );
          const len = SQRT(F(F(F(ex - ax) * F(ex - ax)) + F(F(ey - ay) * F(ey - ay))));
          if (len > F(reach * F(1.6))) continue;
          let distance = F(100);
          {
            let lastx = ax;
            let lasty = ay;
            for (let segment = F(1); segment <= F(4); segment++) {
              const t = F(segment / F(4));
              const bend = F(
                F(
                  F(
                    SIN(F(t * F(3.141593))) *
                      SIN(F(F(phase * F(2)) + F(env.R(cx, cy, F(segment + F(3))) * F(12)))),
                  ) * jitter,
                ) * F(0.3),
              );
              const endx = F(MIX(ax, ex, t) + bend);
              const endy = F(MIX(ay, ey, t) - bend);
              distance = MIN(distance, Segment(env, qx, qy, lastx, lasty, endx, endy));
              lastx = endx;
              lasty = endy;
            }
          }
          let light = F(
            EXP(F(F(F(-distance) * distance) / MAX(F(0.00001), F(width * width)))) +
              F(
                F(EXP(F(F(F(-distance) * distance) / F(F(0.008) + F(glow * F(0.08))))) * glow) *
                  F(0.25),
              ),
          );
          light = F(
            F(light * env.P(F(5))) *
              F(
                F(0.65) +
                  F(
                    F(0.35) *
                      SIN(
                        F(
                          F(F(F(phase * F(2)) + F(qx * F(4))) + F(qy * F(3))) +
                            F(env.R(cx, cy, F(7)) * F(6)),
                        ),
                      ),
                  ),
              ),
          );
          energy = MAX(energy, light);
        }
      }
    }
    coverage = CLAMP(energy, F(0), F(1));
    tone = env.N(F(F(qx * F(0.2)) + F(phase * F(0.1))), F(qy * F(0.2)));
    lighting = F(F(0.7) + F(coverage * F(0.6)));
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade6(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  const sx = u;
  const sy = v;
  let lighting = F(1);
  {
    const xx = F(qx + F(F(SIN(F(F(F(qy * F(0.7)) + phase) + seed)) * env.P(F(3))) * F(0.75)));
    const column = FLOOR(xx);
    const yy = F(F(qy / env.P(F(2))) + F(F(column * env.P(F(6))) * F(0.5)));
    const row = FLOOR(yy);
    const dx = F(F(xx - column) - F(0.5));
    const dy = F(F(yy - row) - F(0.5));
    let distance = SQRT(F(F(dx * dx) + F(dy * dy)));
    if (env.P(F(1)) == F(2)) distance = MAX(ABS(dx), ABS(dy));
    const radius = env.P(F(5));
    let extent = radius;
    if (env.P(F(1)) == F(0)) {
      distance = ABS(F(distance - F(radius * F(0.75))));
      extent = F(radius * env.P(F(7)));
    }
    coverage = CLAMP(F(F(F(extent - distance) / aa) + F(0.5)), F(0), F(1));
    if (env.R(column, row, F(1)) < env.P(F(4))) coverage = F(0);
    tone = F(
      F(F(env.R(column, row, F(2)) * F(0.5)) + F(SIN(F(phase + F(column * F(0.35)))) * F(0.25))) +
        F(0.25),
    );
    if (env.P(F(1)) == F(1))
      lighting = F(
        F(0.4) +
          F(SQRT(MAX(F(0), F(F(1) - F(F(F(dx * dx) + F(dy * dy)) / F(radius * radius))))) * F(0.8)),
      );
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade7(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  const sx = u;
  const sy = v;
  let lighting = F(1);
  {
    const r = F(SQRT(F(F(qx * qx) + F(qy * qy))) / F(3));
    const theta = ATAN(qy, qx);
    let brightest = F(0);
    coverage = F(0);
    for (let j = F(0); j < F(12); j++) {
      if (j >= env.P(F(3))) break;
      const center = F(F(F(j + F(1)) / F(env.P(F(3)) + F(1))) * F(0.45));
      const half = F(F(F(0.5) / F(env.P(F(3)) + F(1))) * F(F(0.6) + env.P(F(5))));
      const a = F(
        F(
          F(theta + F(phase * F(F(0.1) + F(j * F(0.025))))) + F(F(j * env.P(F(7))) * F(0.0174533)),
        ) + F(seed * F(0.05)),
      );
      const sector = F(F(a * env.P(F(2))) / F(6.283185));
      const cell = FLOOR(sector);
      const local = F(sector - cell);
      const radial = F(ABS(F(r - center)) / MAX(F(0.001), half));
      let triangular = F(radial + F(ABS(F(local - F(0.5))) * F(1.4)));
      if (env.P(F(1)) > F(0)) triangular = F(radial + ABS(F(local - F(0.5))));
      const fill = CLAMP(
        F(F(F(F(1) - triangular) / MAX(F(0.01), F(env.AA() * F(10)))) + F(0.5)),
        F(0),
        F(1),
      );
      const facet = FLOOR(F(local * env.P(F(4))));
      const edge = MIN(
        ABS(F(F(1) - triangular)),
        ABS(F(F(local * env.P(F(4))) - FLOOR(F(local * env.P(F(4)))))),
      );
      const ink = CLAMP(
        F(F(F(F(env.P(F(6)) * F(0.15)) - edge) / MAX(F(0.005), F(env.AA() * F(5)))) + F(0.5)),
        F(0),
        F(1),
      );
      if (fill > brightest) {
        brightest = fill;
        coverage = fill;
        tone = F(F(env.R(cell, j, F(2)) * F(0.45)) + F(F(facet / env.P(F(4))) * F(0.55)));
        lighting = F(F(1) - F(ink * F(0.65)));
      }
    }
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade8(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  const sx = u;
  const sy = v;
  let lighting = F(1);
  {
    const cellx = FLOOR(qx);
    const celly = FLOOR(qy);
    let energy = F(0);
    const reach = env.P(F(3));
    let width = env.P(F(7));
    let glow = env.P(F(6));
    let jitter = env.P(F(4));
    {
      width = env.P(F(5));
      glow = env.P(F(6));
      jitter = env.P(F(7));
    }
    for (let yy = F(-F(1)); yy <= F(1); yy++) {
      for (let xx = F(-F(1)); xx <= F(1); xx++) {
        const cx = F(cellx + xx);
        const cy = F(celly + yy);
        const ax = F(
          F(cx + F(0.5)) +
            F(F(SIN(F(phase + F(env.R(cx, cy, F(1)) * F(6.283185)))) * jitter) * F(0.28)),
        );
        const ay = F(
          F(cy + F(0.5)) +
            F(F(COS(F(phase + F(env.R(cx, cy, F(2)) * F(6.283185)))) * jitter) * F(0.28)),
        );
        let gate = env.P(F(2));
        const core = EXP(
          F(F(-F(F(ax * ax) + F(ay * ay))) / F(F(F(env.U(F(2)) * env.U(F(2))) * F(0.1)) + F(0.1))),
        );
        if (F(8) == F(8) && env.P(F(1)) == F(0)) gate = F(gate * MIX(F(1), core, env.P(F(4))));
        if (env.R(cx, cy, F(0)) > gate) continue;

        const nodeDistance = SQRT(F(F(F(qx - ax) * F(qx - ax)) + F(F(qy - ay) * F(qy - ay))));
        energy = MAX(
          energy,
          EXP(F(F(F(-nodeDistance) * nodeDistance) / MAX(F(0.0001), F(F(width * width) * F(6))))),
        );
        for (let branch = F(0); branch < F(4); branch++) {
          let nx = F(cx + F(1));
          let ny = cy;
          if (branch == F(1)) {
            nx = cx;
            ny = F(cy + F(1));
          }
          if (branch == F(2)) {
            nx = F(cx + F(1));
            ny = F(cy + F(1));
          }
          if (branch == F(3)) {
            nx = F(cx - F(1));
            ny = F(cy + F(1));
          }
          if (env.R(nx, ny, F(0)) > gate) continue;
          const ex = F(
            F(nx + F(0.5)) +
              F(F(SIN(F(phase + F(env.R(nx, ny, F(1)) * F(6.283185)))) * jitter) * F(0.28)),
          );
          const ey = F(
            F(ny + F(0.5)) +
              F(F(COS(F(phase + F(env.R(nx, ny, F(2)) * F(6.283185)))) * jitter) * F(0.28)),
          );
          const len = SQRT(F(F(F(ex - ax) * F(ex - ax)) + F(F(ey - ay) * F(ey - ay))));
          if (len > F(reach * F(1.6))) continue;
          let distance = F(100);
          distance = Segment(env, qx, qy, ax, ay, ex, ey);
          const light = F(
            EXP(F(F(F(-distance) * distance) / MAX(F(0.00001), F(width * width)))) +
              F(
                F(EXP(F(F(F(-distance) * distance) / F(F(0.008) + F(glow * F(0.08))))) * glow) *
                  F(0.25),
              ),
          );

          energy = MAX(energy, light);
        }
      }
    }
    coverage = CLAMP(energy, F(0), F(1));
    tone = env.N(F(F(qx * F(0.2)) + F(phase * F(0.1))), F(qy * F(0.2)));
    lighting = F(F(0.7) + F(coverage * F(0.6)));
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade9(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  let sx = u;
  let sy = v;
  let lighting = F(1);
  {
    let normalx = F(0);
    let normaly = F(0);
    let normalz = F(1);
    if (env.P(F(2)) > F(0)) {
      let t = F(1);
      let nearest = F(100);
      let closest = F(1);
      for (let j = F(0); j < F(56); j++) {
        const z = F(F(-F(1.4)) + t);
        const d = FoilDistance(env, bx, by, z, u, v);
        if (d < nearest) {
          nearest = d;
          closest = t;
        }
        t = F(t + MAX(F(0), F(d * F(0.65))));
        if (t > F(2.8)) break;
      }
      coverage = CLAMP(F(F(F(0.002) - nearest) / F(0.001)), F(0), F(1));
      if (coverage > F(0)) {
        const z = F(F(-F(1.4)) + closest);
        const e = F(0.003);
        normalx = F(
          FoilDistance(env, F(bx + e), by, z, u, v) - FoilDistance(env, F(bx - e), by, z, u, v),
        );
        normaly = F(
          FoilDistance(env, bx, F(by + e), z, u, v) - FoilDistance(env, bx, F(by - e), z, u, v),
        );
        normalz = F(
          FoilDistance(env, bx, by, F(z + e), u, v) - FoilDistance(env, bx, by, F(z - e), u, v),
        );
        const norm = MAX(
          F(0.0001),
          SQRT(F(F(F(normalx * normalx) + F(normaly * normaly)) + F(normalz * normalz))),
        );
        normalx = F(normalx / norm);
        normaly = F(normaly / norm);
        normalz = F(normalz / norm);
        sx = CLAMP(F(F(0.5) + F(normalx * F(0.5))), F(0), F(1));
        sy = CLAMP(F(F(0.5) + F(normaly * F(0.5))), F(0), F(1));
      }
    } else {
      const eps = F(0.004);
      const foldx = F(F(COS(F(F(F(qx * env.P(F(6))) + phase) + seed)) * env.P(F(7))) * F(1.8));
      const foldy = F(F(SIN(F(F(qy * env.P(F(6))) - phase)) * env.P(F(7))) * F(1.8));
      normalx = F(
        foldx + F(F(F(env.H(F(u + eps), v) - env.H(F(u - eps), v)) * env.P(F(10))) * F(30)),
      );
      normaly = F(
        foldy + F(F(F(env.H(u, F(v + eps)) - env.H(u, F(v - eps))) * env.P(F(10))) * F(30)),
      );
      const norm = SQRT(F(F(F(normalx * normalx) + F(normaly * normaly)) + F(1)));
      normalx = F(normalx / norm);
      normaly = F(normaly / norm);
      normalz = F(F(1) / norm);
    }
    const light = F(env.P(F(11)) * F(0.0174533));
    const reflection = F(
      F(F(normalx * COS(light)) - F(normaly * SIN(light))) + F(normalz * F(0.5)),
    );
    let sharpness = MIX(F(14), F(1), env.P(F(8)));
    if (env.P(F(1)) > F(0)) sharpness = F(sharpness * F(1.8));
    const highlight = POW(CLAMP(F(F(reflection * F(0.5)) + F(0.5)), F(0), F(1)), sharpness);
    tone = CLAMP(
      F(
        F(F(F(0.5) + F(normalx * F(0.3))) + F(normaly * F(0.2))) +
          F(SIN(F(phase + F(reflection * F(4)))) * F(0.1)),
      ),
      F(0),
      F(1),
    );
    lighting = MIX(
      F(F(0.65) + F(normalz * F(0.25))),
      F(F(F(0.15) + F(highlight * F(1.8))) + F(ABS(SIN(F(F(reflection * F(5)) + phase))) * F(0.2))),
      env.P(F(9)),
    );
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade10(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  const tone = F(0);
  const coverage = F(1);
  const sx = u;
  const sy = v;
  const lighting = F(1);
  {
    const size = F(env.P(F(2)) * env.U(F(2)));
    const nx = F(
      qx + F(F(F(env.N(F(F(qx * F(3)) + phase), F(qy * F(3))) - F(0.5)) * env.P(F(5))) * size),
    );
    const ny = F(
      qy + F(F(F(env.N(F(qx * F(3)), F(F(qy * F(3)) - phase)) - F(0.5)) * env.P(F(5))) * size),
    );
    const cx = FLOOR(F(nx / size));
    const cy = FLOOR(F(ny / size));
    const dropout = env.R(cx, cy, F(0)) < env.P(F(6));
    let erosion = F(1);
    if (env.P(F(1)) > F(1))
      erosion = CLAMP(
        F(F(env.N(F(F(qx * F(12)) + phase), F(qy * F(12))) - F(env.P(F(5)) * F(0.65))) * F(5)),
        F(0),
        F(1),
      );
    const travelx = F(F(F(env.R(cx, cy, F(1)) - F(0.5)) * env.P(F(7))) * F(0.25));
    const travely = F(F(F(env.R(cx, cy, F(2)) - F(0.5)) * env.P(F(7))) * F(0.25));
    const sx = F(u + travelx);
    const sy = F(v + travely);
    const rot = F(env.P(F(8)) * F(0.0174533));
    const stripe = SIN(F(F(F(F(qx * COS(rot)) + F(qy * SIN(rot))) * F(30)) + phase));
    const striped = CLAMP(
      F(F(stripe - F(F(1) - F(env.P(F(4)) * F(2)))) / MAX(aa, F(0.03))),
      F(0),
      F(1),
    );
    for (let ch = F(0); ch < F(3); ch++) {
      const value = env.T(sx, sy, ch);
      const quantized = F(FLOOR(F(value * env.P(F(3)))) / MAX(F(1), F(env.P(F(3)) - F(1))));
      const ink = F(
        MIX(
          Palette(env, F(quantized + F(env.R(cx, cy, F(3)) * F(0.1))), ch),
          quantized,
          env.P(F(0)),
        ) * F(F(0.55) + F(striped * F(0.45))),
      );
      let coverage = erosion;
      if (dropout) coverage = F(0);
      env.O(ch, MIX(env.U(F(F(28) + ch)), ink, coverage));
    }
    return;
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
function Shade11(env: AdvancedEnvironment, u: number, v: number, px: number, py: number): void {
  void u;
  void v;
  void px;
  void py;
  const phase = env.U(F(4));
  const seed = env.U(F(7));
  const bx = F(F(u - env.U(F(5))) * env.U(F(0)));
  const by = F(F(v - env.U(F(6))) * env.U(F(1)));
  const angle = env.U(F(22));
  const rotatedX = F(F(env.P(F(52)) * bx) - F(env.P(F(53)) * by));
  const rotatedY = F(F(env.P(F(53)) * bx) + F(env.P(F(52)) * by));
  const qx = F(rotatedX * env.U(F(2)));
  const qy = F(rotatedY * env.U(F(2)));
  const aa = MAX(F(0.001), F(env.AA() * env.U(F(2))));
  let tone = F(0);
  let coverage = F(1);
  const sx = u;
  const sy = v;
  let lighting = F(1);
  {
    const distance = SQRT(F(F(bx * bx) + F(by * by)));
    const theta = ATAN(qy, qx);
    const half = F(F(env.P(F(2)) * F(0.0174533)) * F(0.5));
    const fan = CLAMP(F(F(half - ABS(theta)) / MAX(aa, F(0.005))), F(0), F(1));
    const beam = F(
      F(0.5) + F(F(0.5) * COS(F(F(F(theta * MAX(F(2), env.U(F(20)))) + phase) + seed))),
    );
    const grating = F(
      F(0.6) + F(F(0.4) * SIN(F(F(F(distance * env.P(F(4))) * F(6.283185)) + phase))),
    );
    const reach = CLAMP(F(F(1) - F(distance / env.P(F(3)))), F(0), F(1));
    coverage = F(
      F(
        F(fan * reach) *
          CLAMP(F(F(beam - env.U(F(10))) / MAX(F(0.01), F(F(1) - env.U(F(10))))), F(0), F(1)),
      ) * F(F(0.5) + F(grating * F(0.5))),
    );
    tone = CLAMP(
      F(F(F(F(theta / MAX(F(0.01), half)) * F(0.5)) + F(0.5)) + F(grating * F(0.15))),
      F(0),
      F(1),
    );
    lighting = F(1.2);
  }

  for (let ch = F(0); ch < F(3); ch++) {
    const material = F(MIX(Palette(env, tone, ch), env.T(sx, sy, ch), env.P(F(0))) * lighting);
    env.O(ch, MIX(env.U(F(F(28) + ch)), material, coverage));
  }
}
export const ADVANCED_CPU_MATERIALS = [
  Shade0,
  Shade1,
  Shade2,
  Shade3,
  Shade4,
  Shade5,
  Shade6,
  Shade7,
  Shade8,
  Shade9,
  Shade10,
  Shade11,
] as const;
