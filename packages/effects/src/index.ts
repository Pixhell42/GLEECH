import {
  createDirectionSampler,
  directionWarpPixels,
  mixDirection,
  type DirectionSampler,
} from './direction-field';
import { directionFieldParams, supportsDirectionField } from '@gleech/project-model';
export { createDirectionSampler, vectorMapSampler } from './direction-field';
import {
  analyzeApplication,
  signalApplicationSampler,
  type ApplicationAnalysis,
} from './application-analysis';
import {
  deriveEffectSeed,
  isDepthApplication,
  type LayerImage,
  bitCrushDepths,
  SPATIAL_CRUSH_DEFAULTS,
  isShaderEffect,
  getEffectDefinition,
  type ShaderEffect,
  SCANLINE_FINISH_DEFAULTS,
  IMAGE_FINISH_DEFAULTS,
  FRACTAL_DEFAULTS,
  SHAPE_TILE_DEFAULTS,
  isTintEnabled,
  DEFAULT_GRADIENT_END,
  CURVE_KEYS,
  heightFieldParams,
  supportsHeightField,
  usesHeightField,
  type BlendMode,
  type ImageFinishParams,
  type EffectInstance,
  type SpatialCrushEffect,
  type SubjectMask,
  type EffectApplication,
  type EdgeHandling,
  type ScanlinesEffect,
  type HalftoneEffect,
  type MirroringEffect,
  type KaleidoscopeEffect,
  type OutputAlignment,
  type MotionMoshEffect,
  type ShapesEffect,
  type MandelbrotEffect,
  type RecursiveSpaceEffect,
  type HeightFieldParams,
} from '@gleech/project-model';
import { createHeightField, sampleHeight, type HeightField } from './depth-field';
import { vectorCorruptionPixels, referenceMoshPixels, motionTransferPixels } from './spatial-mosh';
import {
  depthParallaxPixels,
  depthColorPixels,
  cutoutPixels,
  lensDistortionPixels,
} from './depth-finishing';
import { feedbackPixels } from './feedback';
import { compressionPixels, compressionIsNeutral } from './compression';
import { chromaMoshPixels } from './chroma-mosh';
import { pixelSortPixels } from './pixel-sort';
import { ditherPixels } from './dither';
import { colorRamp, indexedMapper } from './indexed-palette';
import { thresholdPixels } from './threshold';
import { glyphPixels } from './glyph';
import { builtinShaderPixels } from './builtin-shaders';
import {
  pixelStretchPixels,
  ledMatrixPixels,
  granularEchoPixels,
  pigmentDragPixels,
} from './set2-filters';
import {
  windowFragmentPixels,
  celShadingPixels,
  contourWavePixels,
  pixelDissolvePixels,
  neonPrintPixels,
  systemCrashPixels,
  terminalWireframePixels,
  signalWeavePixels,
  dataWeavePixels,
  microCollagePixels,
} from './reference-filters';
export { importedShaderInvocation } from './imported-shaders';
export { builtinShaderInvocation } from './builtin-shaders';
export { mandelbrotSliceOffset } from './set2-advanced-shaders';
export { GLYPH_EMOJI, EMOJI_ATLAS_VERSION, EMOJI_TILE_SIZE } from './glyph-atlas';
export { EXTENDED_REPERTOIRE, UNICODE_REPERTOIRE, TERMINAL_REPERTOIRE } from './glyph-alphabet';
import { crtPixels, crtIsNeutral } from './crt';
import { signalTearingPixels } from './signal-tearing';
import { bitDamagePixels, freezeDropoutPixels } from './bit-dropout';
import {
  photoAdjustmentPixels,
  photoIsNeutral,
  detailPixels,
  halationPixels,
  vignettePixels,
} from './photo-finishing';
import {
  channelTransformPixels,
  temporalEchoPixels,
  channelIsNeutral,
  echoIsNeutral,
} from './channel-echo';
import { fractalOrbit } from './fractal';
import { createShapeTiles, polygonDistance } from './shape-tiles';
import { createColorSampler } from './color-gradient';
import { createToneTable } from './tonal';
import { glowHighlights } from './glow';
import { createNoiseField, noiseValue } from './noise';
import { blurPixels } from './blur';
import { paintedMaskSteps, canvasDrawingSteps } from './painted-mask';
import type { PaintedMaskRasterizer } from './painted-mask-cache';
import type { PreviewStackCache } from './preview-stack-cache';
export { PreviewStackCache } from './preview-stack-cache';
export { PaintedMaskRasterizer } from './painted-mask-cache';
export { renderPaintedMask, renderPaintedMaskAsync } from './painted-mask';
export { createCurveSampler } from './tonal';
export { fractalOrbit, fractalPoint, zoomFractalAt, type FractalView } from './fractal';

export interface EffectImage {
  width: number;
  height: number;
  pixels: ArrayBuffer;
}

// HSL adjustments act on encoded RGB, like the other color controls. Reuse the
// result buffer so a large image does not allocate an array for every pixel.
function adjustHsl(
  r: number,
  g: number,
  b: number,
  hue: number,
  saturation: number,
  lightness: number,
  result: Float64Array,
): void {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const delta = max - min;
  const originalLightness = (max + min) / 2;
  const originalSaturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * originalLightness - 1));
  // Increasing saturation cannot assign an arbitrary hue to an achromatic pixel.
  const s =
    delta === 0
      ? 0
      : saturation < 0
        ? originalSaturation * (1 + saturation)
        : originalSaturation + (1 - originalSaturation) * saturation;
  const l =
    lightness < 0
      ? originalLightness * (1 + lightness)
      : originalLightness + (1 - originalLightness) * lightness;
  const originalHue =
    delta === 0
      ? 0
      : max === r
        ? (g - b) / delta
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  const h = (((originalHue + hue / 60) % 6) + 6) % 6;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = l - chroma / 2;
  result[0] = h < 1 || h >= 5 ? chroma : h < 2 || h >= 4 ? x : 0;
  result[1] = h < 1 ? x : h < 3 ? chroma : h < 4 ? x : 0;
  result[2] = h < 2 ? 0 : h < 3 ? x : h < 5 ? chroma : x;
  for (let c = 0; c < 3; c++) result[c] = Math.round((result[c]! + m) * 255 * 1e9) / 1e9;
}
export interface RenderOptions {
  /** Native JPEG encode/decode of one generation; alpha must remain unchanged. */
  recompressJpeg?: (image: EffectImage, options: JpegPassOptions) => Promise<ArrayBuffer>;
  /** Optional asynchronous raw shader executor. Shared finishing/masks run afterward. */
  renderShader?: (
    image: EffectImage,
    effect: ShaderEffect,
    seed: number,
    reference: { width: number; height: number },
    heightField?: HeightField,
    direction?: DirectionSampler,
  ) => Promise<ArrayBuffer | null>;
  masterSeed?: number;
  reference?: { width: number; height: number };
  isCancelled?: () => boolean;
  subjectMask?: SubjectMask | undefined;
  /** Stage source before draft downsampling, so source palettes remain stable during refinement. */
  paletteSource?: EffectImage;
  /** Decoded, immutable images used by Solid layers, keyed by embedded image ID. */
  layerImages?: ReadonlyMap<string, EffectImage>;
  /** Draft-only height grid bound. Omit for full-detail preview and export. */
  fieldMaxDimension?: number;
  /** Caller-owned bounded rasterizers for interactive mask painting. */
  paintedMaskRasterizers?: ReadonlyMap<string, PaintedMaskRasterizer>;
  /** Small draft-only checkpoints; callers isolate GPU and CPU caches. */
  previewStackCache?: PreviewStackCache | undefined;
}
export interface JpegPassOptions {
  quality: number;
  chromaSubsampling: '420' | '444';
}
export class RenderCancelledError extends Error {
  constructor() {
    super('Preview superseded.');
    this.name = 'RenderCancelledError';
  }
}

// Counter-based random field, version 1. Coordinates and lanes consume no mutable PRNG state.
export function cellRandom(
  seed: number,
  x: number,
  y: number,
  lane: number,
  variation = 0,
): number {
  let hash =
    (seed ^
      Math.imul(x + 1, 0x9e3779b1) ^
      Math.imul(y + 1, 0x85ebca77) ^
      Math.imul(lane + 1, 0xc2b2ae3d) ^
      Math.imul(variation, 0x27d4eb2f)) >>>
    0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(max - 1, value));

// Mirror reflects full tiles across the pixel boundary, repeating the endpoint pixel.
function edgeIndex(value: number, size: number, mode: EdgeHandling): number {
  if (mode === 'extend') return clamp(value, size);
  const period = mode === 'mirror' ? size * 2 : size;
  const position = ((value % period) + period) % period;
  return position < size ? position : period - 1 - position;
}

// Integrate a repeating band over the projected pixel footprint. Subpixel patterns
// converge to their average instead of aliasing differently at every preview size.
function bandCoverage(
  position: number,
  footprint: number,
  center: number,
  width: number,
  rounded = false,
): number {
  if (width <= 0) return 0;
  const start = center - width / 2;
  const mean = rounded ? width / 2 : width;
  const integral = (coordinate: number) => {
    const cycles = Math.floor(coordinate);
    const progress = Math.max(0, Math.min(1, (coordinate - cycles - start) / width));
    return (
      cycles * mean +
      width * (rounded ? progress / 2 - Math.sin(progress * Math.PI * 2) / (Math.PI * 4) : progress)
    );
  };
  return Math.max(
    0,
    Math.min(
      1,
      (integral(position + footprint / 2) - integral(position - footprint / 2)) / footprint,
    ),
  );
}

function blend(
  output: Uint8Array,
  input: Uint8Array,
  index: number,
  color: ArrayLike<number>,
  amount: number,
): void {
  if (amount === 1) {
    for (let channel = 0; channel < 4; channel++)
      output[index + channel] = Math.round(color[channel]!);
    return;
  }
  const alpha = input[index + 3]! * (1 - amount) + color[3]! * amount;
  for (let channel = 0; channel < 3; channel++) {
    // Blend premultiplied colors, then return to straight RGBA for storage/export.
    output[index + channel] = Math.round(
      alpha > 0
        ? (input[index + channel]! * input[index + 3]! * (1 - amount) +
            color[channel]! * color[3]! * amount) /
            alpha
        : input[index + channel]! * (1 - amount) + color[channel]! * amount,
    );
  }
  output[index + 3] = Math.round(alpha);
}

// Smooth spatial sampling in premultiplied color avoids fringes around transparency.
// Hidden RGB is interpolated only when all contributing samples are transparent.
function sampleBilinear(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edgeHandling: EdgeHandling,
): void {
  if (edgeHandling === 'extend') {
    x = clamp(x, width);
    y = clamp(y, height);
  }
  const left = Math.floor(x),
    top = Math.floor(y);
  const right = edgeIndex(left + 1, width, edgeHandling),
    bottom = edgeIndex(top + 1, height, edgeHandling);
  const sampleLeft = edgeIndex(left, width, edgeHandling),
    sampleTop = edgeIndex(top, height, edgeHandling);
  const tx = x - left,
    ty = y - top;
  const a = (sampleTop * width + sampleLeft) * 4,
    b = (sampleTop * width + right) * 4;
  const c = (bottom * width + sampleLeft) * 4,
    d = (bottom * width + right) * 4;
  const wa = (1 - tx) * (1 - ty),
    wb = tx * (1 - ty),
    wc = (1 - tx) * ty,
    wd = tx * ty;
  const aa = pixels[a + 3]! * wa,
    ab = pixels[b + 3]! * wb;
  const ac = pixels[c + 3]! * wc,
    ad = pixels[d + 3]! * wd;
  const alpha = aa + ab + ac + ad;
  for (let channel = 0; channel < 3; channel++) {
    color[channel] =
      alpha > 0
        ? (pixels[a + channel]! * aa +
            pixels[b + channel]! * ab +
            pixels[c + channel]! * ac +
            pixels[d + channel]! * ad) /
          alpha
        : pixels[a + channel]! * wa +
          pixels[b + channel]! * wb +
          pixels[c + channel]! * wc +
          pixels[d + channel]! * wd;
  }
  color[3] = alpha;
}

function blendChannel(backdrop: number, color: number, mode: BlendMode): number {
  switch (mode) {
    case 'darken':
      return Math.min(backdrop, color);
    case 'lighten':
      return Math.max(backdrop, color);
    case 'color-dodge':
      return backdrop === 0
        ? 0
        : color === 255
          ? 255
          : Math.min(255, (backdrop * 255) / (255 - color));
    case 'color-burn':
      return backdrop === 255
        ? 255
        : color === 0
          ? 0
          : 255 - Math.min(255, ((255 - backdrop) * 255) / color);
    case 'linear-burn':
      return Math.max(0, backdrop + color - 255);
    case 'subtract':
      return Math.max(0, backdrop - color);
    case 'hard-light':
      return color <= 127.5
        ? (2 * backdrop * color) / 255
        : 255 - (2 * (255 - backdrop) * (255 - color)) / 255;
    case 'soft-light': {
      const b = backdrop / 255,
        s = color / 255;
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return 255 * (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b));
    }
    case 'exclusion':
      return backdrop + color - (2 * backdrop * color) / 255;
    case 'multiply':
      return (backdrop * color) / 255;
    case 'screen':
      return 255 - ((255 - backdrop) * (255 - color)) / 255;
    case 'add':
      return Math.min(255, backdrop + color);
    case 'overlay':
      return backdrop <= 127.5
        ? (2 * backdrop * color) / 255
        : 255 - (2 * (255 - backdrop) * (255 - color)) / 255;
    case 'difference':
      return Math.abs(backdrop - color);
    default:
      return color;
  }
}

