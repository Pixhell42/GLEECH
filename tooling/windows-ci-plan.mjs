// Reuse local test commands without their repeated build step.
const nativeOnly = new Set([
  'tooling/ui-redesign-check.mjs',
  'tooling/slider-audit-check.mjs',
  'tooling/slider-panels-check.mjs',
  'tooling/depth-slider-check.mjs',
  'tooling/pattern-controls-check.mjs',
  'tooling/mask-paint-benchmark.mjs',
  'tooling/tiled-shapes-runtime-check.mjs',
  'tooling/ui-color-check.mjs',
]);

// These scripts deliberately assert a WebGPU backend or render imported GPU
// programs. Keep their CPU/unsupported-backend checks on hosted Windows; run
// their GPU variants on a physical adapter before accepting a release.
const physicalGpuChecks = new Set(
  [
    'cli',
    'shader',
    'shader-import',
    'shader-paste',
    'isf',
    'mcp',
    'beta-shaders',
    'library-polish',
    'reference-collection',
    'set2-resolution',
    'preview-performance',
    'stack-preview',
  ].map((name) => `tooling/${name}-check.mjs`),
);

export function selectWindowsLane(plan, lane = 'all') {
  if (!['all', 'hosted', 'gpu'].includes(lane)) throw new Error('Choose all, hosted or gpu lane.');
  if (lane === 'all') return plan;
  return plan.filter(({ args }) => {
    const gpu = physicalGpuChecks.has(args[0]) && !args.includes('--cpu');
    return lane === 'gpu' ? gpu : !gpu;
  });
}

export function needsDesktop(paths) {
  return (
    !paths.length || paths.some((path) => !/^(?:docs\/|[^/]+\.md$|LICENSE(?:\.md)?$)/.test(path))
  );
}

export function parseWindowsShard(value) {
  if (value === undefined) return null;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match || Number(match[1]) > Number(match[2]) || Number(match[2]) > 64)
    throw new Error('Provide --shard <index>/<count>, with 1 <= index <= count <= 64.');
  return { index: Number(match[1]), count: Number(match[2]) };
}

export function selectWindowsShard(plan, shard) {
  if (!shard) return plan;
  return plan.filter((_, index) => index % shard.count === shard.index - 1);
}

export function createWindowsPlan(mode, scripts, packagedPath) {
  if (!['quick', 'full'].includes(mode)) throw new Error('Choose quick or full CI.');
  if (packagedPath && mode !== 'full') throw new Error('Packaging belongs to full CI.');
  const commands = [];
  const seen = new Set();
  function add(args, packaged = false) {
    const command = { args, packaged };
    const key = JSON.stringify(command);
    if (!seen.has(key)) {
      seen.add(key);
      commands.push(command);
    }
  }
  add(['tooling/smoke.mjs']);
  add(['tooling/runtime-security-check.mjs']);
  if (mode === 'quick') {
    for (const script of ['image', 'editing', 'project', 'preset-transfer', 'mcp'])
      add([`tooling/${script}-check.mjs`, '--cpu']);
    add(['tooling/cli-check.mjs', '--cpu', '--require-ffmpeg']);
    add(['tooling/ui-color-check.mjs']);
    add(['tooling/ffmpeg-check.mjs']);
    add(['tooling/timeline-check.mjs', '--require-ffmpeg']);
    add(['tooling/timeline-media-check.mjs', '--require-ffmpeg']);
    add(['tooling/render-memory-check.mjs']);
    add(['tooling/open-file-check.mjs']);
    add(['tooling/updates-check.mjs']);
    add(['tooling/terminal-updates-check.mjs']);
    return commands;
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('test:') || ['test:watch', 'test:smoke'].includes(name)) continue;
    const parts = command.split(' && ');
    if (parts.shift() !== 'pnpm build') throw new Error(`Unsupported CI test script: ${name}`);
    for (const part of parts) {
      if (!/^node tooling\/[a-z0-9-]+\.mjs(?: --[a-z0-9-]+)*$/.test(part))
        throw new Error(`Unsupported CI command in ${name}: ${part}`);
      const args = part.split(' ').slice(1);
      add(args);
    }
  }
  if (packagedPath) {
    add(['tooling/smoke.mjs', packagedPath], true);
    for (const { args } of [...commands]) {
      if (args[0] === 'tooling/smoke.mjs' || nativeOnly.has(args[0])) continue;
      add([args[0], packagedPath, ...args.slice(1)], true);
    }
  }
  return commands;
}
