// Per-frame image work for renders: overlay mattes, fitting to the output
// frame (bars, crop, stretch), upscaling and alpha handling.
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, unlink } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type {
  OutputFrame,
  OverlaySettings,
  UpscaleEngine,
  UpscaleSettings,
} from '../shared/render';

/** Tightly packed RGBA8. */
export interface RawImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ResizeKernel = 'lanczos3' | 'cubic' | 'nearest';

function rawInput(image: RawImage) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } });
}

export function toBuffer(bytes: ArrayBuffer | Uint8Array): Buffer {
  return bytes instanceof ArrayBuffer
    ? Buffer.from(bytes)
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// ---------------------------------------------------------------------------
// Overlay mattes (straight alpha)

/** Alpha 0–255 for a 0–255 difference: smoothstep from threshold to threshold + softness. */
export function matteCurve(threshold: number, softness: number): Uint8Array {
  const lut = new Uint8Array(256);
  const t = Math.min(1, Math.max(0, threshold));
  const s = Math.min(1, Math.max(0, softness));
  for (let level = 0; level < 256; level++) {
    const x = level / 255;
    let alpha: number;
    if (s < 1 / 255) alpha = x > t ? 1 : 0;
    else {
      const u = Math.min(1, Math.max(0, (x - t) / s));
      alpha = u * u * (3 - 2 * u);
    }
    lut[level] = Math.round(alpha * 255);
  }
  return lut;
}

/**
 * Difference from source: keeps any pixel the effects changed. Alpha follows
 * the largest channel difference; color is the edited pixel.
 */
export function differenceMatte(
  edited: Uint8Array,
  original: Uint8Array,
  threshold: number,
  softness: number,
): Buffer {
  const lut = matteCurve(threshold, softness);
  const out = Buffer.allocUnsafe(edited.length);
  for (let i = 0; i < edited.length; i += 4) {
    const r = edited[i]!,
      g = edited[i + 1]!,
      b = edited[i + 2]!,
      a = edited[i + 3]!;
    let d = Math.abs(r - original[i]!);
    const dg = Math.abs(g - original[i + 1]!);
    const db = Math.abs(b - original[i + 2]!);
    const da = Math.abs(a - original[i + 3]!);
    if (dg > d) d = dg;
    if (db > d) d = db;
    if (da > d) d = da;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = (lut[d]! * a + 127) / 255;
  }
  return out;
}

/**
 * Added light only: what the effects brightened. The added light per channel
 * is the premultiplied color; alpha is its brightest channel, faded in by
 * luminance through threshold/softness. Composite with Screen or Add.
 */
export function addedLightMatte(
  edited: Uint8Array,
  original: Uint8Array,
  threshold: number,
  softness: number,
): Buffer {
  const lut = matteCurve(threshold, softness);
  const out = Buffer.allocUnsafe(edited.length);
  for (let i = 0; i < edited.length; i += 4) {
    const r = Math.max(0, edited[i]! - original[i]!);
    const g = Math.max(0, edited[i + 1]! - original[i + 1]!);
    const b = Math.max(0, edited[i + 2]! - original[i + 2]!);
    const peak = Math.max(r, g, b);
    if (peak === 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const alpha = (peak * lut[luminance]! * edited[i + 3]!) / (255 * 255);
    // Straight color: the added light divided by its alpha (premultiplied / alpha).
    out[i] = Math.round((r * 255) / peak);
    out[i + 1] = Math.round((g * 255) / peak);
    out[i + 2] = Math.round((b * 255) / peak);
    out[i + 3] = Math.round(alpha);
  }
  return out;
}

export function applyMatte(
  edited: Uint8Array,
  original: Uint8Array,
  overlay: Pick<OverlaySettings, 'matte' | 'threshold' | 'softness'>,
): Buffer {
  if (edited.length !== original.length)
    throw new Error('The original frame does not match the rendered frame.');
  return overlay.matte === 'added-light'
    ? addedLightMatte(edited, original, overlay.threshold, overlay.softness)
    : differenceMatte(edited, original, overlay.threshold, overlay.softness);
}

export function premultiplyInPlace(data: Uint8Array): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 255) continue;
    data[i] = (data[i]! * a + 127) / 255;
    data[i + 1] = (data[i + 1]! * a + 127) / 255;
    data[i + 2] = (data[i + 2]! * a + 127) / 255;
  }
}