function* scanlines(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: ScanlinesEffect,
  reference: { width: number; height: number },
  seed: number,
): Generator<void> {
  const { style, frequency, thickness, intensity, rotation, offset, field, amount } = effect.params;
  const finish = { ...SCANLINE_FINISH_DEFAULTS, ...effect.params };
  const lineColor = createColorSampler(effect.params, 'color', finish.color, reference);
  const angle = (rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle);
  const sine = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle);
  const nx = style === 'grille' ? cosine : -sine,
    ny = style === 'grille' ? sine : cosine;
  const stepX = reference.width / image.width,
    stepY = reference.height / image.height;
  const shorter = Math.min(reference.width, reference.height);
  const rasterScale = frequency / shorter;
  const scale = rasterScale / (style === 'interlaced' ? 2 : 1);
  const footprint = (Math.abs(nx) * stepX + Math.abs(ny) * stepY) * scale;
  const haloFootprint = footprint + ((2 * shorter * finish.glowSize) / 100) * scale;
  const error = finish.errorStrength > 0 ? finish.signalError : 'none';
  const warp = ['jitter', 'sync-loss', 'tear'].includes(error);
  const normalMin = Math.min(0, nx * reference.width) + Math.min(0, ny * reference.height);
  const normalLength = Math.abs(nx) * reference.width + Math.abs(ny) * reference.height;
  const errorShift =
    (nx * reference.width * finish.errorPositionX + ny * reference.height * finish.errorPositionY) /
    100;
  const tearCenter = 0.1 + cellRandom(seed, 0, 0, 8, effect.seedOffset) * 0.8;
  const sampled = new Float64Array(4),
    painted = new Float64Array(4);
  const coverage = (position: number, width: number, channel: number) =>
    style === 'grille'
      ? 1 - bandCoverage(position, width, (channel + 0.5) / 3, (1 - thickness) / 3)
      : bandCoverage(
          position,
          width,
          style === 'interlaced' ? (field === 'even' ? 0.25 : 0.75) : 0.5,
          style === 'interlaced' ? thickness / 2 : thickness,
          style === 'tv',
        );
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const normal = nx * (x + 0.5) * stepX + ny * (y + 0.5) * stepY;
      const errorNormal = normal - errorShift;
      const interval = Math.floor(errorNormal * rasterScale);
      let along = 0,
        across = 0;
      if (error === 'jitter') {
        along =
          (cellRandom(seed, interval, 0, 6, effect.seedOffset) * 2 - 1) *
          shorter *
          0.08 *
          finish.errorStrength;
      } else if (error === 'sync-loss') {
        const group = Math.floor(interval / 8);
        along =
          (cellRandom(seed, group, 0, 6, effect.seedOffset) * 2 - 1) *
          shorter *
          0.2 *
          finish.errorStrength;
        across =
          (cellRandom(seed, group, 0, 7, effect.seedOffset) * 2 - 1) *
          shorter *
          0.08 *
          finish.errorStrength;
      } else if (error === 'tear') {
        const distance = Math.abs((errorNormal - normalMin) / normalLength - tearCenter);
        const radius = 0.025 + 0.15 * finish.errorStrength;
        if (distance < radius) {
          along = shorter * 0.3 * finish.errorStrength * (1 - distance / radius);
          across = shorter * 0.02 * finish.errorStrength;
        }
      }
      const position = (normal + across) * scale + (offset % 1);
      const present =
        error !== 'dropout' ||
        cellRandom(seed, interval, 0, 10, effect.seedOffset) >= finish.errorStrength;
      const index = (y * image.width + x) * 4;
      const rgb = lineColor((x + 0.5) / image.width, (y + 0.5) / image.height);
      if (warp) {
        sampleBilinear(
          pixels,
          image.width,
          image.height,
          x + (ny * along + nx * across) / stepX,
          y + (-nx * along + ny * across) / stepY,
          sampled,
          finish.edgeHandling,
        );
      } else {
        for (let channel = 0; channel < 4; channel++) sampled[channel] = pixels[index + channel]!;
      }
      for (let channel = 0; channel < 3; channel++) {
        const dark = present ? coverage(position, footprint, channel) : 0;
        const halo = present && finish.glow > 0 ? coverage(position, haloFootprint, channel) : 0;
        // Fold Amount into the opacity when no content moves, retaining exact v1 rounding.
        const weight = warp ? 1 : amount;
        const lineAlpha = weight * intensity * dark;
        const glowAlpha = weight * intensity * finish.glow * halo;
        const opacity = finish.glow === 0 ? lineAlpha : 1 - (1 - lineAlpha) * (1 - glowAlpha);
        const backdrop = sampled[channel]!;
        painted[channel] =
          backdrop * (1 - opacity) +
          blendChannel(
            backdrop,
            finish.invert === 'on' ? 255 - rgb[channel]! : rgb[channel]!,
            finish.blendMode,
          ) *
            opacity;
      }
      painted[3] = sampled[3]!;
      if (warp) blend(output, pixels, index, painted, amount);
      else {
        for (let channel = 0; channel < 3; channel++)
          output[index + channel] = Math.round(painted[channel]!);
        output[index + 3] = pixels[index + 3]!;
      }
    }
    yield;
  }
}

// Three separable box passes approximate a Gaussian with bounded, linear work.
// Replicated borders keep masks from fading at the outer edge of the image.
function blurMask(
  input: Float32Array,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): Float32Array {
  function axis(source: Float32Array, radius: number, horizontal: boolean): Float32Array {
    if (!radius) return source;
    const output = new Float32Array(source.length);
    const length = horizontal ? width : height;
    const lines = horizontal ? height : width;
    const stride = horizontal ? 1 : width;
    for (let line = 0; line < lines; line++) {
      const start = horizontal ? line * width : line;
      let sum = source[start]! * (radius + 1);
      for (let offset = 1; offset <= radius; offset++)
        sum += source[start + clamp(offset, length) * stride]!;
      for (let position = 0; position < length; position++) {
        output[start + position * stride] = sum / (radius * 2 + 1);
        sum +=
          source[start + clamp(position + radius + 1, length) * stride]! -
          source[start + clamp(position - radius, length) * stride]!;
      }
    }
    return output;
  }
  let field = input;
  for (let pass = 0; pass < 3; pass++) {
    field = axis(field, radiusX, true);
    field = axis(field, radiusY, false);
  }
  return field;
}

function sampleMaskField(
  input: Float32Array,
  width: number,
  height: number,
  softness: number,
  reference: { width: number; height: number },
): (x: number, y: number) => number {
  if (softness === 0)
    return (x, y) =>
      input[clamp(Math.floor(y * height), height) * width + clamp(Math.floor(x * width), width)]!;
  const radius = softness * 0.2 * Math.min(reference.width, reference.height);
  const field = blurMask(
    input,
    width,
    height,
    Math.max(1, Math.round((radius * width) / reference.width)),
    Math.max(1, Math.round((radius * height) / reference.height)),
  );
  return (x, y) => {
    const sx = Math.max(0, Math.min(width - 1, x * width - 0.5));
    const sy = Math.max(0, Math.min(height - 1, y * height - 0.5));
    const x0 = Math.floor(sx),
      y0 = Math.floor(sy);
    const x1 = Math.min(x0 + 1, width - 1),
      y1 = Math.min(y0 + 1, height - 1);
    const fx = sx - x0,
      fy = sy - y0;
    const top = field[y0 * width + x0]! * (1 - fx) + field[y0 * width + x1]! * fx;
    const bottom = field[y1 * width + x0]! * (1 - fx) + field[y1 * width + x1]! * fx;
    return Math.max(0, Math.min(1, top * (1 - fy) + bottom * fy));
  };
}

function maskSampler(
  application: EffectApplication,
  reference: { width: number; height: number },
  seed: number,
  variation: number,
  subjectMask?: SubjectMask,
): (x: number, y: number) => number {
  const coverage = application.coverage;
  const region = application.region;
  const featherWidth = application.softness * Math.min(reference.width, reference.height);
  const edge = (distance: number) => {
    if (featherWidth === 0) return distance >= 0 ? 1 : 0;
    const t = Math.max(0, Math.min(1, distance / featherWidth + 0.5));
    return t * t * (3 - 2 * t);
  };
  const center = (x: number, y: number, area: number) => {
    const inset = (1 - Math.sqrt(area)) / 2;
    return edge(
      Math.min(
        (x - inset) * reference.width,
        (1 - inset - x) * reference.width,
        (y - inset) * reference.height,
        (1 - inset - y) * reference.height,
      ),
    );
  };
  if (coverage === 1 && region !== 'subject' && region !== 'background') return () => 1;
  if (region === 'top') return (_x, y) => edge((coverage - y) * reference.height);
  if (region === 'bottom') return (_x, y) => edge((coverage - (1 - y)) * reference.height);
  if (region === 'left') return (x) => edge((coverage - x) * reference.width);
  if (region === 'right') return (x) => edge((coverage - (1 - x)) * reference.width);
  if (region === 'center') return (x, y) => center(x, y, coverage);
  if (region === 'edges') return (x, y) => (coverage === 1 ? 1 : 1 - center(x, y, 1 - coverage));
  const cells = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      cells[y * 32 + x] = coverage === 1 || cellRandom(seed, x, y, 5, variation) < coverage ? 1 : 0;
  let patches = (x: number, y: number) =>
    cells[Math.min(31, Math.floor(y * 32)) * 32 + Math.min(31, Math.floor(x * 32))]!;
  if (application.softness > 0 && coverage < 1) {
    const field = new Float32Array(256 * 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++)
        field[y * 256 + x] = cells[Math.floor(y / 8) * 32 + Math.floor(x / 8)]!;
    patches = sampleMaskField(field, 256, 256, application.softness, reference);
  }
  if (region === 'all') return patches;
  if (!subjectMask || subjectMask.values.byteLength !== subjectMask.width * subjectMask.height)
    throw new Error('Subject detection is not available for this image.');
  const subject = sampleMaskField(
    Float32Array.from(new Uint8Array(subjectMask.values), (value) => (value >= 128 ? 1 : 0)),
    subjectMask.width,
    subjectMask.height,
    application.softness,
    reference,
  );
  return (x, y) => {
    const patch = patches(x, y);
    if (!patch) return 0;
    const probability = subject(x, y);
    return patch * (region === 'subject' ? probability : 1 - probability);
  };
}

function* spatialCrush(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: SpatialCrushEffect,
  reference: { width: number; height: number },
  seed: number,
): Generator<void> {
  const block = Math.max(
    1,
    Math.round((Math.min(reference.width, reference.height) * effect.params.blockSize) / 100),
  );
  const columns = Math.ceil(reference.width / block);
  const rows = Math.ceil(reference.height / block);
  const center = (cell: number, size: number) =>
    cell * block + Math.min(block, size - cell * block) / 2;
  if (effect.params.sampling === 'linear') {
    if (block === 1) {
      output.set(pixels);
      return;
    }
    // Interpolate the coarse lattice, not the original image. Keep just two
    // rows in memory, and account for a shorter final cell at either edge.
    const gridCoordinate = (position: number, size: number, count: number) => {
      const left = clamp(Math.floor(position / block - 0.5), count);
      const right = Math.min(count - 1, left + 1);
      const from = center(left, size),
        to = center(right, size);
      return left + (to === from ? 0 : Math.max(0, Math.min(1, (position - from) / (to - from))));
    };
    const horizontal = Float64Array.from({ length: image.width }, (_, x) =>
      gridCoordinate(((x + 0.5) * reference.width) / image.width, reference.width, columns),
    );
    const samples = new Uint8Array(columns * 8);
    const color = new Float64Array(4);
    let cachedTop = -1;
    for (let y = 0; y < image.height; y++) {
      const gy = gridCoordinate(
        ((y + 0.5) * reference.height) / image.height,
        reference.height,
        rows,
      );
      const top = Math.floor(gy);
      if (top !== cachedTop) {
        for (let row = 0; row < 2; row++) {
          const sy = clamp(
            Math.floor(
              (center(Math.min(rows - 1, top + row), reference.height) * image.height) /
                reference.height,
            ),
            image.height,
          );
          for (let cell = 0; cell < columns; cell++) {
            const sx = clamp(
              Math.floor((center(cell, reference.width) * image.width) / reference.width),
              image.width,
            );
            const index = (sy * image.width + sx) * 4;
            samples.set(pixels.subarray(index, index + 4), (row * columns + cell) * 4);
          }
        }
        cachedTop = top;
      }
      for (let x = 0; x < image.width; x++) {
        sampleBilinear(samples, columns, 2, horizontal[x]!, gy - top, color, 'extend');
        blend(output, pixels, (y * image.width + x) * 4, color, effect.params.amount);
      }
      yield;
    }
    return;
  }
  const jitter =
    effect.params.sampling === 'dirty-nearest'
      ? (effect.params.jitter ?? SPATIAL_CRUSH_DEFAULTS.jitter)
      : 0;
  const corruption =
    effect.params.sampling === 'corrupted'
      ? (effect.params.corruption ?? SPATIAL_CRUSH_DEFAULTS.corruption)
      : 0;
  // Shared edges stay ordered, including a short final cell. Horizontal
  // boundaries can differ by grid row, making coherent irregular rectangles.
  const boundary = (cell: number, size: number, lane: number, row = 0) => {
    if (cell <= 0) return 0;
    if (cell >= Math.ceil(size / block)) return size;
    if (jitter === 0) return cell * block;
    return (
      cell * block +
      (cellRandom(seed, cell, row, lane, effect.seedOffset) * 2 - 1) *
        Math.min(block, size - cell * block) *
        0.45 *
        jitter
    );
  };
  for (let startY = 0; startY < image.height;) {
    const positionY = ((startY + 0.5) * reference.height) / image.height;
    let cellY = Math.floor(positionY / block);
    if (jitter > 0) {
      while (positionY < boundary(cellY, reference.height, 5)) cellY--;
      while (positionY >= boundary(cellY + 1, reference.height, 5) && cellY < rows - 1) cellY++;
    }
    const top = boundary(cellY, reference.height, 5);
    const bottom = boundary(cellY + 1, reference.height, 5);
    const endY = Math.min(
      image.height,
      Math.max(startY + 1, Math.ceil((bottom * image.height) / reference.height - 0.5)),
    );
    const cells: { start: number; end: number; x: number; color: number[] }[] = [];
    for (let startX = 0; startX < image.width;) {
      const positionX = ((startX + 0.5) * reference.width) / image.width;
      let cellX = Math.floor(positionX / block);
      if (jitter > 0) {
        while (positionX < boundary(cellX, reference.width, 6, cellY)) cellX--;
        while (positionX >= boundary(cellX + 1, reference.width, 6, cellY) && cellX < columns - 1)
          cellX++;
      }
      const left = boundary(cellX, reference.width, 6, cellY);
      const right = boundary(cellX + 1, reference.width, 6, cellY);
      const endX = Math.min(
        image.width,
        Math.max(startX + 1, Math.ceil((right * image.width) / reference.width - 0.5)),
      );
      const random = effect.params.sampling === 'random';
      const rx = random ? cellRandom(seed, cellX, cellY, 3, effect.seedOffset) : 0.5;
      const ry = random ? cellRandom(seed, cellX, cellY, 4, effect.seedOffset) : 0.5;
      let sampleX = left + (right - left) * rx;
      let sampleY = top + (bottom - top) * ry;
      if (corruption > 0 && cellRandom(seed, cellX, cellY, 7, effect.seedOffset) < corruption) {
        const radius = 1 + Math.round(corruption * 5);
        let dx =
          Math.floor(cellRandom(seed, cellX, cellY, 8, effect.seedOffset) * (radius * 2 + 1)) -
          radius;
        const dy =
          Math.floor(cellRandom(seed, cellX, cellY, 9, effect.seedOffset) * (radius * 2 + 1)) -
          radius;
        if (dx === 0 && dy === 0) dx = 1;
        const edges = effect.params.edgeHandling ?? 'extend';
        sampleX = center(edgeIndex(cellX + dx, columns, edges), reference.width);
        sampleY = center(edgeIndex(cellY + dy, rows, edges), reference.height);
      }
      const sx = clamp(Math.floor((sampleX * image.width) / reference.width), image.width);
      const sy = clamp(Math.floor((sampleY * image.height) / reference.height), image.height);
      const sample = (sy * image.width + sx) * 4;
      cells.push({
        start: startX,
        end: endX,
        x: cellX,
        color: Array.from(pixels.subarray(sample, sample + 4)),
      });
      startX = endX;
    }
    if (effect.params.sampling === 'average') {
      const sums = new Float64Array(cells.length * 8);
      for (let y = startY; y < endY; y++) {
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
          const cell = cells[cellIndex]!;
          const sum = cellIndex * 8;
          for (let x = cell.start; x < cell.end; x++) {
            const index = (y * image.width + x) * 4;
            const alpha = pixels[index + 3]!;
            for (let channel = 0; channel < 3; channel++) {
              sums[sum + channel]! += pixels[index + channel]! * alpha;
              sums[sum + 4 + channel]! += pixels[index + channel]!;
            }
            sums[sum + 3]! += alpha;
            sums[sum + 7]!++;
          }
        }
        yield;
      }
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const sum = cellIndex * 8;
        const alpha = sums[sum + 3]!;
        const count = sums[sum + 7]!;
        cells[cellIndex]!.color = [
          ...[0, 1, 2].map((channel) =>
            alpha > 0 ? sums[sum + channel]! / alpha : sums[sum + 4 + channel]! / count,
          ),
          alpha / count,
        ];
      }
    }
    for (let y = startY; y < endY; y++) {
      for (const cell of cells) {
        for (let x = cell.start; x < cell.end; x++)
          blend(output, pixels, (y * image.width + x) * 4, cell.color, effect.params.amount);
      }
      yield;
    }
    startY = endY;
  }
}

