import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { needsNativeTestFrames } from './test-electron.mjs';
import {
  createWindowsPlan,
  needsDesktop,
  parseWindowsShard,
  selectWindowsShard,
  selectWindowsLane,
} from './windows-ci-plan.mjs';

const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = load(
  readFileSync(new URL('../.github/workflows/windows.yml', import.meta.url), 'utf8'),
);

test('native test frames require an isolated smoke profile and explicit test environment', () => {
  const options = { args: ['app', '--smoke-test'], env: { GLEECH_SMOKE_USER_DATA: 'profile' } };
  assert.equal(needsNativeTestFrames(options, {}), false);
  assert.equal(needsNativeTestFrames(options, { GITHUB_ACTIONS: 'true' }), true);
  assert.equal(needsNativeTestFrames(options, { GLEECH_TEST_NATIVE_FRAMES: '1' }), true);
  assert.equal(
    needsNativeTestFrames({ ...options, args: ['app'] }, { GITHUB_ACTIONS: 'true' }),
    false,
  );
  assert.equal(needsNativeTestFrames({ ...options, env: {} }, { GITHUB_ACTIONS: 'true' }), false);
});
test('routine changes keep critical workflows without rebuilding or packaging', () => {
  const plan = createWindowsPlan('quick', scripts);
  assert.equal(plan.length, 11);
  for (const name of ['image', 'editing', 'project', 'preset-transfer', 'mcp', 'cli'])
    assert.ok(
      plan.some(({ args }) => args[0] === `tooling/${name}-check.mjs` && args.includes('--cpu')),
    );
  assert.ok(plan.every(({ args, packaged }) => !packaged && existsSync(args[0])));
});

test('required quick checks exercise timeline media with the pinned FFmpeg bundle', () => {
  const plan = createWindowsPlan('quick', scripts).map(({ args }) => args[0]);
  const bridge = plan.indexOf('tooling/ffmpeg-check.mjs');
  assert.ok(bridge >= 0);
  assert.ok(plan.indexOf('tooling/timeline-check.mjs') > bridge);
  assert.ok(plan.indexOf('tooling/timeline-media-check.mjs') > bridge);
  const steps = workflow.jobs.desktop.steps;
  const prepare = steps.findIndex((step) => step.run === 'pnpm ffmpeg:prepare');
  assert.ok(prepare > steps.findIndex((step) => step.run === 'pnpm build'));
  assert.ok(prepare < steps.findIndex((step) => step.run === 'node tooling/windows-ci.mjs quick'));
  assert.equal(steps[prepare].if, "steps.scope.outputs.desktop == 'true'");
});
test('full checks retain actual scripts, flags and packaged support without fake filenames', () => {
  const plan = createWindowsPlan('full', scripts, 'GLEECH.exe');
  assert.ok(plan.every(({ args }) => existsSync(args[0])));
  assert.equal(new Set(plan.map((entry) => JSON.stringify(entry))).size, plan.length);
  for (const filename of ['ui-redesign', 'pattern-controls', 'ui-color', 'slider-panels']) {
    assert.ok(plan.some(({ args }) => args[0] === `tooling/${filename}-check.mjs`));
    assert.ok(
      !plan.some(({ args, packaged }) => packaged && args[0] === `tooling/${filename}-check.mjs`),
    );
  }
  for (const filename of ['document', 'shader', 'mcp', 'mcp-clients', 'file-metadata'])
    assert.ok(
      plan.some(({ args, packaged }) => packaged && args[0] === `tooling/${filename}-check.mjs`),
    );
  assert.ok(
    plan.some(
      ({ args, packaged }) =>
        packaged &&
        args[0] === 'tooling/reference-collection-check.mjs' &&
        args.includes('--creative-suite') &&
        args.includes('--cpu'),
    ),
  );
  assert.ok(
    plan.some(({ args }) => args[0] === 'tooling/shader-check.mjs' && !args.includes('--cpu')),
  );
});
test('docs skip desktop work while code, assets, dependencies and workflows do not', () => {
  assert.equal(needsDesktop(['docs/MCP.md', 'README.md', 'CONTRIBUTING.md', 'LICENSE']), false);
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'apps/desktop/src/main/index.ts',
    'apps/desktop/src/renderer/src/assets/logo.svg',
    '.github/workflows/windows.yml',
  ])
    assert.equal(needsDesktop(['README.md', file]), true);
  assert.equal(needsDesktop([]), true);
});
test('stable validation gate requires code checks and the selected desktop suite', () => {
  assert.deepEqual(Object.keys(workflow.jobs), ['checks', 'desktop', 'full', 'validate']);
  assert.equal(workflow.on.workflow_dispatch.inputs.suite.default, 'quick');
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.suite.options, ['quick', 'full']);
  const steps = workflow.jobs.desktop.steps;
  assert.equal(steps.filter((step) => step.run === 'pnpm build').length, 1);
  assert.ok(!steps.some((step) => step.run?.includes('pack:win')));
  assert.ok(workflow.jobs.checks.steps.find((step) => step.run === 'pnpm check'));
  assert.deepEqual(workflow.jobs.validate.needs, ['checks', 'desktop', 'full']);
  assert.equal(workflow.jobs.full.strategy['fail-fast'], false);
  assert.equal(workflow.jobs.full.strategy['max-parallel'], 6);
  assert.deepEqual(
    workflow.jobs.full.strategy.matrix.shard,
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  assert.equal(workflow.jobs.full.steps.filter((step) => step.run === 'pnpm build').length, 1);
  assert.equal(workflow.jobs.full.steps.filter((step) => step.run?.endsWith('pack:win')).length, 1);
  assert.ok(
    workflow.jobs.full.steps.some((step) => step.run?.endsWith('--shard ${{ matrix.shard }}/12')),
  );
  assert.ok(workflow.jobs.full.steps.some((step) => step.run?.includes('--lane hosted')));
  assert.ok(!workflow.on.pull_request?.paths && !workflow.on.pull_request?.['paths-ignore']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.ok(scripts.check.includes('pnpm build:tool:check'));
});
test('release publication never triggers duplicate CI and full validation is explicit', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push, { branches: ['main'] });
  assert.equal(workflow.env.CI_SUITE, "${{ inputs.suite || 'quick' }}");
  assert.equal(
    workflow.jobs.full.if,
    "github.event_name == 'workflow_dispatch' && inputs.suite == 'full'",
  );
  // Manual quick runs remain quick even when targeting a tag.
  assert.equal(workflow.jobs.desktop.if, "inputs.suite != 'full'");
});

