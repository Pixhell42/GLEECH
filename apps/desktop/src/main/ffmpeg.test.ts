import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledFfmpegCandidates, createFfmpegLocator, runFfmpeg, spawnFfmpeg } from './ffmpeg';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

let directory: string;
let bundled: string;
let chosen: string;
let configFile: string;
let broken: string | null;
const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gleech-ffmpeg-locator-'));
  bundled = join(directory, 'bundled', executable);
  chosen = join(directory, 'chosen', executable);
  configFile = join(directory, 'ffmpeg.json');
  for (const file of [bundled, chosen]) {
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'test executable');
    await chmod(file, 0o755);
  }
  broken = null;
  vi.stubEnv('PATH', directory);
  vi.mocked(spawn).mockImplementation((file, args, options) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.end(
        args?.includes('-encoders')
          ? ' V....D libx264 H.264\n V....D libx265 HEVC\n'
          : 'ffmpeg version 9.0.2-test\n',
      );
      child.stderr.end();
      child.emit('close', join(String(options?.cwd ?? ''), String(file)) === broken ? 1 : 0);
    });
    return child as unknown as ReturnType<typeof spawn>;
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('FFmpeg selection', () => {
  it('rejects command strings and other programs before spawning anything', async () => {
    for (const path of [
      executable,
      `${chosen} --help`,
      join(directory, 'node.exe'),
      join(directory, 'ffmpeg.cmd'),
      chosen + '\0',
    ]) {
      await expect(runFfmpeg(path, ['-version'])).rejects.toThrow(/full file path/);
      expect(() => spawnFfmpeg(path, [])).toThrow(/full file path/);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('runs the fixed binary without a shell in the selected directory', async () => {
    const folder = join(directory, 'chosen copy & more');
    const path = join(folder, executable);
    await mkdir(folder);
    await writeFile(path, 'test executable');
    await chmod(path, 0o755);
    await runFfmpeg(path, ['-version']);
    expect(spawn).toHaveBeenCalledWith(
      process.platform === 'win32' ? '.\\ffmpeg.exe' : './ffmpeg',
      ['-version'],
      expect.objectContaining({ cwd: folder, shell: false }),
    );
  });

  it('prefers Locate ffmpeg over a working bundled copy and restores the bundle when cleared', async () => {
    const locator = createFfmpegLocator({ configFile, bundled: [bundled] });
    expect(await locator.status()).toMatchObject({ path: bundled, source: 'bundled' });
    expect(await locator.configure(chosen)).toMatchObject({ path: chosen, source: 'configured' });
    const reopened = createFfmpegLocator({ configFile, bundled: [bundled] });
    expect(await reopened.require()).toBe(chosen);
    expect(await reopened.configure(null)).toMatchObject({ path: bundled, source: 'bundled' });
  });

  it('falls back to the bundle if the configured executable is missing or broken', async () => {
    await writeFile(configFile, JSON.stringify({ path: join(directory, 'missing') }));
    const locator = createFfmpegLocator({ configFile, bundled: [bundled] });
    expect(await locator.require()).toBe(bundled);
    await writeFile(configFile, JSON.stringify({ path: chosen }));
    broken = chosen;
    expect(await locator.status(true)).toMatchObject({ path: bundled, source: 'bundled' });
    await expect(locator.configure(chosen)).rejects.toThrow('ffmpeg did not start');
  });

  it('uses PATH when neither configured nor bundled executables work', async () => {
    const onPath = join(directory, executable);
    await writeFile(onPath, 'PATH executable');
    await chmod(onPath, 0o755);
    broken = bundled;
    const locator = createFfmpegLocator({ configFile, bundled: [bundled] });
    expect(await locator.status()).toMatchObject({
      path: onPath,
      source: 'path',
      encoders: ['libx264', 'libx265'],
    });
  });

  it('finds bin-layout bundles in packaged and prepared development apps', async () => {
    const packaged = bundledFfmpegCandidates(directory, directory, true);
    expect(packaged[0]).toBe(join(directory, 'ffmpeg', 'bin', executable));
    const development = bundledFfmpegCandidates('', directory, false);
    expect(development[0]).toContain(join('out', 'ffmpeg'));
    expect(development[0]).toContain(join('bin', executable));
    await mkdir(join(directory, 'ffmpeg/bin'), { recursive: true });
    await writeFile(packaged[0]!, 'packaged executable');
    await chmod(packaged[0]!, 0o755);
    const locator = createFfmpegLocator({ configFile, bundled: packaged });
    expect(await locator.require()).toBe(packaged[0]);
  });
});
