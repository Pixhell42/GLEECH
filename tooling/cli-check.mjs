import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parent = resolve(root, 'test-results/cli-check');
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, 'run-'));
const packagedIndex = process.argv.indexOf('--packaged');
const positional = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const supplied = packagedIndex >= 0 ? process.argv[packagedIndex + 1] : positional;
const packaged = !!supplied;
const executable = supplied
  ? resolve(supplied, ...(supplied.endsWith('.app') ? ['Contents', 'MacOS', 'GLEECH'] : []))
  : process.execPath;
const entry = packaged
  ? resolve(
      dirname(executable),
      process.platform === 'darwin' ? '../Resources/cli/gleech.cjs' : 'resources/cli/gleech.cjs',
    )
  : resolve(root, 'apps/desktop/out/cli/gleech.cjs');
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const env = { ...process.env, GLEECH_USER_DATA: join(output, 'empty-user-data'), NO_COLOR: '1' };
if (packaged) env.ELECTRON_RUN_AS_NODE = '1';
else delete env.ELECTRON_RUN_AS_NODE;
async function cli(args, options = {}) {
  return run(executable, [entry, ...args], {
    cwd: root,
    env,
    windowsHide: true,
    timeout: 90000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}
const results = [];
async function check(name, work) {
  await work();
  results.push(name);
  console.log('PASS ' + name);
}
async function pixels(path) {
  return sharp(await readFile(path))
    .ensureAlpha()
    .raw()
    .toBuffer();
}
const source = join(output, 'source.png');
const rgba = Uint8Array.from({ length: 48 * 32 * 4 }, (_, i) =>
  i % 4 === 3 ? [64, 128, 255][(i >> 2) % 3] : (i * 17) % 256,
);
await sharp(rgba, { raw: { width: 48, height: 32, channels: 4 } })
  .png()
  .toFile(source);
const info = JSON.parse(
  (await cli(['info', '--json', ...(process.argv.includes('--cpu') ? ['--renderer', 'cpu'] : [])]))
    .stdout,
);
await check('capabilities and isolated shader library', async () => {
  assert.equal(info.codec, 'sharp');
  assert.ok(info.effects > 100);
  const list = JSON.parse((await cli(['shaders', '--json'])).stdout);
  assert.ok(list.some((shader) => shader.name === 'Prism Weave'));
});
await check('CPU export and complete metadata', async () => {
  const path = join(output, 'cpu.png');
  const data = JSON.parse(
    (await cli(['render', source, '-e', 'rgb-split', '--renderer', 'cpu', '-o', path, '--json']))
      .stdout,
  );
  assert.equal(data.backend, 'cpu');
  const xmp = (await sharp(path).metadata()).xmp.toString();
  assert.ok(xmp.includes('https://github.com/Pixhell42/GLEECH'));
  assert.ok(xmp.includes('https://x.com/pixhell'));
});
await check('fallback PNG metadata without native codecs', async () => {
  const path = join(output, 'fallback.png');
  await cli(['render', source, '-e', 'rgb-split', '--renderer', 'cpu', '-o', path], {
    env: { ...env, GLEECH_NO_SHARP: '1' },
  });
  const xmp = (await sharp(path).metadata()).xmp.toString();
  assert.ok(xmp.includes('https://github.com/Pixhell42/GLEECH'));
  assert.ok(xmp.includes('https://x.com/pixhell'));
});
await check('batch exports and JSON variation results', async () => {
  const second = join(output, 'second.png');
  await writeFile(second, await readFile(source));
  const batch = JSON.parse(
    (
      await cli([
        'render',
        source,
        second,
        '-e',
        'rgb-split',
        '--renderer',
        'cpu',
        '-o',
        join(output, 'batch'),
        '--json',
      ])
    ).stdout,
  );
  assert.equal(batch.length, 2);
  const variations = JSON.parse(
    (
      await cli([
        'vary',
        source,
        '-e',
        'rgb-split',
        '--renderer',
        'cpu',
        '-n',
        '2',
        '-o',
        join(output, 'variations'),
        '--json',
      ])
    ).stdout,
  );
  assert.equal(variations.length, 2);
});
await check('seeded GLEECH replay and bounded contact sheet', async () => {
  const sheet = join(output, 'rolls.png');
  const common = [
    'gleech',
    source,
    '-e',
    'rgb-split',
    '--mode',
    'existing-only',
    '--seed',
    '123',
    '--renderer',
    'cpu',
  ];
  const rolls = JSON.parse(
    (await cli([...common, '-n', '2', '--sheet', sheet, '-o', join(output, 'rolls'), '--json']))
      .stdout,
  );
  const replay = join(output, 'replay.png');
  await cli([...common, '-o', replay]);
  assert.ok(
    (await pixels(rolls[0].output)).equals(await pixels(replay)),
    'Seeded replay must preserve pixels.',
  );
  assert.ok((await sharp(sheet).metadata()).width > 48);
});
await check('project overwrite requires permission', async () => {
  const project = join(output, 'preserve.gleech');
  await writeFile(project, 'original content');
  await assert.rejects(() =>
    cli([
      'render',
      source,
      '-e',
      'rgb-split',
      '--renderer',
      'cpu',
      '-o',
      join(output, 'save-export.png'),
      '--save-project',
      project,
    ]),
  );
  assert.equal(await readFile(project, 'utf8'), 'original content');
});
const shader = resolve(root, 'apps/desktop/resources/shaders/prism-weave.gleech-shader');
await check('imported shaders fail clearly on CPU unless explicitly skipped', async () => {
  await assert.rejects(() =>
    cli([
      'render',
      source,
      '--shader',
      shader,
      '--renderer',
      'cpu',
      '-o',
      join(output, 'unsupported.png'),
    ]),
  );
  const skipped = join(output, 'skipped.png');
  const data = JSON.parse(
    (
      await cli([
        'render',
        source,
        '--shader',
        shader,
        '--renderer',
        'cpu',
        '--skip-unsupported-shaders',
        '-o',
        skipped,
        '--json',
      ])
    ).stdout,
  );
  assert.ok(data.warnings.length);
  assert.deepEqual(await pixels(skipped), await pixels(source));
});
if (process.argv.includes('--require-gpu'))
  assert.ok(
    info.renderer.webgpu && info.renderer.webgl2,
    'Both GPU backends required on this test machine.',
  );
if (info.renderer.webgpu && info.renderer.webgl2) {
  await check('built-in WebGPU shader', async () => {
    const path = join(output, 'builtin.png');
    const data = JSON.parse(
      (
        await cli([
          'render',
          source,
          '-e',
          'shader-plasma',
          '--renderer',
          'gpu',
          '-o',
          path,
          '--json',
        ])
      ).stdout,
    );
    assert.equal(data.backend, 'webgpu');
    assert.notDeepEqual(await pixels(path), await pixels(source));
  });
  await check('imported WGSL project/preset round-trip', async () => {
    const path = join(output, 'wgsl.png'),
      project = join(output, 'wgsl.gleech'),
      preset = join(output, 'wgsl.gleechpreset');
    const data = JSON.parse(
      (
        await cli([
          'render',
          source,
          '--shader',
          shader,
          '--renderer',
          'gpu',
          '-o',
          path,
          '--save-project',
          project,
          '--save-preset',
          preset,
          '--json',
        ])
      ).stdout,
    );
    assert.equal(data.backend, 'webgpu');
    await cli(['render', project, '--renderer', 'gpu', '-o', join(output, 'reopened.png')]);
    await cli([
      'render',
      source,
      '-p',
      preset,
      '--renderer',
      'gpu',
      '-o',
      join(output, 'preset.png'),
    ]);
    assert.ok(
      (await pixels(path)).equals(await pixels(join(output, 'reopened.png'))),
      'Project pixels must round-trip.',
    );
    assert.ok(
      (await pixels(path)).equals(await pixels(join(output, 'preset.png'))),
      'Preset pixels must round-trip.',
    );
  });
  await check('embedded image and painted mask in a GPU stack', async () => {
    const preset = join(output, 'embedded.gleechpreset');
    await cli([
      'render',
      source,
      '-e',
      'solid',
      '--renderer',
      'cpu',
      '-o',
      join(output, 'solid.png'),
      '--save-preset',
      preset,
    ]);
    const value = JSON.parse(await readFile(preset, 'utf8'));
    const solid = value.preset.effects[0];
    solid.params.content = 'image';
    solid.image = {
      source: {
        id: 'embedded-test-image',
        name: 'embedded.png',
        width: 48,
        height: 32,
        format: 'png',
        hasAlpha: true,
      },
      png: 'data:image/png;base64,' + (await readFile(source)).toString('base64'),
    };
    solid.paintedMask = {
      version: 1,
      enabled: true,
      inverted: false,
      width: 48,
      height: 32,
      base: 0,
      strokes: [
        {
          size: 50,
          shape: 'circle',
          hardness: 0.5,
          falloff: 'smooth',
          mode: 'paint',
          points: [{ x: 0.5, y: 0.5 }],
        },
      ],
    };
    value.preset.effects.push(
      JSON.parse(await readFile(join(output, 'wgsl.gleechpreset'), 'utf8')).preset.effects[0],
    );
    await writeFile(preset, JSON.stringify(value));
    const data = JSON.parse(
      (
        await cli([
          'render',
          source,
          '-p',
          preset,
          '--renderer',
          'gpu',
          '-o',
          join(output, 'embedded.png'),
          '--json',
        ])
      ).stdout,
    );
    assert.equal(data.backend, 'webgpu');
  });
  await check('shader compilation errors require explicit skipping', async () => {
    const broken = JSON.parse(await readFile(shader, 'utf8'));
    broken.source = broken.source.replace(
      'return vec4f(color, image.a);',
      'return vec4f(missingValue, image.a);',
    );
    const file = join(output, 'broken.gleech-shader');
    await writeFile(file, JSON.stringify(broken));
    await assert.rejects(() =>
      cli([
        'render',
        source,
        '--shader',
        file,
        '--renderer',
        'auto',
        '-o',
        join(output, 'failed.png'),
      ]),
    );
    const data = JSON.parse(
      (
        await cli([
          'render',
          source,
          '--shader',
          file,
          '--renderer',
          'auto',
          '--skip-unsupported-shaders',
          '-o',
          join(output, 'explicit-skip.png'),
          '--json',
        ])
      ).stdout,
    );
    assert.equal(data.backend, 'cpu');
    assert.ok(data.warnings.length);
  });
  const isf = join(output, 'tint.isf');
  await writeFile(
    isf,
    '/*{"ISFVSN":"2","CREDIT":"GLEECH","INPUTS":[{"NAME":"inputImage","TYPE":"image"},{"NAME":"gain","TYPE":"float","DEFAULT":0.7,"MIN":0,"MAX":1}]}*/\nvoid main(){vec4 c=IMG_THIS_PIXEL(inputImage); gl_FragColor=vec4(c.rgb*gain,c.a); }',
  );
  await check('ISF WebGL2 shader', async () => {
    const path = join(output, 'isf.png');
    const data = JSON.parse(
      (await cli(['render', source, '--shader', isf, '--renderer', 'gpu', '-o', path, '--json']))
        .stdout,
    );
    assert.equal(data.backend, 'webgl2');
    assert.notDeepEqual(await pixels(path), await pixels(source));
  });
  await check('mixed WGSL + ISF + native JPEG pass', async () => {
    const data = JSON.parse(
      (
        await cli([
          'render',
          source,
          '-e',
          'jpeg-recompression',
          '--shader',
          shader,
          '--shader',
          isf,
          '--renderer',
          'gpu',
          '-o',
          join(output, 'mixed.png'),
          '--json',
        ])
      ).stdout,
    );
    assert.equal(data.backend, 'mixed-gpu');
  });
} else console.log('SKIP GPU rendering: ' + JSON.stringify(info.renderer));
await writeFile(
  join(output, 'results.json'),
  JSON.stringify({ passed: true, packaged, capabilities: info.renderer, checks: results }, null, 2),
);
console.log(JSON.stringify({ passed: results.length, output }));