export function hasTransparency(data: Uint8Array): boolean {
  if (data.byteOffset % 4 === 0 && data.length % 4 === 0) {
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length / 4);
    // Little-endian RGBA: alpha is the top byte.
    for (let i = 0; i < words.length; i++) if (words[i]! < 0xff000000) return true;
    return false;
  }
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

/** Composites onto a solid color in place (straight alpha in, opaque out). */
export function flattenInPlace(data: Uint8Array, color: readonly [number, number, number]): void {
  const [br, bg, bb] = color;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 255) continue;
    const k = 255 - a;
    data[i] = (data[i]! * a + br * k + 127) / 255;
    data[i + 1] = (data[i + 1]! * a + bg * k + 127) / 255;
    data[i + 2] = (data[i + 2]! * a + bb * k + 127) / 255;
    data[i + 3] = 255;
  }
}

export function parseHexColor(value: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return [0, 0, 0];
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Fitting

/**
 * Which part of the source is shown and where it lands in the output frame.
 * Letterboxes that would need a shrunken picture trim instead.
 */
export function fitGeometry(
  sourceWidth: number,
  sourceHeight: number,
  frame: Pick<OutputFrame, 'width' | 'height' | 'fit' | 'anchor'>,
): { src: Rect; dst: Rect } {
  const W = frame.width;
  const H = frame.height;
  const full: Rect = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const canvas: Rect = { x: 0, y: 0, width: W, height: H };
  const clamp = (value: number, max: number) => Math.min(max, Math.max(1, Math.round(value)));
  const cover = (): { src: Rect; dst: Rect } => {
    const scale = Math.max(W / sourceWidth, H / sourceHeight);
    const width = clamp(W / scale, sourceWidth);
    const height = clamp(H / scale, sourceHeight);
    // TODO: 'subject' should follow the subject mask; it keeps the center for now.
    const y = frame.anchor === 'top' ? 0 : Math.floor((sourceHeight - height) / 2);
    return { src: { x: Math.floor((sourceWidth - width) / 2), y, width, height }, dst: canvas };
  };
  switch (frame.fit) {
    case 'stretch':
      return { src: full, dst: canvas };
    case 'crop':
      return cover();
    case 'letterbox-h': {
      const height = Math.round((sourceHeight * W) / sourceWidth);
      if (height > H) return cover();
      return { src: full, dst: { x: 0, y: Math.floor((H - height) / 2), width: W, height } };
    }
    case 'letterbox-v': {
      const width = Math.round((sourceWidth * H) / sourceHeight);
      if (width > W) return cover();
      return { src: full, dst: { x: Math.floor((W - width) / 2), y: 0, width, height: H } };
    }
    case 'fit': {
      const scale = Math.min(W / sourceWidth, H / sourceHeight);
      const width = clamp(sourceWidth * scale, W);
      const height = clamp(sourceHeight * scale, H);
      return {
        src: full,
        dst: { x: Math.floor((W - width) / 2), y: Math.floor((H - height) / 2), width, height },
      };
    }
  }
}

export interface UpscaleContext {
  readonly settings: UpscaleSettings;
  readonly tempDir: string;
  readonly locate: (engine: UpscaleEngine) => Promise<string | null>;
}

export interface FitOptions {
  /** Resize filter; defaults to Lanczos. */
  readonly kernel?: ResizeKernel;
  /** Used when the frame is enlarged and the method is "Upscale result". */
  readonly upscale?: UpscaleContext | undefined;
  readonly frameIndex?: number;
}

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Fits an image into the output frame with the chosen mode, kernel and bars. */
export async function fitImage(
  image: RawImage,
  frame: OutputFrame,
  options: FitOptions = {},
): Promise<RawImage> {
  const W = frame.width;
  const H = frame.height;
  if (image.width === W && image.height === H) return image;
  const { src, dst } = fitGeometry(image.width, image.height, frame);
  const fullSource = sameRect(src, { x: 0, y: 0, width: image.width, height: image.height });
  const enlarged = dst.width > src.width || dst.height > src.height;
  const upscale = options.upscale?.settings;
  const engine = enlarged && upscale?.method === 'upscale-result' ? upscale.engine : null;
  const bars = !sameRect(dst, { x: 0, y: 0, width: W, height: H });
  const solidBars = bars && frame.bars !== 'blur';
  const [r, g, b] = parseHexColor(frame.bars === 'color' ? frame.barColor : '#000000');
  const background = { r, g, b, alpha: frame.bars === 'transparent' ? 0 : 1 };
  const extend = {
    top: dst.y,
    left: dst.x,
    bottom: H - dst.y - dst.height,
    right: W - dst.x - dst.width,
    background,
  };

  let fitted: Buffer;
  if (engine && engine !== 'lanczos' && engine !== 'nearest') {
    fitted = await externalUpscale(
      image,
      src,
      dst.width,
      dst.height,
      options.upscale!,
      options.frameIndex ?? 0,
    );
    if (solidBars)
      fitted = await sharp(fitted, { raw: { width: dst.width, height: dst.height, channels: 4 } })
        .extend(extend)
        .raw()
        .toBuffer();
  } else {
    const kernel =
      engine === 'nearest'
        ? 'nearest'
        : engine === 'lanczos'
          ? 'lanczos3'
          : (options.kernel ?? 'lanczos3');
    let pipeline = rawInput(image);
    if (!fullSource)
      pipeline = pipeline.extract({
        left: src.x,
        top: src.y,
        width: src.width,
        height: src.height,
      });
    pipeline = pipeline.resize(dst.width, dst.height, { fit: 'fill', kernel });
    if (solidBars) pipeline = pipeline.extend(extend);
    fitted = await pipeline.raw().toBuffer();
  }
  if (!bars || solidBars) return { width: W, height: H, data: fitted };
  return { width: W, height: H, data: await blurredBars(image, frame, dst, fitted) };
}

/** Cover-resized, blurred and darkened copy of the frame behind the fitted picture. */
async function blurredBars(image: RawImage, frame: OutputFrame, dst: Rect, fitted: Buffer) {
  const W = frame.width;
  const H = frame.height;
  // Blur at 1/8 size: cheap, and the enlargement smooths it further.
  const small = { width: Math.max(1, Math.round(W / 8)), height: Math.max(1, Math.round(H / 8)) };
  const keep = 1 - Math.min(1, Math.max(0, frame.barDarken));
  // Darken here: within one sharp pipeline, linear() would run after composite().
  let pipeline = rawInput(image)
    .resize(small.width, small.height, { fit: 'cover' })
    .flatten({ background: '#000000' })
    .linear(keep, 0);
  if (frame.barBlur > 0) pipeline = pipeline.blur(0.3 + Math.min(1, frame.barBlur) * 6);
  const blurred = await pipeline.raw().toBuffer();
  return sharp(blurred, { raw: { width: small.width, height: small.height, channels: 3 } })
    .resize(W, H, { fit: 'fill', kernel: 'cubic' })
    .ensureAlpha()
    .composite([
      {
        input: fitted,
        raw: { width: dst.width, height: dst.height, channels: 4 },
        left: dst.x,
        top: dst.y,
      },
    ])
    .raw()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// External upscalers

export const UPSCALER_EXECUTABLES: Partial<Record<UpscaleEngine, { exe: string; name: string }>> = {
  realesrgan: { exe: 'realesrgan-ncnn-vulkan', name: 'Real-ESRGAN' },
  realcugan: { exe: 'realcugan-ncnn-vulkan', name: 'Real-CUGAN' },
  waifu2x: { exe: 'waifu2x-ncnn-vulkan', name: 'waifu2x' },
};

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds an executable in extra folders (and their <name> subfolders), then on the PATH. */
export async function findExecutable(
  name: string,
  extraDirs: readonly string[] = [],
): Promise<string | null> {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  const dirs = [
    ...extraDirs.flatMap((dir) => [dir, join(dir, name)]),
    ...(process.env['PATH'] ?? '').split(delimiter).map((dir) => dir.replace(/^"|"$/g, '')),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = join(dir, file);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

/** Cached executable lookup for the AI upscalers. */
export function createUpscalerLocator(
  extraDirs: readonly string[] = [],
): (engine: UpscaleEngine) => Promise<string | null> {
  const cache = new Map<UpscaleEngine, Promise<string | null>>();
  return (engine) => {
    const known = UPSCALER_EXECUTABLES[engine];
    if (!known) return Promise.resolve(null);
    let found = cache.get(engine);
    if (!found) {
      found = findExecutable(known.exe, extraDirs);
      cache.set(engine, found);
    }
    return found;
  };
}

/** Splits a command template into arguments; quotes group, backslashes stay literal. */
export function splitCommand(template: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of template.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) args.push(current);
      current = '';
      started = false;
    } else current += char;
  }
  if (quote) throw new Error('The upscaler command has an unclosed quote.');
  if (started || current) args.push(current);
  return args;
}

function pickScale(factor: number, supported: readonly number[]): number {
  return supported.find((scale) => scale >= factor - 1e-6) ?? supported[supported.length - 1]!;
}

const MODEL_NAME = /^[\w.-]+$/;

/** Executable and arguments for an engine run; the scale it produces. */
export function upscalerInvocation(
  engine: 'realesrgan' | 'realcugan' | 'waifu2x',
  model: string,
  factor: number,
  input: string,
  output: string,
): { args: string[]; scale: number } {
  const name = model.trim().split(/\s+/)[0] ?? '';
  const chosen = MODEL_NAME.test(name) ? name : '';
  if (engine === 'realesrgan') {
    const modelName = chosen || 'realesr-animevideov3';
    const scale = pickScale(factor, /x4/.test(modelName) ? [4] : [2, 3, 4]);
    return {
      args: ['-i', input, '-o', output, '-s', String(scale), '-n', modelName, '-f', 'png'],
      scale,
    };
  }
  if (engine === 'realcugan') {
    const scale = pickScale(factor, [2, 3, 4]);
    const modelDir = chosen.startsWith('models-') ? chosen : 'models-se';
    return {
      args: ['-i', input, '-o', output, '-s', String(scale), '-m', modelDir, '-f', 'png'],
      scale,
    };
  }
  const scale = pickScale(factor, [2, 4, 8, 16, 32]);
  const modelDir = chosen.startsWith('models-') ? chosen : 'models-cunet';
  return {
    args: ['-i', input, '-o', output, '-s', String(scale), '-n', '0', '-m', modelDir, '-f', 'png'],
    scale,
  };
}

function runTool(
  command: string,
  args: readonly string[],
  label: string,
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
        ...(options.cwd ? { cwd: options.cwd } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reject(
        new Error(
          /EINVAL/.test(message) && /\.(bat|cmd)$/i.test(command)
            ? `${label}: batch files can't be run directly; point the command at an .exe.`
            : `${label} could not start: ${message}`,
        ),
      );
      return;
    }
    const timer = setTimeout(
      () => {
        child.kill();
        finish(new Error(`${label} took too long and was stopped.`));
      },
      options.timeoutMs ?? 10 * 60 * 1000,
    );
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.once('error', (error: NodeJS.ErrnoException) =>
      finish(
        new Error(
          error.code === 'ENOENT'
            ? `${label} was not found: ${command}`
            : `${label} could not start: ${error.message}`,
        ),
      ),
    );
    child.once('close', (code) => {
      if (code === 0) finish();
      else {
        const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' / ');
        finish(new Error(`${label} failed (code ${code})${tail ? `: ${tail}` : '.'}`));
      }
    });
  });
}