// Area of a circle clipped to its square grid cell; fine dot grids converge
// to this average instead of changing phase with preview resolution.
function dotArea(radius: number): number {
  if (radius <= 0.5) return Math.PI * radius * radius;
  if (radius >= Math.SQRT1_2) return 1;
  return (
    Math.PI * radius * radius -
    4 * (radius * radius * Math.acos(0.5 / radius) - 0.5 * Math.sqrt(radius * radius - 0.25))
  );
}
function* halftone(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: HalftoneEffect,
  reference: { width: number; height: number },
): Generator<void> {
  const { spacing, size, rotation, contrast, style, amount } = effect.params;
  const period = (Math.min(reference.width, reference.height) * spacing) / 100;
  const angle = (rotation * Math.PI) / 180,
    cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const stepX = reference.width / image.width,
    stepY = reference.height / image.height;
  const footprint = (Math.abs(cosine) * stepX + Math.abs(sine) * stepY) / period;
  const inkColor = createColorSampler(
    effect.params,
    'foregroundColor',
    effect.params.foregroundColor,
    reference,
  );
  const paperColor = createColorSampler(
    effect.params,
    'backgroundColor',
    effect.params.backgroundColor,
    reference,
  );
  const sampled = new Float64Array(4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const refX = (x + 0.5) * stepX,
        refY = (y + 0.5) * stepY;
      const u = (cosine * refX + sine * refY) / period,
        v = (-sine * refX + cosine * refY) / period;
      const centerU = Math.floor(u) + 0.5,
        centerV = style === 'dots' ? Math.floor(v) + 0.5 : v;
      sampleBilinear(
        pixels,
        image.width,
        image.height,
        ((cosine * centerU - sine * centerV) * period) / stepX - 0.5,
        ((sine * centerU + cosine * centerV) * period) / stepY - 0.5,
        sampled,
        'extend',
      );
      // Transparent samples are paper; hidden RGB must not generate ink.
      const light =
        sampled[3] === 0
          ? 1
          : (0.2126 * sampled[0]! + 0.7152 * sampled[1]! + 0.0722 * sampled[2]!) / 255;
      let dark = Math.max(0, Math.min(1, 0.5 + (0.5 - light) * contrast));
      if (dark < 1e-12) dark = 0;
      let coverage: number;
      if (style === 'lines') coverage = bandCoverage(u, footprint, 0.5, Math.min(1, dark * size));
      else {
        const radius = Math.sqrt(dark / Math.PI) * size;
        const distance = Math.hypot(u - centerU, v - centerV);
        const feather = Math.max(1e-9, Math.hypot(stepX, stepY) / period);
        coverage =
          radius === 0
            ? 0
            : footprint >= 1
              ? dotArea(radius)
              : Math.max(0, Math.min(1, 0.5 + (radius - distance) / feather));
      }
      if (size === 0) coverage = 0;
      const index = (y * image.width + x) * 4;
      const ink = inkColor((x + 0.5) / image.width, (y + 0.5) / image.height);
      const paper = paperColor((x + 0.5) / image.width, (y + 0.5) / image.height);
      for (let c = 0; c < 3; c++) {
        const color = paper[c]! * (1 - coverage) + ink[c]! * coverage;
        output[index + c] = Math.round(
          pixels[index + c]! * (1 - amount) +
            blendChannel(pixels[index + c]!, color, effect.params.blendMode ?? 'normal') * amount,
        );
      }
      output[index + 3] = pixels[index + 3]!;
    }
    yield;
  }
}
type OutputShift = { x: number; y: number };
function* placeOutput(
  image: EffectImage,
  output: Uint8Array,
  effect: MirroringEffect | KaleidoscopeEffect,
  suppliedShift?: OutputShift,
  reportShift?: (shift: OutputShift) => void,
): Generator<void> {
  const alignment: OutputAlignment = effect.params.outputAlignment ?? 'none';
  let shiftX = ((effect.params.outputOffsetX ?? 0) * image.width) / 100;
  let shiftY = ((effect.params.outputOffsetY ?? 0) * image.height) / 100;
  if (suppliedShift) {
    shiftX = suppliedShift.x;
    shiftY = suppliedShift.y;
  } else if (alignment !== 'none') {
    let left = image.width,
      right = -1,
      top = image.height,
      bottom = -1;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (output[(y * image.width + x) * 4 + 3]! === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      yield;
    }
    // Empty objects have no alignment anchor; manual offsets still apply.
    if (right >= left) {
      shiftX += alignment.includes('left')
        ? -left
        : alignment.includes('right')
          ? image.width - 1 - right
          : (image.width - 1 - left - right) / 2;
      shiftY += alignment.includes('top')
        ? -top
        : alignment.includes('bottom')
          ? image.height - 1 - bottom
          : (image.height - 1 - top - bottom) / 2;
    }
  }
  shiftX = Math.round(shiftX * 1e7) / 1e7;
  shiftY = Math.round(shiftY * 1e7) / 1e7;
  reportShift?.({ x: shiftX, y: shiftY });
  if (shiftX === 0 && shiftY === 0) return;
  const source = output.slice();
  output.fill(0);
  const premultiplied = new Float64Array(3);
  const hidden = new Float64Array(3);
  // Placement clips to a fixed canvas with transparent padding. Edge Handling
  // belongs to pattern sampling and must never repeat a moved object's border.
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const sx = x - shiftX,
        sy = y - shiftY;
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy);
      const fx = sx - x0,
        fy = sy - y0;
      const index = (y * image.width + x) * 4;
      let alpha = 0;
      premultiplied.fill(0);
      hidden.fill(0);
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = x0 + dx,
            py = y0 + dy;
          if (px < 0 || px >= image.width || py < 0 || py >= image.height) continue;
          const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
          const sample = (py * image.width + px) * 4;
          const a = source[sample + 3]! * weight;
          alpha += a;
          for (let c = 0; c < 3; c++) {
            premultiplied[c]! += source[sample + c]! * a;
            hidden[c]! += source[sample + c]! * weight;
          }
        }
      }
      for (let c = 0; c < 3; c++)
        output[index + c] = Math.round(alpha > 0 ? premultiplied[c]! / alpha : hidden[c]!);
      output[index + 3] = Math.round(alpha);
    }
    yield;
  }
}

function* reflection(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: MirroringEffect | KaleidoscopeEffect,
  reference: { width: number; height: number },
  suppliedShift?: OutputShift,
  reportShift?: (shift: OutputShift) => void,
): Generator<void> {
  const stepX = reference.width / image.width,
    stepY = reference.height / image.height;
  const sampled = new Float64Array(4);
  const mirror = effect.type === 'mirroring' ? effect.params : null;
  const kaleido = effect.type === 'kaleidoscope' ? effect.params : null;
  const centerX = (reference.width * (mirror ? mirror.positionX : kaleido!.centerX)) / 100;
  const centerY = (reference.height * (mirror ? mirror.positionY : kaleido!.centerY)) / 100;
  const angle =
    ((mirror
      ? mirror.axis === 'vertical'
        ? 0
        : mirror.axis === 'horizontal'
          ? 90
          : mirror.rotation
      : kaleido!.rotation) *
      Math.PI) /
    180;
  const nx = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle),
    ny = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle);
  const span = kaleido ? (Math.PI * 2) / kaleido.segments : 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      const dx = (x + 0.5) * stepX - centerX,
        dy = (y + 0.5) * stepY - centerY;
      let sx: number, sy: number;
      if (mirror) {
        const distance = dx * nx + dy * ny;
        const keep = mirror.sourceSide === 'first' ? distance <= 0 : distance >= 0;
        if (keep) {
          output.set(pixels.subarray(index, index + 4), index);
          continue;
        }
        sx = x - (2 * distance * nx) / stepX;
        sy = y - (2 * distance * ny) / stepY;
      } else {
        const radius = Math.hypot(dx, dy) / kaleido!.zoom;
        const theta = Math.atan2(dy, dx) - angle;
        const folded = Math.abs(((((theta + span / 2) % span) + span) % span) - span / 2);
        sx = (centerX + Math.cos(angle + folded) * radius) / stepX - 0.5;
        sy = (centerY + Math.sin(angle + folded) * radius) / stepY - 0.5;
      }
      // Polar round trips differ by a few ulps between JS engine versions.
      // Fix the sampling grid at 1e-7 pixels so alpha half-byte ties and exact
      // reflected centers produce the same RGBA in preview, export and replay.
      sx = Math.round(sx * 1e7) / 1e7;
      sy = Math.round(sy * 1e7) / 1e7;
      sampleBilinear(
        pixels,
        image.width,
        image.height,
        sx,
        sy,
        sampled,
        effect.params.edgeHandling ?? 'extend',
      );
      blend(output, pixels, index, sampled, effect.params.amount);
    }
    yield;
  }
  yield* placeOutput(image, output, effect, suppliedShift, reportShift);
}

