import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron } from './test-electron.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { captureTestWindow } from './capture-test-window.mjs';
import { candidate as historicalCandidate, targets } from './installed-acceptance-plan.mjs';

const run = promisify(execFile);
const key = `${process.platform}-${process.arch}`;
const root = resolve(import.meta.dirname, '..');
const releaseCandidate = process.env.GLEECH_RELEASE_CANDIDATE === '1';
if (releaseCandidate) assert.equal(process.env.GITHUB_ACTIONS, 'true');
const candidateDirectory = join(root, 'test-results/builtin-updater', key, 'release-candidate');
const inputs = releaseCandidate
  ? JSON.parse(await readFile(join(candidateDirectory, 'candidate-inputs.json'), 'utf8'))
  : null;
if (inputs) {
  assert.equal(inputs.target, key);
  assert.equal(inputs.version, '0.2.1');
  assert.equal(inputs.privateInstrumentation, false);
  assert.match(inputs.sha256, /^[a-f0-9]{64}$/);
  assert.equal(inputs.archive, targets[key].archive.replace('0.2.0', inputs.version));
}
const candidate = inputs
  ? {
      version: inputs.version,
      appsTree: inputs.sourceInputs.apps,
      packagesTree: inputs.sourceInputs.packages,
      lockBlob: inputs.sourceInputs['pnpm-lock.yaml'],
    }
  : historicalCandidate;
const target = releaseCandidate
  ? { archive: targets[key].archive.replace('0.2.0', '0.2.1'), sha256: inputs.sha256 }
  : targets[key];
const phase = process.argv[2];
assert.ok(
  target && ['install', 'exercise', 'uninstall'].includes(phase),
  'Usage: installed-package-check.mjs install|exercise|uninstall (native targets only)',
);
const output = resolve(
  root,
  releaseCandidate
    ? 'test-results/release-installed-acceptance'
    : 'test-results/installed-acceptance',
  key,
);
await mkdir(output, { recursive: true });
const reportPath = join(output, 'report.json');
const artifact = releaseCandidate
  ? join(candidateDirectory, target.archive)
  : process.platform === 'win32'
    ? resolve(root, 'public-release/release-0.2.0-2026-10-28', target.archive)
    : join(output, 'download', target.archive);
const installed =
  process.platform === 'darwin'
    ? '/Applications/GLEECH.app'
    : process.platform === 'win32'
      ? join(output, 'installed', 'GLEECH')
      : join(output, 'installed', target.archive);
const executable =
  process.platform === 'darwin'
    ? join(installed, 'Contents/MacOS/GLEECH')
    : process.platform === 'win32'
      ? join(installed, 'GLEECH.exe')
      : installed;
const resources =
  process.platform === 'darwin'
    ? join(installed, 'Contents/Resources')
    : process.platform === 'win32'
      ? join(installed, 'resources')
      : null;
const profile = join(output, 'profile');
const artwork = join(output, 'artwork');
const sentinel = join(artwork, 'keep-user-artwork.txt');
const sentinelContents = `GLEECH ${candidate.version} installed acceptance: preserve user artwork\n`;
const profileSentinel = join(profile, 'keep-user-profile.txt');
const env = { ...process.env, GLEECH_TEST_NATIVE_FRAMES: '1', GLEECH_NO_UPDATE_NOTIFIER: '1' };
for (const variable of [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'NODE_OPTIONS',
])
  delete env[variable];