/** Mixes a crisp nearest-neighbor copy back in so AI smoothing keeps the glitch texture. */
export function mixInPlace(target: Uint8Array, crisp: Uint8Array, amount: number): void {
  const k = Math.round(Math.min(1, Math.max(0, amount)) * 256);
  if (k <= 0) return;
  const j = 256 - k;
  for (let i = 0; i < target.length; i++) target[i] = (target[i]! * j + crisp[i]! * k + 128) >> 8;
}

async function externalUpscale(
  image: RawImage,
  src: Rect,
  width: number,
  height: number,
  context: UpscaleContext,
  frameIndex: number,
): Promise<Buffer> {
  const { settings } = context;
  if (settings.engine === 'mcp')
    throw new Error('Upscaling through an MCP tool isn’t available here yet. Pick another engine.');
  const region = () =>
    rawInput(image).extract({ left: src.x, top: src.y, width: src.width, height: src.height });
  const stem = join(
    context.tempDir,
    `upscale-${frameIndex}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const input = `${stem}-in.png`;
  const output = `${stem}-out.png`;
  const factor = Math.max(width / src.width, height / src.height);
  try {
    await region().png({ compressionLevel: 1 }).toFile(input);
    if (settings.engine === 'command') {
      const parts = splitCommand(settings.command);
      if (!parts.length) throw new Error('Enter the command line for your upscaler.');
      if (!parts.some((part) => part.includes('{out}')))
        throw new Error('The upscaler command needs {in} and {out} placeholders.');
      const fill = (part: string) =>
        part
          .replaceAll('{in}', input)
          .replaceAll('{out}', output)
          .replaceAll('{scale}', String(Math.max(1, Math.ceil(factor - 1e-6))))
          .replaceAll('{frame}', String(frameIndex + 1));
      const [command, ...args] = parts.map(fill);
      await runTool(command!, args, 'Your upscaler');
    } else {
      const engine = settings.engine as 'realesrgan' | 'realcugan' | 'waifu2x';
      const known = UPSCALER_EXECUTABLES[engine]!;
      const executable = await context.locate(engine);
      if (!executable)
        throw new Error(
          `${known.name} isn’t installed. Put ${known.exe} on your PATH, or pick Lanczos or Nearest neighbor.`,
        );
      const { args } = upscalerInvocation(engine, settings.model, factor, input, output);
      // ncnn tools look for their models next to the executable.
      await runTool(executable, args, known.name, { cwd: join(executable, '..') });
    }
    if (!(await isFile(output)))
      throw new Error('The upscaler finished but did not write its output image.');
    const upscaled = await sharp(output)
      .toColourspace('srgb')
      .ensureAlpha()
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();
    if (settings.mix > 0) {
      const crisp = await region()
        .resize(width, height, { fit: 'fill', kernel: 'nearest' })
        .raw()
        .toBuffer();
      mixInPlace(upscaled, crisp, settings.mix);
    }
    return upscaled;
  } finally {
    await Promise.all([unlink(input).catch(() => {}), unlink(output).catch(() => {})]);
  }
}

// ---------------------------------------------------------------------------
// Whole-frame pipeline

export interface FramePlan {
  /** Target size and framing. */
  readonly frame: OutputFrame;
  /** Effects-only matte; requires the original frame. */
  readonly overlay?: OverlaySettings | undefined;
  /** Keep alpha in the output; otherwise transparent pixels are flattened. */
  readonly alpha: boolean;
  readonly flattenColor?: readonly [number, number, number];
  readonly premultiply?: boolean;
  readonly kernel?: ResizeKernel;
  readonly upscale?: UpscaleContext | undefined;
}

/** Matte → fit/upscale → flatten or premultiply. Reuses the input buffer when it can. */
export async function prepareFrame(
  edited: RawImage,
  original: RawImage | undefined,
  plan: FramePlan,
  frameIndex = 0,
): Promise<RawImage> {
  let image = edited;
  if (plan.overlay?.enabled) {
    if (!original) throw new Error('Effects-only renders need the original frame with each frame.');
    if (original.width !== edited.width || original.height !== edited.height)
      throw new Error('The original frame does not match the rendered frame size.');
    image = { ...edited, data: applyMatte(edited.data, original.data, plan.overlay) };
  }
  image = await fitImage(image, plan.frame, {
    ...(plan.kernel ? { kernel: plan.kernel } : {}),
    upscale: plan.upscale,
    frameIndex,
  });
  if (!plan.alpha) {
    if (hasTransparency(image.data)) flattenInPlace(image.data, plan.flattenColor ?? [0, 0, 0]);
  } else if (plan.premultiply) premultiplyInPlace(image.data);
  return image;
}