test('manual cancellation cannot fail or replace the required merge check', () => {
  assert.equal(
    workflow.jobs.validate.name,
    "${{ github.event_name == 'workflow_dispatch' && 'manual-validate' || 'validate' }}",
  );
  assert.equal(
    workflow.jobs.validate.if,
    "${{ github.event_name != 'workflow_dispatch' || !cancelled() }}",
  );
});

test('manual full validation is isolated from automatic quick-run cancellation', () => {
  assert.equal(
    workflow.concurrency.group,
    "windows-${{ github.workflow }}-${{ github.ref }}-${{ inputs.suite || 'quick' }}",
  );
  assert.equal(
    workflow.concurrency['cancel-in-progress'],
    "${{ github.event_name == 'pull_request' || github.event_name == 'push' }}",
  );
});

test('outside-contributor checks do not retain credentials or run in privileged contexts', () => {
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.env.ROARR_LOG, 'false');
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['runs-on'], 'windows-latest');
    assert.equal(job.environment, undefined);
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    if (checkout) assert.equal(checkout.with['persist-credentials'], false);
    for (const step of job.steps.filter((step) => step.uses))
      assert.match(step.uses, /^[a-z0-9-]+\/[a-z0-9-]+@[a-f0-9]{40}$/);
  }
  assert.equal(workflow.on.workflow_dispatch.inputs.upload_package.default, false);
  const packageUpload = workflow.jobs.full.steps.find(
    (step) => step.with?.name === 'gleech-windows-development',
  );
  assert.equal(packageUpload.if, 'success() && matrix.shard == 1 && inputs.upload_package');
  const failures = workflow.jobs.full.steps.find((step) => step.if === 'failure()');
  assert.equal(failures.with.name, 'desktop-diagnostics-full-${{ matrix.shard }}');
});

test('full shards cover every built and packaged command exactly once', () => {
  const plan = createWindowsPlan('full', scripts, 'GLEECH.exe');
  const shards = workflow.jobs.full.strategy.matrix.shard.map((index) =>
    selectWindowsShard(plan, parseWindowsShard(`${index}/12`)),
  );
  const keys = shards.flat().map((command) => JSON.stringify(command));
  assert.equal(keys.length, plan.length);
  assert.equal(new Set(keys).size, plan.length);
  assert.deepEqual(keys.sort(), plan.map((command) => JSON.stringify(command)).sort());
  assert.ok(shards.every((shard) => shard.length >= Math.floor(plan.length / 12)));
  for (const shard of shards)
    assert.deepEqual(
      shard.map((command) => plan.indexOf(command)),
      shard.map((command) => plan.indexOf(command)).sort((a, b) => a - b),
    );
});

test('invalid shard definitions cannot silently omit checks', () => {
  assert.equal(parseWindowsShard(undefined), null);
  for (const value of ['', '0/12', '13/12', '1/0', '1/65', 'x/12', '1.5/12', '1/12/3'])
    assert.throws(() => parseWindowsShard(value), /shard/);
});