if (process.platform === 'linux') env.APPIMAGE_EXTRACT_AND_RUN = '1';
let report;
if (phase === 'install') {
  await assert.rejects(access(installed), { code: 'ENOENT' });
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  assert.equal(hash.digest('hex'), target.sha256, 'Install only the reviewed package bytes.');
  for (const [path, expected] of [
    ['apps', candidate.appsTree],
    ['packages', candidate.packagesTree],
    ['pnpm-lock.yaml', candidate.lockBlob],
  ])
    assert.equal((await run('git', ['rev-parse', `HEAD:${path}`])).stdout.trim(), expected);
  report = {
    version: candidate.version,
    target: key,
    package: target.archive,
    sha256: target.sha256,
    startedAt: new Date().toISOString(),
    installed,
    phases: {},
    checks: [],
    limitations: [
      'Automated native acceptance uses isolated smoke profiles and substitutes file-picker selections.',
      'OS download quarantine/SmartScreen/Gatekeeper approval is not certified by this harness.',
      ...(process.platform === 'linux'
        ? [
            'Linux runs the documented AppImage extraction fallback under Xvfb; FUSE and a physical desktop are not certified.',
          ]
        : []),
      ...(process.platform !== 'win32'
        ? ['Hosted CPU checks do not certify physical GPU hardware or every desktop environment.']
        : []),
    ],
  };
  await mkdir(profile, { recursive: true });
  await mkdir(artwork, { recursive: true });
  await writeFile(sentinel, sentinelContents, { flag: 'wx' });
  await writeFile(profileSentinel, sentinelContents, { flag: 'wx' });
} else {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.target, key);
  assert.equal(report.installed, installed);
  assert.equal(report.sha256, target.sha256);
  assert.equal(report.phases.install, 'passed');
}
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
function command(file, args, options = {}) {
  // These tools run only from ordinary CI/workspace paths. Reject shell
  // metacharacters before invoking a program, including the Windows CMD lane.
  if (!/^[a-zA-Z0-9_./:\\ ()-]+$/.test(file)) throw new Error('Unsupported executable path.');
  return run(file, args, {
    env: options.env ?? env,
    timeout: options.timeout ?? 180000,
    maxBuffer: 8e6,
    windowsHide: true,
    shell: false,
  });
}
async function check(name, fn) {
  const started = Date.now();
  await fn();
  report.checks.push({ name, passed: true, durationMs: Date.now() - started });
  await save();
  console.log('PASS', name);
}
async function subprocess(name, file, args) {
  await check(name, async () => {
    assert.equal(file, process.execPath, 'Acceptance suites must use this Node runtime.');
    const result = await new Promise((accept, reject) => {
      const child = spawn(process.execPath, args, {
        env,
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '',
        timedOut = false;
      const timeout = 600000;
      const timer = setTimeout(() => {
        timedOut = true;
        // Kill only the process tree created for this suite. A surviving native
        // child can otherwise keep stdout open after the Node driver times out.
        if (process.platform === 'win32') {
          void run('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            windowsHide: true,
            shell: false,
          }).catch(() => {});
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (error) {
            if (error.code !== 'ESRCH') reject(error);
          }
        }
      }, timeout);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        process.stderr.write(chunk);
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        accept({ code, stdout, stderr, timedOut });
      });
    });
    await writeFile(join(output, name + '.log'), result.stdout + '\n' + result.stderr);
    assert.equal(
      result.timedOut,
      false,
      `${name} exceeded its bounded runtime; see the retained log.`,
    );
    assert.equal(result.code, 0, `${name} failed; see the retained log.`);
  });
}
try {
  if (phase === 'install') {
    await check('install-exact-candidate', async () => {
      if (process.platform === 'win32') {
        await mkdir(dirname(installed), { recursive: true });
        await command(artifact, ['/S', '/currentuser', '/D=' + installed]);
      } else if (process.platform === 'darwin') {
        const expanded = join(output, 'expanded');
        await command('ditto', ['-x', '-k', artifact, expanded]);
        await command('ditto', [join(expanded, 'GLEECH.app'), installed]);
      } else {
        await mkdir(dirname(installed), { recursive: true });
        await copyFile(artifact, installed);
        await chmod(installed, 0o755);
      }
      await access(executable);
      assert.equal((await lstat(installed)).isSymbolicLink(), false);
    });
    report.phases.install = 'passed';
  } else if (phase === 'exercise') {
    let app;
    await check('installed-runtime-and-resources', async () => {
      try {
        app = await electron.launch({
          executablePath: executable,
          args: ['--smoke-test', '--disable-gpu', '--disable-software-rasterizer'],
          env: { ...env, GLEECH_SMOKE_USER_DATA: profile },
          timeout: 60000,
        });
        const page = await app.firstWindow();
        await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
        const runtime = await app.evaluate(({ app }) => ({
          packaged: app.isPackaged,
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          executable: process.execPath,
          resources: process.resourcesPath,
          userData: app.getPath('userData'),
          appimage: process.env.APPIMAGE ?? null,
        }));
        assert.equal(runtime.packaged, true);
        assert.equal(runtime.version, candidate.version);
        assert.equal(runtime.platform + '-' + runtime.arch, key);
        assert.equal(resolve(runtime.userData), profile);
        if (process.platform === 'linux') assert.equal(resolve(runtime.appimage), installed);
        else assert.equal(resolve(runtime.executable).toLowerCase(), executable.toLowerCase());
        for (const file of ['ffmpeg', 'cli/gleech.cjs', 'mcp/server.cjs', 'THIRD_PARTY_NOTICES.md'])
          await access(join(runtime.resources, file));
        report.runtime = runtime;
        await captureTestWindow(app, join(output, 'installed-startup.png'));
      } finally {
        if (app) await closeTestApp(app);
      }
    });
    for (const [name, script] of [
      ['project-save-restart-export-and-masks', 'project-check.mjs'],
      ['preset-save-transfer-and-reopen', 'preset-transfer-check.mjs'],
      ['installed-local-mcp-and-shader-workflows', 'mcp-check.mjs'],
    ])
      await subprocess(name, process.execPath, [join('tooling', script), executable, '--cpu']);
    await copyFile(
      resolve('test-results/project-check/packaged-cpu.gleech'),
      join(artwork, 'acceptance.gleech'),
    );
    report.artworkSHA256 = createHash('sha256')
      .update(await readFile(join(artwork, 'acceptance.gleech')))
      .digest('hex');
    await check('installed-terminal-setup-render-and-clean-removal', async () => {
      const home = join(output, 'terminal-home');
      await mkdir(home, { recursive: true });
      const terminalEnv = {
        ...env,
        HOME: home,
        USERPROFILE: home,
        LOCALAPPDATA: join(home, 'AppData/Local'),
        ZDOTDIR: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        SHELL: '/bin/bash',
        GLEECH_USER_DATA: join(home, 'profile'),
        NO_COLOR: '1',
      };
      const launcher =
        process.platform === 'linux'
          ? installed
          : join(resources, 'cli', process.platform === 'win32' ? 'gleech.cmd' : 'gleech');
      async function invoke(args, file = launcher) {
        if (process.platform === 'win32') {
          const quoted = [file, ...args].map((item) => {
            if (!/^[a-zA-Z0-9_./:\\ ()-]+$/.test(item))
              throw new Error('Unsupported Windows launcher argument.');
            return '"' + item + '"';
          });
          return (
            await run('cmd.exe', ['/d', '/s', '/c', '"' + quoted.join(' ') + '"'], {
              env: terminalEnv,
              timeout: 180000,
              maxBuffer: 8e6,
              windowsHide: true,
              windowsVerbatimArguments: true,
              shell: false,
            })
          ).stdout;
        }
        if (process.platform !== 'linux' || file !== installed)
          return (await command(file, args, { env: terminalEnv })).stdout;
        return new Promise((accept, reject) => {
          const child = spawn(file, ['--cli', ...args], {
            env: { ...terminalEnv, GLEECH_CLI_RESTORE_STDOUT: '1' },
            stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
            timeout: 180000,
          });
          let stdout = '',
            stderr = '';
          child.stdio[3].on('data', (chunk) => {
            stdout += chunk;
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.once('error', reject);
          child.once('close', (code) => (code === 0 ? accept(stdout) : reject(new Error(stderr))));
        });
      }
      const registryPath = async () =>
        (await command('reg.exe', ['query', 'HKCU\\Environment', '/v', 'Path'])).stdout;
      const originalPath = process.platform === 'win32' ? await registryPath() : null;
      const stable =
        process.platform === 'win32'
          ? join(terminalEnv.LOCALAPPDATA, 'GLEECH/bin/gleech.cmd')
          : join(home, '.local/bin/gleech');
      assert.equal((await invoke(['--version'])).trim(), candidate.version);
      try {
        await invoke(['install-cli']);
        const text = await readFile(stable, 'utf8');
        assert.ok(text.includes('GLEECH managed terminal launcher'));
        assert.ok(!text.includes('/.mount_'));
        assert.equal((await invoke(['--version'], stable)).trim(), candidate.version);
        await invoke(['install-cli'], stable);
        const cliImage = join(artwork, 'terminal-render.png');
        await invoke(
          [
            'render',
            'sample',
            '--renderer',
            'cpu',
            '--max-size',
            '64',
            '-e',
            'rgb-split',
            '-o',
            cliImage,
          ],
          stable,
        );
        assert.ok(
          (await readFile(cliImage))
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        );
      } finally {
        await invoke(['uninstall-cli']);
      }
      await assert.rejects(access(stable), { code: 'ENOENT' });
      if (process.platform === 'win32')
        assert.equal(await registryPath(), originalPath, 'Restore the original user PATH exactly.');
      else assert.ok(!(await readFile(join(home, '.profile'), 'utf8')).includes('GLEECH CLI PATH'));
      report.terminalSetupRemoved = true;
    });
    report.phases.exercise = 'passed';
  } else {
    assert.equal(report.phases.exercise, 'passed');
    assert.equal(
      report.terminalSetupRemoved,
      true,
      'Remove terminal setup before removing the application.',
    );
    await check('uninstall-preserves-artwork-and-profile', async () => {
      // Only remove the exact installation owned by this persisted acceptance record.
      assert.equal(report.installed, installed);
      assert.equal((await lstat(installed)).isSymbolicLink(), false);
      if (process.platform === 'win32')
        await command(join(installed, 'Uninstall GLEECH.exe'), ['/S']);
      else await rm(installed, { recursive: process.platform === 'darwin' });
      // NSIS starts a temporary process; allow its documented asynchronous cleanup.
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try {
          await access(executable);
        } catch (error) {
          if (error.code === 'ENOENT') break;
          throw error;
        }
        await new Promise((done) => setTimeout(done, 250));
      }
      await assert.rejects(access(executable), { code: 'ENOENT' });
      assert.equal(await readFile(sentinel, 'utf8'), sentinelContents);
      assert.equal(await readFile(profileSentinel, 'utf8'), sentinelContents);
      assert.equal(
        createHash('sha256')
          .update(await readFile(join(artwork, 'acceptance.gleech')))
          .digest('hex'),
        report.artworkSHA256,
      );
    });
    report.phases.uninstall = 'passed';
    report.complete = true;
  }
  if (report.error) {
    report.resolvedFailures ??= [];
    report.resolvedFailures.push({ resolvedDuringPhase: phase, error: report.error });
    delete report.error;
  }
  report.updatedAt = new Date().toISOString();
  await save();
} catch (error) {
  if (phase === 'install') report.phases.install = 'failed';
  else if (phase === 'exercise') report.phases.exercise = 'failed';
  else report.phases.uninstall = 'failed';
  report.complete = false;
  report.error = String(error.stack ?? error);
  await save();
  throw error;
}
