import { spawn, spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWindowsPlan,
  needsDesktop,
  parseWindowsShard,
  selectWindowsShard,
  selectWindowsLane,
} from './windows-ci-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [mode, ...options] = process.argv.slice(2);
if (mode === 'classify') {
  const base = process.env.CI_BASE_SHA;
  let desktop = true;
  if (process.env.CI_SUITE !== 'full' && /^[a-f0-9]{40}$/.test(base ?? '') && !/^0+$/.test(base)) {
    const diff = spawnSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (diff.status === 0) desktop = needsDesktop(diff.stdout.split('\0').filter(Boolean));
  }
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `desktop=${desktop}\n`);
  console.log(
    desktop
      ? 'Desktop verification required.'
      : 'Documentation only: code checks run; desktop build/render/package checks skipped.',
  );
} else {
  const packagedIndex = options.indexOf('--packaged');
  const packagedPath = packagedIndex >= 0 ? options[packagedIndex + 1] : undefined;
  if (packagedIndex >= 0 && !packagedPath) throw new Error('Provide the packaged executable path.');
  const shardIndex = options.indexOf('--shard');
  if (shardIndex >= 0 && !options[shardIndex + 1])
    throw new Error('Provide the shard index/count.');
  const shard = parseWindowsShard(shardIndex >= 0 ? options[shardIndex + 1] : undefined);
  if (shard && mode !== 'full') throw new Error('Sharding belongs to full CI.');
  const laneIndex = options.indexOf('--lane');
  const lane = laneIndex >= 0 ? options[laneIndex + 1] : 'all';
  if (laneIndex >= 0 && (!lane || mode !== 'full'))
    throw new Error('Provide --lane all/hosted/gpu for full CI only.');
  const expected = options.includes('--list') ? ['--list'] : [];
  if (packagedPath) expected.push('--packaged', packagedPath);
  if (shard) expected.push('--shard', options[shardIndex + 1]);
  if (laneIndex >= 0) expected.push('--lane', lane);
  if (options.length !== expected.length || options.some((arg) => !expected.includes(arg)))
    throw new Error(
      'Use quick/full, optional --list, --packaged <path>, and full-only --shard <index>/<count> and --lane all/hosted/gpu.',
    );
  const { scripts } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const allChecks = createWindowsPlan(mode, scripts, packagedPath);
  const laneChecks = selectWindowsLane(allChecks, lane);
  const plan = selectWindowsShard(laneChecks, shard);
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).stdout?.trim();
  for (const command of plan) await access(resolve(root, command.args[0]));
  if (options.includes('--list')) {
    console.log(
      JSON.stringify(
        {
          mode,
          lane,
          shard,
          totalChecks: allChecks.length,
          laneChecks: laneChecks.length,
          commands: plan,
        },
        null,
        2,
      ),
    );
  } else {
    if (packagedPath) await access(resolve(root, packagedPath));
    const output = resolve(root, 'test-results/windows-ci');
    await mkdir(output, { recursive: true });
    const results = [];
    for (const command of plan) {
      const label = `${command.packaged ? 'Packaged' : 'Built'}: node ${command.args.join(' ')}`;
      console.log(`\n${label}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::group::${label}`);
      const started = Date.now();
      const status = await new Promise((accept, reject) => {
        const child = spawn(process.execPath, command.args, {
          cwd: root,
          stdio: 'inherit',
          windowsHide: true,
        });
        child.once('error', reject);
        child.once('close', (code) => accept(code ?? 1));
      });
      if (process.env.GITHUB_ACTIONS) console.log('::endgroup::');
      results.push({ ...command, status, seconds: (Date.now() - started) / 1000 });
      await writeFile(
        resolve(
          output,
          `${mode}${lane !== 'all' ? `-${lane}` : ''}${shard ? `-${shard.index}-of-${shard.count}` : ''}-result.json`,
        ),
        JSON.stringify(
          {
            mode,
            lane,
            shard,
            sourceCommit,
            totalChecks: plan.length,
            fullChecks: allChecks.length,
            results,
          },
          null,
          2,
        ),
      );
      if (status !== 0) {
        console.error(`CI check failed: ${label}`);
        process.exitCode = 1;
        if (mode !== 'full') break;
      }
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Windows ${mode} (${lane})${shard ? ` ${shard.index}/${shard.count}` : ''} checks\n\n${results.filter((result) => result.status === 0).length}/${plan.length} checks passed.\n\n` +
          results
            .map(
              (result) =>
                `- ${result.status === 0 ? 'Passed' : 'Failed'}: ${result.args.join(' ')} (${result.seconds.toFixed(1)}s)\n`,
            )
            .join(''),
      );
    }
  }
}
