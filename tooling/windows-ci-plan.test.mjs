import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { createWindowsPlan, needsDesktop } from './windows-ci-plan.mjs';

const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = load(
  readFileSync(new URL('../.github/workflows/windows.yml', import.meta.url), 'utf8'),
);
test('routine changes keep critical workflows without rebuilding or packaging', () => {
  const plan = createWindowsPlan('quick', scripts);
  assert.equal(plan.length, 7);
  for (const name of ['image', 'editing', 'project', 'preset-transfer', 'mcp'])
    assert.ok(
      plan.some(({ args }) => args[0] === `tooling/${name}-check.mjs` && args.includes('--cpu')),
    );
  assert.ok(plan.every(({ args, packaged }) => !packaged && existsSync(args[0])));
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
    !plan.some(({ args }) => args[0] === 'tooling/shader-check.mjs' && !args.includes('--cpu')),
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
test('one validation job retains manual full runs and release tags without routine packaging', () => {
  assert.deepEqual(Object.keys(workflow.jobs), ['validate']);
  assert.equal(workflow.on.workflow_dispatch.inputs.suite.default, 'quick');
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.suite.options, ['quick', 'full']);
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  const steps = workflow.jobs.validate.steps;
  assert.equal(steps.filter((step) => step.run === 'pnpm build').length, 1);
  assert.equal(steps.find((step) => step.run?.endsWith('pack:win')).if, "env.CI_SUITE == 'full'");
  assert.ok(steps.find((step) => step.run === 'pnpm check'));
  assert.ok(!workflow.on.pull_request?.paths && !workflow.on.pull_request?.['paths-ignore']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.ok(scripts.check.includes('pnpm build:tool:check'));
});
test('outside-contributor checks do not retain credentials or run in privileged contexts', () => {
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.validate['runs-on'], 'windows-latest');
  assert.equal(workflow.jobs.validate.environment, undefined);
  assert.equal(workflow.jobs.validate.env.ROARR_LOG, 'false');
  const checkout = workflow.jobs.validate.steps.find((step) =>
    step.uses?.startsWith('actions/checkout@'),
  );
  assert.equal(checkout.with['persist-credentials'], false);
  for (const step of workflow.jobs.validate.steps.filter((step) => step.uses))
    assert.match(step.uses, /^[a-z0-9-]+\/[a-z0-9-]+@[a-f0-9]{40}$/);
  assert.equal(workflow.on.workflow_dispatch.inputs.upload_package.default, false);
  const packageUpload = workflow.jobs.validate.steps.find(
    (step) => step.with?.name === 'gleech-windows-development',
  );
  assert.equal(packageUpload.if, "success() && env.CI_SUITE == 'full' && inputs.upload_package");
});
test('nonstandard future test commands cannot silently disappear from full verification', () => {
  assert.throws(
    () => createWindowsPlan('full', { ...scripts, 'test:future': 'echo skipped' }),
    /Unsupported/,
  );
  assert.throws(() => createWindowsPlan('quick', scripts, 'GLEECH.exe'), /Packaging/);
  assert.throws(() => createWindowsPlan('unknown', scripts), /quick or full/);
});
