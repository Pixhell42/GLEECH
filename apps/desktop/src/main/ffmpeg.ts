import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { access, readFile, writeFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { FfmpegStatus } from '../shared/render';

/**
 * Finds the ffmpeg executable GLEECH uses for video and GIF encoding and media
 * decoding. Order: the bundled copy, a user-chosen copy, then the PATH.
 */
export interface FfmpegLocator {
  status(refresh?: boolean): Promise<FfmpegStatus>;
  /** Remember a user-chosen executable; validates it first. */
  configure(path: string | null): Promise<FfmpegStatus>;
  /** The executable path, or a clear error when ffmpeg is unavailable. */
  require(): Promise<string>;
}

const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

export function bundledFfmpegCandidates(
  resourcesPath: string,
  appPath: string,
  packaged: boolean,
): string[] {
  const platformDir = `${process.platform}-${process.arch}`;
  return packaged
    ? [
        join(resourcesPath, 'ffmpeg', executable),
        join(resourcesPath, 'ffmpeg', platformDir, executable),
      ]
    : [
        join(appPath, 'resources', 'ffmpeg', platformDir, executable),
        join(appPath, 'resources', 'ffmpeg', executable),
      ];
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(): Promise<string | null> {
  for (const directory of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory.replace(/^"|"$/g, ''), executable);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

/** Run a short ffmpeg query and collect its output. */
export function runFfmpeg(
  path: string,
  args: readonly string[],
  timeoutMs = 15000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('ffmpeg did not respond.'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length < 4 * 1024 * 1024) stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < 4 * 1024 * 1024) stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export function parseEncoders(listing: string): string[] {
  const encoders: string[] = [];
  for (const line of listing.split(/\r?\n/)) {
    const match = /^\s[VAS][F.][S.][X.][B.][D.]\s+(\S+)/.exec(line);
    if (match?.[1] && match[1] !== '=') encoders.push(match[1]);
  }
  return encoders;
}

async function probe(path: string, source: FfmpegStatus['source']): Promise<FfmpegStatus> {
  try {
    const version = await runFfmpeg(path, ['-hide_banner', '-version']);
    if (version.code !== 0) throw new Error('ffmpeg did not start.');
    const encoders = await runFfmpeg(path, ['-hide_banner', '-encoders']);
    return {
      available: true,
      source,
      path,
      version: /ffmpeg version (\S+)/.exec(version.stdout)?.[1] ?? 'unknown',
      encoders: parseEncoders(encoders.stdout),
    };
  } catch (error) {
    return {
      available: false,
      source,
      path,
      version: null,
      encoders: [],
      error: error instanceof Error ? error.message : 'ffmpeg could not be started.',
    };
  }
}

export function createFfmpegLocator(options: {
  configFile: string;
  bundled: readonly string[];
}): FfmpegLocator {
  let cached: Promise<FfmpegStatus> | null = null;
  async function configured(): Promise<string | null> {
    try {
      const value = JSON.parse(await readFile(options.configFile, 'utf8')) as { path?: unknown };
      return typeof value.path === 'string' && value.path ? value.path : null;
    } catch {
      return null;
    }
  }
  async function resolveStatus(): Promise<FfmpegStatus> {
    for (const candidate of options.bundled)
      if (await isExecutable(candidate)) {
        const status = await probe(candidate, 'bundled');
        if (status.available) return status;
      }
    const chosen = await configured();
    if (chosen && (await isExecutable(chosen))) {
      const status = await probe(chosen, 'configured');
      if (status.available) return status;
    }
    const onPath = await findOnPath();
    if (onPath) {
      const status = await probe(onPath, 'path');
      if (status.available) return status;
    }
    return {
      available: false,
      source: 'none',
      path: null,
      version: null,
      encoders: [],
      error:
        'ffmpeg was not found. Locate ffmpeg to render movies; image sequences and flip books still work.',
    };
  }
  const locator: FfmpegLocator = {
    status(refresh = false) {
      if (refresh || !cached) cached = resolveStatus();
      return cached;
    },
    async configure(path) {
      if (path !== null) {
        if (!(await isExecutable(path))) throw new Error('Choose the ffmpeg executable.');
        const status = await probe(path, 'configured');
        if (!status.available)
          throw new Error(status.error ?? 'That file is not a working ffmpeg.');
      }
      const temporary = options.configFile + '.tmp';
      await writeFile(temporary, JSON.stringify(path ? { path } : {}));
      await rename(temporary, options.configFile);
      return locator.status(true);
    },
    async require() {
      const status = await locator.status();
      if (!status.available || !status.path)
        throw new Error(status.error ?? 'ffmpeg is not available.');
      return status.path;
    },
  };
  return locator;
}

export type FfmpegProcess = ChildProcessByStdio<Writable, Readable, Readable>;
/** Spawn a long-running ffmpeg with piped stdio. */
export function spawnFfmpeg(path: string, args: readonly string[]): FfmpegProcess {
  return spawn(path, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}
