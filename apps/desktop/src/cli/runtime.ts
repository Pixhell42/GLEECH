import { openSync, closeSync } from 'node:fs';
import { ReadStream, isatty } from 'node:tty';
import type sharpModule from 'sharp';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { InferenceSession, Tensor } from 'onnxruntime-node';

type Sharp = typeof sharpModule;
type Electronish = NodeJS.Process & { resourcesPath?: string };

// The CLI is always built as CommonJS; use its module location, not argv[1].
// That keeps resource/native lookup independent of user-supplied input paths.
function entryDirectory(): string {
  return typeof __dirname === 'string' ? __dirname : process.cwd();
}
const here = entryDirectory();
const resourcesPath = (process as Electronish).resourcesPath;

/**
 * Where native dependencies may live. Development builds resolve from the
 * workspace; packaged builds run this bundle with GLEECH's embedded runtime
 * (ELECTRON_RUN_AS_NODE), whose modules live inside app.asar.
 */
function moduleRoots(): string[] {
  const roots = [join(here, 'package.json'), join(here, '..', '..', 'package.json')];
  // Packaged: this bundle is resources/cli/gleech.cjs beside resources/app.asar.
  for (const dir of [resourcesPath, resolve(here, '..')])
    if (dir) roots.push(join(dir, 'app.asar', 'package.json'));
  if (process.env['GLEECH_APP_DIR'])
    roots.push(join(process.env['GLEECH_APP_DIR'], 'package.json'));
  return roots;
}

function requireOptional<T>(name: string): T | null {
  for (const root of moduleRoots()) {
    try {
      return createRequire(root)(name) as T;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') {
        // A present but broken native module is worth reporting once.
        if (process.env['GLEECH_DEBUG']) process.stderr.write(`${name}: ${String(error)}\n`);
      }
    }
  }
  return null;
}

let loadedSharp: Sharp | null | undefined;
export function loadSharp(): Sharp | null {
  if (loadedSharp === undefined) {
    if (process.env['GLEECH_NO_SHARP']) return (loadedSharp = null);
    const loaded = requireOptional<Sharp & { default?: Sharp }>('sharp');
    loadedSharp = loaded ? (loaded.default ?? loaded) : null;
    if (loadedSharp) {
      loadedSharp.cache({ memory: 64, files: 0, items: 32 });
      loadedSharp.concurrency(2);
    }
  }
  return loadedSharp;
}

export function loadOnnx(): Promise<{
  InferenceSession: Pick<typeof InferenceSession, 'create'>;
  Tensor: typeof Tensor;
}> {
  const intelMac = process.platform === 'darwin' && process.arch === 'x64';
  const name = intelMac ? 'onnxruntime-node-macos-x64' : 'onnxruntime-node';
  const runtime = requireOptional<{
    InferenceSession: Pick<typeof InferenceSession, 'create'>;
    Tensor: typeof Tensor;
  }>(name);
  if (!runtime)
    return Promise.reject(new Error('Subject detection needs ONNX Runtime (pnpm install).'));
  return Promise.resolve(runtime);
}

let resourceDirectory: string | undefined;
/** The desktop app's bundled resources: presets, sample image, maps and model. */
export function resourcesDir(): string {
  if (resourceDirectory) return resourceDirectory;
  const candidates = [
    process.env['GLEECH_RESOURCES'],
    resourcesPath,
    resolve(here, '..'),
    resolve(here, '..', '..', 'resources'),
    resolve(here, '..', '..', '..', 'resources'),
    resolve(process.cwd(), 'apps', 'desktop', 'resources'),
  ].filter((value): value is string => !!value);
  resourceDirectory =
    candidates.find((dir) => existsSync(join(dir, 'presets', 'built-in.json'))) ?? candidates[0]!;
  return resourceDirectory;
}

export const sampleImagePath = () => join(resourcesDir(), 'presets', 'statue.png');
export const subjectModelPath = () => join(resourcesDir(), 'models', 'u2netp.onnx');
export const builtinPresetPath = () => join(resourcesDir(), 'presets', 'built-in.json');

/** Start a normal Electron child (not ELECTRON_RUN_AS_NODE) for WebGPU/WebGL2. */
export function gpuLaunch(): { executable: string; args: string[] } {
  const executable = process.versions['electron']
    ? process.execPath
    : requireOptional<string>('electron');
  if (!executable)
    throw new Error(
      'GPU rendering needs the GLEECH/Electron runtime. Run pnpm install and pnpm build.',
    );
  const developmentMain = resolve(here, '..', 'main', 'index.js');
  return {
    executable,
    args: existsSync(developmentMain)
      ? [developmentMain, '--gleech-cli-gpu']
      : ['--gleech-cli-gpu'],
  };
}

/** Electron's Windows GUI subsystem inherits output but can lose console stdin. */
export function restoreWindowsConsoleInput(): void {
  if (
    process.platform !== 'win32' ||
    !process.versions['electron'] ||
    process.stdin.isTTY ||
    !process.stdout.isTTY
  )
    return;
  let fd: number | undefined;
  try {
    fd = openSync(String.fromCharCode(92, 92, 46, 92) + 'CONIN$', 'r+');
    if (!isatty(fd)) {
      closeSync(fd);
      return;
    }
    const input = new ReadStream(fd);
    input.unref(); // The TUI ticker owns liveness; a paused console must not block exit.
    Object.defineProperty(process, 'stdin', { configurable: true, value: input });
  } catch {
    if (fd !== undefined) closeSync(fd);
  }
}
