import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { renderEffects } from './effects-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/tiled-shapes-runtime-check');
await mkdir(output, { recursive: true });
const width = 129,
  height = 65;
const rgba = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    rgba.set(
      [(x * 17) % 256, (y * 23) % 256, ((x ^ y) * 13) % 256, [0, 1, 64, 128, 254, 255][x % 6]],
      (y * width + x) * 4,
    );
const image = { width, height, pixels: rgba.buffer };
const base = {
  instanceId: 'tile-runtime-regression',
  type: 'shapes',
  version: 1,
  enabled: true,
  seedOffset: 1,
  application: { region: 'all', coverage: 1, softness: 0 },
  params: {
    amount: 1,
    blendMode: 'normal',
    tintEnabled: 'off',
    color: '#ffffff',
    tintStrength: 0,
    layout: 'tiled',
    tilePattern: 'radial',
    spacing: 25,
    layoutRotation: 20,
    radialRepeats: 9,
    shape: 'polygon',
    operation: 'distort',
    size: 85,
    scale: 1.2,
    rotation: 18,
    rotationStyle: 'graduated',
    endRotation: 230,
    startSides: 10,
    endSides: 3,
    polygonStyle: 'linear',
    positionX: 35,
    positionY: 60,
    progressionField: 'square',
    progressionX: 40,
    progressionY: 60,
    progressionRange: 75,
    ringThickness: 0.25,
    feather: 3,
    distortionScale: 1.8,
    twist: -60,
    shapeColor: '#4080e0',
    edgeHandling: 'extend',
  },
};
// Native exports found source-choice ties at (84,3) and (85,5) with this recipe.
const overrides = [
  {},
  { edgeHandling: 'wrap' },
  { edgeHandling: 'mirror' },
  { tilePattern: 'grid' },
  { tilePattern: 'staggered' },
  { shape: 'triangle' },
  { shape: 'square' },
  { shape: 'ring' },
  { rotationStyle: 'random', polygonStyle: 'random' },
  {
    positionX: 25,
    progressionX: 25,
    layoutRotation: 0,
    radialRepeats: 8,
    progressionField: 'left-right',
    spacing: 20,
    positionY: 50,
    progressionY: 50,
    size: 60,
  },
];
const render = () =>
  Buffer.concat(
    overrides.map((params) =>
      Buffer.from(
        renderEffects(image, [{ ...base, params: { ...base.params, ...params } }], {
          masterSeed: 8172,
        }).pixels,
      ),
    ),
  );
const path = resolve(output, 'electron.rgba');
if (process.argv.includes('--render')) {
  await writeFile(path, render());
} else {
  const expected = render();
  const executable = createRequire(resolve(root, 'apps/desktop/package.json'))('electron');
  await promisify(execFile)(executable, [fileURLToPath(import.meta.url), '--render'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    timeout: 30000,
  });
  const actual = await readFile(path);
  const differences = [];
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i])
      differences.push({ index: i, actual: actual[i], expected: expected[i] });
  if (differences.length)
    await writeFile(
      resolve(output, 'differences.json'),
      JSON.stringify(differences.slice(0, 30), null, 2),
    );
  assert.ok(
    actual.equals(expected),
    `${differences.length} RGBA differences between Node and Electron`,
  );
  console.log(JSON.stringify({ recipes: overrides.length, result: 'passed' }));
}