test('hosted and physical-GPU lanes partition the complete release plan without omissions', () => {
  const all = createWindowsPlan('full', scripts, 'GLEECH.exe');
  const hosted = selectWindowsLane(all, 'hosted');
  const gpu = selectWindowsLane(all, 'gpu');
  const keys = [...hosted, ...gpu].map((command) => JSON.stringify(command));
  assert.equal(new Set(keys).size, all.length);
  assert.equal(keys.length, all.length);
  assert.deepEqual(keys.sort(), all.map((command) => JSON.stringify(command)).sort());
  assert.ok(gpu.length > 0 && hosted.length > gpu.length);
  assert.ok(gpu.every(({ args }) => !args.includes('--cpu')));
  for (const command of gpu) {
    assert.ok(
      hosted.some(
        ({ args, packaged }) =>
          packaged === command.packaged && args[0] === command.args[0] && args.includes('--cpu'),
      ),
      `Missing CPU coverage for ${command.args.join(' ')}`,
    );
  }
  assert.throws(() => selectWindowsLane(all, 'unknown'), /lane/);
});

test('the CLI preserves the exact commands in each backend lane', () => {
  const all = createWindowsPlan('full', scripts, 'GLEECH.exe');
  for (const lane of ['hosted', 'gpu']) {
    const result = spawnSync(
      process.execPath,
      ['tooling/windows-ci.mjs', 'full', '--list', '--packaged', 'GLEECH.exe', '--lane', lane],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    const listed = JSON.parse(result.stdout);
    assert.equal(listed.totalChecks, all.length);
    assert.equal(listed.lane, lane);
    assert.deepEqual(listed.commands, selectWindowsLane(all, lane));
  }
});

test('the CI command line applies its shard to the actual full plan', () => {
  const result = spawnSync(
    process.execPath,
    ['tooling/windows-ci.mjs', 'full', '--list', '--packaged', 'GLEECH.exe', '--shard', '12/12'],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const listed = JSON.parse(result.stdout);
  const all = createWindowsPlan('full', scripts, 'GLEECH.exe');
  assert.equal(listed.totalChecks, all.length);
  assert.deepEqual(listed.shard, { index: 12, count: 12 });
  assert.deepEqual(
    listed.commands,
    all.filter((_, index) => index % 12 === 11),
  );
  const invalid = spawnSync(
    process.execPath,
    ['tooling/windows-ci.mjs', 'quick', '--list', '--shard', '1/12'],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Sharding belongs to full CI/);
});

test(
  'validation gate rejects failed, cancelled or missing required suites',
  { skip: process.platform !== 'win32' },
  () => {
    const code = workflow.jobs.validate.steps[0].run;
    for (const [suite, checks, desktop, full, success] of [
      ['quick', 'success', 'success', 'skipped', true],
      ['full', 'success', 'skipped', 'success', true],
      ['quick', 'failure', 'success', 'skipped', false],
      ['quick', 'success', 'failure', 'skipped', false],
      ['quick', 'success', 'cancelled', 'skipped', false],
      ['full', 'failure', 'skipped', 'success', false],
      ['full', 'cancelled', 'skipped', 'success', false],
      ['full', 'success', 'skipped', 'failure', false],
      ['full', 'success', 'skipped', 'cancelled', false],
      ['full', 'success', 'skipped', 'skipped', false],
      ['quick', 'success', 'skipped', 'skipped', false],
    ]) {
      const result = spawnSync(
        process.env.GITHUB_ACTIONS === 'true' ? 'pwsh.exe' : 'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', code],
        {
          encoding: 'utf8',
          windowsHide: true,
          // Hosted Windows runners can take longer to start a cold PowerShell process.
          timeout: 60000,
          env: {
            ...process.env,
            CI_SUITE: suite,
            CI_NEEDS: JSON.stringify({
              checks: { result: checks },
              desktop: { result: desktop },
              full: { result: full },
            }),
          },
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status === 0, success, `${suite}: ${checks}/${desktop}/${full}`);
    }
  },
);
test('nonstandard future test commands cannot silently disappear from full verification', () => {
  assert.throws(
    () => createWindowsPlan('full', { ...scripts, 'test:future': 'echo skipped' }),
    /Unsupported/,
  );
  assert.throws(() => createWindowsPlan('quick', scripts, 'GLEECH.exe'), /Packaging/);
  assert.throws(() => createWindowsPlan('unknown', scripts), /quick or full/);
});

test('terminal CPU checks stay hosted and required shader checks use the GPU lane', () => {
  const plan = createWindowsPlan('full', scripts, 'GLEECH.exe');
  const hosted = selectWindowsLane(plan, 'hosted').filter(
    (entry) => entry.args[0] === 'tooling/cli-check.mjs',
  );
  const gpu = selectWindowsLane(plan, 'gpu').filter(
    (entry) => entry.args[0] === 'tooling/cli-check.mjs',
  );
  assert.equal(hosted.length, 2);
  assert.ok(hosted.every((entry) => entry.args.includes('--cpu')));
  assert.equal(gpu.length, 2);
  assert.ok(gpu.every((entry) => entry.args.includes('--require-gpu')));
});
