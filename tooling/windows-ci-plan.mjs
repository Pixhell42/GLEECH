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

export function needsDesktop(paths) {
  return (
    !paths.length || paths.some((path) => !/^(?:docs\/|[^/]+\.md$|LICENSE(?:\.md)?$)/.test(path))
  );
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
  if (mode === 'quick') {
    for (const script of ['image', 'editing', 'project', 'preset-transfer', 'mcp'])
      add([`tooling/${script}-check.mjs`, '--cpu']);
    add(['tooling/ui-color-check.mjs']);
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
      // The strict GPU-only check needs hardware hosted Windows does not promise.
      // Other shader workflows retain automatic backend selection and CPU checks.
      if (args[0] === 'tooling/shader-check.mjs' && !args.includes('--cpu')) continue;
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