function* motionMosh(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: MotionMoshEffect,
  reference: { width: number; height: number },
  seed: number,
  directionField?: DirectionSampler,
): Generator<void> {
  const p = effect.params;
  const shorter = Math.min(reference.width, reference.height);
  const block = Math.max(1, (shorter * p.blockSize) / 100);
  const distance = (shorter * p.travel) / 100;
  const angle = (p.direction * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle);
  const sine = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle);
  const coherence = p.coherence ?? 1;
  const influence = directionFieldParams(p).directionInfluence;
  const vector = new Float64Array(2);
  // Every pixel in a macroblock uses the same steering. Keep only the current
  // block row so imported/procedural fields are not sampled per pixel.
  let fieldRow = -1;
  const fieldVectors = new Map<number, readonly [number, number]>();
  const sx = image.width / reference.width,
    sy = image.height / reference.height;
  const color = new Float64Array(4);
  const samples = p.trailLength === 0 || p.persistence === 0 ? 1 : p.samples;
  const premultiplied = new Float64Array(3);
  const hidden = new Float64Array(3);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      let vx = cosine,
        vy = sine;
      if (directionField || coherence < 1) {
        const cx = Math.floor((x + 0.5) / sx / block);
        const cy = Math.floor((y + 0.5) / sy / block);
        if (cy !== fieldRow) {
          fieldVectors.clear();
          fieldRow = cy;
        }
        const cached = fieldVectors.get(cx);
        if (cached) {
          vx = cached[0];
          vy = cached[1];
        } else {
          if (directionField) {
            mixDirection(
              directionField,
              ((cx + 0.5) * block) / reference.width,
              ((cy + 0.5) * block) / reference.height,
              cosine,
              sine,
              influence,
              vector,
            );
            vx = vector[0]!;
            vy = vector[1]!;
          }
          const turn =
            (cellRandom(seed, cx, cy, 6, effect.seedOffset) * 2 - 1) * Math.PI * (1 - coherence);
          const c = Math.cos(turn),
            s = Math.sin(turn);
          const previousX = vx;
          vx = previousX * c - vy * s;
          vy = previousX * s + vy * c;
          fieldVectors.set(cx, [vx, vy]);
        }
      }
      const dx = distance * vx,
        dy = distance * vy;
      let weightSum = 0,
        alphaSum = 0;
      premultiplied.fill(0);
      hidden.fill(0);
      for (let step = 0; step < samples; step++) {
        const age = samples - 1 - step;
        const t = samples === 1 ? 1 : 1 - (p.trailLength * age) / (samples - 1);
        const refX = (x + 0.5) / sx - dx * t;
        const refY = (y + 0.5) / sy - dy * t;
        const cellX = Math.floor(
          edgeIndex(Math.floor(refX), reference.width, p.edgeHandling) / block,
        );
        const cellY = Math.floor(
          edgeIndex(Math.floor(refY), reference.height, p.edgeHandling) / block,
        );
        if (cellRandom(seed, cellX, cellY, 0, effect.seedOffset) >= p.density) continue;
        sampleBilinear(
          pixels,
          image.width,
          image.height,
          refX * sx - 0.5,
          refY * sy - 0.5,
          color,
          p.edgeHandling,
        );
        const weight = age === 0 ? 1 : p.persistence ** age;
        weightSum += weight;
        alphaSum += color[3]! * weight;
        for (let channel = 0; channel < 3; channel++) {
          premultiplied[channel]! += color[channel]! * color[3]! * weight;
          hidden[channel]! += color[channel]! * weight;
        }
      }
      if (weightSum === 0) output.set(pixels.subarray(index, index + 4), index);
      else {
        for (let channel = 0; channel < 3; channel++)
          color[channel] =
            alphaSum > 0 ? premultiplied[channel]! / alphaSum : hidden[channel]! / weightSum;
        color[3] = alphaSum / weightSum;
        blend(output, pixels, index, color, Math.min(1, weightSum) * p.amount);
      }
      if (x % 128 === 127) yield;
    }
    yield;
  }
}

function* singleShape(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: ShapesEffect,
  reference: { width: number; height: number },
): Generator<void> {
  const p = effect.params;
  const shorter = Math.min(reference.width, reference.height);
  const radius = (shorter * p.size * p.scale) / 200;
  const centerX = (reference.width * p.positionX) / 100,
    centerY = (reference.height * p.positionY) / 100;
  const angle = (p.rotation * Math.PI) / 180,
    cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const sx = image.width / reference.width,
    sy = image.height / reference.height;
  const edgeWidth = Math.max(Math.max(1 / sx, 1 / sy), (shorter * p.feather) / 100);
  const color = new Float64Array(4);
  const shapeColor = createColorSampler(p, 'shapeColor', p.shapeColor, reference);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      const dx = (x + 0.5) / sx - centerX,
        dy = (y + 0.5) / sy - centerY;
      const localX = cosine * dx + sine * dy,
        localY = -sine * dx + cosine * dy;
      const radial = Math.hypot(localX, localY);
      const distance =
        p.shape === 'polygon'
          ? polygonDistance(localX, localY, radius, p.startSides ?? SHAPE_TILE_DEFAULTS.startSides)
          : p.shape === 'square'
            ? Math.max(Math.abs(localX), Math.abs(localY)) - radius
            : p.shape === 'triangle'
              ? Math.max(
                  localY - radius,
                  (-2 * localX - localY - radius) / Math.sqrt(5),
                  (2 * localX - localY - radius) / Math.sqrt(5),
                )
              : p.shape === 'ring' && p.ringThickness < 1
                ? Math.max(radial - radius, radius * (1 - p.ringThickness) - radial)
                : radial - radius;
      const t = Math.max(0, Math.min(1, 0.5 - distance / edgeWidth));
      const mask = t * t * (3 - 2 * t);
      color.set(pixels.subarray(index, index + 4));
      if (p.operation === 'keep-inside' || p.operation === 'cut-out') {
        color[3] = pixels[index + 3]! * (p.operation === 'keep-inside' ? mask : 1 - mask);
      } else if (mask > 0 && p.operation === 'overlay') {
        const paint = shapeColor((x + 0.5) / image.width, (y + 0.5) / image.height);
        for (let c = 0; c < 3; c++) color[c] = pixels[index + c]! * (1 - mask) + paint[c]! * mask;
      } else if (mask > 0 && p.operation === 'distort') {
        const twist = ((-p.twist * Math.PI) / 180) * Math.max(0, 1 - radial / radius);
        const tx = (dx * Math.cos(twist) - dy * Math.sin(twist)) / p.distortionScale;
        const ty = (dx * Math.sin(twist) + dy * Math.cos(twist)) / p.distortionScale;
        sampleBilinear(
          pixels,
          image.width,
          image.height,
          (centerX + tx) * sx - 0.5,
          (centerY + ty) * sy - 0.5,
          color,
          p.edgeHandling,
        );
        blend(output, pixels, index, color, mask);
        color.set(output.subarray(index, index + 4));
      }
      blend(output, pixels, index, color, p.amount);
    }
    yield;
  }
}

function* shapes(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: ShapesEffect,
  reference: { width: number; height: number },
  seed: number,
): Generator<void> {
  if ((effect.params.layout ?? 'single') !== 'tiled') {
    yield* singleShape(image, pixels, output, effect, reference);
    return;
  }
  const p = effect.params;
  const sx = image.width / reference.width,
    sy = image.height / reference.height;
  const tiles = createShapeTiles(effect, reference, Math.max(1 / sx, 1 / sy), (x, y, lane) =>
    cellRandom(seed, x, y, lane, effect.seedOffset),
  );
  const color = new Float64Array(4);
  const shapeColor = createColorSampler(p, 'shapeColor', p.shapeColor, reference);
  const stable = (value: number) => Math.round(value * 1e7) / 1e7;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      const t = tiles.sample((x + 0.5) / sx, (y + 0.5) / sy);
      const coverage = Math.max(0, Math.min(1, 0.5 - stable(t.distance / tiles.edgeWidth)));
      const mask = coverage * coverage * (3 - 2 * coverage);
      color.set(pixels.subarray(index, index + 4));
      if (p.operation === 'keep-inside' || p.operation === 'cut-out') {
        color[3] = pixels[index + 3]! * (p.operation === 'keep-inside' ? mask : 1 - mask);
      } else if (mask > 0 && p.operation === 'overlay') {
        const paint = shapeColor((x + 0.5) / image.width, (y + 0.5) / image.height);
        for (let c = 0; c < 3; c++) color[c] = pixels[index + c]! * (1 - mask) + paint[c]! * mask;
      } else if (mask > 0 && p.operation === 'distort') {
        const twist =
          ((-p.twist * Math.PI) / 180) * Math.max(0, 1 - Math.hypot(t.dx, t.dy) / tiles.radius);
        const tx = (t.dx * Math.cos(twist) - t.dy * Math.sin(twist)) / p.distortionScale;
        const ty = (t.dx * Math.sin(twist) + t.dy * Math.cos(twist)) / p.distortionScale;
        sampleBilinear(
          pixels,
          image.width,
          image.height,
          stable((t.centerX + tx) * sx - 0.5),
          stable((t.centerY + ty) * sy - 0.5),
          color,
          p.edgeHandling,
        );
        blend(output, pixels, index, color, mask);
        color.set(output.subarray(index, index + 4));
      }
      blend(output, pixels, index, color, p.amount);
      if (x % 32 === 31) yield;
    }
    yield;
  }
}

function* recursiveSpace(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: RecursiveSpaceEffect,
  reference: { width: number; height: number },
  field?: HeightField,
): Generator<void> {
  const p = effect.params;
  const angle = (p.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const logScale = Math.log(p.repetitionScale),
    power = 1 + p.perspective;
  const sampled = new Float64Array(4);
  const fraction = (value: number) => value - Math.floor(value);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      // Normalize in the original image plane, independent of preview size.
      const originalX = ((x + 0.5) * reference.width) / image.width;
      const originalY = ((y + 0.5) * reference.height) / image.height;
      const height = field
        ? sampleHeight(field, (x + 0.5) / image.width, (y + 0.5) / image.height) - 0.5
        : 0;
      const distortion = field
        ? ((height * (p.fieldDistortion ?? 0)) / 100) * Math.min(reference.width, reference.height)
        : 0;
      const localScale = field
        ? Math.max(
            0.2,
            Math.min(0.95, p.repetitionScale + height * (p.fieldRepetition ?? 0.5) * 0.4),
          )
        : p.repetitionScale;
      const localLogScale = field ? Math.log(localScale) : logScale;
      const imageScale = field
        ? p.imageScale * 2 ** (height * (p.fieldImageScale ?? 0) * 2)
        : p.imageScale;
      const dx = 2 * ((originalX - distortion) / reference.width - p.centerX / 100);
      const dy = 2 * ((originalY - distortion) / reference.height - p.centerY / 100);
      const u = cosine * dx + sine * dy,
        v = -sine * dx + cosine * dy;
      const radius = p.style === 'spiral' ? Math.hypot(u, v) : Math.max(Math.abs(u), Math.abs(v));
      const levelPosition = Math.max(0, Math.log(Math.max(radius, 1e-30)) / localLogScale) ** power;
      const level = Math.min(p.depth - 1, Math.floor(levelPosition));
      const outer = localScale ** (level ** (1 / power));
      const inner = localScale ** ((level + 1) ** (1 / power));
      let sx: number, sy: number;
      if (levelPosition >= p.depth || radius < 1e-15) {
        // The final central image caps the finite recursion and avoids a pole.
        const core = localScale ** (p.depth ** (1 / power));
        sx = 0.5 + u / (2 * core);
        sy = 0.5 + v / (2 * core);
      } else if (p.style === 'tunnel') {
        let wall: number, along: number;
        if (Math.abs(v) >= Math.abs(u)) {
          wall = v < 0 ? 0 : 2;
          along = (v < 0 ? u : -u) / radius;
        } else {
          wall = u > 0 ? 1 : 3;
          along = (u > 0 ? v : -v) / radius;
        }
        sx = (along + 1) / 2;
        sy = (outer - radius) / (outer - inner);
        if (p.mirrorCopies === 'on' && wall % 2 === 1) sx = 1 - sx;
      } else {
        // Lattice planes retain flat, recognizable tiles; Spiral twists continuously.
        const turn = ((p.twist * Math.PI) / 180) * (p.style === 'lattice' ? level : levelPosition);
        if (p.style === 'spiral') {
          const tile = ((Math.atan2(v, u) - turn) / (2 * Math.PI) + 0.5) * p.symmetry;
          sx = fraction(tile);
          sy = (outer - radius) / (outer - inner);
          if (p.mirrorCopies === 'on' && Math.abs(Math.floor(tile) % 2) === 1) sx = 1 - sx;
        } else {
          const localX =
            (((Math.cos(turn) * u + Math.sin(turn) * v) / outer) * p.symmetry) / 2 + 0.5;
          const localY =
            (((-Math.sin(turn) * u + Math.cos(turn) * v) / outer) * p.symmetry) / 2 + 0.5;
          sx = fraction(localX);
          sy = fraction(localY);
          if (p.mirrorCopies === 'on') {
            if (Math.abs(Math.floor(localX) % 2) === 1) sx = 1 - sx;
            if (Math.abs(Math.floor(localY) % 2) === 1) sy = 1 - sy;
          }
        }
      }
      // Stabilize sampling ties across browser/Node math engines.
      const px = Math.round(((0.5 + (sx - 0.5) / imageScale) * image.width - 0.5) * 1e7) / 1e7;
      const py = Math.round(((0.5 + (sy - 0.5) / imageScale) * image.height - 0.5) * 1e7) / 1e7;
      sampleBilinear(pixels, image.width, image.height, px, py, sampled, p.edgeHandling);
      blend(output, pixels, (y * image.width + x) * 4, sampled, p.amount);
      if (x % 128 === 127) yield;
    }
    yield;
  }
}

