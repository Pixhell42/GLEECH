import { spawn, spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWindowsPlan, needsDesktop } from './windows-ci-plan.mjs';

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
  const expected = options.includes('--list') ? ['--list'] : [];
  if (packagedPath) expected.push('--packaged', packagedPath);
  if (options.length !== expected.length || options.some((arg) => !expected.includes(arg)))
    throw new Error('Use quick/full, optional --list, and optional --packaged <path>.');
  const { scripts } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const plan = createWindowsPlan(mode, scripts, packagedPath);
  for (const command of plan) await access(resolve(root, command.args[0]));
  if (options.includes('--list')) {
    console.log(JSON.stringify({ mode, commands: plan }, null, 2));
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
        resolve(output, `${mode}-result.json`),
        JSON.stringify({ mode, results }, null, 2),
      );
      if (status !== 0) {
        console.error(`CI stopped at the first failing check: ${label}`);
        process.exitCode = 1;
        break;
      }
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Windows ${mode} checks\n\n${results.filter((result) => result.status === 0).length}/${plan.length} checks passed.\n\n` +
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
