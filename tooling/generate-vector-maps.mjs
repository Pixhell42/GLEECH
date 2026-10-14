import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const sharp = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('sharp');
const directory = new URL('../apps/desktop/resources/vector-maps/', import.meta.url);
await mkdir(directory, { recursive: true });
const clamp = (v) => Math.max(-1, Math.min(1, v));
// Match Motion Transfer's signed 8-bit decoding, with byte 128 exactly neutral.
const encode = (v) => Math.round(128 + clamp(v) * (v >= 0 ? 127 : 128));
const random = (x, y, lane = 0) => {
  let z =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(lane | 0, 1442695041) ^
    38129;
  z = Math.imul(z ^ (z >>> 13), 1274126177);
  return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
};
const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
const mix = (a, b, t) => a + (b - a) * t;
function noise(x, y, lane = 0) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = fade(x - ix),
    fy = fade(y - iy);
  return mix(
    mix(random(ix, iy, lane), random(ix + 1, iy, lane), fx),
    mix(random(ix, iy + 1, lane), random(ix + 1, iy + 1, lane), fx),
    fy,
  );
}
const eddies = Array.from({ length: 12 }, (_, i) => ({
  x: random(i, 0, 11) * 2 - 1,
  y: random(i, 0, 12) * 2 - 1,
  radius: 0.18 + random(i, 0, 13) * 0.35,
  spin: random(i, 0, 14) > 0.5 ? 1 : -1,
}));
const maps = [
  [
    'horizontal-flow',
    'Horizontal Flow',
    'Flow',
    'Uniform rightward drift; a simple direction and travel test.',
    () => [0.75, 0],
  ],
  [
    'diagonal-flow',
    'Diagonal Flow',
    'Flow',
    'Uniform down-right drift; rotate or invert for other directions.',
    () => [0.6, 0.6],
  ],
  [
    'radial-outflow',
    'Radial Outflow',
    'Flow',
    'Move outward from the center with distance-scaled strength.',
    (x, y) => [x * 0.75, y * 0.75],
  ],
  [
    'radial-inflow',
    'Radial Inflow',
    'Flow',
    'Pull inward toward the center with distance-scaled strength.',
    (x, y) => [-x * 0.75, -y * 0.75],
  ],
  [
    'clockwise-vortex',
    'Clockwise Vortex',
    'Swirl',
    'Clockwise circular flow, calm at the center and stronger toward the edges.',
    (x, y) => [-y * 0.75, x * 0.75],
  ],
  [
    'counterclockwise-vortex',
    'Counterclockwise Vortex',
    'Swirl',
    'Counterclockwise circular flow with a still center.',
    (x, y) => [y * 0.75, -x * 0.75],
  ],
  [
    'inward-spiral',
    'Inward Spiral',
    'Swirl',
    'Clockwise rotation combined with an inward pull.',
    (x, y) => [(-x - y) * 0.45, (x - y) * 0.45],
  ],
  [
    'outward-spiral',
    'Outward Spiral',
    'Swirl',
    'Clockwise rotation combined with an outward push.',
    (x, y) => [(x - y) * 0.45, (x + y) * 0.45],
  ],
  [
    'horizontal-shear',
    'Horizontal Shear',
    'Geometry',
    'Opposing horizontal travel above and below the center.',
    (_x, y) => [y * 0.9, 0],
  ],
  [
    'vertical-shear',
    'Vertical Shear',
    'Geometry',
    'Opposing vertical travel left and right of the center.',
    (x) => [0, x * 0.9],
  ],
  [
    'saddle-flow',
    'Saddle Flow',
    'Geometry',
    'Expand horizontally while contracting vertically.',
    (x, y) => [x * 0.9, -y * 0.9],
  ],
  [
    'wave-flow',
    'Wave Flow',
    'Wave',
    'Alternating horizontal waves with a smaller vertical ripple.',
    (x, y) => [Math.sin(y * Math.PI * 3) * 0.85, Math.sin(x * Math.PI * 2) * 0.25],
  ],
  [
    'radial-ripples',
    'Radial Ripples',
    'Wave',
    'Concentric rings alternating inward and outward motion.',
    (x, y) => {
      const r = Math.hypot(x, y),
        strength = r === 0 ? 0 : (Math.sin(r * Math.PI * 5) * 0.85) / r;
      return [x * strength, y * strength];
    },
  ],
  [
    'checker-drift',
    'Checker Drift',
    'Geometry',
    'Hard checkerboard cells move in alternating diagonal directions.',
    (x, y) => {
      const sign = (Math.floor((x + 1) * 4) + Math.floor((y + 1) * 4)) % 2 ? 1 : -1;
      return [sign * 0.65, sign * 0.4];
    },
  ],
  [
    'tiled-vortices',
    'Tiled Vortices',
    'Swirl',
    'An array of smooth alternating eddies, with still points between cells.',
    (x, y) => [
      Math.sin(y * Math.PI * 3) * Math.cos(x * Math.PI * 3) * 0.8,
      -Math.sin(x * Math.PI * 3) * Math.cos(y * Math.PI * 3) * 0.8,
    ],
  ],
  [
    'soft-turbulence',
    'Soft Turbulence',
    'Organic',
    'Smooth independent value-noise vectors; broad cloud-like drifting.',
    (x, y) => [
      (noise(x * 3 + 17, y * 3 + 29, 1) - 0.5) * 1.8,
      (noise(x * 3 + 17, y * 3 + 29, 2) - 0.5) * 1.8,
    ],
  ],
  [
    'curl-flow',
    'Curl Flow',
    'Organic',
    'Rotated gradients of a smooth noise potential; curved circulation.',
    (x, y) => {
      const u = x * 3 + 17,
        v = y * 3 + 29,
        step = 0.015;
      return [
        ((noise(u, v + step, 4) - noise(u, v - step, 4)) / (2 * step)) * 0.7,
        (-(noise(u + step, v, 4) - noise(u - step, v, 4)) / (2 * step)) * 0.7,
      ];
    },
  ],
  [
    'layered-eddies',
    'Layered Eddies',
    'Organic',
    'Overlapping seeded vortex structures with varied scale and spin.',
    (x, y) => {
      let vx = 0,
        vy = 0;
      for (const e of eddies) {
        const dx = x - e.x,
          dy = y - e.y,
          weight = (Math.exp(-(dx * dx + dy * dy) / (e.radius * e.radius)) * e.spin) / e.radius;
        vx -= dy * weight;
        vy += dx * weight;
      }
      return [Math.tanh(vx), Math.tanh(vy)];
    },
  ],
  [
    'cellular-drift',
    'Cellular Drift',
    'Broken',
    'Nearest seeded cells each carry a fixed travel direction and distance.',
    (x, y) => {
      const u = (x + 1) * 4,
        v = (y + 1) * 4,
        ix = Math.floor(u),
        iy = Math.floor(v);
      let best = Infinity,
        vx = 0,
        vy = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx,
            cy = iy + dy,
            d = (u - cx - random(cx, cy, 21)) ** 2 + (v - cy - random(cx, cy, 22)) ** 2;
          if (d < best) {
            best = d;
            const a = random(cx, cy, 23) * Math.PI * 2,
              strength = 0.25 + random(cx, cy, 24) * 0.65;
            vx = Math.cos(a) * strength;
            vy = Math.sin(a) * strength;
          }
        }
      return [vx, vy];
    },
  ],
  [
    'broken-blocks',
    'Broken Blocks',
    'Broken',
    'Coarse broken bands and blocks with independent seeded vectors.',
    (x, y) => {
      const row = Math.floor((y + 1) * 7),
        col = Math.floor((x + 1) * 5 + random(row, 0, 31));
      return [(random(col, row, 32) * 2 - 1) * 0.95, (random(col, row, 33) * 2 - 1) * 0.65];
    },
  ],
];
const unit = (x, y) => {
  const r = Math.hypot(x, y);
  return r < 1e-9 ? [0, 0] : [x / r, y / r];
};
const cell = (x, y) => {
  const u = (x + 1) * 3,
    v = (y + 1) * 3,
    ix = Math.floor(u),
    iy = Math.floor(v);
  let best = Infinity,
    dx = 0,
    dy = 0;
  for (let yy = -1; yy <= 1; yy++)
    for (let xx = -1; xx <= 1; xx++) {
      const a = ix + xx + random(ix + xx, iy + yy, 71) - u,
        b = iy + yy + random(ix + xx, iy + yy, 72) - v,
        d = a * a + b * b;
      if (d < best) {
        best = d;
        dx = a;
        dy = b;
      }
    }
  return [dx, dy];
};
maps.push(
  [
    'pinwheel-sectors',
    'Pinwheel Sectors',
    'Geometry',
    'Twelve alternating angular sectors turn into a sharp geometric pinwheel.',
    (x, y) => {
      const r = Math.hypot(x, y),
        a = Math.atan2(y, x),
        sector = Math.floor(((a + Math.PI) / Math.PI) * 6),
        b = a + (sector % 2 ? 1 : -1) * 0.9;
      return [Math.cos(b) * Math.min(0.9, r * 2), Math.sin(b) * Math.min(0.9, r * 2)];
    },
  ],
  [
    'diamond-orbits',
    'Diamond Orbits',
    'Geometry',
    'Circulate around nested diamond-shaped contours with sharp corners.',
    (x, y) => [Math.sign(y) * -0.65, Math.sign(x) * 0.65],
  ],
  [
    'square-circulation',
    'Square Circulation',
    'Geometry',
    'Follow square contours around the center, switching at diagonal corners.',
    (x, y) => (Math.abs(x) > Math.abs(y) ? [0, Math.sign(x) * 0.85] : [-Math.sign(y) * 0.85, 0]),
  ],
  [
    'hexagonal-channels',
    'Hexagonal Channels',
    'Geometry',
    'Six discrete directions turn a swirling field into hexagonal channels.',
    (x, y) => {
      const a = (Math.round((Math.atan2(y, x) + Math.PI / 2) / (Math.PI / 3)) * Math.PI) / 3;
      return [Math.cos(a) * 0.8, Math.sin(a) * 0.8];
    },
  ],
  [
    'alternating-spiral-rings',
    'Alternating Spiral Rings',
    'Swirl',
    'Concentric bands alternate between inward and outward spiral motion.',
    (x, y) => {
      const [a, b] = unit(x, y),
        sign = Math.floor(Math.hypot(x, y) * 7) % 2 ? 1 : -1;
      return [(a * sign - b) * 0.55, (b * sign + a) * 0.55];
    },
  ],
  [
    'twin-vortex',
    'Twin Vortex',
    'Swirl',
    'Two opposed rotating structures meet along a central seam.',
    (x, y) => {
      const dx = x - (x < 0 ? -0.45 : 0.45),
        [a, b] = unit(dx, y),
        spin = x < 0 ? 1 : -1;
      return [-b * spin * 0.85, a * spin * 0.85];
    },
  ],
  [
    'quadrupole',
    'Quadrupole',
    'Geometry',
    'A four-lobed saddle structure produces opposing streams and curved seams.',
    (x, y) => [clamp((x * x - y * y) * 1.2), clamp(-2 * x * y * 1.2)],
  ],
  [
    'vortex-street',
    'Vortex Street',
    'Swirl',
    'Alternating rows of offset eddies carry a gentle rightward current.',
    (x, y) => {
      const row = Math.floor((y + 1) * 3),
        dx = (((x + 1) * 3 + (row % 2) * 0.5) % 1) - 0.5,
        dy = (((y + 1) * 3) % 1) - 0.5,
        spin = row % 2 ? 1 : -1;
      return [clamp(0.3 - dy * spin * 1.5), dx * spin * 1.5];
    },
  ],
  [
    'sine-braid',
    'Sine Braid',
    'Wave',
    'Interwoven diagonal sine currents make smooth braided displacement.',
    (x, y) => [Math.sin((x + y) * Math.PI * 3) * 0.8, Math.sin((x - y) * Math.PI * 3) * 0.8],
  ],
  [
    'crossed-ripples',
    'Crossed Ripples',
    'Wave',
    'Two off-center ripple systems intersect in an interference field.',
    (x, y) => {
      const a = Math.hypot(x + 0.45, y),
        b = Math.hypot(x - 0.45, y);
      return [Math.sin(a * Math.PI * 8) * 0.6, Math.cos(b * Math.PI * 8) * 0.6];
    },
  ],
  [
    'chevron-current',
    'Chevron Current',
    'Geometry',
    'Alternating V-shaped bands make angular zigzag streams.',
    (x, y) => {
      const sign = Math.floor((y + Math.abs(x) + 2) * 6) % 2 ? 1 : -1;
      return [Math.sign(x) * sign * 0.65, sign * -0.65];
    },
  ],
  [
    'stepped-columns',
    'Stepped Columns',
    'Broken',
    'Columns advance through four stepped travel directions.',
    (x, y) => {
      const a = (((Math.floor((x + 1) * 8) + Math.floor((y + 1) * 3)) % 4) * Math.PI) / 2;
      return [Math.cos(a) * 0.85, Math.sin(a) * 0.85];
    },
  ],
  [
    'diagonal-shards',
    'Diagonal Shards',
    'Broken',
    'Seeded diagonal slices travel independently like broken panes.',
    (x, y) => {
      const row = Math.floor((x + y + 2) * 7),
        col = Math.floor((x - y + 2) * 4),
        a = random(col, row, 81) * Math.PI * 2;
      return [Math.cos(a) * 0.9, Math.sin(a) * 0.9];
    },
  ],
  [
    'barcode-slip',
    'Barcode Slip',
    'Broken',
    'Narrow vertical strips have seeded vertical slip and smaller sideways errors.',
    (x, y) => {
      const col = Math.floor((x + 1) * 32),
        row = Math.floor((y + 1) * 3);
      return [(random(col, row, 82) - 0.5) * 0.35, (random(col, 0, 83) * 2 - 1) * 0.95];
    },
  ],
  [
    'quantized-turbulence',
    'Quantized Turbulence',
    'Broken',
    'Smooth noise directions snap to eight compass directions and four strengths.',
    (x, y) => {
      const a = (Math.round(noise(x * 4 + 9, y * 4 + 21, 84) * 8) * Math.PI) / 4,
        m = Math.ceil(noise(x * 3 + 12, y * 3 + 19, 85) * 4) / 4;
      return [Math.cos(a) * m, Math.sin(a) * m];
    },
  ],
  [
    'multiscale-curl',
    'Multiscale Curl',
    'Organic',
    'Broad circulating currents carry smaller curls from a second noise octave.',
    (x, y) => {
      const u = x * 2 + 17,
        v = y * 2 + 29,
        e = 0.02;
      const potential = (a, b) => noise(a, b, 86) + noise(a * 3, b * 3, 87) * 0.2;
      return [
        Math.tanh(((potential(u, v + e) - potential(u, v - e)) / (2 * e)) * 0.8),
        Math.tanh((-(potential(u + e, v) - potential(u - e, v)) / (2 * e)) * 0.8),
      ];
    },
  ],
  [
    'ridged-current',
    'Ridged Current',
    'Organic',
    'Noise ridges modulate a smooth rotating current into clustered folds.',
    (x, y) => {
      const n = noise(x * 4 + 31, y * 4 + 13, 88),
        a = n * Math.PI * 6,
        m = 0.2 + Math.abs(n * 2 - 1) * 0.8;
      return [Math.cos(a) * m, Math.sin(a) * m];
    },
  ],
  [
    'cellular-attractors',
    'Cellular Attractors',
    'Organic',
    'Each irregular cell pulls toward its own seeded center.',
    (x, y) => {
      const [a, b] = cell(x, y),
        [u, v] = unit(a, b),
        m = Math.min(0.9, Math.hypot(a, b) * 2);
      return [u * m, v * m];
    },
  ],
  [
    'cellular-orbits',
    'Cellular Orbits',
    'Swirl',
    'Small irregular cells circulate around seeded centers with hard field seams.',
    (x, y) => {
      const [a, b] = cell(x, y),
        [u, v] = unit(a, b),
        m = Math.min(0.9, Math.hypot(a, b) * 2);
      return [-v * m, u * m];
    },
  ],
  [
    'shockwave-front',
    'Shockwave Front',
    'Wave',
    'An off-center elliptical shock front alternates radial push with circulating motion.',
    (x, y) => {
      const dx = (x + 0.35) * 0.7,
        dy = y - 0.2,
        r = Math.hypot(dx, dy),
        [a, b] = unit(dx, dy),
        wave = Math.sin(r * Math.PI * 10);
      return [(a * wave - b * 0.35) * 0.7, (b * wave + a * 0.35) * 0.7];
    },
  ],
);
const onlyNew = process.argv.includes('--new-only');
const catalog = onlyNew
  ? JSON.parse(await readFile(new URL('catalog.json', directory), 'utf8')).maps.filter((map) =>
      maps.slice(0, 20).some(([id]) => id === map.id),
    )
  : [];