function* mandelbrot(
  image: EffectImage,
  pixels: Uint8Array,
  output: Uint8Array,
  effect: MandelbrotEffect,
  reference: { width: number; height: number },
): Generator<void> {
  const p = effect.params;
  const shorter = Math.min(reference.width, reference.height);
  const span = 3.4 / (shorter * p.zoom);
  const angle = (p.rotation * Math.PI) / 180,
    cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const sx = image.width / reference.width,
    sy = image.height / reference.height;
  const exteriorColor = createColorSampler(p, 'outsideColor', p.outsideColor, reference, true);
  const b = [1, 3, 5].map((start) => Number.parseInt(p.insideColor.slice(start, start + 2), 16));
  const weaveAngle = ((p.weaveRotation ?? FRACTAL_DEFAULTS.weaveRotation) * Math.PI) / 180;
  const weaveCosine = Math.cos(weaveAngle),
    weaveSine = Math.sin(weaveAngle);
  const point = (x: number, y: number) => {
    const dx = x / sx - reference.width / 2,
      dy = y / sy - reference.height / 2;
    return fractalOrbit(
      p.centerReal + (cosine * dx + sine * dy) * span,
      p.centerImaginary + (-sine * dx + cosine * dy) * span,
      p,
      p.operation === 'distort',
      p.operation === 'weave',
    );
  };
  const color = new Float64Array(4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = (y * image.width + x) * 4;
      const result = point(x + 0.5, y + 0.5);
      color.set(pixels.subarray(index, index + 4));
      if (p.operation === 'texture') {
        const mix = result.inside
          ? 0
          : 0.5 +
            0.5 *
              Math.cos(
                2 *
                  Math.PI *
                  ((p.paletteCycles * Math.log1p(result.count)) / Math.log1p(p.iterations) +
                    p.paletteOffset),
              );
        const ramp = exteriorColor(0, 0, mix);
        for (let c = 0; c < 3; c++)
          color[c] =
            p.outsideColorMode === 'gradient' && !result.inside
              ? ramp[c]!
              : b[c]! * (1 - mix) + ramp[c]! * mix;
      } else if (p.operation === 'distort') {
        const length = Math.max(1, Math.hypot(result.x, result.y));
        const distance = (shorter * p.distortion) / 100;
        sampleBilinear(
          pixels,
          image.width,
          image.height,
          x - ((distance * result.x) / length) * sx,
          y - ((distance * result.y) / length) * sy,
          color,
          p.edgeHandling,
        );
      } else if (p.operation === 'weave') {
        const scale = p.weaveScale ?? FRACTAL_DEFAULTS.weaveScale;
        const mirror =
          (p.weaveMirror ?? FRACTAL_DEFAULTS.weaveMirror) === 'on' && result.trapStep % 2 === 0
            ? -1
            : 1;
        const tx = (weaveCosine * result.trapX + weaveSine * result.trapY) * mirror;
        const ty = -weaveSine * result.trapX + weaveCosine * result.trapY;
        const abstraction = p.abstraction ?? FRACTAL_DEFAULTS.abstraction;
        const mappedX = (0.5 + tx / (2 * scale)) * reference.width;
        const mappedY = (0.5 + ty / (2 * scale)) * reference.height;
        sampleBilinear(
          pixels,
          image.width,
          image.height,
          x + (mappedX * sx - 0.5 - x) * abstraction,
          y + (mappedY * sy - 0.5 - y) * abstraction,
          color,
          p.edgeHandling,
        );
      } else {
        // Four subpixel classifications antialias the fractal cutout boundary.
        let inside = 0;
        for (const oy of [0.25, 0.75])
          for (const ox of [0.25, 0.75]) if (point(x + ox, y + oy).inside) inside++;
        const coverage = inside / 4;
        color[3] = pixels[index + 3]! * (p.operation === 'keep-set' ? coverage : 1 - coverage);
      }
      blend(output, pixels, index, color, p.amount);
      if (x % 64 === 63) yield;
    }
    yield;
  }
}

function sampleTransparent(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
): void {
  const left = Math.floor(x),
    top = Math.floor(y),
    fx = x - left,
    fy = y - top;
  color.fill(0);
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const sx = left + dx,
        sy = top + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const i = (sy * width + sx) * 4;
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy),
        alpha = pixels[i + 3]! * weight;
      color[3] = color[3]! + alpha;
      for (let c = 0; c < 3; c++) color[c] = color[c]! + pixels[i + c]! * alpha;
    }
  for (let c = 0; c < 3; c++) color[c] = color[3]! > 0 ? color[c]! / color[3]! : 0;
}

