import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
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
const candidates = [
  'win-unpacked/GLEECH.exe',
  'mac-arm64/GLEECH.app/Contents/MacOS/GLEECH',
  'mac/GLEECH.app/Contents/MacOS/GLEECH',
  'linux-unpacked/gleech',
  'linux-unpacked/gleech-bin',
].map((p) => resolve(root, 'apps/desktop/release', p));
const allowed = new Map(candidates.map((p) => [p, p]));
const executable = supplied
  ? allowed.get(resolve(supplied, ...(supplied.endsWith('.app') ? ['Contents/MacOS/GLEECH'] : [])))
  : process.execPath;
assert.ok(executable, 'Use a known packaged executable under apps/desktop/release.');
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
  assert.equal(
    /<gleech:RepositoryURL>([^<]+)<\//.exec(xmp)?.[1],
    'https://github.com/Pixhell42/GLEECH',
  );
  assert.equal(/<gleech:DeveloperURL>([^<]+)<\//.exec(xmp)?.[1], 'https://x.com/pixhell');
});
await check('fallback PNG metadata without native codecs', async () => {
  const path = join(output, 'fallback.png');
  await cli(['render', source, '-e', 'rgb-split', '--renderer', 'cpu', '-o', path], {
    env: { ...env, GLEECH_NO_SHARP: '1' },
  });
  const xmp = (await sharp(path).metadata()).xmp.toString();
  assert.equal(
    /<gleech:RepositoryURL>([^<]+)<\//.exec(xmp)?.[1],
    'https://github.com/Pixhell42/GLEECH',
  );
  assert.equal(/<gleech:DeveloperURL>([^<]+)<\//.exec(xmp)?.[1], 'https://x.com/pixhell');
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

// Start with an actual CLI-saved project and retain its embedded asset payload.
// Only its JSON recipe changes, the same way a desktop save stores animation.
const animatedProject = join(output, 'animation ü #1.gleech');
const blue = join(output, 'blue.png');
await sharp({ create: { width: 32, height: 16, channels: 4, background: '#0000ff' } })
  .png()
  .toFile(blue);
await cli([
  'render',
  blue,
  '-e',
  'solid:content=color,fillColor=#ff0000',
  '--renderer',
  'cpu',
  '-o',
  join(output, 'fixture.png'),
  '--save-project',
  animatedProject,
]);
const saved = await readFile(animatedProject);
const recipeLength = saved.readUInt32LE(8);
const recipe = JSON.parse(saved.subarray(12, 12 + recipeLength));
recipe.project.timeline = {
  version: 1,
  fps: 2,
  duration: 1.5,
  workArea: { start: 0.5, end: 1.5 },
  loop: true,
  seed: { mode: 'fixed', every: 2 },
  markers: [],
};
recipe.project.effects[0].animation = {
  amount: {
    keys: [
      { t: 0, value: 0, interpolation: 'linear' },
      { t: 1, value: 1, interpolation: 'linear' },
    ],
  },
};
async function saveTimeline(path, project) {
  const json = Buffer.from(JSON.stringify({ ...recipe, project }));
  const header = Buffer.from(saved.subarray(0, 12));
  header.writeUInt32LE(json.length, 8);
  await writeFile(path, Buffer.concat([header, json, saved.subarray(12 + recipeLength)]));
}
await saveTimeline(animatedProject, recipe.project);
const timelineArgs = ['render', animatedProject, '--timeline', '--renderer', 'cpu', '--json'];
await check('timeline CLI evaluates animated pixels and a nonzero range', async () => {
  const folder = join(output, 'animated-frames');
  const result = JSON.parse((await cli([...timelineArgs, '-f', 'png', '-o', folder])).stdout);
  assert.equal(result.frames, 3);
  assert.deepEqual(result.backends, ['cpu']);
  const names = (await readdir(folder)).sort();
  const values = await Promise.all(
    names.map(async (name) => [...(await pixels(join(folder, name))).subarray(0, 4)]),
  );
  assert.deepEqual(values, [
    [0, 0, 255, 255],
    [128, 0, 128, 255],
    [255, 0, 0, 255],
  ]);
  await assert.rejects(() => cli([...timelineArgs, '-f', 'png', '-o', folder]));
  const ranged = join(output, 'ranged-frames');
  const selected = JSON.parse(
    (await cli([...timelineArgs, '-f', 'png', '-o', ranged, '--range', 'work'])).stdout,
  );
  assert.deepEqual(selected.range, { start: 0.5, end: 1.5 });
  assert.equal(selected.frames, 2);
  assert.deepEqual(
    [...(await pixels(join(ranged, (await readdir(ranged)).sort()[0]))).subarray(0, 4)],
    [128, 0, 128, 255],
  );
  const still = join(output, 'timeline-as-still.png');
  await cli(['render', animatedProject, '--renderer', 'cpu', '-o', still]);
  assert.deepEqual([...(await pixels(still)).subarray(0, 4)], [255, 0, 0, 255]);
});
const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const builderOs =
  process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const ffmpeg = (
  packaged
    ? [resolve(dirname(entry), '..', 'ffmpeg', 'bin', ffmpegName)]
    : [
        resolve(root, `apps/desktop/out/ffmpeg/${builderOs}-${process.arch}/bin`, ffmpegName),
        resolve(
          root,
          `apps/desktop/resources/ffmpeg/${process.platform}-${process.arch}`,
          ffmpegName,
        ),
      ]
).find(existsSync);
if (!ffmpeg && process.argv.includes('--require-ffmpeg'))
  throw new Error('Prepare the pinned FFmpeg bundle before running CLI media checks.');
if (ffmpeg) {
  const media = (args) =>
    run(process.platform === 'win32' ? '.\\ffmpeg.exe' : './ffmpeg', args, {
      cwd: dirname(ffmpeg),
      windowsHide: true,
      timeout: 30000,
      encoding: 'buffer',
      maxBuffer: 8 * 1024 * 1024,
    });
  await check('timeline CLI encodes real MP4 and GIF animations', async () => {
    const movie = join(output, 'animated.mp4');
    const result = JSON.parse((await cli([...timelineArgs, '-o', movie, '--no-audio'])).stdout);
    assert.equal(result.frames, 3);
    const decoded = await media([
      '-v',
      'error',
      '-i',
      movie,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1',
    ]);
    assert.equal(decoded.stdout.length, 32 * 16 * 4 * 3);
    assert.ok(decoded.stdout[2] > 230 && decoded.stdout[0] < 20, 'First MP4 frame should be blue.');
    assert.ok(decoded.stdout[32 * 16 * 4 * 2] > 230, 'Last MP4 frame should be red.');
    const before = await readFile(movie);
    await assert.rejects(() => cli([...timelineArgs, '-o', movie]));
    assert.ok(before.equals(await readFile(movie)));
    await cli([...timelineArgs, '-o', movie, '-y', '--start', '0.5', '--end', '1', '--no-audio']);
    const gif = join(output, 'animated.gif');
    await cli([...timelineArgs, '-o', gif, '--fps', '10']);
    const animation = await sharp(gif, { animated: true }).metadata();
    assert.ok(animation.pages > 1);
    assert.equal(animation.width, 32);
    assert.equal(
      animation.delay.reduce((sum, delay) => sum + delay, 0),
      1500,
    );
  });
  await check('timeline CLI streams external clips, holds EOF and exports audio', async () => {
    const clip = join(output, 'clip ü #1.mp4');
    const audio = join(output, 'sound ü #1.wav');
    await media([
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=32x16:r=2:d=0.5',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=32x16:r=2:d=0.5',
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      clip,
    ]);
    await media(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio]);
    const project = structuredClone(recipe.project);
    project.effects = [];
    project.timeline.duration = 2;
    project.timeline.video = {
      path: 'clip ü #1.mp4',
      name: 'clip',
      width: 32,
      height: 16,
      fps: 2,
      duration: 1,
      hasAudio: false,
      posterId: project.source.id,
    };
    project.timeline.audio = {
      path: 'sound ü #1.wav',
      name: 'audio',
      duration: 2,
      sampleRate: 44100,
      channels: 1,
    };
    const file = join(output, 'video.gleech');
    await saveTimeline(file, project);
    const args = ['render', file, '--timeline', '--renderer', 'cpu'];
    const folder = join(output, 'clip-frames');
    await cli([...args, '-f', 'png', '-o', folder]);
    const names = (await readdir(folder)).sort();
    assert.equal(names.length, 4);
    const first = await pixels(join(folder, names[0]));
    const second = await pixels(join(folder, names[1]));
    assert.ok(first[0] > 230 && first[2] < 20, 'Clip frame, not the blue poster.');
    assert.ok(second[2] > 230 && second[0] < 20);
    assert.ok(
      second.equals(await pixels(join(folder, names[3]))),
      'EOF must hold the last video frame.',
    );
    const past = join(output, 'past-clip');
    await cli([...args, '-f', 'png', '-o', past, '--start', '1.5', '--end', '2']);
    assert.ok(second.equals(await pixels(join(past, (await readdir(past))[0]))));
    const movie = join(output, 'clip-with-audio.mp4');
    const partsArgs = [
      ...args,
      '-o',
      movie,
      '--memory-mode',
      'one-frame',
      '--segment-seconds',
      '1',
      '--keep-parts',
      '--json',
    ];
    const segmented = JSON.parse((await cli(partsArgs)).stdout);
    assert.equal(segmented.resumedFrames, 0);
    assert.equal(dirname(segmented.checkpointPath), output);
    const resumed = JSON.parse((await cli([...partsArgs, '--resume', '-y'])).stdout);
    assert.equal(resumed.resumedFrames, 4);
    const frames = (
      await media([
        '-v',
        'error',
        '-i',
        movie,
        '-map',
        '0:v:0',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        'pipe:1',
      ])
    ).stdout;
    assert.equal(frames.length, 4 * 32 * 16 * 4);
    assert.ok(frames[0] > 230 && frames[2] < 20);
    for (let index = 1; index < 4; index++) {
      const start = index * 32 * 16 * 4;
      assert.ok(
        frames[start + 2] > 230 && frames[start] < 20,
        'Parts must retain clip EOF frames.',
      );
    }
    const decoded = await media([
      '-v',
      'error',
      '-i',
      movie,
      '-map',
      '0:a:0',
      '-f',
      's16le',
      'pipe:1',
    ]);
    assert.ok(decoded.stdout.length > 44100);
  });
} else
  console.log('SKIP FFmpeg timeline encoding: prepare the pinned bundle with pnpm ffmpeg:prepare.');
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
  await check('timeline CLI renders animated stacks through the GPU adapter', async () => {
    const folder = join(output, 'gpu-timeline');
    const result = JSON.parse(
      (
        await cli([
          'render',
          animatedProject,
          '--timeline',
          '--shader',
          shader,
          '--renderer',
          'gpu',
          '-f',
          'png',
          '-o',
          folder,
          '--json',
        ])
      ).stdout,
    );
    assert.equal(result.frames, 3);
    assert.ok(result.backends.length > 0 && result.backends.every((backend) => backend !== 'cpu'));
    const names = (await readdir(folder)).sort();
    assert.notDeepEqual(await pixels(join(folder, names[0])), await pixels(join(folder, names[2])));
  });
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