for (const [id, name, category, description, field] of onlyNew ? maps.slice(20) : maps) {
  const size = 2048,
    pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [vx, vy] = field(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1),
        i = (y * size + x) * 3;
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) throw new Error(`Invalid vector: ${id}`);
      pixels[i] = encode(vx);
      pixels[i + 1] = encode(vy);
      pixels[i + 2] = 128;
    }
  const png = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(new URL(`${id}.png`, directory), png);
  // Arrows are composited ONLY onto chooser thumbnails, never into numeric maps.
  const paths = [];
  for (let y = 12; y < 192; y += 24)
    for (let x = 12; x < 192; x += 24) {
      const [vx, vy] = field(x / 96 - 1, y / 96 - 1),
        dx = clamp(vx) * 15,
        dy = clamp(vy) * 15;
      if (Math.hypot(dx, dy) < 1.2) continue;
      const ex = x + dx / 2,
        ey = y + dy / 2,
        angle = Math.atan2(dy, dx),
        a = angle + 2.6,
        b = angle - 2.6;
      paths.push(
        `M${x - dx / 2} ${y - dy / 2}L${ex} ${ey}M${ex + Math.cos(a) * 4} ${ey + Math.sin(a) * 4}L${ex} ${ey}L${ex + Math.cos(b) * 4} ${ey + Math.sin(b) * 4}`,
      );
    }
  const path = paths.join(' '),
    svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><path d="${path}" fill="none" stroke="#111" stroke-opacity="0.75" stroke-width="3"/><path d="${path}" fill="none" stroke="#fff" stroke-width="1.2"/></svg>`,
    );
  const thumb = await sharp(png)
    .resize(192, 192)
    .composite([{ input: svg }])
    .png()
    .toBuffer();
  await writeFile(new URL(`${id}-thumb.png`, directory), thumb);
  catalog.push({
    id,
    name,
    category,
    description,
    width: size,
    height: size,
    sha256: createHash('sha256').update(png).digest('hex'),
  });
  console.log(`${name}: ${(png.length / 1024).toFixed(0)} KB`);
}
await writeFile(
  new URL('catalog.json', directory),
  JSON.stringify(
    {
      version: 1,
      convention:
        'R = horizontal, G = vertical, B = 128. Byte 128 is neutral; 0 is -1, 255 is +1. Positive X moves right; positive Y moves down.',
      maps: catalog,
    },
    null,
    2,
  ) + '\n',
);
