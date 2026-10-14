import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const sharp = require('sharp');
const source = await readFile(new URL('../packages/effects/src/noise.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createNoiseField } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const destination = new URL('../apps/desktop/resources/depth-maps/', import.meta.url);
await mkdir(destination, { recursive: true });
const clamp = (x) => Math.max(0, Math.min(1, x));
const random = (x, y, lane) => {
  let z =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(lane | 0, 1442695041) ^
    87231;
  z = Math.imul(z ^ (z >>> 13), 1274126177);
  return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
};
const noise = (style, detail, roughness) => createNoiseField({ style, detail, roughness }, random);
const perlin = noise('perlin', 4, 0.55),
  simplex = noise('simplex', 4, 0.5),
  worley = noise('voronoi', 2, 0.45);
const bump = (x, y, cx, cy, r) =>
  Math.sqrt(Math.max(0, 1 - ((x - cx) ** 2 + (y - cy) ** 2) / r ** 2));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const maps = [
  [
    'horizontal-ramp',
    'Horizontal Ramp',
    'Simple',
    'Linear depth from left to right; displacement and depth focus.',
    (x) => (x + 1) / 2,
  ],
  [
    'vertical-ramp',
    'Vertical Ramp',
    'Simple',
    'Linear depth from top to bottom; focus and contour bands.',
    (_x, y) => (y + 1) / 2,
  ],
  [
    'radial-dome',
    'Radial Dome',
    'Soft',
    'Smooth raised center; rounded relief and lens-like displacement.',
    (x, y) => Math.exp(-3 * (x * x + y * y)),
  ],
  [
    'soft-basin',
    'Soft Basin',
    'Soft',
    'Smooth recessed center; invertible hollow and soft focus.',
    (x, y) => 1 - Math.exp(-3 * (x * x + y * y)),
  ],
  [
    'saddle',
    'Saddle',
    'Soft',
    'Opposing curved slopes; flowing displacement and relief.',
    (x, y) => 0.5 + 0.5 * (x * x - y * y),
  ],
  [
    'folded-ribbon',
    'Folded Ribbon',
    'Soft',
    'A curved raised ribbon with soft edges.',
    (x, y) => Math.exp(-12 * (y - 0.4 * Math.sin(x * 4)) ** 2),
  ],
  [
    'soft-clouds',
    'Soft Clouds',
    'Noise',
    'Broad layered Perlin clouds; gentle organic warping.',
    (x, y) => perlin(x * 2 + 17, y * 2 + 29),
    512,
  ],
  [
    'storm-clouds',
    'Storm Clouds',
    'Noise',
    'Dense simplex clouds; detailed organic relief.',
    (x, y) => clamp((simplex(x * 6 + 17, y * 6 + 29) - 0.5) * 2.8 + 0.5),
    512,
  ],
  [
    'ridged-terrain',
    'Ridged Terrain',
    'Noise',
    'Mountain-like noise ridges; strong contour and displacement detail.',
    (x, y) => 1 - Math.abs(perlin(x * 5 + 17, y * 5 + 29) - 0.5) * 2,
    512,
  ],
  [
    'cellular-stone',
    'Cellular Stone',
    'Noise',
    'Worley cell valleys; cellular embossing and recursive surfaces.',
    (x, y) => worley(x * 5 + 17, y * 5 + 29),
    512,
  ],
  [
    'flowing-marble',
    'Flowing Marble',
    'Noise',
    'Warped flowing veins; layered contour slicing.',
    (x, y) => 0.5 + 0.5 * Math.sin(x * 16 + perlin(x * 3 + 17, y * 3 + 29) * 18 + y * 5),
    512,
  ],
  [
    'concentric-rings',
    'Concentric Rings',
    'Geometry',
    'Repeated smooth circular elevations; rings and radial slicing.',
    (x, y) => 0.5 + 0.5 * Math.cos(Math.hypot(x, y) * 24),
  ],
  [
    'stepped-pyramid',
    'Stepped Pyramid',
    'Geometry',
    'Eight nested square terraces; discrete structural displacement.',
    (x, y) => Math.floor(clamp(1 - Math.max(Math.abs(x), Math.abs(y))) * 8) / 8,
  ],
  [
    'hexagonal-tiles',
    'Hexagonal Tiles',
    'Geometry',
    'Beveled hexagonal cells at varied heights; tiled structural relief.',
    (x, y) => {
      let best = 9,
        height = 0.5,
        edge = 0;
      for (let row = Math.round((y * 5) / 0.866) - 1; row <= Math.round((y * 5) / 0.866) + 1; row++)
        for (let col = Math.round(x * 5) - 1; col <= Math.round(x * 5) + 1; col++) {
          const dx = x * 5 - col - (row & 1) * 0.5,
            dy = y * 5 - row * 0.866,
            d = Math.hypot(dx, dy);
          if (d < best) {
            best = d;
            height = 0.25 + 0.75 * random(col, row, 1);
            edge = Math.max(
              2 * Math.abs(dx),
              Math.abs(dx + Math.sqrt(3) * dy),
              Math.abs(dx - Math.sqrt(3) * dy),
            );
          }
        }
      return height * clamp((1 - edge) * 6);
    },
  ],
  [
    'sphere-array',
    'Sphere Array',
    'Structure',
    'Rows of true hemisphere heights; repeated rounded structures.',
    (x, y) => bump(x * 3 - Math.round(x * 3), y * 3 - Math.round(y * 3), 0, 0, 0.43),
  ],
  [
    'torus',
    'Torus',
    'Structure',
    'Analytic torus height with a clear central hole; curved ring relief.',
    (x, y) => Math.sqrt(Math.max(0, 1 - ((Math.hypot(x, y) - 0.58) / 0.25) ** 2)),
  ],
  [
    'arched-vault',
    'Arched Vault',
    'Structure',
    'A barrel-vault depth surface with receding architectural ribs.',
    (x, y) =>
      clamp(
        0.2 +
          0.5 * Math.sqrt(Math.max(0, 1 - x * x)) +
          (0.3 * (1 - y)) / 2 -
          0.09 * Math.exp(-100 * Math.sin((y + 1) * 10) ** 2),
      ),
  ],
  [
    'receding-corridor',
    'Receding Corridor',
    'Structure',
    'Perspective square tunnel; depth is distance, without surface lighting.',
    (x, y) => clamp(Math.max(Math.abs(x), Math.abs(y)) ** 0.65),
  ],
  [
    'city-blocks',
    'City Blocks',
    'Structure',
    'Varied flat-topped towers with beveled edges; stepped urban heights.',
    (x, y) => {
      const cx = Math.floor((x + 1) * 6),
        cy = Math.floor((y + 1) * 6),
        fx = (x + 1) * 6 - cx,
        fy = (y + 1) * 6 - cy;
      return (0.15 + 0.85 * random(cx, cy, 2)) * clamp(Math.min(fx, fy, 1 - fx, 1 - fy) * 12);
    },
  ],
  [
    'recursive-terraces',
    'Recursive Terraces',
    'Complex',
    'Nested square subdivisions and soft terraces; layered recursive geometry.',
    (x, y) => {
      let h = 0;
      for (let level = 0; level < 5; level++) {
        const n = 2 ** level;
        const fx = ((x + 1) * n) % 1,
          fy = ((y + 1) * n) % 1;
        h += (Math.min(fx, fy, 1 - fx, 1 - fy) * 2) / 2 ** (level + 1);
      }
      return h;
    },
  ],
];
const originalCount = maps.length;
maps.push(
  [
    'diagonal-ramp',
    'Diagonal Ramp',
    'Simple',
    'An even diagonal slope from far to near; oblique depth focus and displacement.',
    (x, y) => 0.5 + (x + y) / 4,
  ],
  [
    'split-ramps',
    'Split Ramps',
    'Simple',
    'Four quadrants with alternating horizontal and vertical slopes; directional slicing.',
    (x, y) => (x * y >= 0 ? Math.abs(x) : Math.abs(y)),
  ],
  [
    'soft-pillows',
    'Soft Pillows',
    'Soft',
    'A quilt of smooth square pillows with recessed seams; rounded local warping.',
    (x, y) => {
      const u = (x + 1) * 2.5,
        v = (y + 1) * 2.5;
      return (
        Math.sin(Math.PI * (u - Math.floor(u))) ** 0.7 *
        Math.sin(Math.PI * (v - Math.floor(v))) ** 0.7
      );
    },
  ],
  [
    'draped-fabric',
    'Draped Fabric',
    'Soft',
    'Broad hanging folds bent across a soft drape; cloth-like relief without baked lighting.',
    (x, y) => 0.5 + 0.32 * Math.cos(x * 13 + 1.8 * Math.sin(y * 2.8)) + 0.18 * Math.sin(y * 5),
  ],
  [
    'braided-ribbons',
    'Braided Ribbons',
    'Soft',
    'Three interwoven rounded ribbons; smooth crossings for layered displacement.',
    (x, y) => {
      let height = 0;
      for (let strand = 0; strand < 3; strand++) {
        const center = 0.48 * Math.sin(x * 5.5 + (strand * Math.PI * 2) / 3);
        height = Math.max(
          height,
          (0.65 + 0.35 * Math.cos(x * 5.5 + (strand * Math.PI * 2) / 3)) *
            Math.exp(-(((y - center) / 0.095) ** 2)),
        );
      }
      return height;
    },
  ],
  [
    'spiral-folds',
    'Spiral Folds',
    'Soft',
    'Smooth spiral ridges with a softened center; circular depth slicing and warping.',
    (x, y) =>
      0.5 +
      0.5 *
        smooth(0, 0.12, Math.hypot(x, y)) *
        Math.cos(Math.hypot(x, y) * 24 - Math.atan2(y, x) * 4),
  ],
  [
    'warped-cumulus',
    'Warped Cumulus',
    'Noise',
    'Domain-warped layered clouds; broad organic depth with finer surface variation.',
    (x, y) =>
      perlin(
        x * 3 + 41 + (simplex(x * 1.5 + 3, y * 1.5 + 7) - 0.5) * 3,
        y * 3 + 63 + (simplex(x * 1.5 + 13, y * 1.5 + 19) - 0.5) * 3,
      ),
  ],
  [
    'billow-banks',
    'Billow Banks',
    'Noise',
    'Clustered billowing cloud banks with soft valleys; rounded organic relief.',
    (x, y) => (1 - Math.abs(2 * simplex(x * 4 + 71, y * 4 + 43) - 1)) ** 2.2,
  ],
  [
    'eroded-canyon',
    'Eroded Canyon',
    'Noise',
    'Branching recessed channels through rough high ground; terrain and contour cuts.',
    (x, y) => {
      const broad = perlin(x * 2.6 + 11, y * 2.6 + 47);
      const channel = Math.abs(broad - 0.5);
      return smooth(0.035, 0.22, channel) + 0.13 * simplex(x * 12 + 59, y * 12 + 83);
    },
  ],
  [
    'crater-field',
    'Crater Field',
    'Noise',
    'Seeded bowl depressions with raised rims; craters, pits and concentric contours.',
    (x, y) => {
      const u = (x + 1) * 3,
        v = (y + 1) * 3;
      const cx = Math.floor(u),
        cy = Math.floor(v);
      let bowl = 0,
        rim = 0;
      for (let row = cy - 1; row <= cy + 1; row++)
        for (let col = cx - 1; col <= cx + 1; col++) {
          const dx = u - col - 0.2 - random(col, row, 7) * 0.6;
          const dy = v - row - 0.2 - random(col, row, 8) * 0.6;
          const r = Math.hypot(dx, dy) / (0.26 + random(col, row, 9) * 0.22);
          bowl = Math.max(bowl, (1 - smooth(0, 0.82, r)) * 0.58);
          rim = Math.max(rim, Math.exp(-(((r - 0.88) / 0.12) ** 2)) * 0.3);
        }
      return 0.62 - bowl + rim;
    },
  ],
  [
    'wind-carved-dunes',
    'Wind-carved Dunes',
    'Noise',
    'Asymmetric wind-bent ridges over low rolling terrain; sweeping sand-like depth.',
    (x, y) => {
      const phase = x * 17 + y * 4 + (perlin(x * 2 + 37, y * 2 + 91) - 0.5) * 8;
      return (0.5 + 0.5 * Math.sin(phase)) ** 3 + 0.17 * simplex(x * 3 + 61, y * 3 + 13);
    },
  ],
  [
    'diamond-facets',
    'Diamond Facets',
    'Geometry',
    'A diamond-shaped peaked surface with four planar faces; crisp angular relief.',
    (x, y) => clamp(1 - Math.abs(x) - Math.abs(y)),
  ],
  [
    'radial-fan',
    'Radial Fan',
    'Geometry',
    'Twelve angular wedges at alternating heights with radial slopes; segmented depth.',
    (x, y) => {
      const sector = Math.floor(((Math.atan2(y, x) + Math.PI) * 6) / Math.PI) % 12;
      return clamp(Math.hypot(x, y) / Math.SQRT2) * (0.25 + (0.75 * ((sector * 5) % 12)) / 11);
    },
  ],
  [
    'interlocking-chevrons',
    'Interlocking Chevrons',
    'Geometry',
    'Repeated zigzag ridges with alternating elevations; angular contour patterns.',
    (x, y) => {
      const u = y * 3.5 + Math.abs(x * 3.5 - Math.round(x * 3.5));
      return 1 - 2 * Math.abs(u - Math.floor(u) - 0.5);
    },
  ],
  [
    'triangular-panels',
    'Triangular Panels',
    'Geometry',
    'Independent beveled triangular plates at seeded heights; fragmented structural depth.',
    (x, y) => {
      const u = (x + 1) * 3,
        v = (y + 1) * 3;
      const cx = Math.floor(u),
        cy = Math.floor(v),
        fx = u - cx,
        fy = v - cy;
      const edge = Math.min(fx, fy, 1 - fx, 1 - fy, Math.abs(fx - fy) / Math.SQRT2);
      return (0.25 + 0.75 * random(cx, cy, fx > fy ? 10 : 11)) * smooth(0, 0.07, edge);
    },
  ],
  [
    'ribbed-capsule',
    'Ribbed Capsule',
    'Structure',
    'A rounded diagonal capsule with recessed ribs; analytic curved surface heights.',
    (x, y) => {
      const t = clamp(((x + 0.65) * 1.3 + (y + 0.3) * 0.6) / 2.05);
      const distance = Math.hypot(x + 0.65 - t * 1.3, y + 0.3 - t * 0.6);
      const height = Math.sqrt(Math.max(0, 1 - (distance / 0.28) ** 2));
      return height * (0.78 + 0.22 * smooth(0, 0.3, Math.abs(Math.sin(t * Math.PI * 12))));
    },
  ],
  [
    'crossed-vaults',
    'Crossed Vaults',
    'Structure',
    'Intersecting barrel surfaces at two heights; architectural crossings without surface lighting.',
    (x, y) =>
      Math.max(
        0.76 * Math.sqrt(Math.max(0, 1 - (x / 0.33) ** 2)),
        Math.sqrt(Math.max(0, 1 - (y / 0.33) ** 2)),
      ),
  ],
  [
    'switchback-stairs',
    'Switchback Stairs',
    'Structure',
    'Six connected stair flights alternating direction; stepped receding architecture.',
    (x, y) => {
      const u = (x + 1) / 2,
        v = Math.min(5.999999, (y + 1) * 3);
      const row = Math.floor(v),
        step = row % 2 ? 1 - u : u;
      const height = Math.floor((row + step) * 6) / 36;
      return height * smooth(0, 0.04, Math.min(v - row, 1 - (v - row)));
    },
  ],
  [
    'terraced-islands',
    'Terraced Islands',
    'Complex',
    'Layered organic islands with stepped plateaus and softened terrace edges.',
    (x, y) => {
      const n = perlin(x * 3 + 89 + (simplex(x * 2 + 41, y * 2 + 67) - 0.5) * 2, y * 3 + 113);
      const h = clamp((n - 0.27) * 2.2) * 8;
      return (Math.floor(h) + smooth(0.72, 0.98, h - Math.floor(h))) / 8;
    },
  ],
  [
    'truchet-channels',
    'Truchet Channels',
    'Complex',
    'Connected quarter-circle channels forming seeded loops and maze-like depth paths.',
    (x, y) => {
      const u = (x + 1) * 4,
        v = (y + 1) * 4;
      const cx = Math.floor(u),
        cy = Math.floor(v),
        fx = u - cx,
        fy = v - cy;
      const distance =
        random(cx, cy, 12) < 0.5
          ? Math.min(Math.abs(Math.hypot(fx, fy) - 0.5), Math.abs(Math.hypot(1 - fx, 1 - fy) - 0.5))
          : Math.min(
              Math.abs(Math.hypot(fx, 1 - fy) - 0.5),
              Math.abs(Math.hypot(1 - fx, fy) - 0.5),
            );
      return 1 - Math.exp(-((distance / 0.08) ** 2));
    },
  ],
);
const newOnly = process.argv.includes('--new-only');
if (process.argv.slice(2).some((arg) => arg !== '--new-only'))
  throw new Error('Use optional --new-only to preserve existing map files.');
const existing = newOnly
  ? JSON.parse(await readFile(new URL('catalog.json', destination), 'utf8')).maps
  : [];
const entries = newOnly
  ? existing.filter((entry) => !maps.slice(originalCount).some(([id]) => id === entry.id))
  : [];
for (const [index, [id, name, category, description, fn, size = 2048]] of maps.entries()) {
  if (newOnly && index < originalCount) continue;
  const pixels = Buffer.alloc(size * size);
  const heights = index >= originalCount ? new Float32Array(size * size) : null;
  let low = Infinity,
    high = -Infinity;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const height = clamp(fn(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1));
      if (!Number.isFinite(height)) throw new Error(`Invalid height in ${id}.`);
      if (heights) {
        heights[y * size + x] = height;
        low = Math.min(low, height);
        high = Math.max(high, height);
      } else pixels[y * size + x] = Math.round(height * 255);
    }
  if (heights) {
    if (high - low < 1e-6) throw new Error(`Flat depth map: ${id}`);
    for (let i = 0; i < heights.length; i++)
      pixels[i] = Math.round(clamp((heights[i] - low) / (high - low)) * 255);
  }
  const png = await sharp(pixels, { raw: { width: size, height: size, channels: 1 } })
    .resize(2048, 2048, { kernel: 'cubic' })
    .toColourspace('b-w')
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(new URL(`${id}.png`, destination), png);
  await writeFile(
    new URL(`${id}-thumb.png`, destination),
    await sharp(png).resize(192, 192).toColourspace('b-w').png().toBuffer(),
  );
  entries.push({
    id,
    name,
    category,
    description,
    width: 2048,
    height: 2048,
    sha256: createHash('sha256').update(png).digest('hex'),
  });
  console.log(`${name}: ${(png.length / 1024).toFixed(0)} KB`);
}
await writeFile(
  new URL('catalog.json', destination),
  JSON.stringify(
    { version: 1, convention: 'White is high/near; black is low/far.', maps: entries },
    null,
    2,
  ) + '\n',
);