function* renderSteps(
  image: EffectImage,
  effects: readonly EffectInstance[],
  options: RenderOptions,
  mattePass = false,
  reportShift?: (shift: OutputShift) => void,
  heightSource: EffectImage = image,
  fieldCache = new Map<string, HeightField>(),
): Generator<void | Promise<void>, EffectImage> {
  const reference = options.reference ?? image;
  // Copies share computation only within this render. Recipes remain independent,
  // and a bounded cache cannot retain stage images or stale cross-render heights.
  function* fieldFrom(
    params: Partial<HeightFieldParams>,
    attachment?: LayerImage,
  ): Generator<void, HeightField> {
    const imported = attachment ? options.layerImages?.get(attachment.source.id) : undefined;
    if (heightFieldParams(params).fieldSource === 'image' && !imported)
      throw new Error('Choose a depth map before using Imported Map.');
    const recipe = heightFieldParams(params);
    const key = JSON.stringify([recipe, attachment?.source.id]);
    const cached = fieldCache.get(key);
    if (cached) return cached;
    const field = yield* createHeightField(
      heightSource,
      reference,
      recipe,
      sampleBilinear,
      (x, y, lane) => cellRandom(recipe.fieldSeed, x, y, lane),
      imported,
      options.fieldMaxDimension,
    );
    if (fieldCache.size >= 8) fieldCache.delete(fieldCache.keys().next().value!);
    fieldCache.set(key, field);
    return field;
  }
  function* fieldFor(
    effect: EffectInstance & { params: Partial<HeightFieldParams> },
  ): Generator<void, HeightField> {
    return yield* fieldFrom(
      effect.params,
      supportsHeightField(effect) ? effect.fieldImage : undefined,
    );
  }
  const applicationAnalysis = new Map<number, ApplicationAnalysis>();
  let pixels = new Uint8Array(image.pixels);
  let objectPixels: ArrayBuffer | undefined;
  if (
    !mattePass &&
    effects.some(
      (effect) =>
        effect.enabled &&
        effect.params.amount > 0 &&
        effect.application.coverage > 0 &&
        (effect.type === 'mirroring' || effect.type === 'kaleidoscope') &&
        (effect.params.outputAlignment ?? 'none') !== 'none',
    )
  ) {
    let transparent = false;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++)
        if (pixels[(y * image.width + x) * 4 + 3]! < 255) transparent = true;
      yield;
    }
    if (!transparent) {
      const subject = options.subjectMask;
      if (!subject || subject.values.byteLength !== subject.width * subject.height)
        throw new Error('Subject detection is not available for output alignment.');
      const values = new Uint8Array(subject.values);
      const matte = new Uint8Array(pixels.length);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const mx = Math.min(
            subject.width - 1,
            Math.floor(((x + 0.5) * subject.width) / image.width),
          );
          const my = Math.min(
            subject.height - 1,
            Math.floor(((y + 0.5) * subject.height) / image.height),
          );
          matte[(y * image.width + x) * 4 + 3] = values[my * subject.width + mx]! >= 128 ? 255 : 0;
        }
        yield;
      }
      objectPixels = matte.buffer;
    }
  }
  // Alignment carries a second subject matte through the stack; keep that path
  // uncached until both images can be checkpointed together.
  const checkpoint =
    !mattePass &&
    !effects.some(
      (effect) =>
        (effect.type === 'mirroring' || effect.type === 'kaleidoscope') &&
        (effect.params.outputAlignment ?? 'none') !== 'none',
    )
      ? options.previewStackCache?.begin(image, effects, options)
      : null;
  if (checkpoint?.pixels) pixels = checkpoint.pixels;
  for (let effectIndex = checkpoint?.count ?? 0; effectIndex < effects.length; effectIndex++) {
    if (effectIndex > 0) checkpoint?.capture(effectIndex, pixels);
    const storedEffect = effects[effectIndex]!;
    let objectShift: OutputShift | undefined;
    if (objectPixels) {
      // Carry the detected subject through preceding effects, masks and earlier
      // placements. Its reflected bounds describe the object in this result,
      // rather than the subject's original location in the source photo.
      const matte = yield* renderSteps(
        { ...image, pixels: objectPixels },
        [storedEffect],
        options,
        true,
        (shift) => {
          objectShift = shift;
        },
        heightSource,
        fieldCache,
      );
      objectPixels = matte.pixels;
    }
    const finish = { ...IMAGE_FINISH_DEFAULTS, ...(storedEffect.params as ImageFinishParams) };
    const tintStrength = isTintEnabled(storedEffect.params) ? finish.tintStrength : 0;
    const placement =
      (storedEffect.type === 'mirroring' || storedEffect.type === 'kaleidoscope') &&
      ((storedEffect.params.outputAlignment ?? 'none') !== 'none' ||
        (storedEffect.params.outputOffsetX ?? 0) !== 0 ||
        (storedEffect.params.outputOffsetY ?? 0) !== 0);
    const imageFinish =
      getEffectDefinition(storedEffect).finish === 'image' &&
      (isShaderEffect(storedEffect) ||
        storedEffect.type === 'window-fragments' ||
        storedEffect.type === 'contour-waves' ||
        [
          'system-crash',
          'terminal-wireframe',
          'signal-weave',
          'data-weave',
          'micro-collage',
        ].includes(storedEffect.type) ||
        storedEffect.type === 'pixel-dissolve' ||
        storedEffect.type === 'neon-print' ||
        storedEffect.type === 'cel-shading' ||
        placement ||
        finish.blendMode !== 'normal' ||
        (tintStrength > 0 &&
          (finish.color.toLowerCase() !== '#ffffff' ||
            (finish.colorMode === 'gradient' &&
              ((finish.colorEnd ?? DEFAULT_GRADIENT_END).toLowerCase() !== '#ffffff' ||
                (finish.colorStops ?? '[]') !== '[]')))));
    // Render an unblended result for the shared composite. The legacy path keeps
    // its exact rounding and avoids an extra pass when the finish is neutral.
    const effect = imageFinish
      ? ({ ...storedEffect, params: { ...storedEffect.params, amount: 1 } } as EffectInstance)
      : storedEffect;
    const directionRecipe = directionFieldParams(effect.params);
    const replacesHeightSteering =
      effect.type === 'signal-tearing' &&
      directionRecipe.directionSource !== 'native' &&
      directionRecipe.directionInfluence === 1;
    if (
      !storedEffect.enabled ||
      storedEffect.params.amount === 0 ||
      storedEffect.application.coverage === 0
    )
      continue;
    if (
      usesHeightField(effect) &&
      !replacesHeightSteering &&
      heightFieldParams(effect.params).fieldSource === 'image' &&
      !effect.fieldImage
    )
      continue;
    if (
      !imageFinish &&
      effect.type === 'bit-crush' &&
      bitCrushDepths(effect.params).every((bits) => bits === 8)
    )
      continue;
    if (!imageFinish && effect.type === 'glow' && effect.params.strength === 0) continue;
    if (!imageFinish && effect.type === 'crt' && crtIsNeutral(effect.params)) continue;
    if (!imageFinish && effect.type === 'channel-transform' && channelIsNeutral(effect.params))
      continue;
    if (!imageFinish && effect.type === 'temporal-echo' && echoIsNeutral(effect.params)) continue;
    if (!imageFinish && effect.type === 'bit-damage' && effect.params.density === 0) continue;
    if (!imageFinish && effect.type === 'freeze-dropout' && effect.params.density === 0) continue;
    if (!imageFinish && effect.type === 'photo-adjustments' && photoIsNeutral(effect.params))
      continue;
    if (
      !imageFinish &&
      effect.type === 'detail' &&
      effect.params.sharpen === 0 &&
      effect.params.clarity === 0
    )
      continue;
    if (!imageFinish && effect.type === 'halation' && effect.params.strength === 0) continue;
    if (!imageFinish && effect.type === 'vignette' && effect.params.strength === 0) continue;
    if (
      !imageFinish &&
      effect.type === 'signal-tearing' &&
      (effect.params.displacement === 0 || effect.params.density === 0)
    )
      continue;
    if (
      !imageFinish &&
      effect.type === 'compression-breakup' &&
      compressionIsNeutral(effect.params)
    )
      continue;
    if (
      !imageFinish &&
      effect.type === 'levels-curves' &&
      (effect.params.mode === 'levels'
        ? effect.params.inputBlack === 0 &&
          effect.params.inputWhite === 1 &&
          effect.params.gamma === 1 &&
          effect.params.outputBlack === 0 &&
          effect.params.outputWhite === 1
        : CURVE_KEYS.every((key, i) => effect.params[key] === i / 4))
    )
      continue;
    if (
      !imageFinish &&
      effect.type === 'hue-saturation' &&
      effect.params.hue === 0 &&
      effect.params.saturation === 0 &&
      effect.params.lightness === 0
    )
      continue;
    if (!imageFinish && effect.type === 'wave-distortion' && effect.params.strength === 0) continue;
    if (
      !imageFinish &&
      effect.type === 'motion-mosh' &&
      (effect.params.travel === 0 || effect.params.density === 0)
    )
      continue;
    if (
      !imageFinish &&
      effect.type === 'mandelbrot' &&
      ((effect.params.operation === 'distort' && effect.params.distortion === 0) ||
        (effect.params.operation === 'weave' && effect.params.abstraction === 0))
    )
      continue;
    if (
      !imageFinish &&
      effect.type === 'shapes' &&
      effect.params.operation === 'distort' &&
      effect.params.distortionScale === 1 &&
      effect.params.twist === 0
    )
      continue;
    if (
      effect.type === 'scanlines' &&
      (effect.params.intensity === 0 ||
        (effect.params.thickness === 0 &&
          effect.params.style !== 'grille' &&
          ((effect.params.signalError ?? 'none') === 'none' ||
            (effect.params.errorStrength ?? 0.35) === 0 ||
            effect.params.signalError === 'dropout')))
    )
      continue;
    if (
      !imageFinish &&
      effect.type === 'block-corruption' &&
      (effect.params.density === 0 || effect.params.displacement === 0)
    )
      continue;
    if (
      !imageFinish &&
      effect.type === 'transform' &&
      effect.params.scale === 100 &&
      effect.params.rotation === 0 &&
      effect.params.positionX === 0 &&
      effect.params.positionY === 0
    )
      continue;
    const output = new Uint8Array(pixels.length);
    const seeded = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
    // Reference filters take a seed directly, rather than the counter-based
    // random callback used by older effects. Include the per-layer variation.
    const referenceSeed = (seeded ^ Math.imul(effect.seedOffset, 0x27d4eb2f)) >>> 0;
    const random = (x: number, y: number, lane: number) =>
      cellRandom(seeded, x, y, lane, effect.seedOffset);
    const directionField =
      supportsDirectionField(effect) &&
      directionRecipe.directionSource !== 'native' &&
      directionRecipe.directionInfluence > 0
        ? createDirectionSampler(
            effect.params,
            reference,
            heightSource,
            effect.directionImage
              ? options.layerImages?.get(effect.directionImage.source.id)
              : undefined,
          )
        : undefined;
    if (directionField && directionRecipe.directionSource === 'image' && !effect.directionImage)
      continue;
    if (
      directionField &&
      directionRecipe.directionSource === 'image' &&
      effect.directionImage &&
      !options.layerImages?.has(effect.directionImage.source.id)
    )
      throw new Error('The embedded direction map is unavailable.');
    if (isShaderEffect(effect)) {
      const heightField = [
        'shader-spectral-terrain',
        'shader-liquid-marbling',
        'shader-contour-melt',
        'shader-liquid-foil',
      ].includes(effect.type)
        ? yield* fieldFor(effect)
        : undefined;
      let executed = false;
      if (options.renderShader) {
        yield options
          .renderShader(
            { ...image, pixels: pixels.buffer as ArrayBuffer },
            effect,
            seeded,
            reference,
            heightField,
            directionField,
          )
          .then((raw) => {
            if (raw === null) return;
            if (raw.byteLength !== output.byteLength) throw new Error('Invalid shader output.');
            output.set(new Uint8Array(raw));
            executed = true;
          });
      }
      if (!executed && effect.type === 'shader-import') {
        throw new Error(
          `The imported shader ${effect.shader.name} requires ${effect.shader.language === 'isf' ? 'WebGL2' : 'WebGPU'}. Disable it to use CPU rendering.`,
        );
      } else if (!executed && effect.type !== 'shader-import') {
        yield* builtinShaderPixels(
          pixels,
          output,
          image.width,
          image.height,
          effect,
          seeded,
          reference,
          sampleBilinear,
          heightField,
          directionField,
        );
      }
    } else if (effect.type === 'granular-echo') {
      yield* granularEchoPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
        directionField,
      );
    } else if (effect.type === 'pigment-drag') {
      yield* pigmentDragPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
        directionField,
      );
    } else if (effect.type === 'pixel-stretch') {
      yield* pixelStretchPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'led-matrix') {
      yield* ledMatrixPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'cel-shading') {
      yield* celShadingPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'system-crash') {
      yield* systemCrashPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'terminal-wireframe') {
      yield* terminalWireframePixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'signal-weave') {
      yield* signalWeavePixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'data-weave') {
      yield* dataWeavePixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'micro-collage') {
      const imported = effect.image ? options.layerImages?.get(effect.image.source.id) : undefined;
      if (effect.image && !imported)
        throw new Error('The embedded collage reference image is unavailable.');
      yield* microCollagePixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
        imported,
      );
    } else if (effect.type === 'pixel-dissolve') {
      yield* pixelDissolvePixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'neon-print') {
      yield* neonPrintPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
      );
    } else if (effect.type === 'window-fragments') {
      const imported = effect.image ? options.layerImages?.get(effect.image.source.id) : undefined;
      if (effect.image && !imported)
        throw new Error('The embedded window reference image is unavailable.');
      yield* windowFragmentPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        referenceSeed,
        reference,
        sampleBilinear,
        imported,
      );
    } else if (effect.type === 'contour-waves') {
      const field = yield* fieldFor(effect);
      yield* contourWavePixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        field,
        reference,
        referenceSeed,
      );
    } else if (effect.type === 'vector-corruption') {
      yield* vectorCorruptionPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        random,
        blend,
        directionField,
      );
    } else if (effect.type === 'reference-mosh' || effect.type === 'motion-transfer') {
      if (!effect.image && !(effect.type === 'motion-transfer' && directionField)) continue;
      const layer = effect.image
        ? options.layerImages?.get(effect.image.source.id)
        : { width: 1, height: 1, pixels: Uint8Array.from([128, 128, 128, 255]).buffer };
      if (
        !layer ||
        (effect.image &&
          (layer.width !== effect.image.source.width ||
            layer.height !== effect.image.source.height)) ||
        layer.pixels.byteLength !== layer.width * layer.height * 4
      )
        throw new Error('The embedded image/map is not available or has invalid pixels.');
      if (effect.type === 'reference-mosh')
        yield* referenceMoshPixels(
          pixels,
          output,
          image.width,
          image.height,
          effect.params,
          reference,
          layer,
          sampleBilinear,
          sampleTransparent,
          random,
          blend,
        );
      else
        yield* motionTransferPixels(
          pixels,
          output,
          image.width,
          image.height,
          effect.params,
          reference,
          layer,
          sampleBilinear,
          blend,
          directionField,
        );
    } else if (effect.type === 'depth-parallax') {
      const field = yield* fieldFor(effect);
      yield* depthParallaxPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        field,
        reference,
        sampleBilinear,
        sampleTransparent,
        random,
        blend,
      );
    } else if (effect.type === 'depth-haze' || effect.type === 'depth-color-map') {
      const field = yield* fieldFor(effect);
      yield* depthColorPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect,
        field,
        reference,
        blend,
      );
    } else if (effect.type === 'cutout') {
      const field = effect.params.mode === 'subject' ? undefined : yield* fieldFor(effect);
      yield* cutoutPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        field,
        options.subjectMask,
        blend,
      );
    } else if (effect.type === 'lens-distortion') {
      yield* lensDistortionPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        sampleTransparent,
        blend,
      );
    } else if (effect.type === 'glow' && effect.params.strength === 0) {
      output.set(pixels);
    } else if (effect.type === 'levels-curves') {
      const table = createToneTable(effect.params);
      const selected = ['red', 'green', 'blue'].indexOf(effect.params.channel);
      const color = new Float64Array(4);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const index = (y * image.width + x) * 4;
          for (let c = 0; c < 3; c++)
            color[c] =
              selected < 0 || selected === c ? table[pixels[index + c]!]! : pixels[index + c]!;
          color[3] = pixels[index + 3]!;
          blend(output, pixels, index, color, effect.params.amount);
          if ((x & 127) === 127) yield;
        }
        yield;
      }
    } else if (effect.type === 'transform') {
      const p = effect.params;
      const scale = p.scale / 100,
        angle = (p.rotation * Math.PI) / 180;
      const cosine = Math.cos(angle),
        sine = Math.sin(angle);
      const bw = (Math.abs(cosine) * reference.width + Math.abs(sine) * reference.height) * scale;
      const bh = (Math.abs(sine) * reference.width + Math.abs(cosine) * reference.height) * scale;
      const ax =
        p.anchor.includes('left') || p.anchor === 'left'
          ? 0
          : p.anchor.includes('right') || p.anchor === 'right'
            ? 1
            : 0.5;
      const ay = p.anchor.includes('top') ? 0 : p.anchor.includes('bottom') ? 1 : 0.5;
      const cx =
        reference.width / 2 +
        (ax - 0.5) * (reference.width - bw) +
        (p.positionX / 100) * reference.width;
      const cy =
        reference.height / 2 +
        (ay - 0.5) * (reference.height - bh) +
        (p.positionY / 100) * reference.height;
      const color = new Float64Array(4);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const dx = ((x + 0.5) / image.width) * reference.width - cx;
          const dy = ((y + 0.5) / image.height) * reference.height - cy;
          const px =
            ((cosine * dx + sine * dy) / scale / reference.width + 0.5) * image.width - 0.5;
          const py =
            ((-sine * dx + cosine * dy) / scale / reference.height + 0.5) * image.height - 0.5;
          if (p.edges === 'transparent')
            sampleTransparent(pixels, image.width, image.height, px, py, color);
          else sampleBilinear(pixels, image.width, image.height, px, py, color, p.edges);
          blend(output, pixels, (y * image.width + x) * 4, color, p.amount);
          if ((x & 127) === 127) yield;
        }
        yield;
      }
    } else if (effect.type === 'solid') {
      const p = effect.params;
      const layer =
        p.content === 'drawing' && effect.drawing
          ? {
              width: image.width,
              height: image.height,
              pixels: (yield* canvasDrawingSteps(effect.drawing, image.width, image.height))
                .buffer as ArrayBuffer,
            }
          : p.content === 'source'
            ? heightSource
            : p.content === 'image' && effect.image
              ? options.layerImages?.get(effect.image.source.id)
              : undefined;
      if (p.content === 'image' && !effect.image) continue;
      if (p.content === 'drawing' && !effect.drawing) continue;
      if (p.content === 'image' && !layer)
        throw new Error('The Solid layer image is not available.');
      if (
        layer &&
        (layer.width < 1 ||
          layer.height < 1 ||
          layer.pixels.byteLength !== layer.width * layer.height * 4)
      )
        throw new Error('Invalid Solid layer image pixels.');
      const paint = createColorSampler(
        { ...p, fillColorMode: p.content === 'gradient' ? 'gradient' : 'solid' },
        'fillColor',
        p.fillColor,
        reference,
      );
      const color = new Float64Array(4);
      const layerPixels = layer ? new Uint8Array(layer.pixels) : undefined;
      const aspect = p.content === 'image' ? effect.image?.source : reference;
      const scale =
        layer && aspect
          ? (p.placement === 'fill' ? Math.max : Math.min)(
              reference.width / aspect.width,
              reference.height / aspect.height,
            )
          : 1;
      const drawnWidth =
        p.placement === 'stretch' || !aspect ? reference.width : aspect.width * scale;
      const drawnHeight =
        p.placement === 'stretch' || !aspect ? reference.height : aspect.height * scale;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4,
            u = (x + 0.5) / image.width,
            v = (y + 0.5) / image.height;
          if (layer && layerPixels) {
            const lu = (u * reference.width - (reference.width - drawnWidth) / 2) / drawnWidth;
            const lv = (v * reference.height - (reference.height - drawnHeight) / 2) / drawnHeight;
            if (lu < 0 || lu >= 1 || lv < 0 || lv >= 1) {
              output.set(pixels.subarray(i, i + 4), i);
              continue;
            }
            sampleBilinear(
              layerPixels,
              layer.width,
              layer.height,
              lu * layer.width - 0.5,
              lv * layer.height - 0.5,
              color,
              'extend',
            );
          } else {
            const rgb = paint(u, v);
            for (let c = 0; c < 3; c++) color[c] = rgb[c]!;
            color[3] = 255;
          }
          const sa = (color[3]! / 255) * p.amount,
            ba = pixels[i + 3]! / 255;
          const alpha = sa + ba * (1 - sa);
          for (let c = 0; c < 3; c++) {
            const source =
              color[c]! * (1 - ba) + blendChannel(pixels[i + c]!, color[c]!, p.blendMode) * ba;
            output[i + c] =
              alpha > 0
                ? Math.round((source * sa + pixels[i + c]! * ba * (1 - sa)) / alpha)
                : pixels[i + c]!;
          }
          output[i + 3] = Math.round(alpha * 255);
          if ((x & 127) === 127) yield;
        }
        yield;
      }
    } else if (effect.type === 'glow') {
      const field = yield* glowHighlights(
        pixels,
        image.width,
        image.height,
        effect.params,
        reference,
        edgeIndex,
      );
      const sampler = createColorSampler(
        effect.params,
        'glowColor',
        effect.params.glowColor,
        reference,
      );
      const color = new Float64Array(4);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const index = (y * image.width + x) * 4,
            at = (y * image.width + x) * 3;
          const tint = sampler((x + 0.5) / image.width, (y + 0.5) / image.height);
          const light = 0.2126 * field[at]! + 0.7152 * field[at + 1]! + 0.0722 * field[at + 2]!;
          for (let c = 0; c < 3; c++) {
            const halo =
              field[at + c]! * (1 - effect.params.colorMix) +
              ((light * tint[c]!) / 255) * effect.params.colorMix;
            color[c] = Math.min(255, pixels[index + c]! + halo * effect.params.strength);
          }
          color[3] = pixels[index + 3]!;
          blend(output, pixels, index, color, effect.params.amount);
          if ((x & 127) === 127) yield;
        }
        yield;
      }
    } else if (effect.type === 'hue-saturation' || effect.type === 'gradient-map') {
      const color = new Float64Array(4);
      const sample =
        effect.type === 'gradient-map'
          ? createColorSampler(
              {
                ramp: effect.params.shadows,
                rampMode: 'gradient',
                rampEnd: effect.params.highlights,
                rampStops: effect.params.shadowsStops ?? '[]',
              },
              'ramp',
              '#161638',
              reference,
              true,
            )
          : null;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const index = (y * image.width + x) * 4;
          if (effect.type === 'hue-saturation') {
            adjustHsl(
              pixels[index]!,
              pixels[index + 1]!,
              pixels[index + 2]!,
              effect.params.hue,
              effect.params.saturation,
              effect.params.lightness,
              color,
            );
          } else {
            const brightness =
              (0.2126 * pixels[index]! +
                0.7152 * pixels[index + 1]! +
                0.0722 * pixels[index + 2]!) /
              255;
            const midpoint = effect.params.midpoint;
            const value =
              brightness <= midpoint
                ? (0.5 * brightness) / midpoint
                : 0.5 + (0.5 * (brightness - midpoint)) / (1 - midpoint);
            const mapped = sample!(0, 0, effect.params.reverse === 'on' ? 1 - value : value);
            for (let c = 0; c < 3; c++) color[c] = mapped[c]!;
          }
          color[3] = pixels[index + 3]!;
          blend(output, pixels, index, color, effect.params.amount);
          if ((x & 127) === 127) yield;
        }
        yield;
      }
    } else if (effect.type === 'rgb-split') {
      // RGB split v1 retains its original integer sampling and unchanged alpha.
      const dx = Math.round((image.width * effect.params.horizontal) / 100);
      const dy = Math.round((image.height * effect.params.vertical) / 100);
      if (!imageFinish && dx === 0 && dy === 0) continue;
      const amount = effect.params.amount;
      const edgeHandling = effect.params.edgeHandling ?? 'extend';
      for (let y = 0; y < image.height; y++) {
        const redRow = edgeIndex(y - dy, image.height, edgeHandling) * image.width;
        const blueRow = edgeIndex(y + dy, image.height, edgeHandling) * image.width;
        for (let x = 0; x < image.width; x++) {
          const index = (y * image.width + x) * 4;
          const red = (redRow + edgeIndex(x - dx, image.width, edgeHandling)) * 4;
          const blue = (blueRow + edgeIndex(x + dx, image.width, edgeHandling)) * 4;
          output[index] = Math.round(pixels[index]! * (1 - amount) + pixels[red]! * amount);
          output[index + 1] = pixels[index + 1]!;
          output[index + 2] = Math.round(
            pixels[index + 2]! * (1 - amount) + pixels[blue + 2]! * amount,
          );
          output[index + 3] = pixels[index + 3]!;
        }
        yield;
      }
    } else if (effect.type === 'noise-grain') {
      const p = effect.params;
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const random = (x: number, y: number, lane: number) =>
        cellRandom(seed, x, y, lane, effect.seedOffset);
      const field = createNoiseField(p, random);
      const procedural = ['perlin', 'simplex', 'voronoi', 'value'].includes(p.style);
      const size =
        (Math.min(reference.width, reference.height) *
          (p.style === 'scan' ? (p.scanSpacing ?? 1) : procedural ? p.scale : p.size)) /
        100;
      const ramp = createColorSampler(p, 'noiseColor', p.noiseColor, reference, true);
      const color = new Float64Array(4);
      const values = new Float64Array(3);
      const valueAt = (nx: number, ny: number, lane: number) => {
        const value = field(nx, ny, p.coloring === 'color' ? lane * 211 : 0);
        return p.style === 'film'
          ? value * (1 - p.clumping) +
              noiseValue('value', nx / 4, ny / 4, random, lane + 601) * p.clumping
          : value;
      };
      for (let y = 0; y < image.height; y++) {
        const ny = ((y + 0.5) * reference.height) / image.height / size;
        for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4;
          const nx = ((x + 0.5) * reference.width) / image.width / size;
          const scanWidth = (p.scanWidth ?? 0.15) / (p.scanSpacing ?? 1);
          const inRow = ny - Math.floor(ny) < scanWidth;
          const inColumn = nx - Math.floor(nx) < scanWidth;
          const active =
            p.style === 'scan'
              ? p.scanDirection === 'vertical'
                ? inColumn
                : p.scanDirection === 'both'
                  ? inRow || inColumn
                  : inRow
              : !['speckle', 'salt-pepper'].includes(p.style) ||
                random(Math.floor(nx), Math.floor(ny), 903) < p.density;
          const luminance =
            (pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722) / 255;
          const response =
            p.style === 'film' ? 1 - p.tonalResponse * (1 - 4 * luminance * (1 - luminance)) : 1;
          values[0] = valueAt(nx, ny, 0);
          values[1] = p.coloring === 'color' ? valueAt(nx, ny, 1) : values[0]!;
          values[2] = p.coloring === 'color' ? valueAt(nx, ny, 2) : values[0]!;
          const selected =
            p.coloring === 'ramp'
              ? ramp((x + 0.5) / image.width, (y + 0.5) / image.height, values[0]!)
              : null;
          for (let c = 0; c < 3; c++)
            color[c] =
              !active || p.intensity === 0
                ? pixels[i + c]!
                : p.coloring === 'ramp'
                  ? pixels[i + c]! * (1 - p.intensity) + selected![c]! * p.intensity
                  : p.style === 'salt-pepper'
                    ? pixels[i + c]! * (1 - p.intensity) + values[c]! * 255 * p.intensity
                    : Math.max(
                        0,
                        Math.min(
                          255,
                          pixels[i + c]! + (values[c]! - 0.5) * 510 * p.intensity * response,
                        ),
                      );
          color[3] = pixels[i + 3]!;
          blend(output, pixels, i, color, p.amount);
          if (x % 64 === 63) yield;
        }
        yield;
      }
    } else if (effect.type === 'blur') {
      const field = effect.params.style === 'depth' ? yield* fieldFor(effect) : undefined;
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const blurred = yield* blurPixels(
        pixels,
        image.width,
        image.height,
        effect.params,
        reference,
        edgeIndex,
        sampleBilinear,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
        options.subjectMask,
        field ? (u, v) => sampleHeight(field, u, v) : undefined,
      );
      for (let i = 0; i < output.length; i += 4) {
        blend(output, pixels, i, blurred.subarray(i, i + 4), effect.params.amount);
        if (i % 512 === 508) yield;
      }
    } else if (effect.type === 'wave-distortion') {
      const shorter = Math.min(reference.width, reference.height);
      const amplitude = (shorter * effect.params.strength) / 100;
      const angle = ((effect.params.direction % 360) * Math.PI) / 180;
      const cosine = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle);
      const sine = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle);
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const phase = cellRandom(seed, 0, 0, 5, effect.seedOffset) * Math.PI * 2;
      const cycles = (effect.params.frequency * Math.PI * 2) / shorter;
      const scaleX = image.width / reference.width,
        scaleY = image.height / reference.height;
      const color = new Float64Array(4),
        vector = new Float64Array(2);
      for (let y = 0; y < image.height; y++) {
        const refY = (y + 0.5) / scaleY - reference.height / 2;
        for (let x = 0; x < image.width; x++) {
          const refX = (x + 0.5) / scaleX - reference.width / 2;
          const displacement =
            Math.sin((-sine * refX + cosine * refY) * cycles + phase) * amplitude;
          let vx = cosine,
            vy = sine;
          if (directionField) {
            mixDirection(
              directionField,
              (x + 0.5) / image.width,
              (y + 0.5) / image.height,
              vx,
              vy,
              directionRecipe.directionInfluence,
              vector,
            );
            vx = vector[0]!;
            vy = vector[1]!;
          }
          sampleBilinear(
            pixels,
            image.width,
            image.height,
            x - displacement * vx * scaleX,
            y - displacement * vy * scaleY,
            color,
            effect.params.edgeHandling ?? 'extend',
          );
          blend(output, pixels, (y * image.width + x) * 4, color, effect.params.amount);
        }
        yield;
      }
    } else if (effect.type === 'depth-field') {
      const p = effect.params;
      const field = yield* fieldFor(effect);
      const direction = (p.direction * Math.PI) / 180,
        light = (p.lightAngle * Math.PI) / 180;
      const shorter = Math.min(reference.width, reference.height);
      const ink = createColorSampler(p, 'fieldColor', p.fieldColor, reference, true);
      const color = new Float64Array(4);
      const du = 1 / field.width,
        dv = 1 / field.height;
      const terrace = (h: number) => {
        const level = h * (p.contourCount - 1) + (p.contourOffset ?? 0);
        const base = Math.floor(level),
          fraction = level - base;
        const bevel = p.terraceBevel ?? 0.15;
        const t = bevel === 0 ? 0 : Math.max(0, Math.min(1, (fraction - 1 + bevel) / bevel));
        return Math.max(0, Math.min(1, (base + t * t * (3 - 2 * t)) / (p.contourCount - 1)));
      };
      const heightAt = (u: number, v: number) => {
        const h = sampleHeight(field, u, v);
        return p.operation === 'terraces' ? terrace(h) : h;
      };
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4,
            u = (x + 0.5) / image.width,
            v = (y + 0.5) / image.height;
          const height = sampleHeight(field, u, v);
          if (p.operation === 'field') {
            color[0] = color[1] = color[2] = height * 255;
            color[3] = pixels[i + 3]!;
          } else if (p.operation === 'relief' || p.operation === 'terraces') {
            const gx =
              ((((heightAt(u + du, v) - heightAt(u - du, v)) / (2 * du)) * shorter) /
                reference.width) *
              p.relief;
            const gy =
              ((((heightAt(u, v + dv) - heightAt(u, v - dv)) / (2 * dv)) * shorter) /
                reference.height) *
              p.relief;
            let shade = Math.max(
              0,
              Math.min(
                2,
                (-gx * Math.cos(light) * 0.7 - gy * Math.sin(light) * 0.7 + 0.8) /
                  Math.hypot(gx, gy, 1) /
                  0.8,
              ),
            );
            let highlight = 0;
            // Missing optional controls follow the exact legacy diffuse formula above.
            if (
              p.lightElevation !== undefined ||
              p.ambient !== undefined ||
              p.highlights !== undefined ||
              p.operation === 'terraces'
            ) {
              const elevation = ((p.lightElevation ?? 49) * Math.PI) / 180;
              const ambient = p.ambient ?? 0.2;
              const length = Math.hypot(gx, gy, 1);
              const diffuse = Math.max(
                0,
                (-gx * Math.cos(light) * Math.cos(elevation) -
                  gy * Math.sin(light) * Math.cos(elevation) +
                  Math.sin(elevation)) /
                  length,
              );
              shade = Math.min(
                2,
                (ambient + (1 - ambient) * diffuse) /
                  (ambient + (1 - ambient) * Math.sin(elevation)),
              );
              const halfElevation = (elevation + Math.PI / 2) / 2;
              const facing = Math.max(
                0,
                (-gx * Math.cos(light) * Math.cos(halfElevation) -
                  gy * Math.sin(light) * Math.cos(halfElevation) +
                  Math.sin(halfElevation)) /
                  length,
              );
              highlight = (p.highlights ?? 0) * facing ** 24;
            }
            for (let c = 0; c < 3; c++)
              color[c] = Math.min(255, pixels[i + c]! * shade + 255 * highlight);
            color[3] = pixels[i + 3]!;
          } else {
            const value =
              p.operation === 'contours'
                ? Math.max(
                    0,
                    Math.min(
                      1,
                      Math.floor(height * (p.contourCount - 1) + (p.contourOffset ?? 0)) /
                        (p.contourCount - 1),
                    ),
                  )
                : height;
            const travel = ((value - 0.5) * shorter * p.strength) / 100;
            sampleBilinear(
              pixels,
              image.width,
              image.height,
              x - (travel * Math.cos(direction) * image.width) / reference.width,
              y - (travel * Math.sin(direction) * image.height) / reference.height,
              color,
              p.edgeHandling,
            );
            if (p.operation === 'contours' && p.contourWidth > 0) {
              const band = height * p.contourCount + (p.contourOffset ?? 0),
                fraction = band - Math.floor(band);
              const distance = Math.min(fraction, 1 - fraction);
              const footprint =
                (Math.abs(sampleHeight(field, u + 1 / image.width, v) - height) +
                  Math.abs(sampleHeight(field, u, v + 1 / image.height) - height)) *
                p.contourCount;
              const weight =
                footprint > 0.5
                  ? p.contourWidth
                  : Math.max(
                      0,
                      Math.min(
                        1,
                        (p.contourWidth * 0.5 - distance) /
                          (Math.max(0.001, footprint) +
                            (p.contourSoftness ?? 0) * p.contourWidth * 0.5) +
                          0.5,
                      ),
                    );
              const selected = ink(u, v, height);
              for (let c = 0; c < 3; c++)
                color[c] = color[c]! * (1 - weight) + selected[c]! * weight;
            }
          }
          blend(output, pixels, i, color, p.amount);
          if ((x & 127) === 127) yield;
        }
        yield;
      }
    } else if (effect.type === 'compression-breakup') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      yield* compressionPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
      );
    } else if (effect.type === 'feedback-bloom') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const result = yield* feedbackPixels(
        pixels,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
      );
      for (let i = 0; i < output.length; i += 4) {
        blend(output, pixels, i, result.subarray(i, i + 4), effect.params.amount);
        if (i % 512 === 508) yield;
      }
    } else if (effect.type === 'bit-damage' || effect.type === 'freeze-dropout') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const random = (x: number, y: number, lane: number) =>
        cellRandom(seed, x, y, lane, effect.seedOffset);
      if (effect.type === 'bit-damage')
        yield* bitDamagePixels(
          pixels,
          output,
          image.width,
          image.height,
          effect.params,
          reference,
          blend,
          random,
        );
      else
        yield* freezeDropoutPixels(
          pixels,
          output,
          image.width,
          image.height,
          effect.params,
          reference,
          blend,
          sampleBilinear,
          random,
        );
    } else if (effect.type === 'photo-adjustments') {
      yield* photoAdjustmentPixels(pixels, output, image.width, image.height, effect.params, blend);
    } else if (effect.type === 'detail') {
      yield* detailPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        blend,
        edgeIndex,
      );
    } else if (effect.type === 'halation') {
      yield* halationPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        blend,
        edgeIndex,
      );
    } else if (effect.type === 'vignette') {
      yield* vignettePixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        blend,
      );
    } else if (effect.type === 'channel-transform') {
      yield* channelTransformPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        blend,
      );
    } else if (effect.type === 'temporal-echo') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      yield* temporalEchoPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
      );
    } else if (effect.type === 'signal-tearing') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const field =
        effect.params.fieldEnabled === 'on' && !replacesHeightSteering
          ? yield* fieldFor(effect)
          : undefined;
      yield* signalTearingPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
        field ? (u, v) => sampleHeight(field, u, v) : undefined,
        directionField,
      );
    } else if (effect.type === 'crt') {
      yield* crtPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        blend,
        edgeIndex,
      );
    } else if (effect.type === 'glyph') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      yield* glyphPixels(
        pixels,
        output,
        image.width,
        image.height,
        directionField ? { ...effect.params, amount: 1 } : effect.params,
        reference,
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
        effect.glyphFont,
      );
      if (directionField) {
        const glyphs = output.slice();
        yield* directionWarpPixels(
          glyphs,
          output,
          image.width,
          image.height,
          reference,
          directionField,
          effect.params.cellSize * directionRecipe.directionDrift,
          directionRecipe.directionInfluence,
          sampleBilinear,
          blend,
          1,
        );
        for (let i = 0; i < output.length; i += 4) {
          blend(output, pixels, i, output.subarray(i, i + 4), effect.params.amount);
          if ((i & 511) === 508) yield;
        }
      }
    } else if (effect.type === 'threshold') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      yield* thresholdPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
      );
    } else if (effect.type === 'indexed-palette') {
      const p = effect.params,
        seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const random = (x: number, y: number, lane: number) =>
        cellRandom(seed, x, y, lane, effect.seedOffset);
      const mapper = yield* indexedMapper(
        options.paletteSource ?? heightSource,
        p,
        reference,
        random,
        adjustHsl,
      );
      yield* ditherPixels(
        pixels,
        output,
        image.width,
        image.height,
        reference,
        {
          algorithm: p.dither,
          strength: p.ditherStrength,
          cellSize: p.cellSize,
          noiseScale: 255 / Math.max(1, Math.sqrt(p.colors) - 1),
          amount: p.amount,
        },
        mapper,
        blend,
        random,
      );
    } else if (effect.type === 'dither') {
      const p = effect.params,
        seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const ramp = colorRamp(p, 'rampStart', p.rampStart, p.rampEnd);
      yield* ditherPixels(
        pixels,
        output,
        image.width,
        image.height,
        reference,
        {
          algorithm: p.algorithm,
          strength: p.ditherStrength,
          cellSize: p.cellSize,
          noiseScale: 255 / (p.levels - 1),
          amount: p.amount,
          scan: p.scan,
          mono: p.coloring !== 'rgb',
          skippedCells: p.skippedCells,
          errorDisplacement: p.errorDisplacement,
          randomDirection: p.randomDirection,
          blockInterruptions: p.blockInterruptions,
          blockSize: p.blockSize,
          channelDivergence: p.channelDivergence,
        },
        (r, g, b, _x, _y, color, quantized) => {
          const values = [r, g, b];
          for (let c = 0; c < 3; c++)
            quantized[c] = (Math.round((values[c]! / 255) * (p.levels - 1)) * 255) / (p.levels - 1);
          const colored = p.coloring === 'ramp' ? ramp(quantized[0]! / 255) : quantized;
          for (let c = 0; c < 3; c++) color[c] = colored[c]!;
        },
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
      );
    } else if (effect.type === 'pixel-sort') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      yield* pixelSortPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
        directionField,
      );
    } else if (effect.type === 'chroma-mosh') {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      yield* chromaMoshPixels(
        pixels,
        output,
        image.width,
        image.height,
        effect.params,
        reference,
        sampleBilinear,
        blend,
        (x, y, lane) => cellRandom(seed, x, y, lane, effect.seedOffset),
      );
    } else if (effect.type === 'jpeg-recompression') {
      if (!options.recompressJpeg)
        throw new Error('JPEG Recompression requires the native JPEG codec.');
      let incoming = pixels;
      for (let generation = 0; generation < effect.params.generations; generation++) {
        yield options
          .recompressJpeg(
            { ...image, pixels: incoming.buffer as ArrayBuffer },
            {
              quality: Math.max(1, effect.params.quality - generation * effect.params.qualityLoss),
              chromaSubsampling: effect.params.chromaSubsampling,
            },
          )
          .then((raw) => {
            if (raw.byteLength !== pixels.byteLength) throw new Error('Invalid JPEG codec output.');
            incoming = new Uint8Array(raw);
          });
      }
      for (let i = 0; i < output.length; i += 4) {
        blend(output, pixels, i, incoming.subarray(i, i + 4), effect.params.amount);
        if ((i & 511) === 508) yield;
      }
    } else if (effect.type === 'motion-mosh') {
      yield* motionMosh(
        image,
        pixels,
        output,
        effect,
        reference,
        deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId),
        directionField,
      );
    } else if (effect.type === 'shapes') {
      yield* shapes(
        image,
        pixels,
        output,
        effect,
        reference,
        deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId),
      );
    } else if (effect.type === 'mandelbrot') {
      yield* mandelbrot(image, pixels, output, effect, reference);
    } else if (effect.type === 'recursive-space') {
      const field = effect.params.fieldEnabled === 'on' ? yield* fieldFor(effect) : undefined;
      yield* recursiveSpace(image, pixels, output, effect, reference, field);
    } else if (effect.type === 'halftone') {
      yield* halftone(image, pixels, output, effect, reference);
    } else if (effect.type === 'mirroring' || effect.type === 'kaleidoscope') {
      yield* reflection(image, pixels, output, effect, reference, objectShift, reportShift);
    } else if (effect.type === 'scanlines') {
      yield* scanlines(
        image,
        pixels,
        output,
        effect,
        reference,
        deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId),
      );
    } else if (effect.type === 'bit-crush') {
      const depths = bitCrushDepths(effect.params);
      const channelLevels = depths.map((bits) => 2 ** bits - 1);
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      const ordered = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      for (let y = 0; y < image.height; y++) {
        const refY = Math.floor(((y + 0.5) * reference.height) / image.height);
        for (let x = 0; x < image.width; x++) {
          const refX = Math.floor(((x + 0.5) * reference.width) / image.width);
          const index = (y * image.width + x) * 4;
          for (let channel = 0; channel < 4; channel++) {
            if (depths[channel] === 8) {
              output[index + channel] = pixels[index + channel]!;
              continue;
            }
            const levels = channelLevels[channel]!;
            const threshold =
              effect.params.dither === 'ordered'
                ? (ordered[(refY % 4) * 4 + (refX % 4)]! + 0.5) / 16 - 0.5
                : effect.params.dither === 'random'
                  ? cellRandom(seed, refX, refY, channel, effect.seedOffset) - 0.5
                  : 0;
            const quantized =
              (Math.max(
                0,
                Math.min(
                  levels,
                  Math.round(
                    (pixels[index + channel]! * levels) / 255 +
                      threshold * effect.params.ditherAmount,
                  ),
                ),
              ) *
                255) /
              levels;
            output[index + channel] = Math.round(
              pixels[index + channel]! * (1 - effect.params.amount) +
                quantized * effect.params.amount,
            );
          }
        }
        yield;
      }
    } else {
      const seed = deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId);
      if (effect.type === 'spatial-crush') {
        yield* spatialCrush(image, pixels, output, effect, reference, seed);
      } else {
        const block = Math.max(
          1,
          Math.round((Math.min(reference.width, reference.height) * effect.params.blockSize) / 100),
        );
        const distance =
          (Math.min(reference.width, reference.height) * effect.params.displacement) / 100;
        const extraDistance =
          (Math.min(reference.width, reference.height) * (effect.params.fragmentTravel ?? 0)) / 100;
        const replacement = createColorSampler(
          effect.params as Readonly<Record<string, number | string>>,
          'replacementColor',
          effect.params.replacementColor ?? '#ed58c6',
          reference,
        );
        for (let y = 0; y < image.height; y++) {
          const refY = ((y + 0.5) * reference.height) / image.height;
          const cellY = Math.floor(refY / block);
          let lastCell = -1;
          let active = false,
            dx = 0,
            dy = 0;
          for (let x = 0; x < image.width; x++) {
            const refX = ((x + 0.5) * reference.width) / image.width;
            const cellX = Math.floor(refX / block);
            if (cellX !== lastCell) {
              lastCell = cellX;
              active = cellRandom(seed, cellX, cellY, 0, effect.seedOffset) < effect.params.density;
              dx = Math.round(
                (cellRandom(seed, cellX, cellY, 1, effect.seedOffset) * 2 - 1) * distance,
              );
              dy = Math.round(
                (cellRandom(seed, cellX, cellY, 2, effect.seedOffset) * 2 - 1) * distance,
              );
              dx += Math.round(
                (cellRandom(seed, cellX, cellY, 21, effect.seedOffset) * 2 - 1) * extraDistance,
              );
              dy += Math.round(
                (cellRandom(seed, cellX, cellY, 22, effect.seedOffset) * 2 - 1) * extraDistance,
              );
            }
            const index = (y * image.width + x) * 4;
            if (!active) {
              output.set(pixels.subarray(index, index + 4), index);
              continue;
            }
            const localX = refX / block - cellX,
              localY = refY / block - cellY,
              edge = Math.min(localX, 1 - localX, localY, 1 - localY) * 2;
            if (
              edge <
              (effect.params.erosion ?? 0) *
                cellRandom(
                  seed,
                  Math.floor((refX / block) * 8),
                  Math.floor((refY / block) * 8),
                  33,
                  effect.seedOffset,
                )
            ) {
              output.set(pixels.subarray(index, index + 4), index);
              continue;
            }
            const sx = edgeIndex(
              Math.floor(((refX + dx) * image.width) / reference.width),
              image.width,
              effect.params.edgeHandling ?? 'extend',
            );
            const sy = edgeIndex(
              Math.floor(((refY + dy) * image.height) / reference.height),
              image.height,
              effect.params.edgeHandling ?? 'extend',
            );
            const sample = (sy * image.width + sx) * 4;
            if ((effect.params.replacement ?? 'source') === 'source')
              blend(
                output,
                pixels,
                index,
                pixels.subarray(sample, sample + 4),
                effect.params.amount,
              );
            else {
              const scale = effect.params.patternScale ?? 4;
              const tone =
                effect.params.replacement === 'checker'
                  ? (Math.floor(localX * scale) + Math.floor(localY * scale)) % 2
                  : cellRandom(
                      seed,
                      Math.floor((refX / block) * scale),
                      Math.floor((refY / block) * scale),
                      41,
                      effect.seedOffset,
                    );
              const ink = replacement((x + 0.5) / image.width, (y + 0.5) / image.height),
                color = [
                  ink[0]! * (0.15 + tone * 0.85),
                  ink[1]! * (0.15 + tone * 0.85),
                  ink[2]! * (0.15 + tone * 0.85),
                  pixels[sample + 3]!,
                ];
              blend(output, pixels, index, color, effect.params.amount);
            }
          }
          yield;
        }
      }
    }
    if (imageFinish) {
      const tintColor = createColorSampler(storedEffect.params, 'color', finish.color, reference);
      const color = new Float64Array(4);
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const index = (y * image.width + x) * 4;
          const tint = tintColor((x + 0.5) / image.width, (y + 0.5) / image.height);
          for (let channel = 0; channel < 3; channel++) {
            const result = output[index + channel]!;
            const tinted =
              result * (1 - tintStrength) + ((result * tint[channel]!) / 255) * tintStrength;
            // Hidden colors in a transparent backdrop cannot influence the result.
            const backdropAlpha = pixels[index + 3]! / 255;
            color[channel] =
              tinted * (1 - backdropAlpha) +
              blendChannel(pixels[index + channel]!, tinted, finish.blendMode) * backdropAlpha;
          }
          color[3] = output[index + 3]!;
          blend(output, pixels, index, color, storedEffect.params.amount);
        }
        yield;
      }
    }
    if (
      effect.application.region !== 'all' ||
      effect.application.coverage !== 1 ||
      storedEffect.paintedMask?.enabled ||
      effect.application.invert === 'on'
    ) {
      const painted = storedEffect.paintedMask?.enabled
        ? yield* options.paintedMaskRasterizers
            ?.get(storedEffect.instanceId)
            ?.steps(storedEffect.paintedMask, image.width, image.height) ??
            paintedMaskSteps(storedEffect.paintedMask, image.width, image.height)
        : undefined;
      const app = effect.application;
      const legacy = [
        'all',
        'subject',
        'background',
        'top',
        'bottom',
        'left',
        'right',
        'center',
        'edges',
      ].includes(app.region);
      let mask: (u: number, v: number) => number;
      if (legacy)
        mask = maskSampler(
          app,
          reference,
          deriveEffectSeed(options.masterSeed ?? 0, effect.patternId ?? effect.instanceId),
          effect.seedOffset,
          options.subjectMask,
        );
      else {
        let analysis: ApplicationAnalysis | undefined;
        let depth: HeightField | undefined;
        if (isDepthApplication(app.region))
          depth = yield* fieldFrom(app.depthField ?? {}, app.depthImage);
        else if (!app.region.endsWith('-bands')) {
          const scale = app.detailScale ?? 1;
          analysis = applicationAnalysis.get(scale);
          if (!analysis) {
            analysis = yield* analyzeApplication(heightSource, reference, scale);
            if (applicationAnalysis.size >= 4)
              applicationAnalysis.delete(applicationAnalysis.keys().next().value!);
            applicationAnalysis.set(scale, analysis);
          }
        }
        mask = signalApplicationSampler(app, analysis, depth);
      }
      if (app.invert === 'on') {
        const original = mask;
        mask = (u, v) => 1 - original(u, v);
      }
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const index = (y * image.width + x) * 4;
          const weight =
            mask((x + 0.5) / image.width, (y + 0.5) / image.height) *
            (painted?.[y * image.width + x] ?? 1);
          if (weight === 0) output.set(pixels.subarray(index, index + 4), index);
          else if (weight !== 1)
            blend(output, pixels, index, output.subarray(index, index + 4), weight);
        }
        yield;
      }
    }
    pixels = output;
  }
  if (options.isCancelled?.()) throw new RenderCancelledError();
  checkpoint?.capture(effects.length, pixels);
  checkpoint?.commit();
  // A caller can transfer or edit the output without detaching cached storage.
  return { ...image, pixels: checkpoint ? pixels.slice().buffer : (pixels.buffer as ArrayBuffer) };
}

export function renderEffects(
  image: EffectImage,
  effects: readonly EffectInstance[],
  options: RenderOptions = {},
): EffectImage {
  if (options.renderShader) throw new Error('GPU shader rendering requires renderEffectsAsync.');
  if (options.recompressJpeg) throw new Error('JPEG codec rendering requires renderEffectsAsync.');
  const work = renderSteps(image, effects, options);
  while (true) {
    if (options.isCancelled?.()) throw new RenderCancelledError();
    const step = work.next();
    if (step.done) return step.value;
  }
}

export async function renderEffectsAsync(
  image: EffectImage,
  effects: readonly EffectInstance[],
  options: RenderOptions & { yieldControl(): Promise<void> },
): Promise<EffectImage> {
  const work = renderSteps(image, effects, options);
  let deadline = Date.now() + 8;
  while (true) {
    if (options.isCancelled?.()) throw new RenderCancelledError();
    const step = work.next();
    if (step.done) return step.value;
    if (step.value) await step.value;
    if (Date.now() >= deadline) {
      await options.yieldControl();
      deadline = Date.now() + 8;
    }
  }
}
