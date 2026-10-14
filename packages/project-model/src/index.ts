import {
  ADVANCED_SHADER_SPECS,
  ADVANCED_SHADER_TYPES,
  type AdvancedShaderType,
} from './advanced-shaders';
import { SET2_EXTENSION_PARAMETERS } from './set2-extensions';
export * from './set2-extensions';
export * from './advanced-shaders';
import {
  DIRECTION_CONSUMERS,
  DIRECTION_DEFAULTS,
  DIRECTION_PARAMETERS,
  supportsDirectionField,
  type DirectionFieldParams,
} from './direction-field';
export * from './direction-field';
import { assertExecutableShader, assertShaderValues, type ShaderPackage } from './shader-package';
export const PROJECT_SCHEMA_VERSION = 2 as const;

export interface ProjectState {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly name: string;
  readonly masterSeed: number;
  readonly source: ImageSource | null;
  readonly effects: readonly EffectInstance[];
  readonly origin: ImageSource | null;
  readonly sourceSnapshotId: string | null;
  readonly snapshots: readonly StageSnapshot[];
}

export interface StageSnapshot {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly parentId: string | null;
  readonly source: ImageSource;
  readonly rendered: ImageSource;
  readonly effects: readonly EffectInstance[];
  readonly masterSeed: number;
}

interface EffectBase {
  readonly instanceId: string;
  readonly version: 1;
  readonly enabled: boolean;
  readonly seedOffset: number;
  readonly patternId?: string;
  readonly locked?: boolean;
  readonly application: EffectApplication;
  readonly paintedMask?: PaintedMask;
  readonly directionImage?: LayerImage;
}

export const MASK_BRUSH_SHAPES = ['circle', 'square', 'diamond'] as const;
export const MASK_FALLOFFS = ['linear', 'smooth', 'gaussian'] as const;
export const MAX_MASK_POINTS = 65536;
export const MAX_MASK_STROKES = 2048;
export interface MaskPoint {
  readonly x: number;
  readonly y: number;
}
export interface MaskBrush {
  readonly size: number;
  readonly shape: (typeof MASK_BRUSH_SHAPES)[number];
  readonly hardness: number;
  readonly falloff: (typeof MASK_FALLOFFS)[number];
  readonly mode: 'paint' | 'erase';
  readonly opacity?: number;
}
export interface MaskStroke extends MaskBrush {
  readonly points: readonly MaskPoint[];
}
export type MaskAffine = readonly [number, number, number, number, number, number];
export interface MaskFrame {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
}
export const DEFAULT_MASK_FRAME: MaskFrame = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
export interface MaskNode extends MaskPoint {
  readonly incoming?: MaskPoint;
  readonly outgoing?: MaskPoint;
}
export interface MaskPath {
  readonly id: string;
  readonly kind: 'polygon' | 'curve';
  readonly nodes: readonly MaskNode[];
  readonly mode: 'paint' | 'erase';
  readonly opacity: number;
  readonly feather: number;
}
export const MAX_MASK_PATHS = 256;
export const MAX_MASK_NODES = 4096;
export const IDENTITY_MASK_AFFINE: MaskAffine = [1, 0, 0, 1, 0, 0];
export function maskFrameAffine(frame: MaskFrame, width: number, height: number): MaskAffine {
  const angle = (frame.rotation * Math.PI) / 180;
  const a = Math.cos(angle) * frame.scaleX;
  const b = (Math.sin(angle) * frame.scaleX * width) / height;
  const c = (-Math.sin(angle) * frame.scaleY * height) / width;
  const d = Math.cos(angle) * frame.scaleY;
  return [a, b, c, d, 0.5 + frame.x / 100 - (a + c) / 2, 0.5 + frame.y / 100 - (b + d) / 2];
}
export function invertMaskAffine(m: MaskAffine): MaskAffine {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 0.000001)
    throw new RangeError('Invalid mask transform.');
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}
export function multiplyMaskAffine(a: MaskAffine, b: MaskAffine): MaskAffine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function transformMaskPoint(m: MaskAffine, p: MaskPoint): MaskPoint {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
export function maskPatternAffine(mask: PaintedMask | undefined): MaskAffine {
  if (!mask?.pattern) return IDENTITY_MASK_AFFINE;
  return mask.pattern.attached
    ? multiplyMaskAffine(
        mask.pattern.matrix,
        invertMaskAffine(
          maskFrameAffine(mask.frame ?? DEFAULT_MASK_FRAME, mask.width, mask.height),
        ),
      )
    : mask.pattern.matrix;
}
export function attachMaskPattern(mask: PaintedMask, attached: boolean): PaintedMask {
  const current = maskPatternAffine(mask);
  const matrix = attached
    ? multiplyMaskAffine(
        current,
        maskFrameAffine(mask.frame ?? DEFAULT_MASK_FRAME, mask.width, mask.height),
      )
    : current;
  const result = { ...mask, pattern: { attached, matrix } };
  assertPaintedMask(result);
  return result;
}
export interface PaintedMask {
  readonly version: 1;
  readonly enabled: boolean;
  readonly inverted: boolean;
  readonly width: number;
  readonly height: number;
  readonly base: 0 | 1;
  readonly strokes: readonly MaskStroke[];
  readonly paths?: readonly MaskPath[];
  readonly frame?: MaskFrame;
  readonly pattern?: { readonly attached: boolean; readonly matrix: MaskAffine };
}
export const DEFAULT_MASK_BRUSH: MaskBrush = {
  size: 8,
  shape: 'circle',
  hardness: 0.6,
  falloff: 'smooth',
  mode: 'paint',
};
export function createPaintedMask(width: number, height: number): PaintedMask {
  const mask: PaintedMask = {
    version: 1,
    enabled: true,
    inverted: false,
    width,
    height,
    base: 0,
    strokes: [],
  };
  assertPaintedMask(mask);
  return mask;
}
export function assertPaintedMask(mask: PaintedMask): void {
  if (
    !mask ||
    mask.version !== 1 ||
    typeof mask.enabled !== 'boolean' ||
    typeof mask.inverted !== 'boolean' ||
    ![0, 1].includes(mask.base) ||
    !Number.isSafeInteger(mask.width) ||
    !Number.isSafeInteger(mask.height) ||
    mask.width < 1 ||
    mask.height < 1 ||
    mask.width > 32768 ||
    mask.height > 32768 ||
    mask.width * mask.height > 64 * 1024 * 1024 ||
    !Array.isArray(mask.strokes) ||
    mask.strokes.length > MAX_MASK_STROKES
  )
    throw new RangeError('Invalid painted mask.');
  let points = 0;
  if (
    mask.frame &&
    (!Number.isFinite(mask.frame.x) ||
      Math.abs(mask.frame.x) > 200 ||
      !Number.isFinite(mask.frame.y) ||
      Math.abs(mask.frame.y) > 200 ||
      !Number.isFinite(mask.frame.scaleX) ||
      mask.frame.scaleX < 0.1 ||
      mask.frame.scaleX > 10 ||
      !Number.isFinite(mask.frame.scaleY) ||
      mask.frame.scaleY < 0.1 ||
      mask.frame.scaleY > 10 ||
      !Number.isFinite(mask.frame.rotation) ||
      Math.abs(mask.frame.rotation) > 360)
  )
    throw new RangeError('Invalid mask frame.');
  if (mask.pattern) {
    if (
      typeof mask.pattern.attached !== 'boolean' ||
      !Array.isArray(mask.pattern.matrix) ||
      mask.pattern.matrix.length !== 6 ||
      !mask.pattern.matrix.every((v) => Number.isFinite(v) && Math.abs(v) <= 1000)
    )
      throw new RangeError('Invalid mask pattern frame.');
    invertMaskAffine(mask.pattern.matrix);
  }
  if (mask.paths) {
    if (!Array.isArray(mask.paths) || mask.paths.length > MAX_MASK_PATHS)
      throw new RangeError('Invalid mask paths.');
    const ids = new Set<string>();
    let count = 0;
    for (const path of mask.paths) {
      if (
        !path ||
        typeof path.id !== 'string' ||
        !path.id ||
        path.id.length > 256 ||
        ids.has(path.id) ||
        !['polygon', 'curve'].includes(path.kind) ||
        !['paint', 'erase'].includes(path.mode) ||
        !Number.isFinite(path.opacity) ||
        path.opacity < 0 ||
        path.opacity > 1 ||
        !Number.isFinite(path.feather) ||
        path.feather < 0 ||
        path.feather > 100 ||
        !Array.isArray(path.nodes) ||
        path.nodes.length < 3 ||
        path.nodes.length > 256
      )
        throw new RangeError('Invalid mask path.');
      ids.add(path.id);
      count += path.nodes.length;
      if (count > MAX_MASK_NODES) throw new RangeError('This mask has too many path nodes.');
      for (const node of path.nodes) {
        if (!node || typeof node !== 'object') throw new RangeError('Invalid mask path node.');
        for (const point of [node, node.incoming, node.outgoing])
          if (
            point !== undefined &&
            (!point ||
              !Number.isFinite(point.x) ||
              !Number.isFinite(point.y) ||
              point.x < -2 ||
              point.x > 3 ||
              point.y < -2 ||
              point.y > 3)
          )
            throw new RangeError('Invalid mask path point.');
      }
    }
  }
  for (const stroke of mask.strokes) {
    if (
      !stroke ||
      !MASK_BRUSH_SHAPES.includes(stroke.shape) ||
      !MASK_FALLOFFS.includes(stroke.falloff) ||
      !['paint', 'erase'].includes(stroke.mode) ||
      !Number.isFinite(stroke.size) ||
      stroke.size < 0.1 ||
      stroke.size > 100 ||
      !Number.isFinite(stroke.hardness) ||
      stroke.hardness < 0 ||
      stroke.hardness > 1 ||
      (stroke.opacity !== undefined &&
        (!Number.isFinite(stroke.opacity) || stroke.opacity < 0 || stroke.opacity > 1)) ||
      !Array.isArray(stroke.points) ||
      !stroke.points.length
    )
      throw new RangeError('Invalid mask stroke.');
    points += stroke.points.length;
    if (points > MAX_MASK_POINTS) throw new RangeError('This mask has too many brush points.');
    for (const point of stroke.points)
      if (
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < -1 ||
        point.x > 2 ||
        point.y < -1 ||
        point.y > 2
      )
        throw new RangeError('Invalid mask brush point.');
  }
}

const frozenMasks = new WeakSet<PaintedMask>();
const frozenStrokes = new WeakSet<MaskStroke>();
export function freezePaintedMask(mask: PaintedMask): PaintedMask {
  if (frozenMasks.has(mask)) return mask;
  const result = Object.freeze({
    ...mask,
    ...(mask.paths
      ? {
          paths: Object.freeze(
            mask.paths.map((path) =>
              Object.freeze({
                ...path,
                nodes: Object.freeze(
                  path.nodes.map((node) =>
                    Object.freeze({
                      ...node,
                      ...(node.incoming ? { incoming: Object.freeze({ ...node.incoming }) } : {}),
                      ...(node.outgoing ? { outgoing: Object.freeze({ ...node.outgoing }) } : {}),
                    }),
                  ),
                ),
              }),
            ),
          ),
        }
      : {}),
    ...(mask.frame ? { frame: Object.freeze({ ...mask.frame }) } : {}),
    ...(mask.pattern
      ? {
          pattern: Object.freeze({
            ...mask.pattern,
            matrix: Object.freeze([...mask.pattern.matrix]) as MaskAffine,
          }),
        }
      : {}),
    strokes: Object.freeze(
      mask.strokes.map((stroke) => {
        if (frozenStrokes.has(stroke)) return stroke;
        const frozen = Object.freeze({
          ...stroke,
          points: Object.freeze(stroke.points.map((point) => Object.freeze({ ...point }))),
        });
        frozenStrokes.add(frozen);
        return frozen;
      }),
    ),
  });
  frozenMasks.add(result);
  return result;
}
export function copyPaintedMask(mask: PaintedMask): PaintedMask {
  assertPaintedMask(mask);
  const point = (p: MaskPoint) => ({ x: p.x, y: p.y });
  return {
    version: 1,
    enabled: mask.enabled,
    inverted: mask.inverted,
    width: mask.width,
    height: mask.height,
    base: mask.base,
    strokes: mask.strokes.map((stroke) => ({
      size: stroke.size,
      shape: stroke.shape,
      mode: stroke.mode,
      hardness: stroke.hardness,
      falloff: stroke.falloff,
      ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}),
      points: stroke.points.map(point),
    })),
    ...(mask.paths
      ? {
          paths: mask.paths.map((path) => ({
            id: path.id,
            kind: path.kind,
            mode: path.mode,
            opacity: path.opacity,
            feather: path.feather,
            nodes: path.nodes.map((node) => ({
              ...point(node),
              ...(node.incoming ? { incoming: point(node.incoming) } : {}),
              ...(node.outgoing ? { outgoing: point(node.outgoing) } : {}),
            })),
          })),
        }
      : {}),
    ...(mask.frame
      ? {
          frame: {
            x: mask.frame.x,
            y: mask.frame.y,
            scaleX: mask.frame.scaleX,
            scaleY: mask.frame.scaleY,
            rotation: mask.frame.rotation,
          },
        }
      : {}),
    ...(mask.pattern
      ? {
          pattern: {
            attached: mask.pattern.attached,
            matrix: [...mask.pattern.matrix] as MaskAffine,
          },
        }
      : {}),
  };
}

export const APPLICATION_REGIONS = [
  { value: 'all', label: 'All' },
  { value: 'subject', label: 'Subject' },
  { value: 'background', label: 'Background' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'center', label: 'Center' },
  { value: 'edges', label: 'Frame edges' },
  { value: 'highlights', label: 'Highlights' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'shadows', label: 'Shadows' },
  { value: 'content-edges', label: 'Edges' },
  { value: 'flat-areas', label: 'Flat Areas' },
  { value: 'high-detail', label: 'High Detail' },
  { value: 'low-detail', label: 'Low Detail' },
  { value: 'depth-near', label: 'Depth Near' },
  { value: 'depth-mid', label: 'Depth Mid' },
  { value: 'depth-far', label: 'Depth Far' },
  { value: 'depth-band', label: 'Depth Custom Band' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'horizontal-bands', label: 'Horizontal Bands' },
  { value: 'vertical-bands', label: 'Vertical Bands' },
] as const;
export type ApplicationRegion = (typeof APPLICATION_REGIONS)[number]['value'];
export interface EffectApplication {
  readonly region: ApplicationRegion;
  readonly coverage: number;
  readonly softness: number;
  readonly rangeStart?: number;
  readonly rangeEnd?: number;
  readonly invert?: 'off' | 'on';
  readonly detailScale?: number;
  readonly bandFrequency?: number;
  readonly bandOffset?: number;
  readonly depthField?: HeightFieldParams;
  readonly depthImage?: LayerImage | undefined;
}
export const APPLICATION_DEFAULTS = {
  rangeStart: 0,
  rangeEnd: 1,
  invert: 'off' as const,
  detailScale: 1,
  bandFrequency: 8,
  bandOffset: 0,
};
export function isDepthApplication(region: ApplicationRegion): boolean {
  return region.startsWith('depth-');
}
export function copyApplication(application: EffectApplication): EffectApplication {
  return {
    region: application.region,
    coverage: application.coverage,
    softness: application.softness,
    ...Object.fromEntries(
      Object.keys(APPLICATION_DEFAULTS)
        .filter((key) => application[key as keyof EffectApplication] !== undefined)
        .map((key) => [key, application[key as keyof EffectApplication]]),
    ),
    ...(application.depthField ? { depthField: heightFieldParams(application.depthField) } : {}),
    ...(application.depthImage
      ? { depthImage: { ...application.depthImage, source: { ...application.depthImage.source } } }
      : {}),
  };
}
export interface SubjectMask {
  readonly width: number;
  readonly height: number;
  readonly values: ArrayBuffer;
}

export type EdgeHandling = 'extend' | 'wrap' | 'mirror';

export const BLEND_MODES = [
  { value: 'normal', label: 'Normal' },
  { value: 'darken', label: 'Darken' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'linear-burn', label: 'Linear Burn' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'screen', label: 'Screen' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'add', label: 'Add' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'subtract', label: 'Subtract' },
] as const;
export type BlendMode = (typeof BLEND_MODES)[number]['value'];
export interface GradientStop {
  readonly position: number;
  readonly color: string;
}
export const MAX_GRADIENT_STOPS = 16;
export function parseGradientStops(value: unknown): readonly GradientStop[] {
  if (typeof value !== 'string' || value.length > 4096)
    throw new RangeError('Invalid gradient stops.');
  const stops = JSON.parse(value) as GradientStop[];
  if (
    !Array.isArray(stops) ||
    (stops.length !== 0 && (stops.length < 2 || stops.length > MAX_GRADIENT_STOPS))
  )
    throw new RangeError('Invalid gradient stops.');
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (
      !stop ||
      typeof stop !== 'object' ||
      Object.keys(stop).some((key) => !['position', 'color'].includes(key)) ||
      !Number.isFinite(stop.position) ||
      stop.position < 0 ||
      stop.position > 1 ||
      typeof stop.color !== 'string' ||
      !/^#[\da-f]{6}$/i.test(stop.color) ||
      (i > 0 && stop.position < stops[i - 1]!.position)
    )
      throw new RangeError('Invalid gradient stop.');
  }
  if (stops.length && (stops[0]!.position !== 0 || stops[stops.length - 1]!.position !== 1))
    throw new RangeError('Gradient endpoints must be at 0 and 1.');
  return stops;
}
// Endpoints retain their legacy fields, so old two-color recipes stay exact.
export function gradientStops(
  params: Readonly<Record<string, number | string>>,
  key: string,
  start: string,
  end: string,
): readonly GradientStop[] {
  const saved = parseGradientStops(params[`${key}Stops`] ?? '[]');
  return saved.length
    ? saved.map((stop, index) => ({
        ...stop,
        color: index === 0 ? start : index === saved.length - 1 ? end : stop.color,
      }))
    : [
        { position: 0, color: start },
        { position: 1, color: end },
      ];
}

export const DEFAULT_GRADIENT_END = '#4080e0';
export type ColorGradientParams<K extends string = 'color'> = {
  readonly [P in `${K}Mode`]?: 'solid' | 'gradient';
} & {
  readonly [P in `${K}End` | `${K}Stops`]?: string;
} & {
  readonly [P in `${K}Angle` | `${K}CenterX` | `${K}CenterY` | `${K}Span`]?: number;
};
export type ImageFinishParams = ColorGradientParams & {
  readonly tintEnabled?: 'off' | 'on';
  readonly blendMode?: BlendMode;
  readonly color?: string;
  readonly tintStrength?: number;
};
export const IMAGE_FINISH_DEFAULTS = {
  tintEnabled: 'off',
  blendMode: 'normal',
  color: '#ffffff',
  tintStrength: 0,
} as const;

export function isTintEnabled(params: ImageFinishParams): boolean {
  return (
    params.tintEnabled === 'on' ||
    (params.tintEnabled === undefined && (params.tintStrength ?? 0) > 0)
  );
}

export interface RgbSplitEffect extends EffectBase {
  readonly type: 'rgb-split';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly horizontal: number;
    readonly vertical: number;
    readonly edgeHandling?: EdgeHandling;
  };
}

export interface HueSaturationEffect extends EffectBase {
  readonly type: 'hue-saturation';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly hue: number;
    readonly saturation: number;
    readonly lightness: number;
  };
}

export const CURVE_KEYS = [
  'curveShadows',
  'curveDark',
  'curveMid',
  'curveLight',
  'curveHighlights',
] as const;
export type CurveKey = (typeof CURVE_KEYS)[number];
export type ToneCurveParams = { readonly [K in CurveKey]: number };
export interface LevelsCurvesEffect extends EffectBase {
  readonly type: 'levels-curves';
  readonly params: ImageFinishParams &
    ToneCurveParams & {
      readonly amount: number;
      readonly mode: 'levels' | 'curves';
      readonly channel: 'rgb' | 'red' | 'green' | 'blue';
      readonly inputBlack: number;
      readonly inputWhite: number;
      readonly gamma: number;
      readonly outputBlack: number;
      readonly outputWhite: number;
      readonly interpolation: 'smooth' | 'linear';
    };
}
export interface GlowEffect extends EffectBase {
  readonly type: 'glow';
  readonly params: ImageFinishParams &
    ColorGradientParams<'glowColor'> & {
      readonly amount: number;
      readonly radius: number;
      readonly strength: number;
      readonly threshold: number;
      readonly knee: number;
      readonly glowColor: string;
      readonly colorMix: number;
      readonly edgeHandling: EdgeHandling;
    };
}

export const NOISE_STYLES = [
  'white',
  'gaussian',
  'speckle',
  'film',
  'perlin',
  'simplex',
  'voronoi',
  'value',
  'salt-pepper',
  'scan',
] as const;
export const NOISE_EXTRA_DEFAULTS = {
  balance: 0.5,
  scanDirection: 'horizontal',
  scanSpacing: 1,
  scanWidth: 0.15,
  scanIrregularity: 0.15,
} as const;
export const BLUR_STYLES = [
  'gaussian',
  'motion',
  'radial',
  'lens',
  'surface',
  'box',
  'grainy',
  'shape',
  'background',
  'field',
  'tilt-shift',
  'spin',
  'zoom',
  'smart',
  'depth',
] as const;
export type FieldPointKey = `point${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}${'X' | 'Y' | 'Radius'}`;
export interface NoiseGrainEffect extends EffectBase {
  readonly type: 'noise-grain';
  readonly params: ImageFinishParams &
    ColorGradientParams<'noiseColor'> & {
      readonly amount: number;
      readonly style: (typeof NOISE_STYLES)[number];
      readonly intensity: number;
      readonly size: number;
      readonly scale: number;
      readonly detail: number;
      readonly roughness: number;
      readonly variant: 'fbm' | 'turbulence' | 'ridged';
      readonly density: number;
      readonly clumping: number;
      readonly tonalResponse: number;
      readonly cellular: 'cells' | 'distance' | 'borders';
      readonly coloring: 'mono' | 'color' | 'ramp';
      readonly noiseColor: string;
      readonly balance?: number;
      readonly scanDirection?: 'horizontal' | 'vertical' | 'both';
      readonly scanSpacing?: number;
      readonly scanWidth?: number;
      readonly scanIrregularity?: number;
    };
}
export interface BlurEffect extends EffectBase {
  readonly fieldImage?: LayerImage;
  readonly type: 'blur';
  readonly params: ImageFinishParams &
    Partial<HeightFieldParams> & {
      readonly focusPosition?: number;
      readonly focusRange?: number;
      readonly focusFalloff?: number;
      readonly nearBlur?: number;
      readonly farBlur?: number;
    } & Readonly<Record<FieldPointKey, number>> & {
      readonly amount: number;
      readonly style: (typeof BLUR_STYLES)[number];
      readonly radius: number;
      readonly angle: number;
      readonly aspect: number;
      readonly centerX: number;
      readonly centerY: number;
      readonly travel: number;
      readonly radialBalance: number;
      readonly sides: number;
      readonly apertureRotation: number;
      readonly highlights: number;
      readonly threshold: number;
      readonly sensitivity: number;
      readonly preservation: number;
      readonly density: number;
      readonly shape: 'circle' | 'square' | 'triangle' | 'polygon' | 'ring';
      readonly maskSoftness: number;
      readonly refinement: number;
      readonly pointCount: number;
      readonly position: number;
      readonly width: number;
      readonly falloff: number;
      readonly edgeHandling: EdgeHandling;
    };
}

export interface GradientMapEffect extends EffectBase {
  readonly type: 'gradient-map';
  readonly params: ImageFinishParams & {
    readonly shadowsStops?: string;
    readonly amount: number;
    readonly shadows: string;
    readonly highlights: string;
    readonly midpoint: number;
    readonly reverse: 'off' | 'on';
  };
}

export interface BlockCorruptionEffect extends EffectBase {
  readonly type: 'block-corruption';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly blockSize: number;
    readonly density: number;
    readonly displacement: number;
    readonly edgeHandling?: EdgeHandling;
    readonly replacement?: 'source' | 'checker' | 'noise';
    readonly replacementColor?: string;
    readonly patternScale?: number;
    readonly erosion?: number;
    readonly fragmentTravel?: number;
  };
}

export interface SpatialCrushEffect extends EffectBase {
  readonly type: 'spatial-crush';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly blockSize: number;
    readonly sampling: 'nearest' | 'linear' | 'average' | 'dirty-nearest' | 'random' | 'corrupted';
    readonly jitter?: number;
    readonly corruption?: number;
    readonly edgeHandling?: EdgeHandling;
  };
}
export const SPATIAL_CRUSH_DEFAULTS = { jitter: 0.5, corruption: 0.5 };

export interface BitCrushEffect extends EffectBase {
  readonly type: 'bit-crush';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly bits: number;
    readonly linkRGB?: 'on' | 'off';
    readonly redBits?: number;
    readonly greenBits?: number;
    readonly blueBits?: number;
    readonly alphaBits?: number;
    readonly dither: 'none' | 'ordered' | 'random';
    readonly ditherAmount: number;
  };
}
export const BIT_CRUSH_CHANNEL_DEFAULTS = {
  linkRGB: 'on' as const,
  redBits: 3,
  greenBits: 3,
  blueBits: 3,
  alphaBits: 8,
};
/** Missing fields retain the original linked RGB treatment and untouched alpha. */
export function bitCrushDepths(params: BitCrushEffect['params']): [number, number, number, number] {
  return [
    params.linkRGB === 'off' ? (params.redBits ?? params.bits) : params.bits,
    params.linkRGB === 'off' ? (params.greenBits ?? params.bits) : params.bits,
    params.linkRGB === 'off' ? (params.blueBits ?? params.bits) : params.bits,
    params.alphaBits ?? 8,
  ];
}
/** Keep link changes consistent across controls, Reset and parameter clipboard edits. */
export function updateBitCrushParams(
  current: BitCrushEffect['params'],
  change: Readonly<Record<string, number | string>>,
): BitCrushEffect['params'] {
  const result = { ...current, ...change };
  const linked = current.linkRGB !== 'off';
  const editsRGB = ['redBits', 'greenBits', 'blueBits'].some((key) => Object.hasOwn(change, key));
  if (linked && (change.linkRGB === 'off' || (editsRGB && change.linkRGB === undefined))) {
    Object.assign(result, {
      linkRGB: 'off',
      redBits: current.bits,
      greenBits: current.bits,
      blueBits: current.bits,
      ...change,
    });
  } else if (!linked && change.linkRGB === 'on') {
    result.bits = Number(change.bits ?? current.redBits ?? current.bits);
  }
  return result;
}
export interface WaveDistortionEffect extends EffectBase {
  readonly type: 'wave-distortion';
  readonly params: Partial<DirectionFieldParams> &
    ImageFinishParams & {
      readonly amount: number;
      readonly strength: number;
      readonly frequency: number;
      readonly direction: number;
      readonly edgeHandling?: EdgeHandling;
    };
}
export interface ScanlinesEffect extends EffectBase {
  readonly type: 'scanlines';
  readonly params: ColorGradientParams & {
    readonly amount: number;
    readonly style: 'monitor' | 'tv' | 'interlaced' | 'grille';
    readonly frequency: number;
    readonly thickness: number;
    readonly intensity: number;
    readonly rotation: number;
    readonly offset: number;
    readonly field: 'even' | 'odd';
    readonly blendMode?: BlendMode;
    readonly color?: string;
    readonly invert?: 'off' | 'on';
    readonly glow?: number;
    readonly glowSize?: number;
    readonly signalError?: 'none' | 'jitter' | 'sync-loss' | 'tear' | 'dropout';
    readonly errorStrength?: number;
    readonly errorPositionX?: number;
    readonly errorPositionY?: number;
    readonly edgeHandling?: EdgeHandling;
  };
}

export interface HalftoneEffect extends EffectBase {
  readonly type: 'halftone';
  readonly params: ColorGradientParams<'foregroundColor' | 'backgroundColor'> & {
    readonly amount: number;
    readonly style: 'dots' | 'lines';
    readonly size: number;
    readonly spacing: number;
    readonly rotation: number;
    readonly contrast: number;
    readonly foregroundColor: string;
    readonly backgroundColor: string;
    readonly blendMode?: BlendMode;
  };
}
export const OUTPUT_ALIGNMENT_DEFAULTS = {
  outputAlignment: 'none',
  outputOffsetX: 0,
  outputOffsetY: 0,
} as const;
export type OutputAlignment =
  | 'none'
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';
export type OutputPlacementParams = {
  readonly outputAlignment?: OutputAlignment;
  readonly outputOffsetX?: number;
  readonly outputOffsetY?: number;
};
export interface MirroringEffect extends EffectBase {
  readonly type: 'mirroring';
  readonly params: ImageFinishParams &
    OutputPlacementParams & {
      readonly amount: number;
      readonly axis: 'vertical' | 'horizontal' | 'angled';
      readonly positionX: number;
      readonly positionY: number;
      readonly rotation: number;
      readonly sourceSide: 'first' | 'opposite';
      readonly edgeHandling?: EdgeHandling;
    };
}
export interface KaleidoscopeEffect extends EffectBase {
  readonly type: 'kaleidoscope';
  readonly params: ImageFinishParams &
    OutputPlacementParams & {
      readonly amount: number;
      readonly segments: number;
      readonly rotation: number;
      readonly centerX: number;
      readonly centerY: number;
      readonly zoom: number;
      readonly edgeHandling?: EdgeHandling;
    };
}

export interface RecursiveSpaceEffect extends EffectBase {
  readonly fieldImage?: LayerImage;
  readonly type: 'recursive-space';
  readonly params: ImageFinishParams &
    Partial<HeightFieldParams> & {
      readonly fieldEnabled?: 'off' | 'on';
      readonly fieldRepetition?: number;
      readonly fieldImageScale?: number;
      readonly fieldDistortion?: number;
      readonly amount: number;
      readonly style: 'tunnel' | 'spiral' | 'lattice';
      readonly depth: number;
      readonly repetitionScale: number;
      readonly perspective: number;
      readonly centerX: number;
      readonly centerY: number;
      readonly rotation: number;
      readonly twist: number;
      readonly symmetry: number;
      readonly imageScale: number;
      readonly mirrorCopies: 'on' | 'off';
      readonly edgeHandling: EdgeHandling;
    };
}

export const DEPTH_FIELD_KEYS = [
  'fieldSource',
  'fieldShape',
  'fieldScale',
  'fieldX',
  'fieldY',
  'fieldRotation',
  'fieldDetail',
  'fieldRoughness',
  'fieldSeed',
  'fieldInvert',
  'fieldNormalize',
  'fieldContrast',
  'fieldSmoothing',
  'fieldNear',
  'fieldFar',
  'fieldFalloff',
] as const;
export type HeightFieldParams = Pick<DepthFieldEffect['params'], (typeof DEPTH_FIELD_KEYS)[number]>;
export function usesHeightField(effect: EffectInstance): effect is HeightConsumerEffect {
  return (
    effect.type === 'shader-spectral-terrain' ||
    effect.type === 'shader-contour-melt' ||
    effect.type === 'shader-liquid-foil' ||
    effect.type === 'shader-liquid-marbling' ||
    effect.type === 'contour-waves' ||
    effect.type === 'depth-field' ||
    ['depth-parallax', 'depth-haze', 'depth-color-map'].includes(effect.type) ||
    (effect.type === 'cutout' && effect.params.mode !== 'subject') ||
    (effect.type === 'blur' && effect.params.style === 'depth') ||
    (effect.type === 'recursive-space' && effect.params.fieldEnabled === 'on') ||
    (effect.type === 'signal-tearing' && effect.params.fieldEnabled === 'on')
  );
}
export interface DepthFieldEffect extends EffectBase {
  readonly fieldImage?: LayerImage;
  readonly type: 'depth-field';
  readonly params: ImageFinishParams &
    ColorGradientParams<'fieldColor'> & {
      readonly amount: number;
      readonly operation: 'displace' | 'contours' | 'relief' | 'terraces' | 'field';
      readonly contourOffset?: number;
      readonly contourSoftness?: number;
      readonly terraceBevel?: number;
      readonly lightElevation?: number;
      readonly ambient?: number;
      readonly highlights?: number;
      readonly fieldSource:
        | 'brightness'
        | 'linear'
        | 'radial'
        | 'perlin'
        | 'simplex'
        | 'value'
        | 'voronoi'
        | 'shapes'
        | 'image';
      readonly fieldShape: 'circle' | 'square' | 'triangle';
      readonly fieldScale: number;
      readonly fieldX: number;
      readonly fieldY: number;
      readonly fieldRotation: number;
      readonly fieldDetail: number;
      readonly fieldRoughness: number;
      readonly fieldSeed: number;
      readonly fieldInvert: 'on' | 'off';
      readonly fieldNormalize: 'on' | 'off';
      readonly fieldContrast: number;
      readonly fieldSmoothing: number;
      readonly fieldNear: number;
      readonly fieldFar: number;
      readonly fieldFalloff: number;
      readonly strength: number;
      readonly direction: number;
      readonly contourCount: number;
      readonly contourWidth: number;
      readonly lightAngle: number;
      readonly relief: number;
      readonly fieldColor: string;
      readonly edgeHandling: EdgeHandling;
    };
}

export interface LayerImage {
  readonly source: ImageSource;
  /** Lossless, portable PNG. Never a path to a file on the user's computer. */
  readonly png: string;
}

export interface TransformEffect extends EffectBase {
  readonly type: 'transform';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly positionX: number;
    readonly positionY: number;
    readonly scale: number;
    readonly rotation: number;
    readonly anchor:
      | 'center'
      | 'top-left'
      | 'top'
      | 'top-right'
      | 'left'
      | 'right'
      | 'bottom-left'
      | 'bottom'
      | 'bottom-right';
    readonly edges: 'transparent' | EdgeHandling;
  };
}

export interface SolidEffect extends EffectBase {
  readonly type: 'solid';
  readonly image?: LayerImage;
  readonly drawing?: CanvasDrawing;
  readonly params: ColorGradientParams<'fillColor'> & {
    readonly amount: number;
    readonly content: 'color' | 'gradient' | 'source' | 'image' | 'drawing';
    readonly fillColor: string;
    readonly blendMode: BlendMode;
    readonly placement: 'fit' | 'fill' | 'stretch';
  };
}
export interface CanvasDrawing {
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly baseColor: string | null;
  readonly strokes: readonly (MaskStroke & { readonly color: string })[];
  readonly paths: readonly (MaskPath & { readonly color: string })[];
  readonly frame?: MaskFrame;
}
export function createCanvasDrawing(width: number, height: number): CanvasDrawing {
  return { version: 1, width, height, baseColor: null, strokes: [], paths: [] };
}
export function canvasDrawingMask(drawing: CanvasDrawing): PaintedMask {
  return {
    version: 1,
    width: drawing.width,
    height: drawing.height,
    base: drawing.baseColor ? 1 : 0,
    enabled: true,
    inverted: false,
    strokes: drawing.strokes,
    paths: drawing.paths,
    ...(drawing.frame ? { frame: drawing.frame } : {}),
  };
}
export function canvasDrawingFromMask(
  mask: PaintedMask,
  drawing: CanvasDrawing,
  color: string,
): CanvasDrawing {
  return {
    version: 1,
    width: mask.width,
    height: mask.height,
    baseColor: mask.base ? (drawing.baseColor ?? color) : null,
    strokes: mask.strokes.map((stroke, index) => ({
      ...stroke,
      color: drawing.strokes[index]?.color ?? color,
    })),
    paths: (mask.paths ?? []).map((path) => ({
      ...path,
      color: drawing.paths.find((p) => p.id === path.id)?.color ?? color,
    })),
    ...(mask.frame ? { frame: mask.frame } : {}),
  };
}
export function assertCanvasDrawing(drawing: CanvasDrawing): void {
  if (
    !drawing ||
    (drawing.baseColor !== null && !/^#[\da-f]{6}$/i.test(drawing.baseColor)) ||
    !Array.isArray(drawing.paths) ||
    !Array.isArray(drawing.strokes)
  )
    throw new RangeError('Invalid canvas drawing.');
  assertPaintedMask(canvasDrawingMask(drawing));
  if (
    drawing.version !== 1 ||
    [...drawing.strokes, ...drawing.paths].some(
      (item) => typeof item.color !== 'string' || !/^#[\da-f]{6}$/i.test(item.color),
    )
  )
    throw new RangeError('Invalid drawing color.');
}
export function freezeCanvasDrawing(drawing: CanvasDrawing): CanvasDrawing {
  assertCanvasDrawing(drawing);
  const mask = freezePaintedMask(canvasDrawingMask(drawing));
  return Object.freeze({
    ...drawing,
    strokes: mask.strokes as CanvasDrawing['strokes'],
    paths: mask.paths as CanvasDrawing['paths'],
    ...(mask.frame ? { frame: mask.frame } : {}),
  });
}
export function copyCanvasDrawing(drawing: CanvasDrawing): CanvasDrawing {
  assertCanvasDrawing(drawing);
  return canvasDrawingFromMask(copyPaintedMask(canvasDrawingMask(drawing)), drawing, '#000000');
}

export const MAX_LAYER_IMAGE_TEXT = 16 * 1024 * 1024;
const checkedLayerImages = new WeakSet<LayerImage>();
export function assertLayerImage(image: LayerImage): void {
  if (checkedLayerImages.has(image)) return;
  if (!image || typeof image !== 'object' || !image.source) throw new Error('Invalid layer image.');
  assertImageSource(image.source);
  if (
    typeof image.source.id !== 'string' ||
    !image.source.id ||
    image.source.id.length > 1024 ||
    typeof image.source.name !== 'string' ||
    image.source.name.length > 1024 ||
    image.source.width > 32768 ||
    image.source.height > 32768 ||
    image.source.width * image.source.height > 64 * 1024 * 1024 ||
    image.source.format !== 'png' ||
    typeof image.source.hasAlpha !== 'boolean' ||
    typeof image.png !== 'string' ||
    image.png.length > MAX_LAYER_IMAGE_TEXT ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.png)
  )
    throw new Error('Choose a layer image whose encoded PNG is smaller than 12 MB.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const header = new Uint8Array(33);
  let bits = 0,
    value = 0,
    offset = 0;
  for (const character of image.png.slice(22, 66)) {
    value = (value << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      header[offset++] = (value >>> bits) & 255;
    }
  }
  const view = new DataView(header.buffer);
  if (
    offset < 33 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((v, i) => header[i] !== v) ||
    view.getUint32(8) !== 13 ||
    view.getUint32(12) !== 0x49484452 ||
    view.getUint32(16) !== image.source.width ||
    view.getUint32(20) !== image.source.height
  )
    throw new Error('The embedded layer image is damaged or has different dimensions.');
  if (Object.isFrozen(image) && Object.isFrozen(image.source)) checkedLayerImages.add(image);
}

export function supportsHeightField(effect: EffectInstance): effect is HeightConsumerEffect {
  return (
    effect.type === 'shader-contour-melt' ||
    effect.type === 'shader-liquid-foil' ||
    effect.type === 'shader-spectral-terrain' ||
    effect.type === 'shader-liquid-marbling' ||
    effect.type === 'contour-waves' ||
    effect.type === 'depth-field' ||
    effect.type === 'blur' ||
    effect.type === 'recursive-space' ||
    effect.type === 'signal-tearing' ||
    ['depth-parallax', 'depth-haze', 'depth-color-map', 'cutout'].includes(effect.type)
  );
}
export function effectImages(effect: EffectInstance): readonly LayerImage[] {
  const image = supportsLayerImage(effect)
    ? effect.image
    : supportsHeightField(effect)
      ? effect.fieldImage
      : undefined;
  return [
    ...(image ? [image] : []),
    ...(effect.directionImage ? [effect.directionImage] : []),
    ...(effect.application.depthImage ? [effect.application.depthImage] : []),
  ];
}
/** Metadata-only recipes for worker messages and UI diagnostics. */
export function withoutImageData(effect: EffectInstance): EffectInstance {
  let next = effect;
  if (supportsLayerImage(next) && next.image)
    next = { ...next, image: { source: next.image.source, png: '' } };
  if (supportsHeightField(next) && next.fieldImage)
    next = { ...next, fieldImage: { source: next.fieldImage.source, png: '' } };
  if (next.directionImage)
    next = { ...next, directionImage: { source: next.directionImage.source, png: '' } };
  if (next.application.depthImage)
    next = {
      ...next,
      application: {
        ...next.application,
        depthImage: { source: next.application.depthImage.source, png: '' },
      },
    };
  return next;
}
export function layerImages(effects: readonly EffectInstance[]): readonly LayerImage[] {
  const images = new Map<string, LayerImage>();
  for (const image of effects.flatMap(effectImages)) {
    assertLayerImage(image);
    const previous = images.get(image.source.id);
    if (
      previous &&
      (previous.png !== image.png ||
        JSON.stringify(previous.source) !== JSON.stringify(image.source))
    )
      throw new Error('Conflicting layer image references.');
    images.set(image.source.id, image);
  }
  if (
    [...images.values()].reduce((sum, image) => sum + image.source.width * image.source.height, 0) >
    128 * 1024 * 1024
  )
    throw new Error('Layer images exceed the 128 megapixel total limit.');
  return [...images.values()];
}

export interface CompressionBreakupEffect extends EffectBase {
  readonly type: 'compression-breakup';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly compression: number;
    readonly blockSize: number;
    readonly colorResolution: 'full' | 'half' | 'quarter' | 'block';
    readonly colorBleed: number;
    readonly ringing: number;
    readonly seams: number;
    readonly damageDensity: number;
    readonly damageStrength: number;
    readonly damageMode: 'mixed' | 'color-shift' | 'dropout' | 'coefficient-loss';
    readonly edgeHandling: EdgeHandling;
  };
}

export interface FeedbackBloomEffect extends EffectBase {
  readonly type: 'feedback-bloom';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly style: 'bloom' | 'melt';
    readonly iterations: number;
    readonly displacement: number;
    readonly scale: number;
    readonly rotation: number;
    readonly direction: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly persistence: number;
    readonly decay: number;
    readonly refresh: number;
    readonly coherence: number;
    readonly edgeHandling: EdgeHandling;
  };
}

export interface PixelSortEffect extends EffectBase {
  readonly type: 'pixel-sort';
  readonly params: Partial<DirectionFieldParams> &
    ImageFinishParams & {
      readonly amount: number;
      readonly criterion: 'brightness' | 'hue' | 'saturation';
      readonly thresholdStart: number;
      readonly thresholdEnd: number;
      readonly direction: number;
      readonly length: number;
      readonly order: 'ascending' | 'descending';
      readonly density: number;
      readonly breakup: number;
    };
}

export interface ChromaMoshEffect extends EffectBase {
  readonly type: 'chroma-mosh';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly style: 'smear' | 'blocks' | 'trails';
    readonly colorResolution: number;
    readonly displacement: number;
    readonly direction: number;
    readonly density: number;
    readonly persistence: number;
    readonly samples: number;
    readonly chromaMix: number;
    readonly edgeHandling: EdgeHandling;
  };
}

export interface MotionMoshEffect extends EffectBase {
  readonly type: 'motion-mosh';
  readonly params: Partial<DirectionFieldParams> &
    ImageFinishParams & {
      readonly amount: number;
      readonly blockSize: number;
      readonly density: number;
      readonly direction: number;
      readonly travel: number;
      readonly trailLength: number;
      readonly persistence: number;
      readonly samples: number;
      readonly coherence?: number;
      readonly edgeHandling: EdgeHandling;
    };
}
export interface JpegRecompressionEffect extends EffectBase {
  readonly type: 'jpeg-recompression';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly quality: number;
    readonly generations: number;
    readonly qualityLoss: number;
    readonly chromaSubsampling: '420' | '444';
  };
}
export interface ShapeTileParams {
  readonly layout: 'single' | 'tiled';
  readonly tilePattern: 'grid' | 'staggered' | 'radial';
  readonly spacing: number;
  readonly layoutRotation: number;
  readonly radialRepeats: number;
  readonly rotationStyle: 'uniform' | 'linear' | 'graduated' | 'random';
  readonly endRotation: number;
  readonly startSides: number;
  readonly endSides: number;
  readonly polygonStyle: 'uniform' | 'linear' | 'graduated' | 'random';
  readonly progressionField:
    'left-right' | 'right-left' | 'top-bottom' | 'bottom-top' | 'radial' | 'square';
  readonly progressionX: number;
  readonly progressionY: number;
  readonly progressionRange: number;
}

// Optional additions keep existing single-shape version-one recipes exact.
export const SHAPE_TILE_DEFAULTS: ShapeTileParams = {
  layout: 'single',
  tilePattern: 'grid',
  spacing: 20,
  layoutRotation: 0,
  radialRepeats: 8,
  rotationStyle: 'uniform',
  endRotation: 180,
  startSides: 6,
  endSides: 3,
  polygonStyle: 'uniform',
  progressionField: 'left-right',
  progressionX: 50,
  progressionY: 50,
  progressionRange: 100,
};

export interface ShapesEffect extends EffectBase {
  readonly type: 'shapes';
  readonly params: ImageFinishParams &
    ColorGradientParams<'shapeColor'> &
    Partial<ShapeTileParams> & {
      readonly amount: number;
      readonly shape: 'triangle' | 'square' | 'circle' | 'ring' | 'polygon';
      readonly operation: 'keep-inside' | 'cut-out' | 'distort' | 'overlay';
      readonly size: number;
      readonly scale: number;
      readonly rotation: number;
      readonly positionX: number;
      readonly positionY: number;
      readonly ringThickness: number;
      readonly feather: number;
      readonly distortionScale: number;
      readonly twist: number;
      readonly shapeColor: string;
      readonly edgeHandling: EdgeHandling;
    };
}
export interface MandelbrotEffect extends EffectBase {
  readonly type: 'mandelbrot';
  readonly params: ImageFinishParams &
    ColorGradientParams<'outsideColor'> & {
      readonly amount: number;
      readonly operation: 'texture' | 'distort' | 'keep-set' | 'cut-out' | 'weave';
      readonly formula?: 'mandelbrot' | 'julia';
      readonly juliaReal?: number;
      readonly juliaImaginary?: number;
      readonly weaveScale?: number;
      readonly weaveRotation?: number;
      readonly weaveMirror?: 'on' | 'off';
      readonly abstraction?: number;
      readonly centerReal: number;
      readonly centerImaginary: number;
      readonly zoom: number;
      readonly rotation: number;
      readonly iterations: number;
      readonly paletteCycles: number;
      readonly paletteOffset: number;
      readonly outsideColor: string;
      readonly insideColor: string;
      readonly distortion: number;
      readonly edgeHandling: EdgeHandling;
    };
}

// Optional formula/mapping additions preserve existing version-one fractal recipes.
export const FRACTAL_DEFAULTS = {
  formula: 'mandelbrot',
  juliaReal: -0.7,
  juliaImaginary: 0.27015,
  weaveScale: 1.5,
  weaveRotation: 0,
  weaveMirror: 'on',
  abstraction: 0.85,
} as const;

// Optional version-one additions keep existing scanline recipes unchanged.
export const SCANLINE_FINISH_DEFAULTS = {
  blendMode: 'normal',
  color: '#000000',
  invert: 'off',
  glow: 0,
  glowSize: 0.5,
  signalError: 'none',
  errorStrength: 0.35,
  errorPositionX: 0,
  errorPositionY: 0,
  edgeHandling: 'extend',
} as const;

export const DITHER_ALGORITHMS = [
  'none',
  'ordered',
  'floyd-steinberg',
  'atkinson',
  'sierra',
  'jarvis',
  'blue-noise',
  'random',
  'corrupted',
] as const;
export type DitherAlgorithm = (typeof DITHER_ALGORITHMS)[number];
export const INDEXED_PALETTES = [
  'source',
  'rgb332',
  'grayscale',
  'cga',
  'ega',
  'vga',
  'gameboy',
  'monochrome',
  'custom',
] as const;
export interface IndexedPaletteEffect extends EffectBase {
  readonly type: 'indexed-palette';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly palette: (typeof INDEXED_PALETTES)[number];
    readonly colors: number;
    readonly paletteStart: string;
    readonly paletteEnd: string;
    readonly paletteStartStops: string;
    readonly dither: 'none' | 'ordered' | 'floyd-steinberg' | 'blue-noise' | 'random';
    readonly ditherStrength: number;
    readonly cellSize: number;
    readonly colorSwap: number;
    readonly hueDamage: number;
    readonly saturationDamage: number;
    readonly drift: number;
    readonly driftSize: number;
  };
}
export interface ThresholdEffect extends EffectBase {
  readonly type: 'threshold';
  readonly params: ImageFinishParams &
    ColorGradientParams<'inkColor' | 'paperColor'> & {
      readonly amount: number;
      readonly style: 'threshold' | 'bitmap' | 'photocopy';
      readonly threshold: number;
      readonly inputBlack: number;
      readonly inputWhite: number;
      readonly gamma: number;
      readonly levels: number;
      readonly invert: 'off' | 'on';
      readonly local: 'off' | 'on';
      readonly localRadius: number;
      readonly edgeEmphasis: number;
      readonly dirt: number;
      readonly dirtSize: number;
      readonly inkColor: string;
      readonly paperColor: string;
    };
}
export interface DitherEffect extends EffectBase {
  readonly type: 'dither';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly algorithm: DitherAlgorithm;
    readonly levels: number;
    readonly coloring: 'mono' | 'rgb' | 'ramp';
    readonly rampStart: string;
    readonly rampEnd: string;
    readonly rampStartStops: string;
    readonly cellSize: number;
    readonly ditherStrength: number;
    readonly scan: 'serpentine' | 'forward';
    readonly skippedCells: number;
    readonly errorDisplacement: number;
    readonly randomDirection: number;
    readonly blockInterruptions: number;
    readonly blockSize: number;
    readonly channelDivergence: number;
  };
}
export const CHANNELS = ['red', 'green', 'blue'] as const;
export type Channel = (typeof CHANNELS)[number];
export type ChannelMirror = 'off' | 'horizontal' | 'vertical' | 'both';
export type ChannelSource = Channel | 'luma';
export interface ChannelTransformEffect extends EffectBase {
  readonly type: 'channel-transform';
  readonly params: ImageFinishParams &
    Readonly<Record<`${Channel}${'X' | 'Y' | 'Scale' | 'Rotation'}`, number>> &
    Readonly<Record<`${Channel}Mirror`, ChannelMirror>> &
    Readonly<Record<`${Channel}Source`, ChannelSource>> & {
      readonly amount: number;
      readonly centerX: number;
      readonly centerY: number;
      readonly crossfeed: number;
      readonly edgeHandling: EdgeHandling;
    };
}
export interface TemporalEchoEffect extends EffectBase {
  readonly type: 'temporal-echo';
  readonly params: ImageFinishParams &
    ColorGradientParams<'echoColor'> & {
      readonly amount: number;
      readonly style: 'copies' | 'color-separated' | 'silhouette';
      readonly copies: number;
      readonly strength: number;
      readonly spacing: number;
      readonly direction: number;
      readonly falloff: number;
      readonly scaleStep: number;
      readonly rotationStep: number;
      readonly centerX: number;
      readonly centerY: number;
      readonly jitter: number;
      readonly channelStart: Channel;
      readonly echoColor: string;
      readonly clipCopies: 'on' | 'off';
      readonly edgeHandling: EdgeHandling;
    };
}
export interface SignalTearingEffect extends EffectBase {
  readonly type: 'signal-tearing';
  readonly fieldImage?: LayerImage;
  readonly params: Partial<DirectionFieldParams> &
    ImageFinishParams &
    Partial<HeightFieldParams> & {
      readonly amount: number;
      readonly style: 'slices' | 'bursts' | 'staircase';
      readonly displacement: number;
      readonly sliceSize: number;
      readonly density: number;
      readonly orientation: number;
      readonly direction: number;
      readonly frequency: number;
      readonly randomness: number;
      readonly burstLength: number;
      readonly sliceSoftness: number;
      readonly positionX: number;
      readonly positionY: number;
      readonly fieldEnabled: 'off' | 'on';
      readonly fieldInfluence: number;
      readonly edgeHandling: EdgeHandling;
    };
}
export interface CrtEffect extends EffectBase {
  readonly type: 'crt';
  readonly params: ImageFinishParams &
    ColorGradientParams<'glowColor'> & {
      readonly amount: number;
      readonly curvature: number;
      readonly clipScreen: 'off' | 'on';
      readonly edgeHandling: EdgeHandling;
      readonly phosphor: 'off' | 'grille' | 'slot' | 'dots';
      readonly phosphorStrength: number;
      readonly phosphorPitch: number;
      readonly phosphorWidth: number;
      readonly phosphorGain: number;
      readonly fieldBlend: number;
      readonly fieldOrder: 'even' | 'odd';
      readonly fieldSize: number;
      readonly fieldOffsetX: number;
      readonly fieldOffsetY: number;
      readonly bloom: number;
      readonly bloomRadius: number;
      readonly bloomThreshold: number;
      readonly bloomColorMix: number;
      readonly glowColor: string;
    };
}
export { GLYPH_STYLES, GLYPH_DEFAULTS } from './glyph-controls';
export {
  FONT_TILE_WIDTH,
  FONT_TILE_HEIGHT,
  MAX_FONT_CHARACTERS,
  encodeFontCoverage,
  decodeFontCoverage,
  assertGlyphFont,
  type GlyphFontAtlas,
} from './glyph-font';
import { assertGlyphFont, type GlyphFontAtlas } from './glyph-font';
import {
  GLYPH_DEFAULTS,
  GLYPH_PARAMETERS,
  GLYPH_STYLES,
  type GlyphControls,
  type GlyphStyle,
} from './glyph-controls';
export interface GlyphEffect extends EffectBase {
  readonly type: 'glyph';
  readonly glyphFont?: GlyphFontAtlas;
  readonly params: Partial<DirectionFieldParams> &
    ImageFinishParams &
    ColorGradientParams<'foregroundColor' | 'backgroundColor'> &
    GlyphControls & {
      readonly amount: number;
      readonly style: GlyphStyle;
      readonly cellSize: number;
      readonly aspect: number;
      readonly glyphScale: number;
      readonly contrast: number;
      readonly density: number;
      readonly threshold: number;
      readonly invert: 'off' | 'on';
      readonly coloring: 'source' | 'custom';
      readonly foregroundColor: string;
      readonly backgroundColor: string;
    };
}
export interface BitDamageEffect extends EffectBase {
  readonly type: 'bit-damage';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly operation:
      | 'flip'
      | 'clear'
      | 'set'
      | 'shift'
      | 'rotate'
      | 'scramble'
      | 'isolate'
      | 'swap'
      | 'xor'
      | 'and'
      | 'or'
      | 'inject'
      | 'byte-scramble'
      | 'crossfeed';
    readonly target: 'rgb' | 'rgba' | 'luma' | 'red' | 'green' | 'blue' | 'alpha';
    readonly bitSelection?: 'range' | 'custom';
    readonly bitMask?: number;
    readonly swapBitA?: number;
    readonly swapBitB?: number;
    readonly operand?: number;
    readonly sourceChannel?: 'red' | 'green' | 'blue' | 'alpha' | 'luma';
    readonly probability?: number;
    readonly burstLength?: number;
    readonly clustering?: number;
    readonly lowBit: number;
    readonly highBit: number;
    readonly shift: number;
    readonly density: number;
    readonly cellSize: number;
    readonly visualize: 'off' | 'on';
  };
}
export const BIT_DAMAGE_DEFAULTS = {
  bitSelection: 'range' as const,
  bitMask: 255,
  swapBitA: 5,
  swapBitB: 7,
  operand: 128,
  sourceChannel: 'red' as const,
  probability: 1,
  burstLength: 1,
  clustering: 0,
};
export interface FreezeDropoutEffect extends EffectBase {
  readonly type: 'freeze-dropout';
  readonly params: ImageFinishParams &
    ColorGradientParams<'dropoutColor'> & {
      readonly amount: number;
      readonly style: 'freeze' | 'duplicate' | 'blank' | 'noise';
      readonly patchSize: number;
      readonly density: number;
      readonly clustering: number;
      readonly steps: number;
      readonly holdAge: number;
      readonly travel: number;
      readonly direction: number;
      readonly scatter: number;
      readonly positionX: number;
      readonly positionY: number;
      readonly dropoutColor: string;
      readonly clearAlpha: 'off' | 'on';
      readonly edgeHandling: EdgeHandling;
    };
}
export interface PhotoAdjustmentsEffect extends EffectBase {
  readonly type: 'photo-adjustments';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly exposure: number;
    readonly contrast: number;
    readonly highlights: number;
    readonly shadows: number;
    readonly vibrance: number;
    readonly temperature: number;
    readonly tint: number;
  };
}
export interface DetailEffect extends EffectBase {
  readonly type: 'detail';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly sharpen: number;
    readonly radius: number;
    readonly threshold: number;
    readonly clarity: number;
    readonly clarityRadius: number;
    readonly edgeHandling: EdgeHandling;
  };
}
export interface HalationEffect extends EffectBase {
  readonly type: 'halation';
  readonly params: ImageFinishParams &
    ColorGradientParams<'haloColor'> & {
      readonly amount: number;
      readonly strength: number;
      readonly radius: number;
      readonly threshold: number;
      readonly knee: number;
      readonly edgeBias: number;
      readonly haloColor: string;
      readonly edgeHandling: EdgeHandling;
    };
}
export interface VignetteEffect extends EffectBase {
  readonly type: 'vignette';
  readonly params: ImageFinishParams &
    ColorGradientParams<'vignetteColor'> & {
      readonly amount: number;
      readonly strength: number;
      readonly size: number;
      readonly softness: number;
      readonly roundness: number;
      readonly centerX: number;
      readonly centerY: number;
      readonly rotation: number;
      readonly invert: 'off' | 'on';
      readonly vignetteColor: string;
    };
}

export interface VectorCorruptionEffect extends EffectBase {
  readonly type: 'vector-corruption';
  readonly params: Partial<DirectionFieldParams> &
    ImageFinishParams & {
      readonly amount: number;
      readonly operation: 'scramble' | 'reverse' | 'rotate' | 'quantize';
      readonly strength: number;
      readonly direction: number;
      readonly cellSize: number;
      readonly coherence: number;
      readonly density: number;
      readonly quantization: number;
      readonly edgeHandling: EdgeHandling;
    };
}
export interface ReferenceMoshEffect extends EffectBase {
  readonly type: 'reference-mosh';
  readonly image?: LayerImage;
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly style: 'patches' | 'dissolve' | 'drag';
    readonly progression: number;
    readonly persistence: number;
    readonly replacementDensity?: number;
    readonly referenceX?: number;
    readonly referenceY?: number;
    readonly patchSize: number;
    readonly travel: number;
    readonly direction: number;
    readonly placement: 'fit' | 'fill' | 'stretch';
    readonly edgeHandling: EdgeHandling;
  };
}
export interface MotionTransferEffect extends EffectBase {
  readonly type: 'motion-transfer';
  readonly image?: LayerImage;
  readonly params: Partial<DirectionFieldParams> &
    ImageFinishParams & {
      readonly amount: number;
      readonly encoding: 'rg' | 'luma' | 'gradient';
      readonly strength: number;
      readonly direction: number;
      readonly mapScale: number;
      readonly mapX: number;
      readonly mapY: number;
      readonly mapRotation: number;
      readonly invertX: 'off' | 'on';
      readonly invertY: 'off' | 'on';
      readonly edgeHandling: EdgeHandling;
    };
}
export interface DepthParallaxEffect extends EffectBase {
  readonly type: 'depth-parallax';
  readonly fieldImage?: LayerImage;
  readonly params: ImageFinishParams &
    HeightFieldParams & {
      readonly amount: number;
      readonly style: 'parallax' | 'push-pull' | 'tearing';
      readonly cameraX: number;
      readonly cameraY: number;
      readonly focusDepth: number;
      readonly strength: number;
      readonly nearStrength?: number;
      readonly farStrength?: number;
      readonly bands: number;
      readonly scatter: number;
      readonly centerX: number;
      readonly centerY: number;
      readonly edges: 'transparent' | EdgeHandling;
    };
}
export interface DepthHazeEffect extends EffectBase {
  readonly type: 'depth-haze';
  readonly fieldImage?: LayerImage;
  readonly params: ImageFinishParams &
    HeightFieldParams &
    ColorGradientParams<'fogColor'> & {
      readonly amount: number;
      readonly density: number;
      readonly start: number;
      readonly end: number;
      readonly falloff: number;
      readonly fogColor: string;
    };
}
export interface DepthColorMapEffect extends EffectBase {
  readonly type: 'depth-color-map';
  readonly fieldImage?: LayerImage;
  readonly params: ImageFinishParams &
    HeightFieldParams &
    ColorGradientParams<'depthColor'> & {
      readonly amount: number;
      readonly depthColor: string;
      readonly reverse: 'off' | 'on';
      readonly shading: number;
    };
}
export interface CutoutEffect extends EffectBase {
  readonly type: 'cutout';
  readonly fieldImage?: LayerImage;
  readonly params: ImageFinishParams &
    HeightFieldParams & {
      readonly amount: number;
      readonly mode: 'subject' | 'depth' | 'hybrid';
      readonly keep: 'inside' | 'outside';
      readonly near: number;
      readonly far: number;
      readonly softness: number;
      readonly subjectThreshold: number;
      readonly combine: 'intersect' | 'union';
      readonly fillHoles?: 'off' | 'on';
      readonly removeSpecks?: number;
      readonly cleanupSmoothing?: number;
      readonly expand?: number;
      readonly feather?: number;
    };
}
export const CUTOUT_REFINEMENT_DEFAULTS = {
  fillHoles: 'off' as const,
  removeSpecks: 0,
  cleanupSmoothing: 0,
  expand: 0,
  feather: 0,
};
export interface LensDistortionEffect extends EffectBase {
  readonly type: 'lens-distortion';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly distortion: number;
    readonly secondary: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly zoom: number;
    readonly edges: 'transparent' | EdgeHandling;
  };
}
export type HeightConsumerEffect =
  | AdvancedShaderEffect
  | LiquidMarblingEffect
  | SpectralTerrainEffect
  | ContourWavesEffect
  | DepthFieldEffect
  | BlurEffect
  | RecursiveSpaceEffect
  | SignalTearingEffect
  | DepthParallaxEffect
  | DepthHazeEffect
  | DepthColorMapEffect
  | CutoutEffect;
export function supportsLayerImage(
  effect: EffectInstance,
): effect is
  | SolidEffect
  | ReferenceMoshEffect
  | MotionTransferEffect
  | WindowFragmentsEffect
  | MicroCollageEffect {
  return [
    'solid',
    'reference-mosh',
    'motion-transfer',
    'window-fragments',
    'micro-collage',
  ].includes(effect.type);
}

export interface ImportedShaderEffect extends EffectBase {
  readonly type: 'shader-import';
  readonly shader: import('./shader-package').ShaderPackage;
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly phase: number;
  } & Readonly<Record<string, number | string>>;
}
export type ShaderEffect = BuiltinShaderEffect | ImportedShaderEffect;
export function isShaderEffect(effect: EffectInstance): effect is ShaderEffect {
  return effect.type === 'shader-import' || isBuiltinShader(effect);
}
export const BETA_SHADER_TYPES = [
  'shader-cellular-membrane',
  'shader-moire',
  'shader-digital-fracture',
  'shader-diffraction',
  'shader-infinity-tunnel',
  'shader-crystal-facets',
  'shader-circuit-matrix',
  'shader-data-lattice',
  'shader-op-art',
  'shader-polar-grid',
] as const;
export type BetaShaderType = (typeof BETA_SHADER_TYPES)[number];
export const BETA_REFRACTION_TYPES: readonly BetaShaderType[] = [
  'shader-cellular-membrane',
  'shader-digital-fracture',
  'shader-infinity-tunnel',
  'shader-crystal-facets',
];
export function isBetaShader(effect: EffectInstance): effect is BetaShaderEffect {
  return (BETA_SHADER_TYPES as readonly string[]).includes(effect.type);
}
export interface BetaShaderEffect extends BuiltinShaderBase {
  readonly type: BetaShaderType;
  readonly params: BuiltinShaderBase['params'] & {
    readonly structure: number;
    readonly accent: number;
    readonly rotation: number;
    readonly variant: 'first' | 'second' | 'third';
    readonly patternColor: string;
    readonly backgroundColor: string;
    readonly colorMix: number;
    readonly threshold?: number;
    readonly edgeHandling?: EdgeHandling;
  };
}
interface BuiltinShaderBase extends EffectBase {
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly phase: number;
    readonly scale: number;
    readonly strength: number;
    readonly centerX: number;
    readonly centerY: number;
  };
}
export const SET2_SHADER_TYPES = [
  'shader-liquid-marbling',
  'shader-truchet-mosaic',
  'shader-microculture',
  'shader-prismatic-panels',
] as const;
export type AdvancedShaderEffect = BuiltinShaderBase & {
  readonly type: AdvancedShaderType;
  readonly fieldImage?: LayerImage;
  readonly params: BuiltinShaderBase['params'] &
    HeightFieldParams &
    Readonly<Record<string, number | string>> & {
      readonly rotation: number;
      readonly colorMix: number;
      readonly patternColor: string;
      readonly backgroundColor: string;
      readonly sourceMix: number;
      readonly alpha: 'source' | 'opaque';
      readonly style: string;
      readonly edgeHandling: EdgeHandling;
    };
};
export function isAdvancedShader(effect: EffectInstance): effect is AdvancedShaderEffect {
  return (ADVANCED_SHADER_TYPES as readonly string[]).includes(effect.type);
}
type Set2MaterialParams = {
  readonly rotation: number;
  readonly colorMix?: number;
  readonly patternColor: string;
  readonly backgroundColor: string;
  readonly sourceMix: number;
  readonly alpha: 'source' | 'opaque';
  readonly style:
    'stripes' | 'ink' | 'arcs' | 'dots' | 'mixed' | 'stained' | 'colonies' | 'glass' | 'pastel';
  readonly edgeHandling: EdgeHandling;
  readonly swirl?: number;
  readonly bands?: number;
  readonly sharpness?: number;
  readonly travel?: number;
  readonly arcWidth?: number;
  readonly dotSize?: number;
  readonly dotDensity?: number;
  readonly grid?: number;
  readonly radius?: number;
  readonly membrane?: number;
  readonly granules?: number;
  readonly clustering?: number;
  readonly widthVariation?: number;
  readonly refraction?: number;
  readonly edgeWidth?: number;
  readonly iridescence?: number;
  readonly softness?: number;
  readonly lens?: number;
};
export interface LiquidMarblingEffect extends BuiltinShaderBase {
  readonly type: 'shader-liquid-marbling';
  readonly fieldImage?: LayerImage;
  readonly params: BuiltinShaderBase['params'] & Set2MaterialParams & HeightFieldParams;
}
export type Set2ShaderEffect =
  | LiquidMarblingEffect
  | (BuiltinShaderBase & {
      readonly type: Exclude<(typeof SET2_SHADER_TYPES)[number], 'shader-liquid-marbling'>;
      readonly params: BuiltinShaderBase['params'] & Set2MaterialParams;
    });
export function isSet2Shader(effect: EffectInstance): effect is Set2ShaderEffect {
  return (SET2_SHADER_TYPES as readonly string[]).includes(effect.type);
}
export interface PixelStretchEffect extends EffectBase {
  readonly type: 'pixel-stretch';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly style: 'patches' | 'bands' | 'radial';
    readonly axis: 'horizontal' | 'vertical';
    readonly length: number;
    readonly stripWidth: number;
    readonly density: number;
    readonly originX: number;
    readonly originY: number;
    readonly threshold: number;
    readonly softness: number;
    readonly phase: number;
    readonly edgeBias?: number;
    readonly protectedRadius?: number;
    readonly edgeHandling: EdgeHandling;
  };
}
export interface GranularEchoEffect extends EffectBase {
  readonly type: 'granular-echo';
  readonly params: ImageFinishParams &
    ColorGradientParams<'particleColor'> & {
      readonly amount: number;
      readonly particleSize: number;
      readonly trailLength: number;
      readonly trailLayers: number;
      readonly breakup: number;
      readonly direction: number;
      readonly threshold: number;
      readonly monochrome: 'off' | 'on';
      readonly colorSource: 'source' | 'chosen';
      readonly particleColor: string;
      readonly phase: number;
      readonly edgeHandling: EdgeHandling;
    };
}
export interface PigmentDragEffect extends EffectBase {
  readonly type: 'pigment-drag';
  readonly params: ImageFinishParams &
    ColorGradientParams<'pigmentColor'> & {
      readonly amount: number;
      readonly brushSize: number;
      readonly dragLength: number;
      readonly direction: number;
      readonly scraping: number;
      readonly grain: number;
      readonly retention: number;
      readonly drips: number;
      readonly colorMix: number;
      readonly pigmentColor: string;
      readonly phase: number;
      readonly edgeHandling: EdgeHandling;
    };
}
export interface LedMatrixEffect extends EffectBase {
  readonly type: 'led-matrix';
  readonly params: ImageFinishParams &
    ColorGradientParams<'ledColor' | 'backgroundColor'> & {
      readonly amount: number;
      readonly cellSize: number;
      readonly gap: number;
      readonly shape: 'circle' | 'square' | 'ring';
      readonly brightness: number;
      readonly glow: number;
      readonly deadCells: number;
      readonly rotation: number;
      readonly phase: number;
      readonly coloring: 'source' | 'chosen';
      readonly ledColor: string;
      readonly backgroundColor: string;
      readonly brightnessSource?: 'image' | 'pattern';
      readonly patternFrequency?: number;
    };
}
export const REFERENCE_SHADER_TYPES = [
  'shader-signal-collapse',
  'shader-paint-flow',
  'shader-billowing-smoke',
  'shader-chromatic-erosion',
  'shader-bloom-field',
  'shader-neon-edges',
  'shader-wire-ghost',
  'shader-prismatic-shatter',
  'shader-radial-extrusion',
  'shader-cellular-mesh',
  'shader-particle-burst',
  'shader-spectral-terrain',
] as const;
export interface ReferenceShaderEffect extends BuiltinShaderBase {
  readonly type: Exclude<(typeof REFERENCE_SHADER_TYPES)[number], 'shader-spectral-terrain'>;
  readonly params: BuiltinShaderBase['params'] & {
    readonly rotation: number;
    readonly colorMix: number;
    readonly patternColor: string;
    readonly backgroundColor: string;
    readonly spokes?: number;
    readonly depth?: number;
    readonly tunnel?: number;
    readonly facets?: number;
    readonly holes?: number;
    readonly rounding?: number;
    readonly fractures?: number;
    readonly wireframe?: number;
    readonly particleSize?: number;
    readonly scatter?: number;
    readonly branches?: number;
    readonly focalGlow?: number;
    readonly focalLength?: number;
    readonly edgeWidth?: number;
    readonly glow?: number;
    readonly darkness?: number;
    readonly trails?: number;
    readonly travel?: number;
    readonly disruption?: number;
    readonly interference?: number;
    readonly shredding?: number;
    readonly grain?: number;
    readonly distortion?: number;
    readonly banding?: number;
    readonly erosion?: number;
    readonly edgeHandling?: EdgeHandling;
    readonly petals?: number;
    readonly radius?: number;
    readonly dotSize?: number;
    readonly density?: number;
    readonly noiseScale?: number;
    readonly alpha?: 'source' | 'opaque';
    readonly collapse?: number;
    readonly stretch?: number;
    readonly static?: number;
    readonly dropout?: number;
    readonly ribbons?: number;
    readonly paintStyle?: 'splatter' | 'liquid';
    readonly viscosity?: number;
    readonly colorVariation?: number;
    readonly eddyStrength?: number;
    readonly eddyScale?: number;
    readonly sourceMix?: number;
    readonly turbulence?: number;
    readonly volume?: number;
    readonly light?: number;
    readonly softness?: number;
    readonly smokeLayers?: number;
  };
}
export interface SpectralTerrainEffect extends BuiltinShaderBase {
  readonly type: 'shader-spectral-terrain';
  readonly fieldImage?: LayerImage;
  readonly params: ReferenceShaderEffect['params'] &
    HeightFieldParams & {
      readonly mode: 'flat' | 'terrain';
      readonly height: number;
      readonly perspective: number;
      readonly ridges: number;
      readonly lineWidth: number;
    };
}
export function isReferenceShader(
  effect: EffectInstance,
): effect is ReferenceShaderEffect | SpectralTerrainEffect {
  return (REFERENCE_SHADER_TYPES as readonly string[]).includes(effect.type);
}
export interface CelShadingEffect extends EffectBase {
  readonly type: 'cel-shading';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly shadeBands: number;
    readonly colorBands: number;
    readonly smoothing: number;
    readonly contrast: number;
    readonly saturation: number;
    readonly outlineWidth: number;
    readonly outlineThreshold: number;
    readonly outlineStrength: number;
    readonly outlineColor: string;
  };
}
export interface SystemCrashEffect extends EffectBase {
  readonly type: 'system-crash';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly text: string;
    readonly textSize: number;
    readonly textDensity: number;
    readonly threshold: number;
    readonly sourceMix: number;
    readonly windowCount: number;
    readonly windowSize: number;
    readonly windowTravel: number;
    readonly windowSpreadX?: number;
    readonly windowSpreadY?: number;
    readonly windowCenterX?: number;
    readonly windowCenterY?: number;
    readonly windowPlacement?: 'random' | 'grid' | 'horizontal' | 'vertical';
    readonly phase: number;
    readonly textColor: string;
    readonly backgroundColor: string;
    readonly annotations?: 'off' | 'on';
    readonly anchorDensity?: number;
    readonly connectorStyle?: 'elbow' | 'straight' | 'off';
    readonly annotationLabels?: 'on' | 'off';
    readonly labelText?: string;
    readonly overlayFrames?: 'on' | 'off';
    readonly overlayWidth?: number;
  };
}
export interface TerminalWireframeEffect extends EffectBase {
  readonly type: 'terminal-wireframe';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly cellSize: number;
    readonly edgeStrength: number;
    readonly continuity: number;
    readonly density: number;
    readonly perspective: number;
    readonly sourceMix: number;
    readonly phase: number;
    readonly frame: 'off' | 'on';
    readonly colorSource: 'source' | 'chosen';
    readonly lineColor: string;
    readonly accentColor: string;
    readonly backgroundColor: string;
    readonly traceStyle?: 'glyphs' | 'circuit';
    readonly rightAngleBias?: number;
    readonly channelSeparation?: number;
  };
}
export interface SignalWeaveEffect extends EffectBase {
  readonly type: 'signal-weave';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly rasterSpacing: number;
    readonly rasterWidth: number;
    readonly bands: number;
    readonly colorMix: number;
    readonly dropouts: number;
    readonly distortion: number;
    readonly phase: number;
    readonly backgroundColor: string;
    readonly edgeHandling: EdgeHandling;
  };
}
export interface DataWeaveEffect extends EffectBase {
  readonly type: 'data-weave';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly dashLength: number;
    readonly spacing: number;
    readonly rowSpacing: number;
    readonly thickness: number;
    readonly disruption: number;
    readonly sourceMix: number;
    readonly phase: number;
    readonly colorSource: 'source' | 'chosen';
    readonly lineColor: string;
    readonly backgroundColor: string;
  };
}
export interface MicroCollageEffect extends EffectBase {
  readonly type: 'micro-collage';
  readonly image?: LayerImage;
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly fragmentSize: number;
    readonly spacing: number;
    readonly travel: number;
    readonly zoom: number;
    readonly rotation: number;
    readonly sourceMix: number;
    readonly phase: number;
    readonly backgroundColor: string;
    readonly edgeHandling: EdgeHandling;
  };
}
export interface WindowFragmentsEffect extends EffectBase {
  readonly type: 'window-fragments';
  readonly image?: LayerImage;
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly count: number;
    readonly width: number;
    readonly height: number;
    readonly sizeVariation: number;
    readonly travel: number;
    readonly zoom: number;
    readonly colorShift: number;
    readonly borderWidth: number;
    readonly borderColor: string;
    readonly decorations: 'off' | 'on';
    readonly phase: number;
    readonly edgeHandling: EdgeHandling;
  };
}
export interface ContourWavesEffect extends EffectBase {
  readonly type: 'contour-waves';
  readonly fieldImage?: LayerImage;
  readonly params: ImageFinishParams &
    HeightFieldParams & {
      readonly amount: number;
      readonly lines: number;
      readonly amplitude: number;
      readonly lineWidth: number;
      readonly rotation: number;
      readonly phase: number;
      readonly sourceMix: number;
      readonly colorSource: 'source' | 'chosen';
      readonly lineColor: string;
      readonly backgroundColor: string;
      readonly breakup?: number;
      readonly stepSize?: number;
      readonly tearStrength?: number;
    };
}
export interface PixelDissolveEffect extends EffectBase {
  readonly type: 'pixel-dissolve';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly cellSize: number;
    readonly dissolve: number;
    readonly breakup: number;
    readonly scatter: number;
    readonly direction: number;
    readonly softness: number;
    readonly phase: number;
    readonly bias: 'uniform' | 'dark' | 'bright';
    readonly fill: 'transparent' | 'background';
    readonly backgroundColor: string;
    readonly edgeHandling: EdgeHandling;
  };
}
export interface NeonPrintEffect extends EffectBase {
  readonly type: 'neon-print';
  readonly params: ImageFinishParams & {
    readonly amount: number;
    readonly cellSize: number;
    readonly grain: number;
    readonly contrast: number;
    readonly outlines: number;
    readonly outlineWidth: number;
    readonly inkColor1: string;
    readonly inkColor2: string;
    readonly inkColor3: string;
    readonly paperColor: string;
    readonly backgroundColor: string;
  };
}
type RefractionShaderType = 'shader-ripple' | 'shader-liquid-glass' | 'shader-flow-field';
type MaterialShaderType = 'shader-iridescence' | 'shader-hologram';
interface ExtendedShaderParams {
  'shader-caustics': { readonly focus: number; readonly dispersion: number };
  'shader-liquid-chrome': {
    readonly edgeHandling: EdgeHandling;
    readonly shine: number;
    readonly contrast: number;
  };
  'shader-heat-mirage': {
    readonly edgeHandling: EdgeHandling;
    readonly direction: number;
    readonly falloff: number;
  };
  'shader-nebula': {
    readonly alpha: 'source' | 'opaque';
    readonly detail: number;
    readonly core: number;
  };
}
export type BuiltinShaderEffect =
  | Set2ShaderEffect
  | AdvancedShaderEffect
  | SpectralTerrainEffect
  | ReferenceShaderEffect
  | BetaShaderEffect
  | {
      [Type in keyof ExtendedShaderParams]: BuiltinShaderBase & {
        readonly type: Type;
        readonly params: BuiltinShaderBase['params'] & ExtendedShaderParams[Type];
      };
    }[keyof ExtendedShaderParams]
  | {
      [Type in RefractionShaderType]: BuiltinShaderBase & {
        readonly type: Type;
        readonly params: BuiltinShaderBase['params'] & { readonly edgeHandling: EdgeHandling };
      };
    }[RefractionShaderType]
  | (BuiltinShaderBase & {
      readonly type: 'shader-plasma';
      readonly params: BuiltinShaderBase['params'] & { readonly alpha: 'source' | 'opaque' };
    })
  | {
      [Type in MaterialShaderType]: BuiltinShaderBase & { readonly type: Type };
    }[MaterialShaderType];
export function isBuiltinShader(effect: EffectInstance): effect is BuiltinShaderEffect {
  return [
    'shader-ripple',
    'shader-plasma',
    'shader-liquid-glass',
    'shader-flow-field',
    'shader-iridescence',
    'shader-hologram',
    'shader-caustics',
    'shader-liquid-chrome',
    'shader-heat-mirage',
    'shader-nebula',
    ...BETA_SHADER_TYPES,
    ...REFERENCE_SHADER_TYPES,
    ...SET2_SHADER_TYPES,
    ...ADVANCED_SHADER_TYPES,
  ].includes(effect.type);
}

export type EffectInstance =
  | GranularEchoEffect
  | PigmentDragEffect
  | PixelStretchEffect
  | LedMatrixEffect
  | CelShadingEffect
  | SystemCrashEffect
  | TerminalWireframeEffect
  | SignalWeaveEffect
  | DataWeaveEffect
  | MicroCollageEffect
  | PixelDissolveEffect
  | NeonPrintEffect
  | ContourWavesEffect
  | WindowFragmentsEffect
  | JpegRecompressionEffect
  | ImportedShaderEffect
  | BuiltinShaderEffect
  | VectorCorruptionEffect
  | ReferenceMoshEffect
  | MotionTransferEffect
  | DepthParallaxEffect
  | DepthHazeEffect
  | DepthColorMapEffect
  | CutoutEffect
  | LensDistortionEffect
  | BitDamageEffect
  | FreezeDropoutEffect
  | PhotoAdjustmentsEffect
  | DetailEffect
  | HalationEffect
  | VignetteEffect
  | ChannelTransformEffect
  | TemporalEchoEffect
  | SignalTearingEffect
  | CrtEffect
  | GlyphEffect
  | IndexedPaletteEffect
  | ThresholdEffect
  | DitherEffect
  | NoiseGrainEffect
  | BlurEffect
  | LevelsCurvesEffect
  | GlowEffect
  | HueSaturationEffect
  | GradientMapEffect
  | RgbSplitEffect
  | BlockCorruptionEffect
  | SpatialCrushEffect
  | BitCrushEffect
  | WaveDistortionEffect
  | ScanlinesEffect
  | HalftoneEffect
  | MirroringEffect
  | KaleidoscopeEffect
  | RecursiveSpaceEffect
  | DepthFieldEffect
  | FeedbackBloomEffect
  | CompressionBreakupEffect
  | SolidEffect
  | TransformEffect
  | MotionMoshEffect
  | ChromaMoshEffect
  | PixelSortEffect
  | ShapesEffect
  | MandelbrotEffect;
/** Built-in catalog types. Imported shaders carry their own definitions. */
export type EffectType = Exclude<EffectInstance['type'], 'shader-import'>;

const sourceTransparency = new WeakMap<ArrayBuffer, boolean>();
// Call with immutable source pixels, not a rendered output or file-format alpha flag.
export function effectsNeedSubject(
  effects: readonly EffectInstance[],
  sourcePixels?: ArrayBuffer,
): boolean {
  const active = effects.filter(
    (effect) => effect.enabled && effect.params.amount > 0 && effect.application.coverage > 0,
  );
  if (
    active.some(
      (effect) =>
        ['subject', 'background'].includes(effect.application.region) ||
        (effect.type === 'cutout' && effect.params.mode !== 'depth') ||
        (effect.type === 'blur' &&
          effect.params.style === 'background' &&
          effect.params.radius > 0),
    )
  )
    return true;
  const aligned = active.some(
    (effect) =>
      (effect.type === 'mirroring' || effect.type === 'kaleidoscope') &&
      (effect.params.outputAlignment ?? 'none') !== 'none',
  );
  if (!aligned) return false;
  if (!sourcePixels) return true;
  let transparent = sourceTransparency.get(sourcePixels);
  if (transparent === undefined) {
    transparent = false;
    const pixels = new Uint8Array(sourcePixels);
    for (let i = 3; i < pixels.length; i += 4)
      if (pixels[i]! < 255) {
        transparent = true;
        break;
      }
    sourceTransparency.set(sourcePixels, transparent);
  }
  return !transparent;
}

export interface PresetRecipe {
  readonly masterSeed: number;
  readonly effects: readonly EffectInstance[];
}
export type PresetPlacement = 'replace' | 'above' | 'below' | 'merge';
export interface EffectPreset extends PresetRecipe {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly thumbnail: string;
  readonly thumbnailSource?: 'image' | 'statue';
}

export function assertPresetRecipe(value: unknown): asserts value is PresetRecipe {
  if (!value || typeof value !== 'object') throw new Error('Invalid preset recipe.');
  const recipe = value as PresetRecipe;
  assertSeed(recipe.masterSeed);
  if (!Array.isArray(recipe.effects) || !recipe.effects.length || recipe.effects.length > 1000)
    throw new Error('A preset must contain between 1 and 1,000 effects.');
  const ids = new Set<string>();
  for (const effect of recipe.effects) {
    if (!effect || typeof effect.instanceId !== 'string' || effect.instanceId.length > 1024)
      throw new Error('Invalid preset effect.');
    assertEffect(effect);
    if (ids.has(effect.instanceId)) throw new Error('Duplicate preset effect ID.');
    ids.add(effect.instanceId);
  }
  layerImages(recipe.effects);
}

export function assertPresetName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120)
    throw new Error('Choose a preset name between 1 and 120 characters.');
}

export function assertEffectPreset(value: unknown): asserts value is EffectPreset {
  assertPresetRecipe(value);
  const preset = value as EffectPreset;
  assertPresetName(preset.name);
  if (
    preset.schemaVersion !== 1 ||
    typeof preset.id !== 'string' ||
    !preset.id ||
    preset.id.length > 1024 ||
    typeof preset.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(preset.createdAt)) ||
    (preset.thumbnailSource !== undefined &&
      !['image', 'statue'].includes(preset.thumbnailSource)) ||
    typeof preset.thumbnail !== 'string' ||
    preset.thumbnail.length > 1024 * 1024 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(preset.thumbnail)
  )
    throw new Error('Invalid saved preset.');
}
export type ParameterDefinition = (
  | {
      readonly kind: 'text';
      readonly label: string;
      readonly description: string;
      readonly default: string;
      readonly maxLength: number;
    }
  | {
      readonly kind: 'stops';
      readonly label: string;
      readonly description: string;
      readonly default: string;
    }
  | {
      readonly kind: 'number';
      readonly label: string;
      readonly description: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly unit:
        | 'percent'
        | 'image-percent'
        | 'bits'
        | 'cycles'
        | 'degrees'
        | 'multiplier'
        | 'count'
        | 'coordinate';
      readonly default: number;
    }
  | {
      readonly kind: 'choice';
      readonly label: string;
      readonly description: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
      readonly default: string;
    }
  | {
      readonly kind: 'color';
      readonly gradient?: 'spatial' | 'field';
      readonly label: string;
      readonly description: string;
      readonly default: string;
    }
) & { readonly colorSource?: string };
export interface EffectDefinition {
  readonly finish: 'image' | 'pattern' | 'none';
  readonly title: string;
  readonly description: string;
  readonly hint: string;
  readonly parameters: Readonly<Record<string, ParameterDefinition>>;
}
export function applicationParameters(): Readonly<Record<string, ParameterDefinition>> {
  const number = (
    label: string,
    description: string,
    defaultValue: number,
    min = 0,
    max = 1,
    step = 0.01,
    unit: Extract<ParameterDefinition, { kind: 'number' }>['unit'] = 'percent',
  ): ParameterDefinition => ({
    kind: 'number',
    label,
    description,
    default: defaultValue,
    min,
    max,
    step,
    unit,
  });
  return {
    'application.region': {
      kind: 'choice',
      label: 'Application',
      description:
        'Choose the region or source signal that controls this effect. Content masks read the stage input and combine with the painted mask.',
      default: 'all',
      options: APPLICATION_REGIONS,
    },
    'application.coverage': number(
      'Coverage',
      'Expand the selected area or signal range. For bands, controls stripe width. Zero applies nothing; 100% covers the entire chosen source range.',
      1,
    ),
    'application.softness': number(
      'Softness',
      'Feather spatial boundaries or signal thresholds. Zero creates a hard edge; higher values create a gradual falloff.',
      0,
    ),
    'application.rangeStart': number(
      'Range start',
      'Lower cutoff for the selected luminance, alpha, detail or depth signal. Reversed cutoffs are sorted automatically.',
      0,
    ),
    'application.rangeEnd': number(
      'Range end',
      'Upper cutoff for the selected signal. Coverage works inside this range.',
      1,
    ),
    'application.invert': {
      kind: 'choice',
      label: 'Invert application',
      description:
        'Reverse the generated Application mask before multiplying it by the painted mask.',
      default: 'off',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
    },
    'application.detailScale': number(
      'Detail scale',
      'Neighborhood size for local detail analysis as a percentage of the shorter source side.',
      1,
      0.1,
      10,
      0.1,
      'image-percent',
    ),
    'application.bandFrequency': number(
      'Band frequency',
      'Number of repeating horizontal or vertical bands across the canvas.',
      8,
      1,
      128,
      1,
      'count',
    ),
    'application.bandOffset': number(
      'Band offset',
      'Move the repeating bands through one complete cycle.',
      0,
    ),
    ...Object.fromEntries(
      DEPTH_FIELD_KEYS.map((key) => [
        `application.depthField.${key}`,
        EFFECT_DEFINITIONS['depth-field'].parameters[key]!,
      ]),
    ),
  };
}
export function applicationValue(application: EffectApplication, key: string): number | string {
  const path = key.replace(/^application\./, '');
  if (path.startsWith('depthField.'))
    return heightFieldParams(application.depthField ?? {})[
      path.slice(11) as keyof HeightFieldParams
    ];
  return (
    (application as unknown as Record<string, number | string>)[path] ??
    applicationParameters()[key]!.default
  );
}
export function setApplicationValue(
  application: EffectApplication,
  key: string,
  value: number | string,
): EffectApplication {
  const path = key.replace(/^application\./, '');
  return path.startsWith('depthField.')
    ? {
        ...application,
        depthField: { ...heightFieldParams(application.depthField ?? {}), [path.slice(11)]: value },
      }
    : { ...application, [path]: value };
}
export function isParameterText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    Array.from(value).every((character) => {
      const code = character.codePointAt(0)!;
      return code !== 127 && (code >= 32 || code === 9 || code === 10 || code === 13);
    })
  );
}

const amount: ParameterDefinition = {
  kind: 'number',
  label: 'Opacity',
  description:
    'Control the opacity of this effect over the incoming image. 0% shows the incoming image; 100% applies the full effect.',
  min: 0,
  max: 1,
  step: 0.01,
  unit: 'percent',
  default: 1,
};
const blockSize: ParameterDefinition = {
  kind: 'number',
  label: 'Block size',
  description:
    'Size of each block as a percentage of the shorter image side. Larger values create chunkier blocks. Export keeps the same proportions.',
  min: 0.1,
  max: 25,
  step: 0.1,
  unit: 'image-percent',
  default: 4,
};
const edgeHandling: ParameterDefinition = {
  kind: 'choice',
  label: 'Edge Handling',
  description:
    'Choose pixels beyond the image boundary. Extend repeats the outermost pixels; Wrap (Tile) continues from the opposite edge; Mirror reflects the image at each edge. Wrap can show a seam when opposite edges differ.',
  default: 'extend',
  options: [
    { value: 'extend', label: 'Extend' },
    { value: 'wrap', label: 'Wrap (Tile)' },
    { value: 'mirror', label: 'Mirror' },
  ],
};
export const blendMode: ParameterDefinition = {
  kind: 'choice',
  label: 'Blend mode',
  default: 'normal',
  description:
    'Combine the effect result with the incoming image. Normal uses the result; Multiply darkens; Screen lightens; Add increases brightness; Overlay combines contrast; Difference creates inverted contrasts. Opacity controls the mix.',
  options: BLEND_MODES,
};
// Reuse for filters that transform image pixels. Pattern filters instead use a
// pattern color with the same blend modes at their own paint/composite boundary.
export const IMAGE_FINISH_PARAMETERS = {
  blendMode,
  tintEnabled: {
    kind: 'choice',
    label: 'Tint',
    description:
      'Enable image tinting. Turning this off keeps your selected color and strength for later and disables Tint strength. Blend mode still applies independently.',
    default: IMAGE_FINISH_DEFAULTS.tintEnabled,
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
  color: {
    kind: 'color',
    gradient: 'spatial',
    label: 'Tint color',
    default: IMAGE_FINISH_DEFAULTS.color,
    description:
      'Choose a tint for the processed image. Tint strength controls how much it multiplies the effect colors; white leaves them unchanged. Click the swatch to open the color picker.',
  },
  tintStrength: {
    kind: 'number',
    label: 'Tint strength',
    default: IMAGE_FINISH_DEFAULTS.tintStrength,
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'percent',
    description:
      'Mix the selected tint into the processed image before blending it with the input. 0% preserves the original effect colors; 100% multiplies them by the tint. Transparency is preserved.',
  },
} as const satisfies Readonly<Record<string, ParameterDefinition>>;

const errorPosition = {
  kind: 'number',
  default: 0,
  min: -100,
  max: 100,
  step: 0.1,
  unit: 'image-percent',
} as const;
const imagePosition = {
  kind: 'number',
  min: 0,
  max: 100,
  step: 0.1,
  unit: 'image-percent',
  default: 50,
} as const;
const rotation = {
  kind: 'number',
  label: 'Rotation',
  min: 0,
  max: 360,
  step: 1,
  unit: 'degrees',
  default: 0,
} as const;
const outputPlacement = {
  outputAlignment: {
    kind: 'choice',
    label: 'Output alignment',
    default: 'none',
    description:
      'Align the finished object using its transparency, or the detected subject for ordinary photos. Center, edge and corner presets move its visible bounds without changing the reflection axis or sampled source wedge. None keeps its rendered position. Offsets apply afterward; newly uncovered areas are transparent.',
    options: [
      { value: 'none', label: 'None' },
      { value: 'center', label: 'Center' },
      { value: 'top', label: 'Top' },
      { value: 'bottom', label: 'Bottom' },
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' },
      { value: 'top-left', label: 'Top left' },
      { value: 'top-right', label: 'Top right' },
      { value: 'bottom-left', label: 'Bottom left' },
      { value: 'bottom-right', label: 'Bottom right' },
    ],
  },
  outputOffsetX: {
    kind: 'number',
    label: 'Output offset X',
    min: -100,
    max: 100,
    step: 0.1,
    unit: 'image-percent',
    default: 0,
    description:
      'Move the finished result horizontally after alignment, as a percentage of image width. Negative moves left; positive moves right. This does not change the reflection pattern.',
  },
  outputOffsetY: {
    kind: 'number',
    label: 'Output offset Y',
    min: -100,
    max: 100,
    step: 0.1,
    unit: 'image-percent',
    default: 0,
    description:
      'Move the finished result vertically after alignment, as a percentage of image height. Negative moves up; positive moves down. This does not change the reflection pattern.',
  },
} as const;
export const DEPTH_TREATMENT_DEFAULTS = {
  contourOffset: 0,
  contourSoftness: 0,
  terraceBevel: 0.15,
  lightElevation: 49,
  ambient: 0.2,
  highlights: 0,
} as const;

const reductionNumber = (
  label: string,
  initial: number,
  min: number,
  max: number,
  unit: 'percent' | 'count' | 'multiplier' | 'image-percent' | 'coordinate' | 'degrees',
  description: string,
): ParameterDefinition => ({
  kind: 'number',
  label,
  default: initial,
  min,
  max,
  unit,
  step: unit === 'count' ? 1 : 0.01,
  description,
});
const reductionChoice = (
  label: string,
  initial: string,
  options: readonly (readonly [string, string])[],
  description: string,
): ParameterDefinition => ({
  kind: 'choice',
  label,
  default: initial,
  options: options.map(([value, label]) => ({ value, label })),
  description,
});
const ditherOptions = [
  ['none', 'None'],
  ['ordered', 'Ordered / Bayer'],
  ['floyd-steinberg', 'Floyd–Steinberg'],
  ['atkinson', 'Atkinson'],
  ['sierra', 'Sierra'],
  ['jarvis', 'Jarvis–Judice–Ninke'],
  ['blue-noise', 'Blue Noise'],
  ['random', 'Random'],
  ['corrupted', 'Corrupted Dither'],
] as const;
const cellSizeControl = reductionNumber(
  'Cell size',
  1,
  1,
  64,
  'count',
  'Size of each processed cell in original-image pixels. Larger cells average visible color into coarse tiles. Transparency remains at its original pixels.',
);
const ditherStrengthControl = reductionNumber(
  'Dither strength',
  1,
  0,
  1,
  'percent',
  'Scale threshold noise or quantization-error diffusion. Zero uses hard nearest-color mapping; 100% uses the selected algorithm at full strength.',
);
function originalImageShader(
  title: string,
  description: string,
  refracts: boolean,
  scale: number,
): EffectDefinition {
  return {
    title,
    description,
    hint: `${description} Phase selects a frozen still frame; New pattern changes the seeded field. Opacity, tint, blending and masks apply after the shader.`,
    finish: 'image',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.',
      ),
      scale: reductionNumber(
        'Scale',
        scale,
        1,
        24,
        'multiplier',
        'Pattern density per shorter image side. Lower values make broader folds or bands.',
      ),
      strength: refracts
        ? reductionNumber(
            'Strength',
            4,
            0,
            15,
            'image-percent',
            'Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.',
          )
        : reductionNumber(
            'Intensity',
            0.75,
            0,
            1,
            'percent',
            'Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.',
          ),
      centerX: reductionNumber(
        'Center X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal pattern origin.',
      ),
      centerY: reductionNumber('Center Y', 50, 0, 100, 'image-percent', 'Vertical pattern origin.'),
      ...(refracts ? { edgeHandling } : {}),
    },
  };
}
function extendedImageShader(
  title: string,
  description: string,
  refracts: boolean,
  scale: number,
  parameters: Readonly<Record<string, ParameterDefinition>>,
): EffectDefinition {
  const base = originalImageShader(title, description, refracts, scale);
  return { ...base, parameters: { ...base.parameters, ...parameters } };
}
function betaShader(
  title: string,
  description: string,
  refracts: boolean,
  scale: number,
  structure: ParameterDefinition,
  accent: ParameterDefinition,
  variants: readonly [string, string, string],
  extra: Readonly<Record<string, ParameterDefinition>> = {},
): EffectDefinition {
  const palette: Readonly<Record<string, readonly [string, string]>> = {
    'Moiré Interference': ['#ffca5b', '#291f48'],
    'Digital Fracture': ['#ff4f9b', '#151c35'],
    'Cellular Membrane': ['#4de7d1', '#122437'],
    'Infinity Tunnel': ['#bba1ff', '#10172a'],
    'Crystal Facets': ['#b8e9ff', '#1c2540'],
    'Circuit Matrix': ['#8cff88', '#081f19'],
    'Data Lattice': ['#ff8d4f', '#2b1636'],
    'Op Art': ['#f5e7ce', '#171a30'],
    'Polar Grid': ['#68dfff', '#0a172c'],
    Diffraction: ['#b5cfff', '#241032'],
  };
  return extendedImageShader(title, description, refracts, scale, {
    structure,
    accent,
    rotation: reductionNumber(
      'Pattern rotation',
      0,
      -180,
      180,
      'degrees',
      'Rotate the procedural structure around its Center without rotating the source image.',
    ),
    variant: reductionChoice(
      'Pattern',
      'first',
      [
        ['first', variants[0]],
        ['second', variants[1]],
        ['third', variants[2]],
      ],
      'Choose a different geometric construction. Each pattern uses the same saved controls and seed.',
    ),
    patternColor: {
      kind: 'color',
      label: 'Accent color',
      default: palette[title]?.[0] ?? '#51e6ef',
      description: 'Color of the bright pattern, seam or highlight.',
    },
    backgroundColor: {
      kind: 'color',
      label: 'Shadow color',
      default: palette[title]?.[1] ?? '#221735',
      description: 'Color of the dark pattern regions. Source transparency is preserved.',
    },
    colorMix: reductionNumber(
      'Pattern color',
      0.55,
      0,
      1,
      'percent',
      'Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.',
    ),
    ...extra,
  });
}
function referenceMaterial(
  title: string,
  description: string,
  scale: number,
  extra: Readonly<Record<string, ParameterDefinition>>,
): EffectDefinition {
  return extendedImageShader(title, description, false, scale, {
    scale: reductionNumber(
      'Pattern scale',
      scale,
      0.25,
      96,
      'multiplier',
      'Procedural pattern density per shorter original image side. Higher values create smaller structures.',
    ),
    rotation: reductionNumber(
      'Pattern rotation',
      0,
      -180,
      180,
      'degrees',
      'Rotate the procedural pattern around its center without rotating source content.',
    ),
    colorMix: reductionNumber(
      'Spectral color',
      0.85,
      0,
      1,
      'percent',
      'Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.',
    ),
    patternColor: {
      kind: 'color',
      label: 'Accent color',
      default: '#63dfff',
      description: 'Color mixed with the spectral highlights.',
    },
    backgroundColor: {
      kind: 'color',
      label: 'Shadow color',
      default: '#060714',
      description: 'Color of dark shader regions.',
    },
    edgeHandling,
    ...extra,
  });
}
const betaFeature = (label: string, initial: number, description: string) =>
  reductionNumber(label, initial, 0, 1, 'percent', description);
function set2Material(
  title: string,
  description: string,
  scale: number,
  extra: Readonly<Record<string, ParameterDefinition>>,
): EffectDefinition {
  const definition = referenceMaterial(title, description, scale, {
    alpha: reductionChoice(
      'Canvas',
      'source',
      [
        ['source', 'Preserve source transparency'],
        ['opaque', 'Fill canvas'],
      ],
      'Retain the source silhouette or fill the canvas with the material.',
    ),
    ...extra,
  });
  return title === 'Prismatic Panels'
    ? {
        ...definition,
        parameters: Object.fromEntries(
          Object.entries(definition.parameters).filter(([key]) => key !== 'colorMix'),
        ),
      }
    : definition;
}
const BASE_EFFECT_DEFINITIONS: Readonly<Record<EffectType, EffectDefinition>> = {
  'granular-echo': {
    title: 'Granular Echo',
    finish: 'image',
    hint: 'Use particle size and trail length for powdery directional echoes; a shared direction field can bend the trails.',
    description:
      'Scatter powdery image fragments and directional ghost trails while retaining source colors.',
    parameters: {
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Blend the treatment with its original input.',
      ),
      ...IMAGE_FINISH_PARAMETERS,
      particleSize: reductionNumber(
        'Particle size',
        1.4,
        0.2,
        8,
        'image-percent',
        'Size of fragments in the original image.',
      ),
      trailLength: reductionNumber(
        'Trail length',
        14,
        0,
        50,
        'image-percent',
        'Distance traveled by the directional ghost traces.',
      ),
      trailLayers: reductionNumber(
        'Trail layers',
        5,
        1,
        12,
        'count',
        'Number of overlapping image echoes.',
      ),
      breakup: betaFeature('Breakup', 0.45, 'Seeded gaps and powdery fragmentation in the traces.'),
      direction: reductionNumber(
        'Trail direction',
        -15,
        -180,
        180,
        'degrees',
        'Direction followed by fragments when no shared direction field is selected.',
      ),
      threshold: betaFeature(
        'Particle threshold',
        0.25,
        'Minimum source brightness represented by particle trails.',
      ),
      monochrome: reductionChoice(
        'Monochrome',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Keep the source colors or render a monochrome powder treatment.',
      ),
      colorSource: reductionChoice(
        'Particle coloring',
        'source',
        [
          ['source', 'Source'],
          ['chosen', 'Chosen'],
        ],
        'Use source colors or the chosen color/gradient for particle trails.',
      ),
      particleColor: {
        kind: 'color',
        label: 'Particle color',
        default: '#f4dfb9',
        gradient: 'spatial',
        description: 'Color or gradient of chosen particle trails.',
      },
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Choose a frozen stage of the granular drift.',
      ),
      edgeHandling,
    },
  },
  'pigment-drag': {
    title: 'Pigment Drag',
    finish: 'image',
    hint: 'Adjust brush size, travel and scraping. Drips always pull downward; shared fields steer the primary smear.',
    description:
      'Smear source pigment into scraped brush tracks, fine grain and gravity-aligned runs.',
    parameters: {
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Blend the treatment with its original input.',
      ),
      ...IMAGE_FINISH_PARAMETERS,
      brushSize: reductionNumber(
        'Brush size',
        3,
        0.4,
        15,
        'image-percent',
        'Width of individual dragged pigment tracks.',
      ),
      dragLength: reductionNumber(
        'Drag length',
        16,
        0,
        60,
        'image-percent',
        'Maximum sampling travel in the original image.',
      ),
      direction: reductionNumber(
        'Drag direction',
        0,
        -180,
        180,
        'degrees',
        'Direction of the smear when no shared direction field is selected.',
      ),
      scraping: betaFeature(
        'Scraping',
        0.5,
        'Break drag strokes into scraped edges and exposed source patches.',
      ),
      grain: betaFeature(
        'Pigment grain',
        0.25,
        'Amount of seeded particulate variation in the dragged color.',
      ),
      retention: betaFeature(
        'Source retention',
        0.35,
        'Blend the dragged result back toward the original image.',
      ),
      drips: betaFeature(
        'Drips',
        0.25,
        'Add downward pigment runs independently of the main drag direction.',
      ),
      colorMix: betaFeature(
        'Chosen pigment',
        0,
        'Mix source pigment with the chosen color or gradient.',
      ),
      pigmentColor: {
        kind: 'color',
        label: 'Pigment color',
        default: '#da477e',
        gradient: 'spatial',
        description: 'Optional color or multi-stop gradient applied to the pigment.',
      },
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Choose a frozen state of the dragged brush tracks.',
      ),
      edgeHandling,
    },
  },
  ...(Object.fromEntries(
    Object.entries(ADVANCED_SHADER_SPECS).map(([type, spec]) => [
      type,
      set2Material(spec.title, spec.description, spec.scale, spec.controls),
    ]),
  ) as Record<AdvancedShaderType, EffectDefinition>),
  'shader-liquid-marbling': set2Material(
    'Liquid Marbling',
    'Curl the image and height field into striped folds or flowing ink bands.',
    3,
    {
      style: reductionChoice(
        'Style',
        'stripes',
        [
          ['stripes', 'Stripes'],
          ['ink', 'Ink'],
        ],
        'Choose nested striped folds or sharper ink-like curls.',
      ),
      swirl: betaFeature(
        'Swirl',
        0.65,
        'Bend the material into coherent curls. Zero removes procedural curling.',
      ),
      bands: reductionNumber(
        'Color bands',
        8,
        2,
        32,
        'count',
        'Number of alternating color bands across the marbled field.',
      ),
      sharpness: betaFeature(
        'Band sharpness',
        0.65,
        'Blend softly between bands or retain crisp ink boundaries.',
      ),
      travel: reductionNumber(
        'Image distortion',
        9,
        0,
        30,
        'image-percent',
        'Displace source sampling through the same curl field. Zero keeps the original sampling positions.',
      ),
      colorMix: betaFeature(
        'Field influence',
        0.55,
        'Mix the shared height field into the stripe layout. Source luminance, noise and imported depth maps are available.',
      ),
      sourceMix: betaFeature(
        'Source colors',
        0.2,
        'Mix source colors into the two-color marbling palette.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Light ink',
        default: '#eee9dc',
        description: 'Color of raised/light marbling bands.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Dark ink',
        default: '#141525',
        description: 'Color of recessed/dark marbling bands.',
      },
    },
  ),
  'shader-truchet-mosaic': set2Material(
    'Truchet Mosaic',
    'Join quarter-circle arcs and dots into a seeded geometric tile pattern.',
    8,
    {
      style: reductionChoice(
        'Tile style',
        'mixed',
        [
          ['arcs', 'Arcs'],
          ['dots', 'Dots'],
          ['mixed', 'Arcs and dots'],
        ],
        'Choose connected arcs, dot cells, or a seeded mix of both.',
      ),
      arcWidth: betaFeature('Arc width', 0.14, 'Thickness of curved paths relative to a tile.'),
      dotSize: betaFeature('Dot size', 0.21, 'Radius of the dots relative to a tile.'),
      dotDensity: betaFeature(
        'Dot density',
        0.4,
        'Fraction of cells containing dots in mixed style, or populated cells in dots style.',
      ),
      grid: betaFeature(
        'Grid lines',
        0.08,
        'Opacity of subtle lines separating the tile cells. Zero removes the grid.',
      ),
      sourceMix: betaFeature(
        'Source background',
        0.12,
        'Reveal the source beneath the geometric pattern.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Pattern color',
        default: '#efc35a',
        description: 'Color of arcs and dots.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Tile background',
        default: '#162d35',
        description: 'Color between the geometric paths.',
      },
    },
  ),
  'shader-microculture': set2Material(
    'Microculture',
    'Layer translucent cells, organic membranes and granular colonies over the image.',
    5,
    {
      style: reductionChoice(
        'Style',
        'stained',
        [
          ['stained', 'Stained tissue'],
          ['colonies', 'Colonies'],
        ],
        'Choose stained translucent tissue or granular clustered colonies.',
      ),
      radius: betaFeature(
        'Cell radius',
        0.38,
        'Size of the rounded cell bodies relative to their spacing.',
      ),
      membrane: betaFeature(
        'Membrane width',
        0.1,
        'Thickness of the boundary surrounding each cell.',
      ),
      granules: betaFeature('Granules', 0.45, 'Amount of fine internal particulate texture.'),
      clustering: betaFeature(
        'Clustering',
        0.55,
        'Vary cell size and population through a coherent organic field.',
      ),
      sourceMix: betaFeature(
        'Source background',
        0.2,
        'Reveal the image beneath the translucent culture.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Stain color',
        default: '#167ba8',
        description: 'Primary stain; nearby cells use related contrasting stains.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Culture background',
        default: '#f2eddf',
        description: 'Base color between translucent cells.',
      },
    },
  ),
  'shader-prismatic-panels': set2Material(
    'Prismatic Panels',
    'Refract the source through soft panels with pastel faces and spectral edges.',
    7,
    {
      style: reductionChoice(
        'Style',
        'glass',
        [
          ['glass', 'Source glass'],
          ['pastel', 'Pastel material'],
        ],
        'Refract source details or emphasize the colored panel surfaces.',
      ),
      widthVariation: betaFeature(
        'Width variation',
        0.55,
        'Vary the widths of neighboring panels using the saved seed.',
      ),
      refraction: reductionNumber(
        'Refraction',
        10,
        0,
        25,
        'image-percent',
        'Travel of source details through the glass faces.',
      ),
      edgeWidth: betaFeature(
        'Edge width',
        0.09,
        'Width of the spectral seams relative to a panel.',
      ),
      iridescence: betaFeature(
        'Iridescence',
        0.8,
        'Strength of the rainbow spectral color along panel edges.',
      ),
      softness: betaFeature('Face softness', 0.35, 'Smooth the transition across each panel face.'),
      sourceMix: betaFeature(
        'Source colors',
        0.65,
        'Retain source color beneath the pastel panel treatment.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Panel color A',
        default: '#f0cdb5',
        description: 'First pastel face color.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Panel color B',
        default: '#b4dce5',
        description: 'Second pastel face color.',
      },
    },
  ),
  'pixel-stretch': {
    title: 'Pixel Stretch',
    finish: 'image',
    description: 'Pull selected image strips into patchwork, long bands or radial edge trails.',
    hint: 'Use length and strip width to control the streaks. Origin positions place the anchor for bands and radial trails; application masks can protect a figure.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: reductionChoice(
        'Style',
        'patches',
        [
          ['patches', 'Patchwork'],
          ['bands', 'Bands'],
          ['radial', 'Radial edge flow'],
        ],
        'Choose scattered stretch patches, long directional bands or outward trails.',
      ),
      axis: reductionChoice(
        'Axis',
        'vertical',
        [
          ['horizontal', 'Horizontal'],
          ['vertical', 'Vertical'],
        ],
        'Direction of bands and patchwork stretches.',
      ),
      length: reductionNumber(
        'Stretch length',
        30,
        0,
        100,
        'image-percent',
        'Reach of the stretched strips relative to the shorter original image side. Zero leaves the image unchanged.',
      ),
      stripWidth: reductionNumber(
        'Strip width',
        2,
        0.1,
        20,
        'image-percent',
        'Width of individual source strips or radial sectors.',
      ),
      density: betaFeature(
        'Stretch density',
        0.65,
        'Seeded fraction of strips that are stretched.',
      ),
      originX: reductionNumber(
        'Origin X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal anchor position for bands and radial trails.',
      ),
      originY: reductionNumber(
        'Origin Y',
        50,
        0,
        100,
        'image-percent',
        'Vertical anchor position for bands and radial trails.',
      ),
      threshold: betaFeature(
        'Brightness threshold',
        0,
        'Only stretch anchors at or above this source brightness. Zero includes all anchors.',
      ),
      softness: betaFeature(
        'Trail softness',
        0.2,
        'Feather streaks into the incoming image. Zero creates clipped patches.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen drift of the stretch pattern. 0% and 100% match.',
      ),
      edgeHandling,
    },
  },
  'led-matrix': {
    title: 'LED Matrix',
    finish: 'image',
    description:
      'Render image colors as glowing light cells with adjustable shapes and signal failures.',
    hint: 'Cell size controls display resolution. Glow creates light spill around the emitters; dead cells and Phase simulate a frozen failure pattern.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      cellSize: reductionNumber(
        'Cell size',
        2.5,
        0.5,
        15,
        'image-percent',
        'Spacing of LED cells relative to the shorter original image side.',
      ),
      shape: reductionChoice(
        'Emitter shape',
        'circle',
        [
          ['circle', 'Circle'],
          ['square', 'Square'],
          ['ring', 'Ring'],
        ],
        'Choose round emitters, square pixels or hollow rings.',
      ),
      gap: betaFeature('Cell gap', 0.3, 'Dark space between neighboring emitters.'),
      brightness: reductionNumber(
        'Brightness',
        1.3,
        0,
        3,
        'multiplier',
        'Brightness gain of the sampled LED colors.',
      ),
      glow: betaFeature('Glow', 0.45, 'Spread soft light into the spaces around each emitter.'),
      deadCells: betaFeature(
        'Dead cells',
        0.05,
        'Fraction of cells removed by the saved failure pattern.',
      ),
      rotation: reductionNumber(
        'Grid rotation',
        0,
        -180,
        180,
        'degrees',
        'Rotate the display grid without rotating the source image.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen offset and flicker state of the grid. 0% and 100% match.',
      ),
      coloring: reductionChoice(
        'LED colors',
        'source',
        [
          ['source', 'Source image'],
          ['chosen', 'Chosen color'],
        ],
        'Use sampled image colors, or apply a chosen color/gradient with image brightness.',
      ),
      ledColor: {
        kind: 'color',
        label: 'LED color',
        default: '#ef4a75',
        gradient: 'spatial',
        description: 'Emitter color when LED colors uses Chosen color.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Display background',
        default: '#07090f',
        gradient: 'spatial',
        description: 'Color or gradient between light cells.',
      },
    },
  },
  'cel-shading': {
    title: 'Cel Shading',
    finish: 'image',
    description: 'Flatten source colors into clean shaded bands with adjustable ink outlines.',
    hint: 'Smooth small texture, then tune the shade bands and outlines. Source colors and transparency are preserved.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      shadeBands: reductionNumber(
        'Shade bands',
        4,
        2,
        16,
        'count',
        'Number of brightness steps used to create flat illustrated shading.',
      ),
      colorBands: reductionNumber(
        'Color bands',
        8,
        2,
        32,
        'count',
        'Number of steps per color channel. Fewer steps create broader, flatter color areas.',
      ),
      smoothing: reductionNumber(
        'Surface smoothing',
        0.35,
        0,
        3,
        'image-percent',
        'Smooth small texture before shading while retaining boundaries. Radius is a percentage of the shorter image side.',
      ),
      contrast: reductionNumber(
        'Contrast',
        1.15,
        0.25,
        3,
        'multiplier',
        'Expand the source brightness range before choosing shade bands.',
      ),
      saturation: reductionNumber(
        'Saturation',
        1.1,
        0,
        2,
        'multiplier',
        'Control the saturation of the illustrated colors. Zero creates grayscale shading.',
      ),
      outlineWidth: reductionNumber(
        'Outline width',
        0.25,
        0,
        2,
        'image-percent',
        'Sampling radius used to detect ink boundaries. Zero disables outlines.',
      ),
      outlineThreshold: betaFeature(
        'Outline threshold',
        0.15,
        'Minimum image contrast that creates an ink boundary. Higher values retain only stronger edges.',
      ),
      outlineStrength: betaFeature(
        'Outline opacity',
        0.9,
        'Opacity of the ink boundaries over the shaded colors. Zero disables outlines.',
      ),
      outlineColor: {
        kind: 'color',
        label: 'Ink color',
        default: '#151326',
        description: 'Color of the illustrated ink outlines.',
      },
    },
  },
  'shader-signal-collapse': referenceMaterial(
    'Signal Collapse',
    'Fold the source into jagged digital blocks, stretched ribbons, static and dropouts.',
    14,
    {
      collapse: betaFeature(
        'Collapse',
        0.65,
        'Displace and fold coherent blocks of the source. Zero disables folding while retaining other treatments.',
      ),
      stretch: betaFeature(
        'Ribbon stretch',
        0.6,
        'Stretch thin source strips across several neighboring blocks. Higher values form longer ribbons; zero disables stretching.',
      ),
      static: betaFeature('Static', 0.3, 'Mix fine seeded signal noise into the damaged regions.'),
      dropout: betaFeature(
        'Dropout',
        0.2,
        'Fraction of damaged blocks replaced by the shadow color.',
      ),
      ribbons: betaFeature(
        'Ribbon density',
        0.55,
        'Gradually increase the number and strength of horizontal ribbon bands. Zero removes ribbons; 100% stretches every band.',
      ),
      colorMix: betaFeature(
        'Palette strength',
        0.65,
        'Mix a limited neon palette into corrupted samples. Zero preserves source colors.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Neon accent',
        default: '#ff00a8',
        description: 'Primary accent used in the limited neon signal palette.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Dropout color',
        default: '#000000',
        description: 'Color of missing signal blocks and darkest palette regions.',
      },
    },
  ),
  'shader-paint-flow': referenceMaterial(
    'Paint Flow',
    'Spread source-colored paint into irregular splashes or flowing liquid ribbons.',
    9,
    {
      paintStyle: reductionChoice(
        'Mode',
        'splatter',
        [
          ['splatter', 'Splatter'],
          ['liquid', 'Liquid'],
        ],
        'Choose irregular paint droplets and sprays or continuous flowing liquid ribbons.',
      ),
      density: betaFeature(
        'Paint coverage',
        0.7,
        'Coverage of the painted forms. Higher values fill more of the image.',
      ),
      radius: reductionNumber(
        'Paint size',
        0.45,
        0.1,
        1,
        'percent',
        'Size of the splash clusters or thickness of the liquid ribbons within each pattern cell.',
      ),
      travel: reductionNumber(
        'Flow distance',
        12,
        0,
        40,
        'image-percent',
        'Distance the fluid field moves source samples as a percentage of the shorter image side.',
      ),
      viscosity: betaFeature(
        'Viscosity',
        0.6,
        'Thick paint holds short rounded splashes. Lower viscosity lets paint run downward into longer, thinner drips; Liquid mode stretches into gravity-driven streams.',
      ),
      colorVariation: betaFeature(
        'Color variation',
        0,
        'Mix seeded color differences into the paint. Zero retains the source/chosen paint color; higher values create a more varied palette. Drips keep their parent splash color.',
      ),
      sourceMix: betaFeature(
        'Background source',
        0.85,
        'Reveal the original image between paint forms. Zero uses the chosen background color.',
      ),
      colorMix: betaFeature(
        'Paint color',
        0,
        'Mix the chosen paint color with sampled source colors. Zero paints with the source image colors.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Paint color',
        default: '#ff496c',
        description: 'Chosen paint color mixed into the source-colored fluid.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Background color',
        default: '#101321',
        description: 'Color between paint forms when Background source is reduced.',
      },
    },
  ),
  'shader-billowing-smoke': referenceMaterial(
    'Billowing Smoke',
    'Build rolling clouds of shaded smoke from a layered turbulent field.',
    4,
    {
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Advance the frozen smoke through local rolling eddies and turbulent billows. 0% and 100% match. This does not start live playback.',
      ),
      density: betaFeature(
        'Density',
        0.65,
        'Expand the amount of visible smoke. Zero clears the smoke field.',
      ),
      turbulence: betaFeature(
        'Turbulence',
        0.65,
        'Twist the cloud field into smaller rolling curls. Zero retains broad soft billows.',
      ),
      eddyStrength: betaFeature(
        'Eddy curl',
        0.75,
        'Strength of local swirling motion as Phase advances. Zero disables the large eddies while retaining smaller turbulent billows.',
      ),
      eddyScale: reductionNumber(
        'Eddy size',
        2.5,
        0.5,
        6,
        'multiplier',
        'Size of the swirling regions relative to the procedural pattern. Larger values create broad rolling eddies.',
      ),
      volume: betaFeature(
        'Volume',
        0.65,
        'Increase optical thickness through the layered smoke field.',
      ),
      light: betaFeature(
        'Lighting',
        0.7,
        'Shade cloud ridges and cavities to give the smoke a sense of depth.',
      ),
      softness: betaFeature(
        'Softness',
        0.6,
        'Control the smooth falloff from dense smoke into clear areas.',
      ),
      smokeLayers: reductionNumber(
        'Volume layers',
        4,
        1,
        8,
        'count',
        'Number of bounded field layers combined into each still smoke frame. More layers create richer volume and take longer to render.',
      ),
      colorMix: betaFeature(
        'Smoke color',
        1,
        'Use the chosen smoke color, or reduce this value to draw smoke with source image colors.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Smoke color',
        default: '#b9c3dc',
        description: 'Color of the lit smoke billows.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Background color',
        default: '#080b17',
        description: 'Color of clear areas and the deepest smoke shadows.',
      },
      alpha: reductionChoice(
        'Canvas',
        'source',
        [
          ['source', 'Preserve source transparency'],
          ['opaque', 'Fill canvas'],
        ],
        'Preserve the source silhouette or fill the full canvas with smoke and its background.',
      ),
    },
  ),
  'shader-radial-extrusion': referenceMaterial(
    'Radial Extrusion',
    'Extrude source-colored rectangular rays into a fractured radial tunnel.',
    6,
    {
      spokes: reductionNumber(
        'Spokes',
        48,
        8,
        128,
        'count',
        'Number of rectangular rays around the radial center.',
      ),
      depth: betaFeature(
        'Extrusion depth',
        0.65,
        'Length and depth of source-driven radial fragments.',
      ),
      tunnel: betaFeature('Tunnel opening', 0.18, 'Radius of the dark central opening.'),
      facets: betaFeature(
        'Facet shading',
        0.65,
        'Contrast between rectangular ray faces and their beveled sides.',
      ),
    },
  ),
  'shader-cellular-mesh': referenceMaterial(
    'Cellular Mesh',
    'Rebuild the flat image as rounded cellular forms, holes and fractured mesh boundaries.',
    14,
    {
      holes: betaFeature('Hole size', 0.35, 'Radius of rounded openings inside cellular forms.'),
      rounding: betaFeature(
        'Cell rounding',
        0.6,
        'Round off cellular faces and soften their boundaries.',
      ),
      fractures: betaFeature('Fractures', 0.2, 'Seeded fraction of broken cellular faces.'),
      wireframe: betaFeature('Wireframe', 0.35, 'Reveal bright cellular boundary wires.'),
    },
  ),
  'shader-particle-burst': referenceMaterial(
    'Particle Burst',
    'Reveal source structure through scattered particles, branching streaks and a focal cross glow.',
    35,
    {
      density: betaFeature(
        'Particle density',
        0.6,
        'Seeded fraction of source-brightness-driven particle cells.',
      ),
      particleSize: reductionNumber(
        'Particle size',
        0.13,
        0.025,
        0.4,
        'percent',
        'Radius of a particle relative to its procedural cell.',
      ),
      scatter: betaFeature(
        'Scatter',
        0.5,
        'Seeded movement of particle positions inside their cells.',
      ),
      branches: betaFeature(
        'Branch streaks',
        0.45,
        'Strength and length of directional particle streaks.',
      ),
      focalGlow: betaFeature(
        'Focal glow',
        0.55,
        'Strength of the cross-shaped light at the selected Center.',
      ),
      focalLength: betaFeature(
        'Focal length',
        0.35,
        'Extent of the horizontal and vertical focal light.',
      ),
    },
  ),
  'shader-spectral-terrain': referenceMaterial(
    'Spectral Terrain',
    'Render flowing neon ridges as a flat field or an optional height-projected terrain.',
    4,
    {
      mode: reductionChoice(
        'Projection',
        'flat',
        [
          ['flat', 'Flat'],
          ['terrain', 'Terrain'],
        ],
        'Flat uses the spectral field without landscape perspective; Terrain projects its peaks and valleys.',
      ),
      height: betaFeature(
        'Relief height',
        0.4,
        'Strength of height shading in Flat and vertical relief in Terrain.',
      ),
      perspective: betaFeature(
        'Perspective',
        0.65,
        'Perspective compression of the Terrain projection. Flat does not use perspective.',
      ),
      ridges: reductionNumber(
        'Ridges',
        12,
        2,
        40,
        'count',
        'Number of spectral contour ridges across the height range.',
      ),
      lineWidth: reductionNumber(
        'Ridge width',
        0.18,
        0.03,
        1,
        'percent',
        'Width of the bright spectral ridge within its contour period.',
      ),
    },
  ),
  'shader-neon-edges': referenceMaterial(
    'Neon Edges',
    'Trace the image with glowing spectral contours and dark interiors.',
    6,
    {
      edgeWidth: reductionNumber(
        'Contour width',
        0.35,
        0.05,
        4,
        'image-percent',
        'Distance used to detect image contours, relative to the shorter original image side.',
      ),
      glow: betaFeature('Glow', 0.7, 'Strength of wider light around the sharp neon contours.'),
      darkness: betaFeature(
        'Interior darkness',
        0.9,
        'Darken the image between contours without changing its transparency.',
      ),
    },
  ),
  'shader-wire-ghost': referenceMaterial(
    'Wire Ghost',
    'Layer chromatic silhouette contours with translucent trails and signal disruptions.',
    8,
    {
      edgeWidth: reductionNumber(
        'Contour width',
        0.3,
        0.05,
        4,
        'image-percent',
        'Distance used to detect image contours, relative to the shorter original image side.',
      ),
      trails: reductionNumber('Trails', 4, 1, 8, 'count', 'Number of chromatic contour echoes.'),
      travel: reductionNumber(
        'Trail travel',
        8,
        0,
        30,
        'image-percent',
        'Distance of contour trails along the selected pattern rotation.',
      ),
      disruption: betaFeature(
        'Disruption',
        0.25,
        'Seeded horizontal interruptions in the contour trails.',
      ),
      glow: betaFeature('Glow', 0.5, 'Widen and brighten the contour trails.'),
    },
  ),
  'shader-prismatic-shatter': referenceMaterial(
    'Prismatic Shatter',
    'Break the source into granular crystalline facets with diagonal interference and shredded edges.',
    22,
    {
      distortion: reductionNumber(
        'Fragment travel',
        8,
        0,
        30,
        'image-percent',
        'Seeded displacement of source samples within crystalline fragments.',
      ),
      interference: betaFeature(
        'Interference',
        0.65,
        'Strength of diagonal spectral interference across the facets.',
      ),
      shredding: betaFeature(
        'Edge shredding',
        0.3,
        'Remove granular fragments near image contours. Zero keeps every fragment.',
      ),
      grain: betaFeature('Crystal grain', 0.5, 'Seeded variation in granular crystalline shading.'),
    },
  ),
  'system-crash': {
    title: 'System Crash',
    finish: 'image',
    description: 'Convert image structure into diagnostic text with displaced image windows.',
    hint: 'Text follows source brightness. Use Application Subject to confine the treatment to a detected subject.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      text: {
        kind: 'text',
        label: 'Diagnostic text',
        default: 'GLEECH SYSTEM ERROR 0X42 MEMORY CORRUPTED SIGNAL LOST RESTART REQUIRED',
        maxLength: 256,
        description:
          'Original diagnostic text repeated across the image. Letters, numbers and punctuation use portable bitmap glyphs.',
      },
      textSize: reductionNumber(
        'Text size',
        1.3,
        0.3,
        12,
        'image-percent',
        'Width of each diagnostic character relative to the shorter original image side.',
      ),
      textDensity: betaFeature(
        'Text density',
        0.85,
        'Seeded fraction of character cells populated with diagnostic text.',
      ),
      threshold: betaFeature(
        'Image threshold',
        0.25,
        'Brightness at which diagnostic text begins to reveal source structure.',
      ),
      sourceMix: betaFeature(
        'Source visibility',
        0.15,
        'Reveal the source behind the diagnostic blue screen.',
      ),
      windowCount: reductionNumber(
        'Image windows',
        6,
        0,
        24,
        'count',
        'Number of displaced source-image windows laid over the text treatment.',
      ),
      windowSize: reductionNumber(
        'Window size',
        20,
        4,
        60,
        'image-percent',
        'Width and height of diagnostic image windows relative to canvas bounds.',
      ),
      windowTravel: reductionNumber(
        'Window travel',
        20,
        0,
        60,
        'image-percent',
        'Maximum seeded displacement of image content inside the diagnostic windows.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment of text drift and window travel. 0% and 100% match.',
      ),
      textColor: {
        kind: 'color',
        label: 'Text color',
        default: '#cbd6ff',
        description: 'Color of bright diagnostic characters and window borders.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Screen color',
        default: '#1324bd',
        description: 'Color of the diagnostic screen behind text and image windows.',
      },
    },
  },
  'terminal-wireframe': {
    title: 'Terminal Wireframe',
    finish: 'image',
    description: 'Trace image-derived contours with dashed terminal glyphs and perspective.',
    hint: 'Contours and character structure come from the image. Perspective creates a terminal-style projection without reconstructing a 3D scene.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      cellSize: reductionNumber(
        'Character size',
        1.4,
        0.3,
        10,
        'image-percent',
        'Size of each terminal character relative to the shorter original image side.',
      ),
      edgeStrength: reductionNumber(
        'Contour strength',
        4,
        0,
        12,
        'multiplier',
        'Amplify image-derived contours and choose where wireframe characters appear.',
      ),
      continuity: betaFeature(
        'Line continuity',
        0.7,
        'Increase continuous contour dashes; lower values break them into isolated marks.',
      ),
      density: betaFeature(
        'Character density',
        0.55,
        'Seeded fraction of image cells contributing terminal structure.',
      ),
      perspective: betaFeature(
        'Perspective',
        0.3,
        'Compress distant rows around the center to create a terminal perspective treatment.',
      ),
      sourceMix: betaFeature(
        'Source visibility',
        0.05,
        'Reveal the source behind the terminal wireframe.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment of terminal row drift. 0% and 100% match.',
      ),
      frame: reductionChoice(
        'Terminal frame',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Add an optional terminal border and corner marks.',
      ),
      colorSource: reductionChoice(
        'Wire color',
        'chosen',
        [
          ['chosen', 'Chosen palette'],
          ['source', 'Source image'],
        ],
        'Use the two-color terminal palette or sampled image colors.',
      ),
      lineColor: {
        kind: 'color',
        label: 'Wire color',
        default: '#63dbe1',
        description: 'Main terminal contour color.',
      },
      accentColor: {
        kind: 'color',
        label: 'Accent color',
        default: '#f36b9c',
        description: 'Color of brighter characters and terminal framing.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Background color',
        default: '#091020',
        description: 'Terminal background behind characters and contours.',
      },
    },
  },

  'signal-weave': {
    title: 'Signal Weave',
    finish: 'image',
    description:
      'Weave vertical raster threads through horizontal spectral bands and signal dropouts.',
    hint: 'Raster controls the vertical texture; Bands and Color mix control horizontal spectral strips independently.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      rasterSpacing: reductionNumber(
        'Raster spacing',
        0.5,
        0.05,
        8,
        'image-percent',
        'Distance between vertical threads, relative to the shorter original image side.',
      ),
      rasterWidth: betaFeature(
        'Raster width',
        0.45,
        'Fraction of each raster period occupied by a visible thread.',
      ),
      bands: reductionNumber(
        'Color bands',
        18,
        2,
        80,
        'count',
        'Number of horizontal spectral color bands across the image.',
      ),
      colorMix: betaFeature(
        'Band color',
        0.65,
        'Mix spectral colors into the sampled source. Zero preserves source colors.',
      ),
      dropouts: betaFeature(
        'Dropouts',
        0.12,
        'Seeded probability of missing signal segments within the raster.',
      ),
      distortion: reductionNumber(
        'Signal displacement',
        4,
        0,
        30,
        'image-percent',
        'Horizontal displacement of source content within individual signal bands.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment of spectral color and raster displacement. 0% and 100% match.',
      ),
      backgroundColor: {
        kind: 'color',
        label: 'Background color',
        default: '#050817',
        description: 'Color between raster threads and inside signal dropouts.',
      },
      edgeHandling,
    },
  },
  'data-weave': {
    title: 'Data Weave',
    finish: 'image',
    description: 'Reveal the image through disrupted rows of colored data dashes.',
    hint: 'Source-colored dashes follow image brightness. Length, spacing and disruption change the weave independently.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      dashLength: reductionNumber(
        'Dash length',
        1.6,
        0.1,
        12,
        'image-percent',
        'Length of each horizontal dash, relative to the shorter original image side.',
      ),
      spacing: reductionNumber(
        'Dash spacing',
        0.4,
        0,
        8,
        'image-percent',
        'Horizontal gap between dashes.',
      ),
      rowSpacing: reductionNumber(
        'Row spacing',
        0.8,
        0.1,
        8,
        'image-percent',
        'Distance between data rows, relative to the shorter original image side.',
      ),
      thickness: betaFeature('Dash thickness', 0.6, 'Fraction of each row occupied by a dash.'),
      disruption: betaFeature('Disruption', 0.25, 'Seeded missing dashes and uneven dash lengths.'),
      sourceMix: betaFeature(
        'Source visibility',
        0.05,
        'Reveal the unfiltered image behind the dash rows.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment of row drift. 0% and 100% match.',
      ),
      colorSource: reductionChoice(
        'Dash color',
        'source',
        [
          ['source', 'Source image'],
          ['chosen', 'Chosen color'],
        ],
        'Use sampled image colors or the chosen dash color.',
      ),
      lineColor: {
        kind: 'color',
        label: 'Dash color',
        default: '#64f4de',
        description: 'Color of dashes when Dash color is set to Chosen color.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Background color',
        default: '#060919',
        description: 'Color of the gaps and missing data dashes.',
      },
    },
  },
  'micro-collage': {
    title: 'Micro Collage',
    finish: 'image',
    description:
      'Rebuild the source from small image fragments, optionally sampled from a reference image.',
    hint: 'Source visibility keeps the image recognizable. Reference images are embedded in projects and presets.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      fragmentSize: reductionNumber(
        'Fragment size',
        3,
        0.3,
        30,
        'image-percent',
        'Size of mosaic fragments relative to the shorter original image side.',
      ),
      spacing: betaFeature(
        'Fragment spacing',
        0.06,
        'Gap around each fragment as a fraction of its size.',
      ),
      travel: reductionNumber(
        'Fragment travel',
        15,
        0,
        70,
        'image-percent',
        'Seeded distance between a fragment and its sampled source position.',
      ),
      zoom: reductionNumber(
        'Fragment zoom',
        1.6,
        0.25,
        8,
        'multiplier',
        'Magnify the image content inside each fragment.',
      ),
      rotation: reductionNumber(
        'Random rotation',
        15,
        0,
        180,
        'degrees',
        'Maximum seeded rotation of sampled content inside each fragment.',
      ),
      sourceMix: betaFeature(
        'Source visibility',
        0.3,
        'Blend the original image with the fragment collage to retain recognizable content.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment of fragment sampling. 0% and 100% match.',
      ),
      backgroundColor: {
        kind: 'color',
        label: 'Gap color',
        default: '#080717',
        description: 'Color exposed between fragments.',
      },
      edgeHandling,
    },
  },

  'pixel-dissolve': {
    title: 'Pixel Dissolve',
    finish: 'image',
    description: 'Break source-colored pixels into scattered blocks and selectively dissolve them.',
    hint: 'Source colors are retained. Dissolve removes blocks; Breakup moves them. No monochrome or decorative frame is added.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      cellSize: reductionNumber(
        'Block size',
        1.5,
        0.15,
        15,
        'image-percent',
        'Size of each block relative to the shorter original image side.',
      ),
      dissolve: betaFeature(
        'Dissolve',
        0.35,
        'Fraction of seeded blocks removed from the image. Zero keeps all blocks; 100% removes all.',
      ),
      breakup: betaFeature(
        'Breakup',
        0.55,
        'Fraction of remaining blocks with displaced source content.',
      ),
      scatter: reductionNumber(
        'Scatter',
        12,
        0,
        60,
        'image-percent',
        'Maximum travel of displaced blocks relative to the shorter canvas side.',
      ),
      direction: reductionNumber(
        'Direction',
        0,
        -180,
        180,
        'degrees',
        'Rotate the dominant direction of block scatter.',
      ),
      softness: betaFeature(
        'Dissolve softness',
        0.08,
        'Smooth the opacity threshold between surviving and dissolved blocks. Zero produces a hard breakup.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment of block travel and dissolve. 0% and 100% match.',
      ),
      bias: reductionChoice(
        'Dissolve bias',
        'uniform',
        [
          ['uniform', 'Uniform'],
          ['dark', 'Dark first'],
          ['bright', 'Bright first'],
        ],
        'Favor dark or bright image blocks when dissolving, or use a uniform seeded threshold.',
      ),
      fill: reductionChoice(
        'Dissolved pixels',
        'transparent',
        [
          ['transparent', 'Transparent'],
          ['background', 'Background color'],
        ],
        'Expose transparency or fill removed blocks with the chosen background color.',
      ),
      backgroundColor: {
        kind: 'color',
        label: 'Background color',
        default: '#000000',
        description: 'Fill color when Dissolved pixels is set to Background color.',
      },
      edgeHandling,
    },
  },
  'neon-print': {
    title: 'Neon Print',
    finish: 'image',
    description:
      'Print the source with coarse stippling, dark outlines and a limited neon ink palette.',
    hint: 'Only the image treatment is generated. No grid, numbers, symbols or illustrated scene is added.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      cellSize: reductionNumber(
        'Print size',
        0.3,
        0.05,
        4,
        'image-percent',
        'Size of the coarse print cells relative to the shorter original image side.',
      ),
      grain: betaFeature(
        'Stippling',
        0.55,
        'Seeded ink and paper variation within the limited palette.',
      ),
      contrast: reductionNumber(
        'Print contrast',
        1.25,
        0.25,
        3,
        'multiplier',
        'Contrast applied before selecting the nearest ink color.',
      ),
      outlines: betaFeature('Outlines', 0.55, 'Strength of dark image-derived contour lines.'),
      outlineWidth: reductionNumber(
        'Outline width',
        0.2,
        0.05,
        2,
        'image-percent',
        'Distance used to detect image contours, relative to the shorter canvas side.',
      ),
      inkColor1: {
        kind: 'color',
        label: 'Ink 1',
        default: '#00a9e8',
        description: 'First print ink; cyan by default.',
      },
      inkColor2: {
        kind: 'color',
        label: 'Ink 2',
        default: '#f4499b',
        description: 'Second print ink; magenta by default.',
      },
      inkColor3: {
        kind: 'color',
        label: 'Ink 3',
        default: '#f6dc57',
        description: 'Third print ink; yellow by default.',
      },
      paperColor: {
        kind: 'color',
        label: 'Paper color',
        default: '#f1eee3',
        description: 'Lightest color of the print and paper speckles.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Dark ink',
        default: '#0d1e29',
        description: 'Darkest print color and image contours.',
      },
    },
  },
  'shader-chromatic-erosion': extendedImageShader(
    'Chromatic Erosion',
    'Shred the image into ragged ribbons with independently adjustable spectral contour bands.',
    false,
    8,
    {
      distortion: reductionNumber(
        'Distortion',
        9,
        0,
        30,
        'image-percent',
        'Travel of the torn image ribbons, independent of the rainbow color treatment.',
      ),
      banding: reductionNumber(
        'Color bands',
        9,
        1,
        32,
        'count',
        'Number of spectral contours across the sampled brightness range.',
      ),
      erosion: betaFeature(
        'Erosion',
        0.22,
        'Replace dark ribbon fragments with the background color. Zero keeps every fragment.',
      ),
      rotation: reductionNumber(
        'Direction',
        -15,
        -180,
        180,
        'degrees',
        'Rotate the ribbon field and displacement direction.',
      ),
      colorMix: betaFeature(
        'Spectral color',
        0.9,
        'Mix rainbow contour colors with the displaced source. Zero retains source colors.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Dark fragment color',
        default: '#000000',
        description: 'Color of retained dark contours.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Eroded background',
        default: '#ffffff',
        description: 'Color exposed by eroding a ribbon.',
      },
      edgeHandling,
    },
  ),
  'shader-bloom-field': extendedImageShader(
    'Bloom Field',
    'Scatter rotating dot flowers through a smooth seeded noise field.',
    false,
    12,
    {
      petals: reductionNumber('Petals', 5, 2, 12, 'count', 'Number of dots around each flower.'),
      radius: betaFeature(
        'Flower radius',
        0.22,
        'Distance from the flower center to its petal dots, relative to a grid cell.',
      ),
      dotSize: betaFeature('Dot size', 0.075, 'Radius of each petal dot relative to a grid cell.'),
      density: betaFeature(
        'Density',
        0.55,
        'Noise threshold controlling the fraction of cells containing a flower.',
      ),
      noiseScale: reductionNumber(
        'Cluster size',
        3,
        0.5,
        12,
        'multiplier',
        'Size of coherent flower clusters in grid cells.',
      ),
      rotation: reductionNumber(
        'Rotation',
        0,
        -180,
        180,
        'degrees',
        'Rotate the petal arrangement within each flower.',
      ),
      colorMix: betaFeature(
        'Pattern color',
        1,
        'Mix the chosen flower color with the incoming image color.',
      ),
      patternColor: {
        kind: 'color',
        label: 'Flower color',
        default: '#ffffff',
        description: 'Color of the petal dots.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Background color',
        default: '#000000',
        description: 'Color between flower clusters.',
      },
      alpha: reductionChoice(
        'Canvas',
        'source',
        [
          ['source', 'Preserve source transparency'],
          ['opaque', 'Fill canvas'],
        ],
        'Preserve the incoming silhouette or generate an opaque flower texture.',
      ),
    },
  ),
  'window-fragments': {
    title: 'Window Fragments',
    finish: 'image',
    description:
      'Overlay seeded windows containing displaced and recolored fragments of the source or an embedded image.',
    hint: 'New pattern changes the window layout. Each window samples the current input unless an optional reference image is chosen.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      count: reductionNumber(
        'Windows',
        7,
        1,
        48,
        'count',
        'Number of overlapping image fragments.',
      ),
      width: reductionNumber(
        'Window width',
        24,
        2,
        90,
        'image-percent',
        'Base window width as a percentage of the canvas width.',
      ),
      height: reductionNumber(
        'Window height',
        27,
        2,
        90,
        'image-percent',
        'Base window height as a percentage of the canvas height.',
      ),
      sizeVariation: betaFeature(
        'Size variation',
        0.45,
        'Seeded variation around the chosen width and height.',
      ),
      travel: reductionNumber(
        'Fragment displacement',
        18,
        0,
        80,
        'image-percent',
        'Maximum displacement of the content sampled inside each window.',
      ),
      zoom: reductionNumber(
        'Fragment zoom',
        1.5,
        0.25,
        6,
        'multiplier',
        'Magnification of sampled content inside each fragment.',
      ),
      colorShift: betaFeature(
        'Color shift',
        0.35,
        'Apply a different seeded channel treatment to each window.',
      ),
      borderWidth: reductionNumber(
        'Border width',
        0.2,
        0,
        2,
        'image-percent',
        'Window border width relative to the shorter canvas side.',
      ),
      borderColor: {
        kind: 'color',
        label: 'Border color',
        default: '#e9c46a',
        description: 'Color of window borders and optional corner decorations.',
      },
      decorations: reductionChoice(
        'Corner details',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Add small corner marks and a thin title strip.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment of window movement. 0% and 100% match.',
      ),
      edgeHandling,
    },
  },
  'contour-waves': {
    title: 'Contour Waves',
    finish: 'image',
    description:
      'Draw stacked lines lifted into waves by source brightness, procedural noise, or an imported height map.',
    hint: 'Use Field source to select the driver. Line count and width remain consistent between preview and export.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      lines: reductionNumber(
        'Lines',
        64,
        4,
        256,
        'count',
        'Number of stacked lines across the canvas.',
      ),
      amplitude: reductionNumber(
        'Wave height',
        8,
        0,
        35,
        'image-percent',
        'Maximum line displacement driven by the height field.',
      ),
      lineWidth: reductionNumber(
        'Line width',
        0.12,
        0.01,
        1,
        'image-percent',
        'Thickness of each line relative to the shorter original image side.',
      ),
      rotation: reductionNumber(
        'Direction',
        0,
        -180,
        180,
        'degrees',
        'Rotate the line layout across the canvas.',
      ),
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen offset in the contour pattern. 0% and 100% match.',
      ),
      sourceMix: betaFeature(
        'Source background',
        0,
        'Mix the source image into the background behind the lines.',
      ),
      colorSource: reductionChoice(
        'Line colors',
        'chosen',
        [
          ['chosen', 'Chosen color'],
          ['source', 'Source image'],
        ],
        'Use one line color or sample color from the incoming image along each line.',
      ),
      lineColor: {
        kind: 'color',
        label: 'Line color',
        default: '#ffffff',
        description: 'Color of the stacked wave lines.',
      },
      backgroundColor: {
        kind: 'color',
        label: 'Background color',
        default: '#000000',
        description: 'Color behind the lines.',
      },
    },
  },
  'shader-cellular-membrane': betaShader(
    'Cellular Membrane',
    'Refract the image through seeded cells with luminous elastic walls.',
    true,
    6,
    betaFeature('Wall width', 0.2, 'Width of the cell boundary and its colored membrane.'),
    betaFeature('Cell disorder', 0.7, 'Move cell centers away from a regular lattice.'),
    ['Cells', 'Bubbles', 'Diamond cells'],
  ),
  'shader-moire': betaShader(
    'Moiré Interference',
    'Interfere rotated lines, rings or grids into intricate geometric bands.',
    false,
    12,
    betaFeature(
      'Interference angle',
      0.12,
      'Angle between the two interfering patterns, from parallel to a quarter turn.',
    ),
    betaFeature('Contrast', 0.8, 'Sharpen the interference into graphic bands.'),
    ['Lines', 'Rings', 'Grids'],
  ),
  'shader-digital-fracture': betaShader(
    'Digital Fracture',
    'Break the source into displaced geometric shards with bright seams.',
    true,
    8,
    betaFeature('Seam width', 0.12, 'Width of illuminated gaps between displaced shards.'),
    betaFeature('Scatter', 0.7, 'Vary displacement between neighboring shards.'),
    ['Tiles', 'Strips', 'Diagonal shards'],
  ),
  'shader-diffraction': betaShader(
    'Diffraction',
    'Spread source highlights into spectral starbursts and streaks.',
    false,
    3,
    reductionNumber(
      'Ray count',
      6,
      2,
      12,
      'count',
      'Number of directions sampled around each highlight.',
    ),
    betaFeature(
      'Ray length',
      0.5,
      'Length of highlight streaks relative to the shorter image side.',
    ),
    ['Star', 'Cross', 'Spectral'],
    {
      threshold: betaFeature(
        'Highlight threshold',
        0.65,
        'Only source light above this brightness contributes to the starbursts.',
      ),
      edgeHandling,
    },
  ),
  'shader-infinity-tunnel': betaShader(
    'Infinity Tunnel',
    'Fold repeated source images into a twisted geometric tunnel.',
    true,
    3,
    reductionNumber(
      'Tunnel depth',
      5,
      1,
      12,
      'count',
      'Number of repeating scales along the tunnel.',
    ),
    betaFeature('Twist', 0.35, 'Rotate successive repetitions around the tunnel center.'),
    ['Circular', 'Square', 'Hexagonal'],
  ),
  'shader-crystal-facets': betaShader(
    'Crystal Facets',
    'Refract the source through crisp angled crystal planes.',
    true,
    7,
    betaFeature(
      'Facet bevel',
      0.25,
      'Size of the bright beveled boundaries between crystal planes.',
    ),
    betaFeature('Facet tilt', 0.6, 'Increase the directional change in refraction between planes.'),
    ['Diamonds', 'Triangles', 'Hexagonal facets'],
  ),
  'shader-circuit-matrix': betaShader(
    'Circuit Matrix',
    'Trace seeded circuits, junctions and angular connections over the image.',
    false,
    10,
    betaFeature('Trace width', 0.2, 'Thickness of the circuit paths.'),
    betaFeature('Junction glow', 0.65, 'Brightness and spread around circuit junctions.'),
    ['Right angles', 'Diagonal', 'Loops'],
  ),
  'shader-data-lattice': betaShader(
    'Data Lattice',
    'Build structured digital cells, broken data blocks and barcode fragments.',
    false,
    14,
    betaFeature('Block fill', 0.6, 'Fraction of seeded data cells that contain a visible mark.'),
    betaFeature('Corruption', 0.3, 'Break and offset the regular data lattice.'),
    ['Bits', 'Bricks', 'Barcode'],
  ),
  'shader-op-art': betaShader(
    'Op Art',
    'Bend alternating geometric fields into bold optical patterns.',
    false,
    8,
    betaFeature('Curve bend', 0.5, 'Bend the regular pattern into waves or bulging optical forms.'),
    betaFeature('Contrast', 0.9, 'Sharpen the transition between light and dark regions.'),
    ['Checker', 'Stripes', 'Concentric'],
  ),
  'shader-polar-grid': betaShader(
    'Polar Grid',
    'Overlay radial spokes, concentric rings and spiraling radar geometry.',
    false,
    6,
    reductionNumber('Spokes', 16, 3, 64, 'count', 'Number of radial divisions around the center.'),
    betaFeature('Line width', 0.15, 'Width of the radial and circular grid lines.'),
    ['Grid', 'Spiral', 'Radar'],
  ),
  'shader-caustics': extendedImageShader(
    'Caustics',
    'Interlocking pools of light form a bright underwater network.',
    false,
    3,
    {
      focus: reductionNumber(
        'Focus',
        5,
        1,
        12,
        'multiplier',
        'Concentrate broad pools into thin, bright light seams.',
      ),
      dispersion: reductionNumber(
        'Dispersion',
        0.25,
        0,
        1,
        'percent',
        'Separate the light network into subtle spectral colors. Zero keeps the light neutral.',
      ),
    },
  ),
  'shader-liquid-chrome': extendedImageShader(
    'Liquid Chrome',
    'Metallic folds refract the image and reflect its colors into bright highlights.',
    true,
    2,
    {
      shine: reductionNumber(
        'Shine',
        0.65,
        0,
        1,
        'percent',
        'Brightness of the metallic highlight ridges. Zero retains only the warped image and contrast.',
      ),
      contrast: reductionNumber(
        'Metal contrast',
        2,
        1,
        4,
        'multiplier',
        'Sharpen reflections into dark cavities and bright metal folds.',
      ),
    },
  ),
  'shader-heat-mirage': extendedImageShader(
    'Heat Mirage',
    'Layered heat turbulence shimmers along a chosen direction.',
    true,
    4,
    {
      direction: reductionNumber(
        'Direction',
        90,
        0,
        360,
        'degrees',
        'Direction in which the heat shimmer displaces the image.',
      ),
      falloff: reductionNumber(
        'Falloff',
        0.5,
        0,
        1,
        'percent',
        'Concentrate shimmer near Center Y with a soft vertical fade. Zero applies it across the canvas.',
      ),
    },
  ),
  'shader-nebula': extendedImageShader(
    'Nebula',
    'Layered cosmic clouds reveal luminous cores and dark cavities.',
    false,
    2,
    {
      strength: reductionNumber(
        'Contrast',
        1,
        0,
        2,
        'multiplier',
        'Contrast between luminous cloud forms and dark space. Zero produces a uniform cloud color.',
      ),
      detail: reductionNumber(
        'Cloud detail',
        4,
        1,
        6,
        'count',
        'Number of cloud layers. More layers add fine turbulence; fewer make broad, soft forms.',
      ),
      core: reductionNumber(
        'Core glow',
        0.65,
        0,
        1,
        'percent',
        'Strength of luminous cores inside the denser cloud regions.',
      ),
      alpha: reductionChoice(
        'Canvas',
        'source',
        [
          ['source', 'Source silhouette'],
          ['opaque', 'Whole canvas'],
        ],
        'Keep the incoming transparency, or generate an opaque nebula across the whole canvas.',
      ),
    },
  ),
  'shader-liquid-glass': originalImageShader(
    'Liquid Glass',
    'Smooth glass folds refract the image into flowing ripples.',
    true,
    3,
  ),
  'shader-flow-field': originalImageShader(
    'Flow Field',
    'A seeded curl field bends the image into coherent swirls.',
    true,
    2,
  ),
  'shader-iridescence': originalImageShader(
    'Iridescence',
    'Spectral film follows the image’s light and dark structure.',
    false,
    3,
  ),
  'shader-hologram': originalImageShader(
    'Hologram',
    'Luminous cyan interference bands and contours follow the image.',
    false,
    5,
  ),
  'shader-ripple': {
    title: 'Shader Ripple',
    description: 'Concentric liquid ripples that refract the incoming image.',
    hint: 'Phase selects a still frame of the ripple. Scale controls the number of rings; Strength controls refraction. The full image is sampled before application and painted masks are applied.',
    finish: 'image',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment in the pattern. 0% and 100% meet at the same point in its cycle. This value is saved in projects and presets.',
      ),
      scale: reductionNumber(
        'Scale',
        8,
        1,
        24,
        'multiplier',
        'Number of ripple cycles per shorter image side.',
      ),
      strength: reductionNumber(
        'Strength',
        3,
        0,
        15,
        'image-percent',
        'Maximum refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.',
      ),
      centerX: reductionNumber(
        'Center X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal ripple origin.',
      ),
      centerY: reductionNumber('Center Y', 50, 0, 100, 'image-percent', 'Vertical ripple origin.'),
      edgeHandling,
    },
  },
  'shader-plasma': {
    title: 'Shader Plasma',
    description: 'Flowing interference bands with a vivid procedural color palette.',
    hint: 'A procedural generator: Phase selects its frozen moment. Source silhouette keeps incoming transparency; Whole canvas fills it. Use tint, blending, opacity and masks to integrate it with the image.',
    finish: 'image',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      phase: reductionNumber(
        'Phase',
        0,
        0,
        1,
        'percent',
        'Select a frozen moment in the pattern. 0% and 100% meet at the same point in its cycle. This value is saved in projects and presets.',
      ),
      scale: reductionNumber(
        'Scale',
        5,
        1,
        24,
        'multiplier',
        'Density of the plasma pattern per shorter image side.',
      ),
      strength: reductionNumber(
        'Contrast',
        1,
        0,
        2,
        'multiplier',
        'Increase the contrast of the interference bands. Zero produces a uniform palette color.',
      ),
      centerX: reductionNumber(
        'Center X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal pattern origin.',
      ),
      centerY: reductionNumber('Center Y', 50, 0, 100, 'image-percent', 'Vertical pattern origin.'),
      alpha: reductionChoice(
        'Canvas',
        'source',
        [
          ['source', 'Source silhouette'],
          ['opaque', 'Whole canvas'],
        ],
        'Keep the source alpha silhouette, or generate an opaque image across the whole canvas.',
      ),
    },
  },
  'vector-corruption': {
    title: 'Vector Corruption',
    description:
      'Corrupt a seeded synthetic displacement field. This is a still-image simulation, not decoded video motion vectors.',
    hint: 'Corrupt a seeded synthetic displacement field. This is a still-image simulation, not decoded video motion vectors.',
    finish: 'image',
    parameters: {
      ...IMAGE_FINISH_PARAMETERS,
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Mix this effect with the incoming image.',
      ),
      operation: reductionChoice(
        'Operation',
        'scramble',
        [
          ['scramble', 'Scramble'],
          ['reverse', 'Reverse'],
          ['rotate', 'Rotate'],
          ['quantize', 'Quantize'],
        ],
        'Scramble directions, reverse selected vectors, rotate them by a quarter-turn or snap vectors to discrete directions.',
      ),
      strength: reductionNumber(
        'Travel',
        8,
        0,
        50,
        'image-percent',
        'Maximum displacement as a percentage of the shorter image side.',
      ),
      direction: reductionNumber(
        'Direction',
        0,
        0,
        360,
        'degrees',
        'Base travel direction in degrees; 0 is horizontal and 90 is vertical.',
      ),
      cellSize: reductionNumber(
        'Vector cell size',
        5,
        0.5,
        50,
        'image-percent',
        'Size of each vector cell relative to the shorter original-image side.',
      ),
      coherence: reductionNumber(
        'Coherence',
        0.75,
        0,
        1,
        'percent',
        'Group vector directions into coherent larger regions. Zero gives independent cells.',
      ),
      density: reductionNumber(
        'Corruption density',
        0.7,
        0,
        1,
        'percent',
        'Fraction of vector cells affected. Zero preserves the source exactly.',
      ),
      quantization: reductionNumber(
        'Directions',
        8,
        2,
        32,
        'count',
        'Number of direction steps for Quantize.',
      ),
      edgeHandling: reductionChoice(
        'Edges',
        'extend',
        [
          ['extend', 'Extend'],
          ['wrap', 'Tile / Wrap'],
          ['mirror', 'Mirror'],
        ],
        'Choose how samples outside the image are filled. Tile wraps to the opposite edge.',
      ),
    },
  },
  'reference-mosh': {
    title: 'Reference / Cross-image Mosh',
    description:
      'Break a still-image transition using an embedded reference image or frozen saved stage.',
    hint: 'Break a still-image transition using an embedded reference image or frozen saved stage.',
    finish: 'image',
    parameters: {
      ...IMAGE_FINISH_PARAMETERS,
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Mix this effect with the incoming image.',
      ),
      style: reductionChoice(
        'Style',
        'patches',
        [
          ['patches', 'Retained patches'],
          ['dissolve', 'Broken dissolve'],
          ['drag', 'Dragged patches'],
        ],
        'Replace seeded patches, softly transition between inputs or drag reference patches through the current image.',
      ),
      progression: reductionNumber(
        'Progression',
        0.5,
        0,
        1,
        'percent',
        'Scrub selected patches from the incoming image at 0% to the reference at 100%. Unselected patches remain unchanged; Replacement density at 100% allows a full transition. Patch identities stay stable while scrubbing.',
      ),
      persistence: reductionNumber(
        'Persistence',
        0.6,
        0,
        1,
        'percent',
        'Delay replacement of strongly retained patches until later in the transition.',
      ),
      replacementDensity: reductionNumber(
        'Replacement density',
        1,
        0,
        1,
        'percent',
        'Fraction of patches allowed to change. Progression advances only those patches; at 100% progression, unselected patches still retain the incoming image. New pattern changes the selection.',
      ),
      patchSize: reductionNumber(
        'Patch size',
        8,
        0.5,
        50,
        'image-percent',
        'Size of retained patches relative to the shorter original-image side.',
      ),
      travel: reductionNumber(
        'Drag distance',
        10,
        0,
        50,
        'image-percent',
        'Travel of reference patches during the transition; the final reference returns to its original position.',
      ),
      direction: reductionNumber(
        'Direction',
        0,
        0,
        360,
        'degrees',
        'Direction of dragged reference patches.',
      ),
      placement: reductionChoice(
        'Reference placement',
        'fill',
        [
          ['fit', 'Fit'],
          ['fill', 'Fill'],
          ['stretch', 'Stretch'],
        ],
        'Fit preserves the whole reference with transparent margins; Fill crops while preserving aspect; Stretch fills the canvas.',
      ),
      referenceX: reductionNumber(
        'Reference position X',
        0,
        -100,
        100,
        'image-percent',
        'Move the reference image horizontally as a percentage of the canvas width. Zero centers it; positive values move it right.',
      ),
      referenceY: reductionNumber(
        'Reference position Y',
        0,
        -100,
        100,
        'image-percent',
        'Move the reference image vertically as a percentage of the canvas height. Zero centers it; positive values move it down.',
      ),
      edgeHandling: reductionChoice(
        'Edges',
        'extend',
        [
          ['extend', 'Extend'],
          ['wrap', 'Tile / Wrap'],
          ['mirror', 'Mirror'],
        ],
        'Choose how samples outside the image are filled. Tile wraps to the opposite edge.',
      ),
    },
  },
  'motion-transfer': {
    title: 'Motion Transfer',
    description:
      'Displace the image using an explicitly imported vector or grayscale map. No video or motion extraction is required.',
    hint: 'Displace the image using an explicitly imported vector or grayscale map. No video or motion extraction is required.',
    finish: 'image',
    parameters: {
      ...IMAGE_FINISH_PARAMETERS,
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Mix this effect with the incoming image.',
      ),
      encoding: reductionChoice(
        'Map encoding',
        'rg',
        [
          ['rg', 'Red / Green vectors'],
          ['luma', 'Grayscale direction'],
          ['gradient', 'Grayscale slopes'],
        ],
        'Red / Green uses R for horizontal and G for vertical displacement, with 128 exactly neutral. Grayscale direction uses brightness about mid-gray; Slopes uses changes in brightness.',
      ),
      strength: reductionNumber(
        'Travel',
        10,
        0,
        50,
        'image-percent',
        'Maximum displacement as a percentage of the shorter image side. Transparent map pixels are neutral.',
      ),
      direction: reductionNumber(
        'Direction',
        0,
        0,
        360,
        'degrees',
        'Travel direction for Grayscale direction maps.',
      ),
      mapScale: reductionNumber(
        'Map scale',
        100,
        10,
        400,
        'image-percent',
        'Scale the map about its position. 100% maps the full input across the image.',
      ),
      mapX: reductionNumber(
        'Map position X',
        50,
        -100,
        200,
        'image-percent',
        'Horizontal map position in the stage canvas.',
      ),
      mapY: reductionNumber(
        'Map position Y',
        50,
        -100,
        200,
        'image-percent',
        'Vertical map position in the stage canvas.',
      ),
      mapRotation: reductionNumber(
        'Map rotation',
        0,
        -180,
        180,
        'degrees',
        'Rotate map coordinates around its position; vector directions follow the same rotation.',
      ),
      invertX: reductionChoice(
        'Invert horizontal',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Reverse horizontal displacement.',
      ),
      invertY: reductionChoice(
        'Invert vertical',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Reverse vertical displacement.',
      ),
      edgeHandling: reductionChoice(
        'Edges',
        'extend',
        [
          ['extend', 'Extend'],
          ['wrap', 'Tile / Wrap'],
          ['mirror', 'Mirror'],
        ],
        'Choose how samples outside the image are filled. Tile wraps to the opposite edge.',
      ),
    },
  },
  'depth-parallax': {
    title: 'Depth Parallax / Push-Pull',
    description:
      'Use a static height field for simulated parallax, depth-dependent scale or torn depth slices.',
    hint: 'Use a static height field for simulated parallax, depth-dependent scale or torn depth slices.',
    finish: 'image',
    parameters: {
      ...IMAGE_FINISH_PARAMETERS,
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Mix this effect with the incoming image.',
      ),
      style: reductionChoice(
        'Style',
        'parallax',
        [
          ['parallax', 'Parallax'],
          ['push-pull', 'Push / Pull'],
          ['tearing', 'Depth tearing'],
        ],
        'Parallax shifts layers relative to a focus plane; Push / Pull scales by depth; Tearing shifts discrete depth bands. These are 2.5D approximations.',
      ),
      cameraX: reductionNumber(
        'Camera X',
        12,
        -50,
        50,
        'image-percent',
        'Horizontal depth-dependent travel relative to the shorter image side.',
      ),
      cameraY: reductionNumber(
        'Camera Y',
        0,
        -50,
        50,
        'image-percent',
        'Vertical depth-dependent travel relative to the shorter image side.',
      ),
      focusDepth: reductionNumber(
        'Focus depth',
        0.5,
        0,
        1,
        'percent',
        'Height plane that stays still. White is near/high and black is far/low.',
      ),
      strength: reductionNumber(
        'Push / Pull',
        0.6,
        -1.5,
        1.5,
        'multiplier',
        'Depth-dependent scale around the center. Positive expands near areas and contracts far areas.',
      ),
      nearStrength: reductionNumber(
        'Near push strength',
        1,
        0,
        3,
        'multiplier',
        'Scale the near/high side of Push / Pull independently. Zero leaves near areas unchanged; 1× retains the original Push / Pull strength.',
      ),
      farStrength: reductionNumber(
        'Far pull strength',
        1,
        0,
        3,
        'multiplier',
        'Scale the far/low side of Push / Pull independently. Zero leaves far areas unchanged. Negative overall Push / Pull reverses both directions.',
      ),
      bands: reductionNumber(
        'Depth bands',
        12,
        2,
        64,
        'count',
        'Number of discrete height slices for Tearing.',
      ),
      scatter: reductionNumber(
        'Band scatter',
        0.5,
        0,
        1,
        'percent',
        'Seeded additional offsets of torn depth bands.',
      ),
      centerX: reductionNumber(
        'Center X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal scaling center for Push / Pull.',
      ),
      centerY: reductionNumber(
        'Center Y',
        50,
        0,
        100,
        'image-percent',
        'Vertical scaling center for Push / Pull.',
      ),
      edges: reductionChoice(
        'Edges',
        'transparent',
        [
          ['transparent', 'Transparent'],
          ['extend', 'Extend'],
          ['wrap', 'Tile / Wrap'],
          ['mirror', 'Mirror'],
        ],
        'Choose transparent clipping, extended edge pixels, tiled wrapping or mirrored pixels.',
      ),
    },
  },
  'depth-haze': {
    title: 'Depth Haze',
    description:
      'Blend fog into distant areas of a static depth field while preserving source transparency.',
    hint: 'Blend fog into distant areas of a static depth field while preserving source transparency.',
    finish: 'image',
    parameters: {
      ...IMAGE_FINISH_PARAMETERS,
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Mix this effect with the incoming image.',
      ),
      density: reductionNumber(
        'Fog density',
        0.75,
        0,
        1,
        'percent',
        'Maximum fog opacity at the far end of the selected distance range.',
      ),
      start: reductionNumber(
        'Fog start',
        0.15,
        0,
        1,
        'percent',
        'Distance at which fog begins: 0 is near/white, 100% is far/black.',
      ),
      end: reductionNumber(
        'Fog end',
        0.9,
        0,
        1,
        'percent',
        'Distance at which fog reaches full density. Endpoints may be crossed; their sorted range is used.',
      ),
      falloff: reductionNumber(
        'Fog falloff',
        1.5,
        0.1,
        8,
        'multiplier',
        'Shape the fog increase: higher values concentrate fog farther away.',
      ),
      fogColor: {
        kind: 'color',
        label: 'Fog color',
        default: '#b5dce5',
        gradient: 'spatial',
        description: 'Choose a fog color or a multi-stop gradient fixed to the stage canvas.',
      },
    },
  },
  'depth-color-map': {
    title: 'Depth Color Mapping',
    description: 'Map white-near / black-far height values to a multi-stop color ramp.',
    hint: 'Map white-near / black-far height values to a multi-stop color ramp.',
    finish: 'image',
    parameters: {
      ...IMAGE_FINISH_PARAMETERS,
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Mix this effect with the incoming image.',
      ),
      depthColor: {
        kind: 'color',
        label: 'Depth palette',
        default: '#241050',
        gradient: 'field',
        description:
          'Map far/black areas to the start color and near/white areas to the end color. Intermediate stops define depth bands.',
      },
      reverse: reductionChoice(
        'Reverse palette',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Swap the near and far palette direction without changing the height field.',
      ),
      shading: reductionNumber(
        'Preserve shading',
        0.25,
        0,
        1,
        'percent',
        'Retain source luminance within the mapped palette. Zero uses the pure depth colors.',
      ),
    },
  },
  cutout: {
    title: 'Subject / Depth / Hybrid Cutout',
    description:
      'Remove pixels using detected subject coverage, a height interval or both. The mask stays in static stage coordinates.',
    hint: 'Remove pixels using detected subject coverage, a height interval or both. The mask stays in static stage coordinates.',
    finish: 'image',
    parameters: {
      ...IMAGE_FINISH_PARAMETERS,
      fillHoles: reductionChoice(
        'Fill holes',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Fill enclosed holes in the cutout mask. Open background connected to the canvas border remains outside.',
      ),
      removeSpecks: reductionNumber(
        'Remove specks',
        0,
        0,
        5,
        'image-percent',
        'Remove disconnected foreground islands smaller than this percentage of the mask area. Zero preserves every island.',
      ),
      cleanupSmoothing: reductionNumber(
        'Cleanup smoothing',
        0,
        0,
        5,
        'image-percent',
        'Smooth jagged mask edges in canvas space. Radius is a percentage of the shorter source side.',
      ),
      expand: reductionNumber(
        'Expand / Contract',
        0,
        -10,
        10,
        'image-percent',
        'Move the actual cutout boundary. Positive expands the retained region; negative contracts it. Measured against the shorter source side.',
      ),
      feather: reductionNumber(
        'Spatial feather',
        0,
        0,
        10,
        'image-percent',
        'Feather the cleaned boundary in canvas space. Edge softness instead changes the subject/depth confidence threshold.',
      ),

      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Mix this effect with the incoming image.',
      ),
      mode: reductionChoice(
        'Cutout source',
        'depth',
        [
          ['subject', 'Detected subject'],
          ['depth', 'Depth range'],
          ['hybrid', 'Subject + depth'],
        ],
        'Detect a subject in a photo, select a height range or combine both sources. Baking makes the cutout part of later distorted content.',
      ),
      keep: reductionChoice(
        'Keep',
        'inside',
        [
          ['inside', 'Selected region'],
          ['outside', 'Outside region'],
        ],
        'Keep the selected subject/depth region or its complement.',
      ),
      near: reductionNumber(
        'Near limit',
        1,
        0,
        1,
        'percent',
        'Upper height boundary. White is near/high. The two limits are sorted when crossed.',
      ),
      far: reductionNumber(
        'Far limit',
        0.3,
        0,
        1,
        'percent',
        'Lower height boundary. Black is far/low.',
      ),
      softness: reductionNumber(
        'Edge softness',
        0.05,
        0,
        0.5,
        'percent',
        'Feather subject and depth boundaries. Zero makes a hard clipped selection.',
      ),
      subjectThreshold: reductionNumber(
        'Subject threshold',
        0.5,
        0,
        1,
        'percent',
        'Confidence boundary for the detected subject.',
      ),
      combine: reductionChoice(
        'Combine masks',
        'intersect',
        [
          ['intersect', 'Intersection'],
          ['union', 'Union'],
        ],
        'Intersection keeps pixels present in both masks; Union keeps pixels in either mask.',
      ),
    },
  },
  'lens-distortion': {
    title: 'Lens Distortion',
    description:
      'Smooth barrel or pincushion distortion with an adjustable optical center and edge handling.',
    hint: 'Smooth barrel or pincushion distortion with an adjustable optical center and edge handling.',
    finish: 'image',
    parameters: {
      ...IMAGE_FINISH_PARAMETERS,
      amount: reductionNumber(
        'Opacity',
        1,
        0,
        1,
        'percent',
        'Mix this effect with the incoming image.',
      ),
      distortion: reductionNumber(
        'Barrel / Pincushion',
        0.25,
        -0.8,
        0.8,
        'multiplier',
        'Positive values produce barrel distortion; negative values produce pincushion distortion. Zero is neutral when the secondary term is also zero.',
      ),
      secondary: reductionNumber(
        'Outer curvature',
        0,
        -0.5,
        0.5,
        'multiplier',
        'Additional curvature that increases toward the perimeter.',
      ),
      centerX: reductionNumber(
        'Optical center X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal optical center.',
      ),
      centerY: reductionNumber(
        'Optical center Y',
        50,
        0,
        100,
        'image-percent',
        'Vertical optical center.',
      ),
      zoom: reductionNumber(
        'Zoom',
        100,
        25,
        300,
        'image-percent',
        'Magnify the result to crop transparent lens margins or reveal more of the image.',
      ),
      edges: reductionChoice(
        'Edges',
        'transparent',
        [
          ['transparent', 'Transparent'],
          ['extend', 'Extend'],
          ['wrap', 'Tile / Wrap'],
          ['mirror', 'Mirror'],
        ],
        'Choose transparent clipping, extended edge pixels, tiled wrapping or mirrored pixels.',
      ),
    },
  },
  'bit-damage': {
    title: 'Advanced Bit Damage',
    finish: 'image',
    description: 'Corrupt selected bit planes in individual color channels or transparency.',
    hint: 'Bit 0 is the least significant bit; bit 7 changes the largest values. Low/High bit select an inclusive range even when reversed. Visualize displays that range without changing hidden RGB. Alpha damage can cut transparency; newly revealed pixels use black rather than hidden source colors.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      operation: reductionChoice(
        'Operation',
        'flip',
        [
          ['flip', 'Flip'],
          ['clear', 'Clear'],
          ['set', 'Set'],
          ['shift', 'Shift'],
          ['rotate', 'Rotate'],
          ['scramble', 'Scramble'],
          ['isolate', 'Isolate'],
          ['swap', 'Swap bit pair'],
          ['xor', 'XOR'],
          ['and', 'AND'],
          ['or', 'OR'],
          ['inject', 'Random bit injection'],
          ['byte-scramble', 'Byte scramble'],
          ['crossfeed', 'Channel crossfeed'],
        ],
        'Modify selected bit planes. Shift/Rotate/Scramble operate among selected planes; Isolate erases all other bits. Swap uses two selected indices; XOR/AND/OR use Operand. Injection replaces bits, Byte scramble reorders cells and Crossfeed reads Source channel.',
      ),
      target: reductionChoice(
        'Target',
        'rgb',
        [
          ['rgb', 'RGB'],
          ['rgba', 'RGBA'],
          ['luma', 'Luma'],
          ['red', 'Red'],
          ['green', 'Green'],
          ['blue', 'Blue'],
          ['alpha', 'Alpha'],
        ],
        'Choose which encoded 8-bit channels to process. Alpha modifies transparency; Visualize on Alpha shows its selected planes as gray while preserving transparency.',
      ),
      lowBit: reductionNumber(
        'Low bit',
        5,
        0,
        7,
        'count',
        'First bit in the inclusive selected range, counted from zero. Reversed endpoints are sorted automatically.',
      ),
      highBit: reductionNumber(
        'High bit',
        7,
        0,
        7,
        'count',
        'Last bit in the inclusive selected range. Bit 7 has the strongest visible effect.',
      ),
      shift: reductionNumber(
        'Bit shift',
        1,
        -7,
        7,
        'count',
        'Positive moves selected bits toward larger values; negative toward smaller values. Rotate wraps within the range; Shift discards bits that leave it.',
      ),
      density: reductionNumber(
        'Damage density',
        0.35,
        0,
        1,
        'percent',
        'Fraction of seeded cells affected. Zero preserves the source exactly; 100% processes every cell.',
      ),
      cellSize: reductionNumber(
        'Cell size',
        8,
        1,
        256,
        'count',
        'Width and height of damage cells in original-image pixels. Larger cells group corruption into patches.',
      ),
      visualize: reductionChoice(
        'Visualize planes',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Display the selected range stretched to full brightness instead of applying the operation. Untargeted channels stay unchanged.',
      ),
      bitSelection: reductionChoice(
        'Bit selection',
        'range',
        [
          ['range', 'Range'],
          ['custom', 'Custom planes'],
        ],
        'Select a continuous Low/High range or individually choose any of the eight bit planes.',
      ),
      bitMask: reductionNumber(
        'Selected planes',
        255,
        0,
        255,
        'count',
        'Bit mask for custom selection. Each enabled plane participates; all unselected planes are preserved except with Isolate.',
      ),
      swapBitA: reductionNumber(
        'First swap bit',
        5,
        0,
        7,
        'count',
        'First absolute bit index to swap. Both swap bits must be included in the selected planes.',
      ),
      swapBitB: reductionNumber(
        'Second swap bit',
        7,
        0,
        7,
        'count',
        'Second absolute bit index to swap. Equal indices leave the byte unchanged.',
      ),
      operand: reductionNumber(
        'Operand',
        128,
        0,
        255,
        'count',
        'Saved 8-bit value for XOR, AND or OR. Only selected planes are modified.',
      ),
      sourceChannel: reductionChoice(
        'Source channel',
        'red',
        [
          ['red', 'Red'],
          ['green', 'Green'],
          ['blue', 'Blue'],
          ['alpha', 'Alpha'],
          ['luma', 'Luma'],
        ],
        'Copy the selected bit planes from this input channel into the target channels. Reads original input values, so RGBA processing cannot feed back on itself.',
      ),
      probability: reductionNumber(
        'Bit probability',
        1,
        0,
        1,
        'percent',
        'Within damaged cells, independently choose which selected bits receive the operation. Zero preserves the source; 100% applies every selected bit.',
      ),
      burstLength: reductionNumber(
        'Burst length',
        1,
        1,
        64,
        'count',
        'Length of horizontal damage runs in cells. With clustering, neighbors share damage decisions. Byte scramble reorders whole input bytes within runs of at least two cells.',
      ),
      clustering: reductionNumber(
        'Damage clustering',
        0,
        0,
        1,
        'percent',
        'Blend independent cell selection with shared decisions across horizontal bursts and three adjacent cell rows. Density still controls the damaged fraction.',
      ),
    },
  },
  'freeze-dropout': {
    title: 'Freeze / Dropout',
    finish: 'image',
    description:
      'Simulate stuck patches, duplicated blocks, missing regions and noisy decoder failures.',
    hint: 'Freeze holds selected patches at an earlier simulated translation while the rest advances. Duplicate reuses offset patches; Blank and Noise replace selected blocks. All samples come from this filter input, so previews, exports and saved projects reproduce the same still image.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: reductionChoice(
        'Style',
        'freeze',
        [
          ['freeze', 'Freeze'],
          ['duplicate', 'Duplicate'],
          ['blank', 'Blank'],
          ['noise', 'Noise'],
        ],
        'Choose retained earlier patches, randomly displaced copies, colored dropout regions, or seeded colored noise.',
      ),
      patchSize: reductionNumber(
        'Patch size',
        6,
        0.1,
        50,
        'image-percent',
        'Square patch size as a percentage of the shorter original-image side.',
      ),
      density: reductionNumber(
        'Failure density',
        0.3,
        0,
        1,
        'percent',
        'Control how many patches fail. Zero preserves the input exactly; 100% selects every patch.',
      ),
      clustering: reductionNumber(
        'Clustering',
        0.5,
        0,
        1,
        'percent',
        'Group failure decisions into larger neighborhoods. Zero selects independently; 100% shares selection across three-by-three patch clusters.',
      ),
      steps: reductionNumber(
        'Simulated steps',
        8,
        1,
        32,
        'count',
        'Number of translation steps reached by the moving background in Freeze. This is a reproducible still-image simulation.',
      ),
      holdAge: reductionNumber(
        'Hold age',
        4,
        0,
        32,
        'count',
        'How many simulated steps selected patches lag behind, capped at Simulated steps. Zero catches all patches up.',
      ),
      travel: reductionNumber(
        'Travel per step',
        1,
        0,
        10,
        'image-percent',
        'Translation per simulated step, as a percentage of the shorter image side. Duplicate uses Travel times Simulated steps for its offset distance.',
      ),
      direction: reductionNumber(
        'Direction',
        0,
        0,
        360,
        'coordinate',
        'Direction of travel: 0 degrees moves right; 90 moves down.',
      ),
      scatter: reductionNumber(
        'Scatter',
        0.3,
        0,
        1,
        'percent',
        'Vary duplicated patch offsets around Direction by a seeded amount. Zero uses one uniform offset.',
      ),
      positionX: reductionNumber(
        'Grid position X',
        0,
        -100,
        100,
        'image-percent',
        'Move the patch grid horizontally as a percentage of image width.',
      ),
      positionY: reductionNumber(
        'Grid position Y',
        0,
        -100,
        100,
        'image-percent',
        'Move the patch grid vertically as a percentage of image height.',
      ),
      dropoutColor: {
        kind: 'color',
        label: 'Dropout color',
        default: '#000000',
        gradient: 'spatial',
        description:
          'Color or gradient filling Blank patches. Input transparency stays fixed unless Clear transparency is on.',
      },
      clearAlpha: reductionChoice(
        'Clear transparency',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Make Blank patches transparent instead of colored. Opacity and masks can soften the cutout.',
      ),
      edgeHandling,
    },
  },
  'photo-adjustments': {
    title: 'Photo Adjustments',
    finish: 'image',
    description:
      'Adjust exposure, tonal contrast, highlights, shadows, vibrance and white balance.',
    hint: 'Exposure and white balance operate in linear light; tone and vibrance controls shape the displayed RGB. Temperature is a relative warm/cool adjustment, not a calibrated camera Kelvin reading. Neutral controls preserve exact source bytes.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      exposure: reductionNumber(
        'Exposure',
        0.25,
        -4,
        4,
        'coordinate',
        'Exposure in stops: +1 doubles linear-light intensity; -1 halves it.',
      ),
      contrast: reductionNumber(
        'Contrast',
        0.1,
        -1,
        1,
        'percent',
        'Increase or reduce contrast around mid-gray. Zero keeps contrast unchanged.',
      ),
      highlights: reductionNumber(
        'Highlights',
        -0.1,
        -1,
        1,
        'percent',
        'Lift or lower bright tones with a smooth luminance-weighted adjustment.',
      ),
      shadows: reductionNumber(
        'Shadows',
        0.1,
        -1,
        1,
        'percent',
        'Lift or deepen dark tones with a smooth luminance-weighted adjustment.',
      ),
      vibrance: reductionNumber(
        'Vibrance',
        0.15,
        -1,
        1,
        'percent',
        'Boost muted colors more than already saturated colors; negative values reduce saturation. Grays remain gray.',
      ),
      temperature: reductionNumber(
        'Temperature',
        0,
        -1,
        1,
        'percent',
        'Shift white balance toward cool blue or warm amber using relative linear-light channel gains.',
      ),
      tint: reductionNumber(
        'White balance tint',
        0,
        -1,
        1,
        'percent',
        'Shift white balance toward green or magenta. This is separate from the shared artistic Tint color.',
      ),
    },
  },
  detail: {
    title: 'Detail / Sharpen / Clarity',
    finish: 'image',
    description: 'Sharpen fine edges and adjust broader local contrast.',
    hint: 'Sharpen uses an alpha-aware unsharp mask. Clarity applies broader luminance contrast, weighted toward midtones. Negative values soften detail. Source transparency remains fixed; hidden transparent colors do not create fringes.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      sharpen: reductionNumber(
        'Sharpen',
        0.7,
        -1,
        3,
        'multiplier',
        'Add or subtract fine detail relative to the blurred source. Negative values soften; zero disables fine sharpening.',
      ),
      radius: reductionNumber(
        'Sharpen radius',
        1.5,
        0.1,
        20,
        'coordinate',
        'Fine-detail radius in original-image pixels; scales with draft previews.',
      ),
      threshold: reductionNumber(
        'Detail threshold',
        0.01,
        0,
        0.3,
        'percent',
        'Suppress sharpening of differences below this brightness threshold, reducing amplification of tiny noise.',
      ),
      clarity: reductionNumber(
        'Clarity',
        0.3,
        -1,
        1,
        'percent',
        'Add or subtract broad luminance detail, weighted toward midtones. Zero disables clarity.',
      ),
      clarityRadius: reductionNumber(
        'Clarity radius',
        2,
        0.1,
        15,
        'image-percent',
        'Broad local-contrast radius as a percentage of the shorter image side.',
      ),
      edgeHandling,
    },
  },
  halation: {
    title: 'Halation',
    finish: 'image',
    description: 'Spread a colored photographic halo from bright regions into darker surroundings.',
    hint: 'A still-image film halation treatment. Highlight energy is spread with a soft linear-time blur and suppressed in bright centers to emphasize surrounding halos. Source alpha stays fixed.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      strength: reductionNumber(
        'Halo strength',
        1.5,
        0,
        5,
        'multiplier',
        'Intensity of colored highlight spill. Zero preserves the source exactly.',
      ),
      radius: reductionNumber(
        'Halo radius',
        1,
        0.1,
        10,
        'image-percent',
        'Spread radius as a percentage of the shorter image side. Larger values create broader soft halos.',
      ),
      threshold: reductionNumber(
        'Highlight threshold',
        0.65,
        0,
        1,
        'percent',
        'Brightness above which visible image pixels generate halo energy.',
      ),
      knee: reductionNumber(
        'Highlight softness',
        0.15,
        0,
        0.5,
        'percent',
        'Soften the transition into highlight selection. Zero uses a hard threshold.',
      ),
      edgeBias: reductionNumber(
        'Dark-side bias',
        0.85,
        0,
        1,
        'percent',
        'Suppress halos in bright centers and favor their darker surroundings. Zero allows spill across all tones.',
      ),
      haloColor: {
        kind: 'color',
        label: 'Halo color',
        default: '#ff4820',
        gradient: 'spatial',
        description:
          'Color or multi-stop gradient of the halo. The default creates warm red-orange film-like spill.',
      },
      edgeHandling,
    },
  },
  vignette: {
    title: 'Vignette',
    finish: 'image',
    description: 'Apply a positioned, feathered elliptical or circular color vignette.',
    hint: 'Size sets the outer boundary measured from the center to the middle of each image edge. Roundness moves from a canvas-fitting ellipse to a true circle. A zero-softness edge is hard clipped; gradients stay fixed to the canvas.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      strength: reductionNumber(
        'Vignette strength',
        0.65,
        0,
        1,
        'percent',
        'Mix the vignette color into the selected region. Zero preserves the source exactly.',
      ),
      size: reductionNumber(
        'Size',
        1,
        0.1,
        2,
        'multiplier',
        'Outer radius relative to half the canvas dimensions. Increase to move the vignette farther toward the corners.',
      ),
      softness: reductionNumber(
        'Feather',
        0.6,
        0,
        1,
        'percent',
        'Fraction of the radius used for smooth falloff. Zero makes a hard edge.',
      ),
      roundness: reductionNumber(
        'Roundness',
        0,
        0,
        1,
        'percent',
        'Zero fits an ellipse to the canvas; 100% uses a circle based on the shorter side.',
      ),
      centerX: reductionNumber(
        'Center X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal position of the vignette center.',
      ),
      centerY: reductionNumber(
        'Center Y',
        50,
        0,
        100,
        'image-percent',
        'Vertical position of the vignette center.',
      ),
      rotation: reductionNumber(
        'Rotation',
        0,
        -180,
        180,
        'coordinate',
        'Rotate the ellipse around its center. A true circle is unchanged by rotation.',
      ),
      invert: reductionChoice(
        'Invert',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Apply color to the center instead of the outside.',
      ),
      vignetteColor: {
        kind: 'color',
        label: 'Vignette color',
        default: '#000000',
        gradient: 'spatial',
        description:
          'Choose a dark, light or colored vignette, or a multi-stop gradient. Source transparency stays fixed.',
      },
    },
  },
  'channel-transform': {
    title: 'Channel Transform',
    finish: 'image',
    description:
      'Transform red, green and blue independently, then swap or mix their source channels.',
    hint: 'Choose an editing channel to adjust its position, scale, rotation and mirror. Source routes another channel into it; Crossfeed blends that routing with its own channel. Geometry follows the shared pivot; image transparency stays in place.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      crossfeed: reductionNumber(
        'Crossfeed',
        1,
        0,
        1,
        'percent',
        'Mix each transformed channel with its selected Source. Zero uses its own channel; 100% uses the chosen source. Route one source to several destinations to duplicate a channel.',
      ),
      centerX: reductionNumber(
        'Pivot X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal pivot for all channel scale, rotation and mirroring, as a percentage of image width.',
      ),
      centerY: reductionNumber(
        'Pivot Y',
        50,
        0,
        100,
        'image-percent',
        'Vertical pivot for all channel scale, rotation and mirroring, as a percentage of image height.',
      ),
      ...Object.fromEntries(
        CHANNELS.flatMap((channel) => {
          const title = channel[0]!.toUpperCase() + channel.slice(1);
          return [
            [
              `${channel}X`,
              reductionNumber(
                `${title} position X`,
                channel === 'red' ? -2 : channel === 'blue' ? 2 : 0,
                -100,
                100,
                'image-percent',
                'Move this channel horizontally as a percentage of image width. Positive moves right.',
              ),
            ],
            [
              `${channel}Y`,
              reductionNumber(
                `${title} position Y`,
                0,
                -100,
                100,
                'image-percent',
                'Move this channel vertically as a percentage of image height. Positive moves down.',
              ),
            ],
            [
              `${channel}Scale`,
              reductionNumber(
                `${title} scale`,
                100,
                25,
                400,
                'image-percent',
                'Scale this channel around the shared pivot. 100% keeps its original size.',
              ),
            ],
            [
              `${channel}Rotation`,
              {
                kind: 'number',
                label: `${title} rotation`,
                default: 0,
                min: -180,
                max: 180,
                step: 1,
                unit: 'degrees',
                description: 'Rotate this channel clockwise around the shared pivot.',
              } satisfies ParameterDefinition,
            ],
            [
              `${channel}Mirror`,
              reductionChoice(
                `${title} mirror`,
                'off',
                [
                  ['off', 'Off'],
                  ['horizontal', 'Horizontal'],
                  ['vertical', 'Vertical'],
                  ['both', 'Both'],
                ],
                'Mirror this channel around the shared pivot before scaling and rotation.',
              ),
            ],
            [
              `${channel}Source`,
              reductionChoice(
                `${title} source`,
                channel,
                [
                  ['red', 'Red'],
                  ['green', 'Green'],
                  ['blue', 'Blue'],
                  ['luma', 'Luminance'],
                ],
                'Choose the channel sampled through this destination transform. Crossfeed controls how much of this source is used.',
              ),
            ],
          ];
        }),
      ),
      edgeHandling,
    },
  },
  'temporal-echo': {
    title: 'Temporal Echo',
    finish: 'image',
    description: 'Overlay fading image copies, color-separated trails or colored silhouettes.',
    hint: 'Each echo samples this filter input with another step of translation, scale and rotation. Echoes never sample the live preview. Clip copies makes areas outside the copied image transparent; turn it off to use Edge Handling.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: reductionChoice(
        'Style',
        'copies',
        [
          ['copies', 'Image copies'],
          ['color-separated', 'Color-separated'],
          ['silhouette', 'Silhouettes'],
        ],
        'Keep copied image colors, cycle red/green/blue echoes, or replace copied colors with Echo color. Silhouettes follow input transparency; an opaque image gives full-frame silhouettes.',
      ),
      copies: reductionNumber(
        'Copies',
        5,
        1,
        24,
        'count',
        'Number of transformed echoes overlaid on the original image.',
      ),
      strength: reductionNumber(
        'Echo opacity',
        0.55,
        0,
        1,
        'percent',
        'Opacity of the nearest echo before overall filter Opacity. Zero leaves the original image.',
      ),
      spacing: reductionNumber(
        'Spacing',
        4,
        0,
        25,
        'image-percent',
        'Travel added for each echo, as a percentage of the shorter image side.',
      ),
      direction: {
        kind: 'number',
        label: 'Direction',
        default: 180,
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        description: 'Direction of echo travel. Zero moves right, 90 down and 180 left.',
      },
      falloff: reductionNumber(
        'Falloff',
        0.65,
        0,
        1,
        'percent',
        'Opacity retained at each additional echo. Zero keeps only the nearest copy; 100% gives every copy the same opacity.',
      ),
      scaleStep: reductionNumber(
        'Scale per echo',
        1,
        0.85,
        1.15,
        'multiplier',
        'Multiply image scale at each echo around the pivot. Below one shrinks successive copies; above one enlarges them.',
      ),
      rotationStep: {
        kind: 'number',
        label: 'Rotation per echo',
        default: 0,
        min: -45,
        max: 45,
        step: 1,
        unit: 'degrees',
        description: 'Clockwise rotation added at each echo around the pivot.',
      },
      centerX: reductionNumber(
        'Pivot X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal pivot for echo scale and rotation.',
      ),
      centerY: reductionNumber(
        'Pivot Y',
        50,
        0,
        100,
        'image-percent',
        'Vertical pivot for echo scale and rotation.',
      ),
      jitter: reductionNumber(
        'Position jitter',
        0,
        0,
        1,
        'percent',
        'Add seeded offset variation up to one spacing step to each copy. New pattern changes the offsets without changing the recipe controls.',
      ),
      channelStart: reductionChoice(
        'First echo channel',
        'red',
        [
          ['red', 'Red'],
          ['green', 'Green'],
          ['blue', 'Blue'],
        ],
        'First color-separated echo channel. Subsequent copies cycle through the other two channels.',
      ),
      echoColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Echo color',
        default: '#ffcf88',
        description:
          'Solid or canvas-positioned multi-stop gradient used by Silhouettes. Copied alpha defines the shape; Tint colors the entire result separately.',
      },
      clipCopies: reductionChoice(
        'Clip copies',
        'on',
        [
          ['on', 'On'],
          ['off', 'Off'],
        ],
        'On makes areas outside each transformed source rectangle transparent. Off samples those areas using Edge Handling.',
      ),
      edgeHandling,
    },
  },
  'signal-tearing': {
    title: 'Signal Tearing',
    finish: 'image',
    description: 'Displace the image in angled slices, clustered bursts or stair steps.',
    hint: 'Slice angle sets the band layout; Direction sets where the image moves. New pattern changes the tear locations. An optional depth field steers the displacement locally.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: reductionChoice(
        'Style',
        'slices',
        [
          ['slices', 'Slices'],
          ['bursts', 'Bursts'],
          ['staircase', 'Stair steps'],
        ],
        'Separate strips, groups of strips moving together, or a repeating stepped displacement.',
      ),
      displacement: reductionNumber(
        'Displacement',
        8,
        0,
        50,
        'image-percent',
        'Maximum travel as a percentage of the shorter original-image side.',
      ),
      sliceSize: reductionNumber(
        'Slice size',
        2,
        0.1,
        25,
        'image-percent',
        'Width of a strip as a percentage of the shorter image side. Bursts group several strips.',
      ),
      density: reductionNumber(
        'Density',
        0.45,
        0,
        1,
        'percent',
        'Fraction of slices or bursts that move. Zero keeps the original image.',
      ),
      orientation: {
        kind: 'number',
        label: 'Slice angle',
        default: 0,
        min: 0,
        max: 180,
        step: 1,
        unit: 'degrees',
        description:
          'Zero creates horizontal strips, 90 creates vertical strips, and intermediate angles create diagonal strips.',
      },
      direction: {
        kind: 'number',
        label: 'Direction',
        default: 0,
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        description:
          'Direction of pixel travel, independent of Slice angle. Zero moves horizontally and 90 vertically.',
      },
      frequency: reductionNumber(
        'Frequency',
        8,
        1,
        64,
        'count',
        'Number of displacement-wave cycles across the shorter image side. Stair steps use a sawtooth wave.',
      ),
      randomness: reductionNumber(
        'Randomness',
        0.75,
        0,
        1,
        'percent',
        'Mix seeded random travel with the repeating displacement wave. Density remains seeded at zero randomness.',
      ),
      burstLength: reductionNumber(
        'Burst length',
        4,
        1,
        24,
        'count',
        'Number of adjacent slices sharing one displacement and activation in Bursts mode.',
      ),
      sliceSoftness: reductionNumber(
        'Slice softness',
        0.05,
        0,
        1,
        'percent',
        'Ease displacement back to zero near slice or burst edges. Zero makes a hard tear; higher values make a softer transition.',
      ),
      positionX: reductionNumber(
        'Position X',
        50,
        0,
        100,
        'image-percent',
        'Horizontal anchor of the angled slice layout.',
      ),
      positionY: reductionNumber(
        'Position Y',
        50,
        0,
        100,
        'image-percent',
        'Vertical anchor of the slice layout.',
      ),
      fieldEnabled: reductionChoice(
        'Height steering',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Use a procedural, source-brightness or imported depth field to steer native pixel travel. A shared Direction field at 100% influence overrides height steering.',
      ),
      fieldInfluence: reductionNumber(
        'Height steering influence',
        0.5,
        0,
        1,
        'percent',
        'Rotate travel direction with field height. Mid-gray keeps Direction; at full influence black and white span a full turn.',
      ),
      edgeHandling,
    },
  },
  crt: {
    title: 'CRT',
    finish: 'image',
    description:
      'Curve the image into a phosphor screen with highlight bloom and interlaced field blending.',
    hint: 'Phosphor patterns stay fixed to the screen. Curvature bends the image beneath them; field blending mixes shifted alternating rows from this still image. Use Scanlines separately for scanline patterns and signal errors.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      curvature: reductionNumber(
        'Curvature',
        0.12,
        0,
        0.75,
        'percent',
        'Bend the image toward a curved screen. Zero keeps the image flat; increasing curvature bends edges and compresses corners.',
      ),
      clipScreen: reductionChoice(
        'Clip screen',
        'on',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Make areas outside the curved screen transparent, with softened edges. Off fills them using Edge Handling. Clipping affects the warped image, not your painted mask.',
      ),
      edgeHandling,
      phosphor: reductionChoice(
        'Phosphor pattern',
        'grille',
        [
          ['off', 'Off'],
          ['grille', 'Aperture grille'],
          ['slot', 'Slot mask'],
          ['dots', 'Dot mask'],
        ],
        'Choose RGB stripes, rectangular RGB slots, or staggered circular RGB dots. These modulate image colors and stay aligned to the screen after curvature.',
      ),
      phosphorStrength: reductionNumber(
        'Phosphor strength',
        0.45,
        0,
        1,
        'percent',
        'Mix the phosphor pattern into the image. Zero bypasses the pattern and its gain; 100% uses the full RGB mask.',
      ),
      phosphorPitch: reductionNumber(
        'Phosphor pitch',
        6,
        3,
        30,
        'count',
        'Width of a complete RGB triplet in original-image pixels. Larger values expose the phosphor structure. Reduced previews average fine patterns to avoid flickering.',
      ),
      phosphorWidth: reductionNumber(
        'Phosphor width',
        0.8,
        0.2,
        1,
        'percent',
        'Fill more or less of each phosphor cell. Lower values widen the dark gaps; higher values make broader stripes, slots or dots.',
      ),
      phosphorGain: reductionNumber(
        'Phosphor gain',
        3,
        0.5,
        6,
        'multiplier',
        'Boost the illuminated phosphor cells to compensate for dark gaps. High gain can clip highlights. This only applies while the pattern has nonzero strength.',
      ),
      fieldBlend: reductionNumber(
        'Field blend',
        0.15,
        0,
        1,
        'percent',
        'Blend a shifted copy into alternating row bands. This simulates two misaligned fields of a still image; it does not introduce animation.',
      ),
      fieldOrder: reductionChoice(
        'Shifted field',
        'odd',
        [
          ['even', 'Even'],
          ['odd', 'Odd'],
        ],
        'Choose which alternating row bands use the shifted image. The other field stays in place.',
      ),
      fieldSize: reductionNumber(
        'Field height',
        1,
        1,
        16,
        'count',
        'Height of each alternating field band in original-image pixels. One simulates interlaced rows; larger bands make field damage more visible.',
      ),
      fieldOffsetX: reductionNumber(
        'Field offset X',
        0,
        -32,
        32,
        'coordinate',
        'Shift the selected field horizontally in original-image pixels. Positive values move its content right. Zero keeps horizontal registration.',
      ),
      fieldOffsetY: reductionNumber(
        'Field offset Y',
        1,
        -8,
        8,
        'coordinate',
        'Shift the selected field vertically in original-image pixels. Positive values move its content down. Zero keeps vertical registration.',
      ),
      bloom: reductionNumber(
        'Bloom',
        0.35,
        0,
        2,
        'multiplier',
        'Spread light from bright image phosphors into nearby visible pixels. Zero disables bloom. The warped image transparency is preserved.',
      ),
      bloomRadius: reductionNumber(
        'Bloom radius',
        0.8,
        0,
        8,
        'image-percent',
        'Radius of the soft highlight spread as a percentage of the shorter original-image side. Zero adds highlight light without spreading it.',
      ),
      bloomThreshold: reductionNumber(
        'Bloom threshold',
        0.55,
        0,
        1,
        'percent',
        'Minimum brightness contributing to phosphor bloom, with a soft transition. Lower values let more image areas glow.',
      ),
      bloomColorMix: reductionNumber(
        'Bloom color mix',
        0,
        0,
        1,
        'percent',
        'Zero keeps the phosphor highlight colors. Increasing this recolors the bloom with Bloom color, including its gradient.',
      ),
      glowColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Bloom color',
        default: '#ffcf88',
        description:
          'Choose a solid or gradient color for the bloom. Bloom color mix controls its contribution; the shared Tint colors the entire CRT result.',
      },
    },
  },
  glyph: {
    title: 'Glyph Renderer',
    finish: 'image',
    description: 'Rebuild images with ASCII, text, pixel emoji, Braille or block glyphs.',
    hint: 'Sampling cells stay fixed while glyphs vary in size, color and placement. Text modes can use built-in characters or installed fonts. Saved character sheets preserve font appearances in projects and presets.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: reductionChoice(
        'Style',
        'ascii',
        GLYPH_STYLES.map(
          (style) =>
            [
              style,
              (
                {
                  ascii: 'ASCII',
                  'extended-ascii': 'Extended ASCII',
                  unicode: 'Unicode',
                  emoji: 'Emoji',
                  binary: 'Binary',
                  hexadecimal: 'Hexadecimal',
                  numbers: 'Numbers',
                  terminal: 'Terminal',
                  'custom-set': 'Custom Glyph Set',
                  'custom-text': 'Custom Text',
                  braille: 'Braille',
                  blocks: 'Blocks',
                } as const
              )[style],
            ] as const,
        ),
        'Brightness-ranked ASCII, extended symbols and Unicode shapes; source-channel byte digits for Binary, Hexadecimal and Numbers; brightness-ranked terminal characters; custom ordered symbols or repeating text; original pixel emoji; Braille dots and block quadrants.',
      ),
      cellSize: reductionNumber(
        'Cell size',
        12,
        4,
        128,
        'count',
        'Cell width in original-image pixels. Smaller cells retain finer detail; larger cells make the glyphs more visible. Preview and export use the same canvas grid.',
      ),
      aspect: reductionNumber(
        'Cell aspect',
        1.5,
        0.5,
        3,
        'multiplier',
        'Cell height divided by cell width. One makes square cells; larger values make taller cells. This changes the sampled image grid.',
      ),
      glyphScale: reductionNumber(
        'Glyph scale',
        0.85,
        0.2,
        1,
        'percent',
        'Size of the glyph within each cell. Lower values add space around characters; higher values fill more of the cell. Sampling remains based on the full cell.',
      ),
      contrast: reductionNumber(
        'Contrast',
        1,
        0,
        4,
        'multiplier',
        'Expand or compress visible brightness around the midpoint before selecting glyphs. One keeps the sampled brightness; zero maps visible tones to the midpoint.',
      ),
      density: reductionNumber(
        'Symbol density',
        1,
        0,
        2,
        'multiplier',
        'Multiply the adjusted brightness used to choose characters, dots and blocks. Lower values use fewer marks; higher values use denser marks. Zero leaves only Background.',
      ),
      threshold: reductionNumber(
        'Dot / block threshold',
        0.5,
        0,
        1,
        'percent',
        'Minimum adjusted brightness for each visible Braille dot or block quadrant. ASCII uses ranked character density instead. Invisible samples never create marks.',
      ),
      invert: reductionChoice(
        'Invert',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Reverse visible brightness before density and threshold selection. Dark regions receive dense glyphs and light regions receive sparse glyphs; source colors and transparency stay unchanged.',
      ),
      coloring: reductionChoice(
        'Glyph colors',
        'source',
        [
          ['source', 'Source image'],
          ['custom', 'Custom'],
        ],
        'Source image colors glyphs with the alpha-weighted cell color. Custom uses Foreground, including gradients. Background uses its own color or gradient in either mode.',
      ),
      foregroundColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Foreground',
        default: '#f1cc6b',
        description:
          'Solid or gradient color for glyph marks in Custom mode. Source image mode uses sampled cell colors instead.',
      },
      backgroundColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Background',
        default: '#101216',
        description:
          'Solid or gradient color between glyph marks. Original alpha remains at its original pixels; this does not create opacity in transparent areas.',
      },
      ...GLYPH_PARAMETERS,
    },
  },
  'indexed-palette': {
    title: 'Indexed Palette',
    finish: 'image',
    description: 'Limit colors to a palette, then scramble or drift their assignments.',
    hint: 'Color count limits the total palette, not bits per channel. Source samples the stage input; corruption changes assignments after matching.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      palette: reductionChoice(
        'Palette',
        'source',
        [
          ['source', 'Source sampled'],
          ['rgb332', 'RGB332'],
          ['grayscale', 'Grayscale'],
          ['cga', 'CGA-like'],
          ['ega', 'EGA-like'],
          ['vga', 'VGA-like'],
          ['gameboy', 'Game Boy-like'],
          ['monochrome', 'Monochrome'],
          ['custom', 'Custom ramp'],
        ],
        'Choose stage-source colors or a fixed palette. Hardware-inspired sets are artistic palettes, not strict display emulation. Custom ramp uses the editable color bar.',
      ),
      colors: reductionNumber(
        'Color count',
        16,
        2,
        256,
        'count',
        'Maximum total palette entries, from 2 to 256. Source sampling can return fewer colors for simple images. Fixed small palettes keep their native maximum; they never invent extra colors.',
      ),
      paletteStart: {
        kind: 'color',
        label: 'Palette start',
        default: '#101522',
        description: 'Dark end of the custom palette ramp. Add or edit colors in the palette bar.',
      },
      paletteEnd: {
        kind: 'color',
        label: 'Palette end',
        default: '#f1cc6b',
        description:
          'Light end of the custom palette ramp. Color count samples discrete entries along this ramp.',
      },
      paletteStartStops: {
        kind: 'stops',
        colorSource: 'paletteStart',
        label: 'Palette stops',
        default: '[]',
        description:
          'Up to sixteen editable ramp colors, sampled into the selected total color count.',
      },
      dither: reductionChoice(
        'Dithering',
        'none',
        ditherOptions.filter(([value]) =>
          ['none', 'ordered', 'floyd-steinberg', 'blue-noise', 'random'].includes(value),
        ),
        'Hard nearest-color mapping, or Bayer, error diffusion, blue noise or seeded random mapping into the same palette.',
      ),
      ditherStrength: ditherStrengthControl,
      cellSize: cellSizeControl,
      colorSwap: reductionNumber(
        'Color swaps',
        0,
        0,
        1,
        'percent',
        'Shuffle this seeded fraction of palette entries after nearest-color matching. Zero preserves ordinary assignments. New pattern chooses another permutation.',
      ),
      hueDamage: reductionNumber(
        'Hue damage',
        0,
        0,
        1,
        'percent',
        'Apply seeded hue rotations to individual palette entries. Higher values allow greater color-wheel changes; zero preserves palette hues.',
      ),
      saturationDamage: reductionNumber(
        'Saturation damage',
        0,
        0,
        1,
        'percent',
        'Apply seeded saturation changes to palette entries, from faded toward vivid colors. Zero preserves the palette. Gray entries remain gray.',
      ),
      drift: reductionNumber(
        'Palette drift',
        0,
        0,
        1,
        'percent',
        'Shift color assignments by seeded offsets in spatial patches. Higher values allow greater palette-index shifts. The original palette still supplies the colors.',
      ),
      driftSize: reductionNumber(
        'Drift size',
        8,
        0.1,
        50,
        'image-percent',
        'Width of palette-drift patches as a percentage of the shorter original image side.',
      ),
    },
  },
  threshold: {
    title: 'Threshold / Photocopy',
    finish: 'image',
    description: 'Clip tones into bitmap levels or a distressed photocopy.',
    hint: 'Adjust input levels before thresholding. Local threshold adapts to neighboring visible tones; edges and dirt add photocopy damage.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: reductionChoice(
        'Style',
        'threshold',
        [
          ['threshold', 'Threshold'],
          ['bitmap', 'Bitmap levels'],
          ['photocopy', 'Dirty Photocopy'],
        ],
        'Threshold makes two tones; Bitmap levels keeps multiple discrete tones; Dirty Photocopy adds selectable edge emphasis and seeded ink/paper defects.',
      ),
      threshold: reductionNumber(
        'Threshold',
        0.5,
        0,
        1,
        'percent',
        'Brightness boundary between ink and paper. In Bitmap mode this shifts the level boundaries; with Local threshold it biases the boundary relative to the local mean.',
      ),
      inputBlack: reductionNumber(
        'Input black',
        0,
        0,
        0.99,
        'percent',
        'Brightness mapped to black before thresholding. Must remain below Input white.',
      ),
      inputWhite: reductionNumber(
        'Input white',
        1,
        0.01,
        1,
        'percent',
        'Brightness mapped to white before thresholding. Must remain above Input black.',
      ),
      gamma: reductionNumber(
        'Gamma',
        1,
        0.1,
        4,
        'multiplier',
        'Adjust midtone brightness after input levels and before thresholding. One preserves the normalized tones.',
      ),
      levels: reductionNumber(
        'Bitmap levels',
        4,
        2,
        16,
        'count',
        'Number of discrete tones between Ink and Paper in Bitmap levels mode.',
      ),
      invert: reductionChoice(
        'Invert',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Exchange the ink and paper assignments without changing your selected colors.',
      ),
      local: reductionChoice(
        'Local threshold',
        'off',
        [
          ['off', 'Off'],
          ['on', 'On'],
        ],
        'Use an alpha-weighted neighborhood mean to reveal details under uneven lighting. Fully transparent pixels supply no hidden color.',
      ),
      localRadius: reductionNumber(
        'Local radius',
        3,
        0.1,
        25,
        'image-percent',
        'Neighborhood radius for Local threshold as a percentage of the shorter original image side. Sampling extends the edge with clipped windows.',
      ),
      edgeEmphasis: reductionNumber(
        'Edge emphasis',
        0.5,
        0,
        2,
        'multiplier',
        'Darken local brightness transitions in Dirty Photocopy mode. Zero leaves only the threshold treatment.',
      ),
      dirt: reductionNumber(
        'Photocopy dirt',
        0.18,
        0,
        1,
        'percent',
        'Seeded ink speckles and paper dropouts in Dirty Photocopy mode. Zero produces a clean copy; New pattern changes the defect field.',
      ),
      dirtSize: reductionNumber(
        'Dirt size',
        0.15,
        0.01,
        5,
        'image-percent',
        'Size of photocopy defects as a percentage of the shorter original image side.',
      ),
      inkColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Ink',
        default: '#111111',
        description:
          'Color assigned to dark bitmap tones. Solid or a canvas gradient; alpha stays unchanged.',
      },
      paperColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Paper',
        default: '#f5efdf',
        description:
          'Color assigned to light bitmap tones. Intermediate Bitmap levels interpolate between Ink and Paper.',
      },
    },
  },
  dither: {
    title: 'Dither',
    finish: 'image',
    description: 'Render reduced tones with diffusion, blue-noise or corrupted patterns.',
    hint: 'Levels per channel differs from Indexed Palette color count. Error diffusion follows cells in scan order and does not cross fully transparent gaps.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      algorithm: reductionChoice(
        'Algorithm',
        'floyd-steinberg',
        ditherOptions,
        'Choose hard mapping, ordered Bayer, Floyd–Steinberg, Atkinson, full Sierra, Jarvis–Judice–Ninke, toroidal blue-noise ranks, seeded random noise or corrupted Floyd–Steinberg diffusion.',
      ),
      coloring: reductionChoice(
        'Coloring',
        'mono',
        [
          ['mono', 'Monochrome'],
          ['rgb', 'RGB channels'],
          ['ramp', 'Color ramp'],
        ],
        'Monochrome diffuses brightness into gray tones. RGB reduces and diffuses each channel independently. Color ramp maps the same brightness levels through an editable color bar.',
      ),
      levels: reductionNumber(
        'Levels per channel',
        2,
        2,
        32,
        'count',
        'Discrete values per brightness/RGB channel. Two gives a binary bitmap; RGB can produce up to this count cubed colors. This is not a total indexed-palette count.',
      ),
      rampStart: {
        kind: 'color',
        label: 'Ramp start',
        default: '#15152c',
        description: 'Color for the lowest brightness level in Color ramp mode.',
      },
      rampEnd: {
        kind: 'color',
        label: 'Ramp end',
        default: '#f1cc6b',
        description: 'Color for the highest brightness level in Color ramp mode.',
      },
      rampStartStops: {
        kind: 'stops',
        colorSource: 'rampStart',
        label: 'Dither ramp stops',
        default: '[]',
        description: 'Map quantized brightness through up to sixteen editable colors.',
      },
      cellSize: cellSizeControl,
      ditherStrength: ditherStrengthControl,
      scan: reductionChoice(
        'Scan',
        'serpentine',
        [
          ['serpentine', 'Serpentine'],
          ['forward', 'Left to right'],
        ],
        'Error diffusion alternates row direction in Serpentine mode or always scans left to right. Non-diffusion algorithms do not use scan direction.',
      ),
      skippedCells: reductionNumber(
        'Skipped cells',
        0.1,
        0,
        1,
        'percent',
        'Seeded fraction of cells left as incoming image color in Corrupted Dither. These cells do not propagate error. Zero skips none.',
      ),
      errorDisplacement: reductionNumber(
        'Error displacement',
        3,
        0,
        16,
        'count',
        'Maximum horizontal travel of diffused error in original-image pixels in Corrupted Dither. Errors only reach future cells; zero preserves ordinary destinations.',
      ),
      randomDirection: reductionNumber(
        'Random direction',
        0.25,
        0,
        1,
        'percent',
        'Seeded fraction of diffusion rows and error destinations whose horizontal direction is reversed in Corrupted Dither.',
      ),
      blockInterruptions: reductionNumber(
        'Block interruptions',
        0.2,
        0,
        1,
        'percent',
        'Seeded fraction of blocks that discard incoming and outgoing diffusion error, creating islands of hard quantization.',
      ),
      blockSize: reductionNumber(
        'Interruption size',
        16,
        2,
        128,
        'count',
        'Size of corruption blocks in original-image pixels. Enabled by Block interruptions.',
      ),
      channelDivergence: reductionNumber(
        'Channel divergence',
        0.3,
        0,
        1,
        'percent',
        'Give RGB channels independent seeded error paths and perturbations in Corrupted Dither. Monochrome and Color ramp share one brightness path.',
      ),
    },
  },
  transform: {
    finish: 'image',
    title: 'Transform',
    description: 'Position, resize and rotate the preceding stack on the canvas.',
    hint: 'Align the result, then choose how to sample outside its edges.',
    parameters: {
      amount,
      positionX: {
        kind: 'number',
        label: 'Position X',
        min: -100,
        max: 100,
        step: 0.1,
        default: 0,
        unit: 'image-percent',
        description: 'Move horizontally by a percentage of canvas width.',
      },
      positionY: {
        kind: 'number',
        label: 'Position Y',
        min: -100,
        max: 100,
        step: 0.1,
        default: 0,
        unit: 'image-percent',
        description: 'Move vertically by a percentage of canvas height.',
      },
      scale: {
        kind: 'number',
        label: 'Scale',
        min: 1,
        max: 400,
        step: 0.1,
        default: 100,
        unit: 'image-percent',
        description: 'Resize proportionally. 100% keeps the original size.',
      },
      rotation: {
        kind: 'number',
        label: 'Rotation',
        min: -180,
        max: 180,
        step: 0.1,
        default: 0,
        unit: 'degrees',
        description: 'Rotate clockwise around the image center before alignment.',
      },
      anchor: {
        kind: 'choice',
        label: 'Alignment',
        default: 'center',
        description:
          'Align the bounding box of the scaled, rotated canvas to this point before applying Position X/Y.',
        options: [
          { value: 'center', label: 'Center' },
          { value: 'top-left', label: 'Top Left' },
          { value: 'top', label: 'Top' },
          { value: 'top-right', label: 'Top Right' },
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'bottom-left', label: 'Bottom Left' },
          { value: 'bottom', label: 'Bottom' },
          { value: 'bottom-right', label: 'Bottom Right' },
        ],
      },
      edges: {
        kind: 'choice',
        label: 'Outside edges',
        default: 'transparent',
        description:
          'Transparent leaves uncovered canvas clear. Extend repeats edge pixels; Tile wraps the image; Mirror reflects at the edges.',
        options: [
          { value: 'transparent', label: 'Transparent' },
          { value: 'extend', label: 'Extend' },
          { value: 'wrap', label: 'Tile' },
          { value: 'mirror', label: 'Mirror' },
        ],
      },
    },
  },
  solid: {
    finish: 'pattern',
    title: 'Solid',
    description: 'Layer a color, gradient, stage source or another image over the stack.',
    hint: 'Choose content, then blend and mask it like any other effect.',
    parameters: {
      amount,
      content: {
        kind: 'choice',
        label: 'Content',
        default: 'color',
        description:
          'Color and Gradient create a full-canvas layer. Source Image uses this stage’s input, including a baked source. New Image embeds a separately chosen image in your projects and presets.',
        options: [
          { value: 'color', label: 'Solid Color' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'source', label: 'Source Image' },
          { value: 'image', label: 'New Image' },
          { value: 'drawing', label: 'Drawing' },
        ],
      },
      fillColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Fill color',
        default: '#e7c55c',
        description: 'Choose the layer color or the starting color of its gradient.',
      },
      placement: {
        kind: 'choice',
        label: 'Image placement',
        default: 'fit',
        description:
          'Fit shows the whole image with transparent margins; Fill covers the canvas and crops excess; Stretch fits the canvas without preserving proportions. Placement is centered.',
        options: [
          { value: 'fit', label: 'Fit' },
          { value: 'fill', label: 'Fill' },
          { value: 'stretch', label: 'Stretch' },
        ],
      },
      blendMode,
    },
  },
  'noise-grain': {
    title: 'Noise / Grain',
    finish: 'image',
    description: 'Add photographic grain or layered procedural noise.',
    hint: 'Choose a style, shape its texture, then blend it into the image.',
    parameters: {
      amount,
      ...{
        style: {
          kind: 'choice',
          label: 'Style',
          description:
            'Choose independent grain, photographic grain or a smooth procedural field. Each style retains its controls.',
          default: 'film',
          options: [
            { value: 'white', label: 'White Noise' },
            { value: 'gaussian', label: 'Gaussian' },
            { value: 'speckle', label: 'Speckle' },
            { value: 'film', label: 'Film Grain' },
            { value: 'perlin', label: 'Perlin' },
            { value: 'simplex', label: 'Simplex' },
            { value: 'voronoi', label: 'Voronoi / Worley' },
            { value: 'value', label: 'Value' },
            { value: 'salt-pepper', label: 'Salt-and-pepper' },
            { value: 'scan', label: 'Scan Noise' },
          ],
        },
        intensity: {
          kind: 'number',
          label: 'Intensity',
          description: 'Strength of the noise brightness or selected noise colors.',
          min: 0,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.25,
        },
        size: {
          kind: 'number',
          label: 'Grain size',
          description: 'Grain cell size as a percentage of the shorter original image side.',
          min: 0.02,
          max: 5,
          step: 0.01,
          unit: 'image-percent',
          default: 0.15,
        },
        scale: {
          kind: 'number',
          label: 'Scale',
          description:
            'Size of procedural noise cells relative to the shorter original image side.',
          min: 0.1,
          max: 50,
          step: 0.1,
          unit: 'image-percent',
          default: 8,
        },
        detail: {
          kind: 'number',
          label: 'Detail / Octaves',
          description: 'Number of layered frequencies; more layers add finer structure.',
          min: 1,
          max: 6,
          step: 1,
          unit: 'count',
          default: 3,
        },
        roughness: {
          kind: 'number',
          label: 'Roughness',
          description: 'How much finer layers contribute to the procedural field.',
          min: 0,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.5,
        },
        variant: {
          kind: 'choice',
          label: 'Variant',
          description: 'Layer signed noise, fold it into turbulence or form ridged bands.',
          default: 'fbm',
          options: [
            { value: 'fbm', label: 'Fractal (fBm)' },
            { value: 'turbulence', label: 'Turbulence' },
            { value: 'ridged', label: 'Ridged' },
          ],
        },
        density: {
          kind: 'number',
          label: 'Density',
          description: 'Fraction of grain cells affected by speckles or salt-and-pepper impulses.',
          min: 0,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.15,
        },
        clumping: {
          kind: 'number',
          label: 'Clumping',
          description: 'Mix small grain with a broader uneven film texture.',
          min: 0,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.4,
        },
        tonalResponse: {
          kind: 'number',
          label: 'Tonal response',
          description:
            'Concentrate photographic grain in midtones and reduce it in deep shadows and highlights.',
          min: 0,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.5,
        },
        cellular: {
          kind: 'choice',
          label: 'Cell pattern',
          description:
            'Use seeded cell colors, nearest feature-point distance or boundaries between neighboring cells.',
          default: 'distance',
          options: [
            { value: 'cells', label: 'Filled Cells' },
            { value: 'distance', label: 'Distance' },
            { value: 'borders', label: 'Cell Borders' },
          ],
        },
        coloring: {
          kind: 'choice',
          label: 'Noise colors',
          description:
            'Use grayscale grain, independent RGB noise, or an editable solid/two-color noise ramp.',
          default: 'mono',
          options: [
            { value: 'mono', label: 'Monochrome' },
            { value: 'color', label: 'Color' },
            { value: 'ramp', label: 'Selected color / ramp' },
          ],
        },
        noiseColor: {
          kind: 'color',
          gradient: 'field',
          label: 'Noise color',
          default: '#f6c65b',
          description: 'Choose a solid noise color or two-color ramp sampled by the noise value.',
        },
      },
      balance: reductionNumber(
        'Salt / Pepper balance',
        0.5,
        0,
        1,
        'percent',
        'Chance of a white impulse instead of black. 0% uses only pepper; 100% uses only salt. Selected color ramps replace these two endpoints.',
      ),
      scanDirection: reductionChoice(
        'Scan direction',
        'horizontal',
        [
          ['horizontal', 'Horizontal'],
          ['vertical', 'Vertical'],
          ['both', 'Crossed'],
        ],
        'Correlate noise along rows, columns or their intersections.',
      ),
      scanSpacing: reductionNumber(
        'Scan spacing',
        1,
        0.02,
        20,
        'image-percent',
        'Distance between noise bands as a percentage of the shorter original image side.',
      ),
      scanWidth: reductionNumber(
        'Band width',
        0.15,
        0.02,
        5,
        'image-percent',
        'Thickness of each noisy band. Widths at least as large as Scan spacing fill the gaps.',
      ),
      scanIrregularity: reductionNumber(
        'Irregularity',
        0.15,
        0,
        1,
        'percent',
        'Mix coherent line noise with local signal breakup. Zero keeps each row or column uniform.',
      ),
      ...IMAGE_FINISH_PARAMETERS,
    },
  },
  blur: {
    title: 'Blur',
    finish: 'image',
    description: 'Soften, streak or selectively defocus your image.',
    hint: 'Choose a style and adjust its footprint or focus field.',
    parameters: {
      amount,
      ...{
        style: {
          kind: 'choice',
          label: 'Style',
          description:
            'Choose a blur style. Style-specific controls retain their values when switching.',
          default: 'gaussian',
          options: [
            { value: 'gaussian', label: 'Gaussian' },
            { value: 'motion', label: 'Motion' },
            { value: 'radial', label: 'Radial' },
            { value: 'lens', label: 'Lens' },
            { value: 'surface', label: 'Surface' },
            { value: 'box', label: 'Box' },
            { value: 'grainy', label: 'Grainy' },
            { value: 'shape', label: 'Shape' },
            { value: 'background', label: 'Background' },
            { value: 'field', label: 'Field' },
            { value: 'tilt-shift', label: 'Tilt-shift' },
            { value: 'spin', label: 'Spin' },
            { value: 'zoom', label: 'Zoom' },
            { value: 'smart', label: 'Smart Blur' },
            { value: 'depth', label: 'Depth Field' },
          ],
        },
        radius: {
          kind: 'number',
          label: 'Radius',
          description:
            'Blur radius as a percentage of the shorter original image side. Zero leaves the image sharp.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 1,
        },
        angle: {
          kind: 'number',
          label: 'Angle',
          description: 'Direction of motion streaks or the angle of the tilt-shift focus band.',
          min: 0,
          max: 360,
          step: 1,
          unit: 'degrees',
          default: 0,
        },
        aspect: {
          kind: 'number',
          label: 'Aspect',
          description: 'Stretch the blur footprint horizontally relative to its height.',
          min: 0.25,
          max: 4,
          step: 0.01,
          unit: 'multiplier',
          default: 1,
        },
        centerX: {
          kind: 'number',
          label: 'Center X',
          description: 'Horizontal position of the spin, zoom or radial blur center.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        centerY: {
          kind: 'number',
          label: 'Center Y',
          description: 'Vertical position of the spin, zoom or radial blur center.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        travel: {
          kind: 'number',
          label: 'Travel',
          description:
            'Spin angular travel (percentage of one turn) or signed radial zoom travel; negative reverses direction.',
          min: -100,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 20,
        },
        radialBalance: {
          kind: 'number',
          label: 'Spin / Zoom balance',
          description: '0% is rotational spin; 100% is radial zoom.',
          min: 0,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.5,
        },
        sides: {
          kind: 'number',
          label: 'Aperture sides',
          description: 'Polygon side count for Lens or the Polygon footprint.',
          min: 3,
          max: 12,
          step: 1,
          unit: 'count',
          default: 6,
        },
        apertureRotation: {
          kind: 'number',
          label: 'Footprint rotation',
          description: 'Rotate a polygon, square or triangular aperture.',
          min: 0,
          max: 360,
          step: 1,
          unit: 'degrees',
          default: 0,
        },
        highlights: {
          kind: 'number',
          label: 'Highlight response',
          description: 'Give bright samples more weight to emphasize bokeh highlights.',
          min: 0,
          max: 3,
          step: 0.01,
          unit: 'multiplier',
          default: 0,
        },
        threshold: {
          kind: 'number',
          label: 'Color threshold',
          description:
            'Surface only mixes samples whose RGB distance from this pixel is within this threshold.',
          min: 0,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.12,
        },
        sensitivity: {
          kind: 'number',
          label: 'Sensitivity',
          description:
            'Smart Blur uses a smooth bilateral color weight; lower values protect smaller color differences.',
          min: 0.01,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.15,
        },
        preservation: {
          kind: 'number',
          label: 'Detail preservation',
          description: 'Retain original fine detail after edge-aware Smart Blur smoothing.',
          min: 0,
          max: 1,
          step: 0.01,
          unit: 'percent',
          default: 0.3,
        },
        density: {
          kind: 'number',
          label: 'Sample density',
          description: 'Number of seeded jittered samples in Grainy Blur.',
          min: 4,
          max: 64,
          step: 1,
          unit: 'count',
          default: 24,
        },
        shape: {
          kind: 'choice',
          label: 'Footprint',
          description: 'Choose the primitive footprint through which Shape Blur samples pixels.',
          default: 'circle',
          options: [
            { value: 'circle', label: 'Circle' },
            { value: 'square', label: 'Square' },
            { value: 'triangle', label: 'Triangle' },
            { value: 'polygon', label: 'Polygon' },
            { value: 'ring', label: 'Ring' },
          ],
        },
        maskSoftness: {
          kind: 'number',
          label: 'Mask softness',
          description:
            'Feather the detected subject boundary; background samples exclude protected subject colors.',
          min: 0,
          max: 5,
          step: 0.1,
          unit: 'image-percent',
          default: 1,
        },
        refinement: {
          kind: 'number',
          label: 'Subject refinement',
          description:
            'Adjust the subject mask threshold. Positive protects more of the detected subject.',
          min: -0.45,
          max: 0.45,
          step: 0.01,
          unit: 'percent',
          default: 0,
        },
        pointCount: {
          kind: 'number',
          label: 'Field points',
          description:
            'Add up to eight adjustable control points. Radius interpolates by inverse squared distance; a point keeps its exact local radius.',
          min: 1,
          max: 8,
          step: 1,
          unit: 'count',
          default: 2,
        },
        position: {
          kind: 'number',
          label: 'Focus position',
          description: 'Move the tilt-shift focus band along its normal.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        width: {
          kind: 'number',
          label: 'Focus width',
          description: 'Width of the sharp band, relative to the shorter original image side.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 20,
        },
        falloff: {
          kind: 'number',
          label: 'Focus falloff',
          description: 'Distance over which the image transitions from sharp to fully blurred.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 20,
        },
        point0X: {
          kind: 'number',
          label: 'Point 1 X',
          description: 'Horizontal field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 35,
        },
        point0Y: {
          kind: 'number',
          label: 'Point 1 Y',
          description: 'Vertical field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        point0Radius: {
          kind: 'number',
          label: 'Point 1 radius',
          description:
            'Local blur radius at this control point, interpolated smoothly between points.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 0,
        },
        point1X: {
          kind: 'number',
          label: 'Point 2 X',
          description: 'Horizontal field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 65,
        },
        point1Y: {
          kind: 'number',
          label: 'Point 2 Y',
          description: 'Vertical field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        point1Radius: {
          kind: 'number',
          label: 'Point 2 radius',
          description:
            'Local blur radius at this control point, interpolated smoothly between points.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 3,
        },
        point2X: {
          kind: 'number',
          label: 'Point 3 X',
          description: 'Horizontal field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 65,
        },
        point2Y: {
          kind: 'number',
          label: 'Point 3 Y',
          description: 'Vertical field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        point2Radius: {
          kind: 'number',
          label: 'Point 3 radius',
          description:
            'Local blur radius at this control point, interpolated smoothly between points.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 3,
        },
        point3X: {
          kind: 'number',
          label: 'Point 4 X',
          description: 'Horizontal field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 65,
        },
        point3Y: {
          kind: 'number',
          label: 'Point 4 Y',
          description: 'Vertical field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        point3Radius: {
          kind: 'number',
          label: 'Point 4 radius',
          description:
            'Local blur radius at this control point, interpolated smoothly between points.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 3,
        },
        point4X: {
          kind: 'number',
          label: 'Point 5 X',
          description: 'Horizontal field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 65,
        },
        point4Y: {
          kind: 'number',
          label: 'Point 5 Y',
          description: 'Vertical field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        point4Radius: {
          kind: 'number',
          label: 'Point 5 radius',
          description:
            'Local blur radius at this control point, interpolated smoothly between points.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 3,
        },
        point5X: {
          kind: 'number',
          label: 'Point 6 X',
          description: 'Horizontal field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 65,
        },
        point5Y: {
          kind: 'number',
          label: 'Point 6 Y',
          description: 'Vertical field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        point5Radius: {
          kind: 'number',
          label: 'Point 6 radius',
          description:
            'Local blur radius at this control point, interpolated smoothly between points.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 3,
        },
        point6X: {
          kind: 'number',
          label: 'Point 7 X',
          description: 'Horizontal field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 65,
        },
        point6Y: {
          kind: 'number',
          label: 'Point 7 Y',
          description: 'Vertical field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        point6Radius: {
          kind: 'number',
          label: 'Point 7 radius',
          description:
            'Local blur radius at this control point, interpolated smoothly between points.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 3,
        },
        point7X: {
          kind: 'number',
          label: 'Point 8 X',
          description: 'Horizontal field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 65,
        },
        point7Y: {
          kind: 'number',
          label: 'Point 8 Y',
          description: 'Vertical field control-point position.',
          min: 0,
          max: 100,
          step: 0.1,
          unit: 'image-percent',
          default: 50,
        },
        point7Radius: {
          kind: 'number',
          label: 'Point 8 radius',
          description:
            'Local blur radius at this control point, interpolated smoothly between points.',
          min: 0,
          max: 10,
          step: 0.1,
          unit: 'image-percent',
          default: 3,
        },
      },
      edgeHandling,
      ...IMAGE_FINISH_PARAMETERS,
    },
  },
  'levels-curves': {
    title: 'Levels / Curves',
    finish: 'image',
    description: 'Shape contrast and color with levels or an editable tonal curve.',
    hint: 'Choose Levels or Curves, then target all RGB channels or one channel. Neutral controls preserve the incoming image.',
    parameters: {
      amount,
      mode: {
        kind: 'choice',
        label: 'Mode',
        default: 'levels',
        options: [
          { value: 'levels', label: 'Levels' },
          { value: 'curves', label: 'Curves' },
        ],
        description:
          'Levels remaps the input range, gamma and output range. Curves uses five adjustable tonal points. Each mode retains its settings when switching.',
      },
      channel: {
        kind: 'choice',
        label: 'Channel',
        default: 'rgb',
        options: [
          { value: 'rgb', label: 'RGB (all)' },
          { value: 'red', label: 'Red' },
          { value: 'green', label: 'Green' },
          { value: 'blue', label: 'Blue' },
        ],
        description:
          'Apply this tonal adjustment to all RGB channels or just one. Other channels and alpha stay unchanged before blending and tint. Use additional instances for independent channel adjustments.',
      },
      inputBlack: {
        kind: 'number',
        label: 'Input black',
        min: 0,
        max: 0.99,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Incoming values at or below this level map to Output black. Increasing it deepens shadows. It must stay below Input white.',
      },
      inputWhite: {
        kind: 'number',
        label: 'Input white',
        min: 0.01,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 1,
        description:
          'Incoming values at or above this level map to Output white. Decreasing it brightens highlights. It must stay above Input black.',
      },
      gamma: {
        kind: 'number',
        label: 'Gamma',
        min: 0.1,
        max: 4,
        step: 0.01,
        unit: 'multiplier',
        default: 1,
        description:
          'Adjust midtones between the input endpoints. Above 1 brightens; below 1 darkens; 1 preserves the normalized midtones.',
      },
      outputBlack: {
        kind: 'number',
        label: 'Output black',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Set the darkest output level. Raise it for faded shadows. Crossing Output white reverses the tonal range.',
      },
      outputWhite: {
        kind: 'number',
        label: 'Output white',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 1,
        description:
          'Set the brightest output level. Lower it to soften highlights. Crossing Output black reverses the tonal range.',
      },
      interpolation: {
        kind: 'choice',
        label: 'Curve interpolation',
        default: 'smooth',
        options: [
          { value: 'smooth', label: 'Smooth' },
          { value: 'linear', label: 'Linear' },
        ],
        description:
          'Smooth joins the five points with a shape-preserving curve; Linear joins them with straight segments. Drag points vertically or use their sliders. Crossing point heights can solarize colors.',
      },
      ...Object.fromEntries(
        CURVE_KEYS.map((key, i) => [
          key,
          {
            kind: 'number',
            label: [
              'Curve shadows',
              'Curve dark tones',
              'Curve midtones',
              'Curve light tones',
              'Curve highlights',
            ][i]!,
            min: 0,
            max: 1,
            step: 0.01,
            unit: 'percent',
            default: i / 4,
            description: `Output brightness at ${i * 25}% incoming brightness. Adjust this slider or drag the corresponding graph point vertically. 0% is black; 100% is white.`,
          } satisfies ParameterDefinition,
        ]),
      ),
      ...IMAGE_FINISH_PARAMETERS,
    },
  },
  glow: {
    title: 'Glow',
    finish: 'image',
    description: 'Diffuse bright areas into a soft luminous halo.',
    hint: 'Threshold selects highlights. Radius spreads their light; optional halo colors follow the output canvas.',
    parameters: {
      amount,
      radius: {
        kind: 'number',
        label: 'Radius',
        min: 0,
        max: 10,
        step: 0.1,
        unit: 'image-percent',
        default: 2,
        description:
          'Spread selected highlights with a soft halo, as a percentage of the shorter original image side. 0% brightens selected pixels without spreading light. The halo remains inside existing transparency.',
      },
      strength: {
        kind: 'number',
        label: 'Glow strength',
        min: 0,
        max: 3,
        step: 0.01,
        unit: 'multiplier',
        default: 1,
        description:
          'Light added from blurred highlights. 0 removes the glow; larger values brighten the halo. Opacity mixes the complete result with the incoming image.',
      },
      threshold: {
        kind: 'number',
        label: 'Threshold',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.6,
        description:
          'Incoming brightness above this level contributes light. Lower values include more of the image; higher values isolate the brightest highlights.',
      },
      knee: {
        kind: 'number',
        label: 'Highlight softness',
        min: 0,
        max: 0.5,
        step: 0.01,
        unit: 'percent',
        default: 0.1,
        description:
          'Soften the transition around Threshold. 0% gives a hard threshold; larger values gradually admit nearby highlight tones.',
      },
      glowColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Halo color',
        default: '#f6c65b',
        description:
          'Choose a solid halo color or canvas gradient. Halo color mix controls whether the halo follows its original highlight colors or this selected color.',
      },
      colorMix: {
        kind: 'number',
        label: 'Halo color mix',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          '0% retains the blurred highlights original colors. 100% recolors their brightness with Halo color. This colors only the added halo; the optional Tint below affects the complete processed image.',
      },
      edgeHandling,
      ...IMAGE_FINISH_PARAMETERS,
    },
  },
  'hue-saturation': {
    title: 'Hue / Saturation',
    finish: 'image',
    description: 'Shift colors, saturation and lightness.',
    hint: 'Adjust the incoming colors without changing geometry or transparency.',
    parameters: {
      amount,
      hue: {
        kind: 'number',
        label: 'Hue',
        min: -180,
        max: 180,
        step: 1,
        unit: 'degrees',
        default: 0,
        description:
          'Rotate colors around the color wheel. 120° moves red to green, green to blue, and blue to red. Gray pixels remain gray.',
      },
      saturation: {
        kind: 'number',
        label: 'Saturation',
        min: -1,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Adjust HSL saturation. Negative values reduce color toward gray; positive values strengthen existing colors toward full saturation. Gray pixels stay gray. 0% preserves saturation.',
      },
      lightness: {
        kind: 'number',
        label: 'Lightness',
        min: -1,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Move HSL lightness toward black (negative) or white (positive). -100% makes black; +100% makes white. 0% preserves lightness. Transparency stays unchanged.',
      },
      ...IMAGE_FINISH_PARAMETERS,
    },
  },
  'gradient-map': {
    title: 'Gradient Map',
    finish: 'image',
    description: 'Recolor shadows through highlights with a two-color ramp.',
    hint: 'Map incoming brightness to colors. Midpoint shifts the tonal balance; Reverse swaps the ramp direction.',
    parameters: {
      amount,
      shadows: {
        kind: 'color',
        label: 'Shadows',
        default: '#161638',
        description:
          'Color for the darkest incoming pixels. Midtones blend smoothly between Shadows and Highlights. Reverse exchanges the dark and bright ends.',
      },
      highlights: {
        kind: 'color',
        label: 'Highlights',
        default: '#f6c65b',
        description:
          'Color for the brightest incoming pixels. Both colors follow incoming brightness rather than image position. Transparency stays unchanged.',
      },
      midpoint: {
        kind: 'number',
        label: 'Midpoint',
        min: 0.05,
        max: 0.95,
        step: 0.01,
        unit: 'percent',
        default: 0.5,
        description:
          'Incoming brightness mapped halfway between the two colors. Lower values favor Highlights; higher values favor Shadows. 50% gives a linear brightness ramp.',
      },
      reverse: {
        kind: 'choice',
        label: 'Reverse',
        default: 'off',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ],
        description:
          'Swap the ramp direction: dark pixels use Highlights and bright pixels use Shadows. Your selected colors are retained.',
      },
      ...IMAGE_FINISH_PARAMETERS,
    },
  },
  'rgb-split': {
    title: 'RGB split',
    finish: 'image',
    description: 'Separate red and blue channels.',
    hint: 'Red and blue shift in opposite directions. Green and transparency stay in place.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      horizontal: {
        kind: 'number',
        label: 'Horizontal shift',
        description:
          'Shift red and blue in opposite horizontal directions, as a percentage of image width. Negative values reverse the direction. Green and transparency stay in place.',
        min: -10,
        max: 10,
        step: 0.1,
        unit: 'image-percent',
        default: 1,
      },
      vertical: {
        kind: 'number',
        label: 'Vertical shift',
        description:
          'Shift red and blue in opposite vertical directions, as a percentage of image height. Negative values reverse the direction. Green and transparency stay in place.',
        min: -10,
        max: 10,
        step: 0.1,
        unit: 'image-percent',
        default: 0,
      },
      edgeHandling,
    },
  },
  'block-corruption': {
    title: 'Block corruption',
    finish: 'image',
    description: 'Displace a seeded pattern of image blocks.',
    hint: 'Move selected blocks with their transparency. The seed controls the pattern.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      blockSize,
      density: {
        kind: 'number',
        label: 'Density',
        description:
          'Chance that each block is displaced. 0% moves no blocks; 100% moves every block. The seed determines which blocks are selected.',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.35,
      },
      displacement: {
        kind: 'number',
        label: 'Displacement',
        description:
          'Maximum distance a selected block can move, as a percentage of the shorter image side. The seed controls the direction and distance.',
        min: 0,
        max: 25,
        step: 0.1,
        unit: 'image-percent',
        default: 8,
      },
      edgeHandling,
    },
  },
  'spatial-crush': {
    title: 'Spatial crush',
    finish: 'image',
    description: 'Reduce detail into chunky pixels.',
    hint: 'Reduce color and transparency into a coarse grid. Linear smooths between samples; Dirty Nearest warps the grid; Corrupted Sample borrows blocks from elsewhere. Seeded modes support New pattern.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      blockSize: { ...blockSize, default: 2 },
      sampling: {
        kind: 'choice',
        label: 'Sampling',
        description:
          'Nearest samples each block center. Linear smooths between those samples. Average blends each block. Dirty Nearest jitters block boundaries. Random sample picks within each block. Corrupted Sample pulls some blocks from the wrong grid locations.',
        default: 'nearest',
        options: [
          { value: 'nearest', label: 'Nearest' },
          { value: 'linear', label: 'Linear' },
          { value: 'average', label: 'Average' },
          { value: 'dirty-nearest', label: 'Dirty Nearest' },
          { value: 'random', label: 'Random sample' },
          { value: 'corrupted', label: 'Corrupted Sample' },
        ],
      },
      jitter: {
        kind: 'number',
        label: 'Grid jitter',
        description:
          'Make Dirty Nearest block edges uneven using the seed. Zero restores the regular Nearest grid; higher values create more irregular block widths and heights.',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: SPATIAL_CRUSH_DEFAULTS.jitter,
      },
      corruption: {
        kind: 'number',
        label: 'Sampling errors',
        description:
          'Increase the fraction of blocks sampled from the wrong locations and how far those samples can travel. Zero restores Nearest. New pattern changes which blocks are corrupted.',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: SPATIAL_CRUSH_DEFAULTS.corruption,
      },
      edgeHandling,
    },
  },
  'bit-crush': {
    title: 'Bit crush',
    finish: 'image',
    description: 'Reduce color depth into stepped tones.',
    hint: 'Reduce linked RGB precision or set each color channel independently. Alpha depth stays at 8 bits until you choose to reduce transparency precision. Optional dithering softens bands.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      linkRGB: {
        kind: 'choice',
        label: 'Link RGB depths',
        description:
          'On uses one Color depth for red, green and blue. Off starts each channel at that depth and lets you adjust them separately. Linking again uses the Red depth. Alpha always has its own depth.',
        default: 'on',
        options: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
      },
      bits: {
        kind: 'number',
        label: 'Color depth',
        description:
          'Bits per red, green and blue channel. 1 bit gives two levels per channel; 8 bits preserves the original 256 levels. Lower values create stronger color bands. Transparency is preserved.',
        min: 1,
        max: 8,
        step: 1,
        unit: 'bits',
        default: 3,
      },
      ...Object.fromEntries(
        (['red', 'green', 'blue', 'alpha'] as const).map((channel) => [
          `${channel}Bits`,
          {
            kind: 'number',
            label: `${channel[0]!.toUpperCase() + channel.slice(1)} depth`,
            description:
              channel === 'alpha'
                ? 'Bits for transparency. 8 preserves the original alpha; lower values reduce it to stepped transparency levels. RGB linking does not change this setting. Dithering and Opacity also apply.'
                : `Bits for the ${channel} channel when RGB depths are unlinked. 1 bit gives two levels; 8 preserves all 256 values. Other channels keep their own depths.`,
            min: 1,
            max: 8,
            step: 1,
            unit: 'bits',
            default: channel === 'alpha' ? 8 : 3,
          } satisfies ParameterDefinition,
        ]),
      ),
      dither: {
        kind: 'choice',
        label: 'Dithering',
        description:
          'None keeps clean color bands. Ordered uses a fixed repeating pattern; Random uses seeded noise to break up banding. Color depth stays unchanged.',
        default: 'none',
        options: [
          { value: 'none', label: 'None' },
          { value: 'ordered', label: 'Ordered' },
          { value: 'random', label: 'Random' },
        ],
      },
      ditherAmount: {
        kind: 'number',
        label: 'Dither strength',
        description:
          'Strength of the ordered or random dithering before reducing color depth. 0% keeps clean bands; 100% uses the full pattern. Choose a dithering mode to enable this control.',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.75,
      },
    },
  },
  'wave-distortion': {
    title: 'Wave distortion',
    finish: 'image',
    description: 'Bend the image into smooth, flowing waves.',
    hint: 'Warp color and transparency together. Strength sets the travel distance; Frequency sets the wave count; Direction sets the displacement angle. New pattern changes the seeded wave position. Edge Handling controls pixels beyond the image.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      strength: {
        kind: 'number',
        label: 'Strength',
        description:
          'Maximum wave displacement as a percentage of the shorter image side. 0% leaves the image unchanged; larger values create stronger bends. Color and transparency move together.',
        min: 0,
        max: 25,
        step: 0.1,
        unit: 'image-percent',
        default: 5,
      },
      frequency: {
        kind: 'number',
        label: 'Frequency',
        description:
          'Number of wave cycles over a distance equal to the shorter image side. Lower values create broad bends; higher values create tighter ripples. Zoom and export keep the same wave proportions.',
        min: 0.25,
        max: 30,
        step: 0.25,
        unit: 'cycles',
        default: 3,
      },
      direction: {
        kind: 'number',
        label: 'Direction',
        description:
          'Direction the pixels move: 0° is horizontal, 90° is vertical, and intermediate angles create diagonal waves. The wave repeats across the perpendicular direction.',
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        default: 0,
      },
      edgeHandling,
    },
  },
  halftone: {
    title: 'Halftone',
    finish: 'pattern',
    description: 'Turn image tones into ink dots or lines.',
    hint: 'Darkness controls dot area or line width. Size scales the marks independently of their spacing; colors define the ink and paper. Transparency stays in place.',
    parameters: {
      amount,
      blendMode: {
        ...blendMode,
        description:
          'Combine the ink-and-paper pattern with the incoming image using the selected blend mode. Opacity controls the final mix.',
      },
      style: {
        kind: 'choice',
        label: 'Style',
        default: 'dots',
        description:
          'Dots creates a regular grid of round ink dots. Lines creates parallel ink bands that widen in darker parts of the image.',
        options: [
          { value: 'dots', label: 'Dots' },
          { value: 'lines', label: 'Lines' },
        ],
      },
      size: {
        kind: 'number',
        label: 'Size',
        min: 0,
        max: 2,
        step: 0.01,
        unit: 'percent',
        default: 1,
        description:
          'Scale the ink dot radius or line width independently of spacing. 0% shows only the background color; 100% uses the tonal size; higher values create denser, overlapping marks.',
      },
      spacing: {
        kind: 'number',
        label: 'Spacing',
        min: 0.2,
        max: 25,
        step: 0.1,
        unit: 'image-percent',
        default: 3,
        description:
          'Distance between dot centers or line centers, as a percentage of the shorter original image side. Higher values make a coarser print. Preview and export keep the same proportions.',
      },
      rotation: {
        ...rotation,
        max: 180,
        default: 35,
        description:
          'Rotate the dot grid or parallel lines. 0° gives an upright dot grid and vertical ink lines; 90° turns lines horizontal.',
      },
      contrast: {
        kind: 'number',
        label: 'Contrast',
        min: 0,
        max: 3,
        step: 0.05,
        unit: 'multiplier',
        default: 1,
        description:
          'Expand tonal differences around middle gray before sizing the ink marks. 1× uses the incoming tones; higher values create stronger light/dark separation; 0× makes a uniform middle-gray pattern.',
      },
      foregroundColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Ink color',
        default: '#000000',
        description:
          'Choose the color of the halftone dots or lines. Swap ink and paper colors to invert the print treatment.',
      },
      backgroundColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Paper color',
        default: '#ffffff',
        description:
          'Choose the color between the ink marks. This colors the existing image area and preserves its transparency.',
      },
    },
  },
  mirroring: {
    title: 'Mirroring',
    finish: 'image',
    description: 'Reflect image regions across an adjustable axis.',
    hint: 'Choose an axis and which side to keep. Position moves the reflection axis; angled axes also use Rotation. Color and transparency reflect together.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      axis: {
        kind: 'choice',
        label: 'Axis',
        default: 'vertical',
        description:
          'Vertical reflects left/right; Horizontal reflects top/bottom; Angled enables Rotation for a diagonal reflection axis.',
        options: [
          { value: 'vertical', label: 'Vertical' },
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'angled', label: 'Angled' },
        ],
      },
      sourceSide: {
        kind: 'choice',
        label: 'Source side',
        default: 'first',
        description:
          'Keep the selected half and reflect it into the opposite half. Left / Top keeps the left half for a vertical axis or the top half for a horizontal axis. For an angled axis these choices select opposite sides of the line.',
        options: [
          { value: 'first', label: 'Left / Top' },
          { value: 'opposite', label: 'Right / Bottom' },
        ],
      },
      positionX: {
        ...imagePosition,
        label: 'Position X',
        description:
          'Place the reflection axis horizontally as a percentage of image width. 50% centers it. Horizontal axes use Position Y instead.',
      },
      positionY: {
        ...imagePosition,
        label: 'Position Y',
        description:
          'Place the reflection axis vertically as a percentage of image height. 50% centers it. Vertical axes use Position X instead.',
      },
      rotation: {
        ...rotation,
        max: 180,
        default: 45,
        description:
          'Rotate an angled reflection axis: 0° is vertical, 90° is horizontal. Axis must be Angled to enable this control.',
      },
      edgeHandling,
      ...outputPlacement,
    },
  },
  kaleidoscope: {
    title: 'Kaleidoscope',
    finish: 'image',
    description: 'Repeat reflected image sectors around a center.',
    hint: 'Each sector repeats a reflected portion of the image. Segments changes symmetry; Center moves the origin; Rotation chooses the source wedge; Zoom enlarges its contents.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      segments: {
        kind: 'number',
        label: 'Segments',
        min: 2,
        max: 32,
        step: 1,
        unit: 'count',
        default: 6,
        description:
          'Number of repeated sectors around the center. Each sector contains two mirrored halves. Higher values create finer radial symmetry.',
      },
      rotation: {
        ...rotation,
        description:
          'Rotate the source wedge and the resulting symmetry together around the chosen center.',
      },
      centerX: {
        ...imagePosition,
        label: 'Center X',
        description:
          'Horizontal center of the kaleidoscope, as a percentage of original image width. 50% is the middle.',
      },
      centerY: {
        ...imagePosition,
        label: 'Center Y',
        description:
          'Vertical center of the kaleidoscope, as a percentage of original image height. 50% is the middle.',
      },
      zoom: {
        kind: 'number',
        label: 'Zoom',
        min: 0.25,
        max: 4,
        step: 0.05,
        unit: 'multiplier',
        default: 1,
        description:
          'Enlarge the source wedge content. 1× keeps its original scale; values above 1× zoom in, and values below 1× reveal more of the image. Edge Handling controls sampling beyond its boundary.',
      },
      edgeHandling,
      ...outputPlacement,
    },
  },

  'recursive-space': {
    title: 'Recursive Space',
    finish: 'image',
    description: 'Repeat image pieces into receding tunnels, spirals and lattices.',
    hint: 'Tunnel maps the image onto four receding walls; Spiral repeats radial panels with twist; Mirrored Lattice nests tiled image planes toward a vanishing point. Depth is the number of repetitions, independent of scene depth.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: {
        kind: 'choice',
        label: 'Style',
        default: 'tunnel',
        description:
          'Tunnel repeats full image pieces on four corridor walls. Spiral repeats radial panels around the vanishing point. Mirrored Lattice tiles receding planes.',
        options: [
          { value: 'tunnel', label: 'Tunnel' },
          { value: 'spiral', label: 'Spiral' },
          { value: 'lattice', label: 'Mirrored Lattice' },
        ],
      },
      depth: {
        kind: 'number',
        label: 'Depth',
        min: 1,
        max: 24,
        step: 1,
        unit: 'count',
        default: 8,
        description:
          'Number of nested repetitions toward the vanishing point. This creates a finite illusion of depth without estimating a photo depth map.',
      },
      repetitionScale: {
        kind: 'number',
        label: 'Repetition scale',
        min: 0.3,
        max: 0.9,
        step: 0.01,
        unit: 'percent',
        default: 0.65,
        description:
          'Size of each nested repetition relative to the previous one. Lower values leave broader panels; higher values create tightly packed repetitions.',
      },
      perspective: {
        kind: 'number',
        label: 'Perspective',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.35,
        description:
          'Bias the spacing of nested repetitions toward the vanishing point. Higher values make the depth progression more compressed toward the center.',
      },
      centerX: {
        ...imagePosition,
        label: 'Vanishing point X',
        description:
          'Horizontal vanishing-point position as a percentage of the original image width.',
      },
      centerY: {
        ...imagePosition,
        label: 'Vanishing point Y',
        description:
          'Vertical vanishing-point position as a percentage of the original image height.',
      },
      rotation: {
        ...rotation,
        description: 'Rotate the entire recursive layout around its vanishing point.',
      },
      twist: {
        ...rotation,
        label: 'Twist',
        min: -180,
        max: 180,
        default: 25,
        description:
          'Rotate successive radial panels or lattice planes as they recede. Tunnel keeps straight walls and disables Twist.',
      },
      symmetry: {
        kind: 'number',
        label: 'Repeats',
        min: 2,
        max: 16,
        step: 1,
        unit: 'count',
        default: 6,
        description:
          'Radial panels per turn in Spiral, or tiles across a plane in Mirrored Lattice. Tunnel has four fixed walls.',
      },
      imageScale: {
        kind: 'number',
        label: 'Image scale',
        min: 0.25,
        max: 4,
        step: 0.01,
        unit: 'multiplier',
        default: 1,
        description:
          'Zoom the source image inside each repeated panel without changing the layout. Edge Handling controls pixels outside the source.',
      },
      mirrorCopies: {
        kind: 'choice',
        label: 'Mirror copies',
        default: 'on',
        description:
          'Reflect alternating wall/radial panels and lattice tiles. Off repeats each image with the same orientation.',
        options: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
      },
      edgeHandling,
    },
  },
  'depth-field': {
    title: 'Depth Field',
    finish: 'image',
    description: 'Manufacture height fields for displacement, contour slices and relief.',
    hint: 'Brightness uses the stage source image. Ramps, shapes and seeded noise manufacture artistic height, rather than estimating physical scene depth. Reuse copies a field recipe without creating live links.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      operation: {
        kind: 'choice',
        label: 'Treatment',
        default: 'displace',
        description: 'Choose treatment. Settings are saved with the recipe.',
        options: [
          { value: 'displace', label: 'Displacement' },
          { value: 'contours', label: 'Contour Slicing' },
          { value: 'relief', label: 'Relief' },
          { value: 'terraces', label: 'Stepped Relief' },
          { value: 'field', label: 'Show Field' },
        ],
      },
      fieldSource: {
        kind: 'choice',
        label: 'Field source',
        default: 'brightness',
        description: 'Choose field source. Settings are saved with the recipe.',
        options: [
          { value: 'brightness', label: 'Brightness' },
          { value: 'image', label: 'Imported Map' },
          { value: 'linear', label: 'Linear Ramp' },
          { value: 'radial', label: 'Radial Ramp' },
          { value: 'perlin', label: 'Perlin' },
          { value: 'simplex', label: 'Simplex' },
          { value: 'value', label: 'Value' },
          { value: 'voronoi', label: 'Voronoi / Worley' },
          { value: 'shapes', label: 'Shapes' },
        ],
      },
      fieldShape: {
        kind: 'choice',
        label: 'Field shape',
        default: 'circle',
        description: 'Choose field shape. Settings are saved with the recipe.',
        options: [
          { value: 'circle', label: 'Circle' },
          { value: 'square', label: 'Square' },
          { value: 'triangle', label: 'Triangle' },
        ],
      },
      fieldInvert: {
        kind: 'choice',
        label: 'Invert field',
        default: 'off',
        description: 'Choose invert field. Settings are saved with the recipe.',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ],
      },
      fieldNormalize: {
        kind: 'choice',
        label: 'Normalize field',
        default: 'off',
        description: 'Choose normalize field. Settings are saved with the recipe.',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ],
      },
      fieldScale: {
        kind: 'number',
        label: 'Field scale',
        min: 1,
        max: 200,
        step: 1,
        unit: 'image-percent',
        default: 50,
        description:
          'Size of noise cells, shape tiles or the ramp span, as a percentage of the shorter image side.',
      },
      fieldRotation: {
        kind: 'number',
        label: 'Field rotation',
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        default: 0,
        description: 'Rotate ramps and shape patterns around their field center.',
      },
      fieldDetail: {
        kind: 'number',
        label: 'Field detail',
        min: 1,
        max: 6,
        step: 1,
        unit: 'count',
        default: 3,
        description: 'Number of finer noise octaves contributing to the field.',
      },
      fieldRoughness: {
        kind: 'number',
        label: 'Field roughness',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.5,
        description: 'Contribution of finer noise octaves.',
      },
      fieldSeed: {
        kind: 'number',
        label: 'Field seed',
        min: 0,
        max: 65535,
        step: 1,
        unit: 'count',
        default: 8172,
        description: 'Saved independent seed for this reusable height field.',
      },
      fieldContrast: {
        kind: 'number',
        label: 'Field contrast',
        min: 0.1,
        max: 4,
        step: 0.01,
        unit: 'multiplier',
        default: 1,
        description: 'Expand or compress height values around the midpoint.',
      },
      fieldSmoothing: {
        kind: 'number',
        label: 'Field smoothing',
        min: 0,
        max: 10,
        step: 0.1,
        unit: 'image-percent',
        default: 0,
        description:
          'Smooth heights over this percentage of the shorter image side before normalization and contrast.',
      },
      fieldNear: {
        kind: 'number',
        label: 'Near',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 1,
        description:
          'Height mapped to the foreground end of the depth range. Move below Far to invert the selected range.',
      },
      fieldFar: {
        kind: 'number',
        label: 'Far',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Height mapped to the background end of the depth range. Equal values produce a hard threshold.',
      },
      fieldFalloff: {
        kind: 'number',
        label: 'Field falloff',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Blend a smooth height transition into the selected near/far range; 0% keeps a linear or hard transition.',
      },
      strength: {
        kind: 'number',
        label: 'Displacement',
        min: -50,
        max: 50,
        step: 0.1,
        unit: 'image-percent',
        default: 8,
        description:
          'Move pixels along Direction according to their field height relative to the midpoint.',
      },
      direction: {
        kind: 'number',
        label: 'Direction',
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        default: 0,
        description: 'Direction of depth-driven pixel displacement or contour slicing.',
      },
      contourCount: {
        kind: 'number',
        label: 'Contour count',
        min: 2,
        max: 64,
        step: 1,
        unit: 'count',
        default: 12,
        description: 'Number of discrete height terraces and visible contour bands.',
      },
      contourWidth: {
        kind: 'number',
        label: 'Contour width',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.15,
        description:
          'Thickness of color bands along each height terrace. Zero hides the bands while retaining slicing.',
      },
      contourOffset: {
        kind: 'number',
        label: 'Contour offset',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Shift the contour bands and terraces through one height interval without moving the depth map.',
      },
      contourSoftness: {
        kind: 'number',
        label: 'Contour softness',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Soften the contour ink falloff. Zero keeps a sharp antialiased edge; higher values feather the bands.',
      },
      terraceBevel: {
        kind: 'number',
        label: 'Terrace bevel',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.15,
        description:
          'Fraction of each height interval used to smooth the step into the next terrace. Zero creates hard steps; 100% rounds the whole interval.',
      },
      lightElevation: {
        kind: 'number',
        label: 'Light elevation',
        min: 5,
        max: 90,
        step: 1,
        unit: 'degrees',
        default: 49,
        description:
          'Height of the light above the surface. Low angles emphasize ridges; 90 degrees lights from directly above.',
      },
      ambient: {
        kind: 'number',
        label: 'Ambient light',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.2,
        description:
          'Fill the shaded areas with uniform light. Higher values reduce the contrast of relief lighting.',
      },
      highlights: {
        kind: 'number',
        label: 'Relief highlights',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Add narrow highlights where relief normals face the simulated light. Zero keeps diffuse lighting only.',
      },
      lightAngle: {
        kind: 'number',
        label: 'Light angle',
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        default: 315,
        description: 'Direction of simulated relief lighting across the height field.',
      },
      relief: {
        kind: 'number',
        label: 'Relief strength',
        min: 0,
        max: 4,
        step: 0.01,
        unit: 'multiplier',
        default: 1,
        description: 'Strength of relief shading derived from height gradients.',
      },
      fieldX: {
        ...imagePosition,
        label: 'Field position X',
        description: 'Horizontal field center on the image canvas.',
      },
      fieldY: {
        ...imagePosition,
        label: 'Field position Y',
        description: 'Vertical field center on the image canvas.',
      },
      fieldColor: {
        kind: 'color',
        gradient: 'field',
        label: 'Contour color',
        default: '#f1cc6b',
        description: 'Solid or gradient contour ink mapped through field height.',
      },
      edgeHandling,
    },
  },

  'compression-breakup': {
    title: 'Compression Breakup',
    finish: 'image',
    description: 'Break image detail into damaged compression blocks and bleeding color.',
    hint: 'A still-image compression simulation. Compression discards block detail; Color resolution and Bleed degrade color independently. Add Ringing, Block seams or seeded damaged blocks. Source transparency is retained.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      compression: {
        kind: 'number',
        label: 'Compression',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.55,
        description:
          'Quantize the block transform. Higher values remove fine detail and create stronger stepped tonal patches. This simulates compression without encoding a JPEG.',
      },
      blockSize: {
        ...blockSize,
        min: 0.5,
        max: 12,
        default: 3,
        description:
          'Width of each square compression block as a percentage of the shorter image side, with a minimum of eight source pixels. Larger blocks produce coarser damage; positions stay fixed in original-image coordinates.',
      },
      colorResolution: {
        kind: 'choice',
        label: 'Color resolution',
        default: 'half',
        description:
          'Resolution of color information inside each block. Luminance keeps its own detail; lower color resolution creates broad color patches.',
        options: [
          { value: 'full', label: 'Full' },
          { value: 'half', label: 'Half' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'block', label: 'One color per block' },
        ],
      },
      colorBleed: {
        kind: 'number',
        label: 'Color bleed',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.15,
        description:
          'Shift sampled color horizontally by up to one block width while keeping luminance in place. Edge Handling controls color sampling beyond the canvas.',
      },
      ringing: {
        kind: 'number',
        label: 'Ringing',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.2,
        description:
          'Exaggerate light and dark halos around contrast edges in the decoded block detail.',
      },
      seams: {
        kind: 'number',
        label: 'Block seams',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.15,
        description: 'Darken narrow edges between compression blocks. Zero hides the added seams.',
      },
      damageDensity: {
        kind: 'number',
        label: 'Damage density',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.12,
        description:
          'Fraction of seeded compression blocks with extra decoder-style damage. New pattern changes which blocks fail. Zero disables damage.',
      },
      damageMode: {
        kind: 'choice',
        label: 'Damage type',
        default: 'mixed',
        description:
          'Mixed chooses a failure per block. Color shift corrupts color, DC dropout changes average block brightness, and Coefficient loss drops detail frequencies.',
        options: [
          { value: 'mixed', label: 'Mixed' },
          { value: 'color-shift', label: 'Color shift' },
          { value: 'dropout', label: 'DC dropout' },
          { value: 'coefficient-loss', label: 'Coefficient loss' },
        ],
      },
      damageStrength: {
        kind: 'number',
        label: 'Damage strength',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.65,
        description:
          'Severity of the selected block failures, independently of their density. Zero removes extra damage.',
      },
      edgeHandling,
    },
  },

  'feedback-bloom': {
    title: 'Feedback Bloom / Melt',
    finish: 'image',
    description: 'Accumulate expanding echoes or melting image feedback.',
    hint: 'Each pass transforms the previous simulated result. Use Scale and Rotation for echoes, or Melt and Direction for flowing trails. Saved seeds reproduce the same feedback.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: {
        kind: 'choice',
        label: 'Style',
        default: 'bloom',
        description:
          'Bloom expands repeated echoes around a center. Melt drags them along a coherent flowing field.',
        options: [
          { value: 'bloom', label: 'Bloom' },
          { value: 'melt', label: 'Melt' },
        ],
      },
      iterations: {
        kind: 'number',
        label: 'Iterations',
        min: 1,
        max: 24,
        step: 1,
        unit: 'count',
        default: 8,
        description:
          'Number of feedback passes. Each pass transforms the preceding result; more passes accumulate longer trails.',
      },
      displacement: {
        kind: 'number',
        label: 'Displacement',
        min: 0,
        max: 12,
        step: 0.1,
        unit: 'image-percent',
        default: 2,
        description:
          'Travel per pass as a percentage of the shorter image side. Bloom swells outward; Melt flows along Direction.',
      },
      scale: {
        kind: 'number',
        label: 'Scale',
        min: 0.8,
        max: 1.2,
        step: 0.005,
        unit: 'multiplier',
        default: 1.025,
        description:
          'Scale of each feedback copy. Above 1 expands echoes; below 1 pulls them inward.',
      },
      rotation: {
        kind: 'number',
        label: 'Rotation',
        min: -30,
        max: 30,
        step: 0.1,
        unit: 'degrees',
        default: 2,
        description:
          'Rotate each feedback copy around the center, accumulating a spiral over successive passes.',
      },
      direction: {
        kind: 'number',
        label: 'Direction',
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        default: 90,
        description: 'Direction of the melt flow. 90 degrees flows downward.',
      },
      persistence: {
        kind: 'number',
        label: 'Persistence',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.85,
        description:
          'How much transformed feedback survives each pass. Lower values restore more of the incoming image.',
      },
      decay: {
        kind: 'number',
        label: 'Decay',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.03,
        description:
          'Fade feedback color and transparency each pass. The incoming image supplies fresh detail.',
      },
      refresh: {
        kind: 'number',
        label: 'Refresh',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.02,
        description:
          'Fraction of seeded patches restored from the incoming image on each pass, interrupting the feedback trails.',
      },
      coherence: {
        kind: 'number',
        label: 'Coherence',
        min: 1,
        max: 100,
        step: 1,
        unit: 'image-percent',
        default: 25,
        description:
          'Size of the flow and refresh patches relative to the shorter image side. Larger values produce broader motion.',
      },
      centerX: {
        ...imagePosition,
        label: 'Center X',
        description: 'Horizontal center of the feedback scale and rotation.',
      },
      centerY: {
        ...imagePosition,
        label: 'Center Y',
        description: 'Vertical center of the feedback scale and rotation.',
      },
      edgeHandling,
    },
  },

  'pixel-sort': {
    title: 'Pixel Sorting',
    finish: 'image',
    description: 'Reorder selected pixel stretches into tonal or colored streaks.',
    hint: 'Sort contiguous selected colors along Direction. Thresholds and transparent gaps split the stretches; Length limits each run. Density and Boundary breaks use saved seeds. Source alpha stays in place.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      criterion: {
        kind: 'choice',
        label: 'Sort by',
        default: 'brightness',
        description:
          'Use the selected measure for both threshold selection and ordering. Brightness follows image tones; Hue follows the color wheel; Saturation orders muted to vivid colors.',
        options: [
          { value: 'brightness', label: 'Brightness' },
          { value: 'hue', label: 'Hue' },
          { value: 'saturation', label: 'Saturation' },
        ],
      },
      thresholdStart: {
        kind: 'number',
        label: 'Threshold start',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.08,
        description:
          'Start of the selected range. Brightness and saturation use 0-100%. Hue runs around the color wheel: red at 0%, green near 33%, blue near 67%. A hue start above the end selects across the red seam. Other criteria accept either endpoint order.',
      },
      thresholdEnd: {
        kind: 'number',
        label: 'Threshold end',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.95,
        description:
          'End of the selected range. Pixels outside the range remain unchanged and split sort runs. Swapping hue endpoints can select across the red seam; brightness and saturation use the interval between the endpoints.',
      },
      direction: {
        kind: 'number',
        label: 'Direction',
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        default: 0,
        description:
          'Direction in original-image coordinates: 0 degrees runs left to right, 90 top to bottom, 180 right to left and 270 bottom to top. Intermediate angles follow discrete pixel lines without resampling the image.',
      },
      length: {
        kind: 'number',
        label: 'Streak length',
        min: 0,
        max: 100,
        step: 1,
        unit: 'image-percent',
        default: 40,
        description:
          'Maximum length of a sorted stretch as a percentage of the original canvas span along Direction. 100% allows whole selected runs; lower values split them into shorter streaks. Zero restores the incoming image.',
      },
      order: {
        kind: 'choice',
        label: 'Order',
        default: 'ascending',
        description:
          'Ascending orders dark-to-light, early-to-late hue or muted-to-vivid saturation along Direction. Descending reverses the ordering. Equal values retain their original relative order.',
        options: [
          { value: 'ascending', label: 'Ascending' },
          { value: 'descending', label: 'Descending' },
        ],
      },
      density: {
        kind: 'number',
        label: 'Density',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 1,
        description:
          'Fraction of seeded stretches that are sorted. Zero restores the incoming image; 100% sorts every eligible stretch. New pattern changes the chosen stretches.',
      },
      breakup: {
        kind: 'number',
        label: 'Boundary breaks',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Add seeded breaks to otherwise continuous selected runs. Higher values fragment the streaks; zero keeps only threshold, transparency and length boundaries. New pattern changes the broken boundaries.',
      },
    },
  },
  'chroma-mosh': {
    title: 'Chroma Mosh',
    finish: 'image',
    description: 'Drag, freeze and smear color while retaining sharp brightness detail.',
    hint: 'A still-image color corruption treatment. Smear flows continuously; Blocks retain seeded color patches; Trails leave persistent color echoes. Brightness and source transparency stay in place.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      style: {
        kind: 'choice',
        label: 'Style',
        default: 'trails',
        description:
          'Smear moves color continuously. Blocks reuse coarse color cells with seeded travel. Trails accumulate several color samples with persistence.',
        options: [
          { value: 'smear', label: 'Smear' },
          { value: 'blocks', label: 'Blocks' },
          { value: 'trails', label: 'Trails' },
        ],
      },
      colorResolution: {
        kind: 'number',
        label: 'Chroma size',
        min: 0.1,
        max: 25,
        step: 0.1,
        unit: 'image-percent',
        default: 2,
        description:
          'Size of shared color cells as a percentage of the shorter image side. Larger cells create coarse bleeding color patches while preserving brightness detail.',
      },
      displacement: {
        kind: 'number',
        label: 'Color travel',
        min: 0,
        max: 50,
        step: 0.1,
        unit: 'image-percent',
        default: 8,
        description:
          'Travel of color information along Direction. Brightness and transparency remain at their original pixels.',
      },
      direction: {
        kind: 'number',
        label: 'Direction',
        min: 0,
        max: 360,
        step: 1,
        unit: 'degrees',
        default: 0,
        description:
          'Direction of the displaced color: 0 degrees is horizontal and 90 degrees is vertical.',
      },
      density: {
        kind: 'number',
        label: 'Density',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.8,
        description:
          'Fraction of seeded color cells affected by Blocks and Trails. New pattern changes the selected cells.',
      },
      persistence: {
        kind: 'number',
        label: 'Persistence',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.7,
        description:
          'Weight retained by distant color samples in a trail. Higher values produce stronger lingering color.',
      },
      samples: {
        kind: 'number',
        label: 'Trail samples',
        min: 1,
        max: 12,
        step: 1,
        unit: 'count',
        default: 6,
        description:
          'Number of color samples along each trail. More samples make a smoother smear; work is bounded for responsive rendering.',
      },
      chromaMix: {
        kind: 'number',
        label: 'Color mix',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 1,
        description:
          'Mix damaged color into the original color while retaining the original brightness. Zero restores the original image.',
      },
      edgeHandling,
    },
  },
  'motion-mosh': {
    title: 'Motion Mosh',
    finish: 'image',
    description: 'Drag frozen blocks into persistent directional trails.',
    hint: 'Simulate block motion from one still image. Density selects frozen blocks; Travel moves them; Trail length and Persistence retain earlier positions. New pattern changes the selected blocks.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      blockSize,
      coherence: reductionNumber(
        'Coherence',
        1,
        0,
        1,
        'percent',
        'Higher coherence follows the selected direction or shared field. Lower values add seeded angular disorder per block. 100% with Native retains the original motion.',
      ),
      density: {
        kind: 'number',
        label: 'Density',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.55,
        description:
          'Fraction of source blocks selected for motion. New pattern changes the selection; 0% leaves the image unchanged, and 100% moves all blocks.',
      },
      direction: {
        ...rotation,
        label: 'Direction',
        description:
          'Direction the blocks travel: 0° moves right, 90° moves down, 180° moves left, and 270° moves up.',
      },
      travel: {
        kind: 'number',
        label: 'Travel',
        min: 0,
        max: 100,
        step: 0.1,
        unit: 'image-percent',
        default: 18,
        description:
          'Distance the selected blocks move, as a percentage of the shorter original image side. Zero travel preserves the input.',
      },
      trailLength: {
        kind: 'number',
        label: 'Trail length',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.85,
        description:
          'How much of the travel path retains earlier block positions. 0% shows only the final displaced blocks; 100% reaches back to their original positions.',
      },
      persistence: {
        kind: 'number',
        label: 'Persistence',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.75,
        description:
          'Visibility of earlier trail positions. 0% shows only the latest position; 100% holds earlier positions at full strength.',
      },
      samples: {
        kind: 'number',
        label: 'Trail samples',
        min: 1,
        max: 16,
        step: 1,
        unit: 'count',
        default: 8,
        description:
          'Number of retained positions along each trail. More positions make denser smears and take longer to render; one shows just the final position.',
      },
      edgeHandling,
    },
  },
  'jpeg-recompression': {
    title: 'JPEG Recompression',
    finish: 'image',
    description: 'Repeated real JPEG compression creates block damage, ringing and color bleed.',
    hint: 'Run actual JPEG encode/decode generations on the incoming image. Low quality and chroma subsampling expose codec damage. Transparency is retained; fully transparent pixels use neutral gray inside the codec so hidden colors cannot leak.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      quality: reductionNumber(
        'Quality',
        18,
        1,
        100,
        'count',
        'JPEG quality of the first generation. Lower values produce stronger block and ringing damage; 100 is still lossy.',
      ),
      generations: reductionNumber(
        'Generations',
        3,
        1,
        8,
        'count',
        'Number of sequential JPEG encode/decode passes. Each pass starts from the preceding decoded image. More generations take longer and may converge when quality loss is zero.',
      ),
      qualityLoss: reductionNumber(
        'Quality loss per generation',
        3,
        0,
        20,
        'count',
        'Subtract this many quality points for each later generation, down to a minimum quality of 1. Zero recompresses at the same quality.',
      ),
      chromaSubsampling: reductionChoice(
        'Chroma subsampling',
        '420',
        [
          ['420', '4:2:0 — reduced color detail'],
          ['444', '4:4:4 — full color detail'],
        ],
        '4:2:0 encodes color at reduced resolution, creating more bleed around colored edges. 4:4:4 retains full color sampling while still compressing each channel.',
      ),
    },
  },
  shapes: {
    title: 'Shapes',
    finish: 'image',
    description: 'Mask, cut, warp, or color single and tiled geometric regions.',
    hint: 'Place a single primitive or tile a grid, staggered rows or radial rings. Rotate the layout independently of its shapes, and progress rotation or polygon sides across an adjustable field.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      layout: {
        kind: 'choice',
        label: 'Layout',
        default: 'single',
        description:
          'Single retains the original one-shape workflow. Tiled repeats shapes across the image, with Size relative to tile spacing.',
        options: [
          { value: 'single', label: 'Single' },
          { value: 'tiled', label: 'Tiled' },
        ],
      },
      tilePattern: {
        kind: 'choice',
        label: 'Tile pattern',
        default: 'grid',
        description:
          'Grid uses aligned rows; Staggered offsets alternating rows; Radial distributes shapes across concentric rings.',
        options: [
          { value: 'grid', label: 'Grid' },
          { value: 'staggered', label: 'Staggered' },
          { value: 'radial', label: 'Radial' },
        ],
      },
      spacing: {
        kind: 'number',
        label: 'Spacing',
        min: 2,
        max: 100,
        step: 0.5,
        unit: 'image-percent',
        default: 20,
        description:
          'Distance between grid centers or radial rings, as a percentage of the shorter original image side. Size controls each shape as a fraction of this spacing.',
      },
      layoutRotation: {
        ...rotation,
        label: 'Layout rotation',
        description:
          'Rotate tile positions around Position X/Y without changing individual shape rotation.',
      },
      radialRepeats: {
        kind: 'number',
        label: 'Radial repeats',
        min: 3,
        max: 24,
        step: 1,
        unit: 'count',
        default: 8,
        description:
          'Shapes on the first radial ring. Each successive ring has this many additional shapes, keeping outer rings populated.',
      },
      shape: {
        kind: 'choice',
        label: 'Shape',
        default: 'circle',
        description:
          'Choose the primitive used by the operation. Ring thickness controls the hole in a ring.',
        options: [
          { value: 'triangle', label: 'Triangle' },
          { value: 'square', label: 'Square' },
          { value: 'circle', label: 'Circle' },
          { value: 'ring', label: 'Ring' },
          { value: 'polygon', label: 'Polygon' },
        ],
      },
      operation: {
        kind: 'choice',
        label: 'Operation',
        default: 'keep-inside',
        description:
          'Keep inside retains the primitive and makes its surroundings transparent. Cut out removes it. Distort zooms and twists the pixels inside it. Overlay colors the region without adding opacity outside the image.',
        options: [
          { value: 'keep-inside', label: 'Keep inside' },
          { value: 'cut-out', label: 'Cut out' },
          { value: 'distort', label: 'Distort' },
          { value: 'overlay', label: 'Overlay' },
        ],
      },
      size: {
        kind: 'number',
        label: 'Size',
        min: 1,
        max: 200,
        step: 0.1,
        unit: 'image-percent',
        default: 65,
        description:
          'Single: size as a percentage of the shorter image side. Tiled: size as a percentage of tile spacing. Scale multiplies the base size independently of spacing.',
      },
      scale: {
        kind: 'number',
        label: 'Scale',
        min: 0.1,
        max: 4,
        step: 0.01,
        unit: 'multiplier',
        default: 1,
        description:
          'Multiply the primitive size without changing its saved base Size. 1× keeps the base size.',
      },
      rotation: {
        ...rotation,
        description:
          'Rotate the primitive around its position. Circles and rings have rotational symmetry; triangle and square visibly rotate.',
      },
      rotationStyle: {
        kind: 'choice',
        label: 'Rotation style',
        default: 'uniform',
        description:
          'Uniform uses Rotation everywhere. Linear progresses toward End rotation. Graduated eases that progression. Random uses stable seeded angles between the two values.',
        options: [
          { value: 'uniform', label: 'Uniform' },
          { value: 'linear', label: 'Linear' },
          { value: 'graduated', label: 'Graduated' },
          { value: 'random', label: 'Random' },
        ],
      },
      endRotation: {
        ...rotation,
        label: 'End rotation',
        default: 180,
        description:
          'Final angle for Linear/Graduated rotation, or the second bound for seeded Random rotation. Rotation supplies the starting angle.',
      },
      startSides: {
        kind: 'number',
        label: 'Start sides',
        min: 3,
        max: 12,
        step: 1,
        unit: 'count',
        default: 6,
        description:
          'Polygon side count for Single/Uniform, or the starting side count for tiled progression. Counts are always discrete integers.',
      },
      endSides: {
        kind: 'number',
        label: 'End sides',
        min: 3,
        max: 12,
        step: 1,
        unit: 'count',
        default: 3,
        description:
          'Final polygon side count, or the second bound for Random side counts. For example, Start sides 10 and End sides 3 progresses from decagons to triangles.',
      },
      polygonStyle: {
        kind: 'choice',
        label: 'Polygon style',
        default: 'uniform',
        description:
          'Uniform keeps Start sides. Linear or Graduated changes discrete side counts across the field; Random selects an integer between Start sides and End sides for each tile.',
        options: [
          { value: 'uniform', label: 'Uniform' },
          { value: 'linear', label: 'Linear' },
          { value: 'graduated', label: 'Graduated' },
          { value: 'random', label: 'Random' },
        ],
      },
      positionX: {
        ...imagePosition,
        label: 'Position X',
        description:
          'Horizontal center of the single shape or tile layout, as a percentage of image width. 50% centers it.',
      },
      positionY: {
        ...imagePosition,
        label: 'Position Y',
        description:
          'Vertical center of the single shape or tile layout, as a percentage of image height. 50% centers it.',
      },
      progressionField: {
        kind: 'choice',
        label: 'Progression field',
        default: 'left-right',
        description:
          'Shared spatial progression for rotation and polygon sides. Linear directions cross the image; Radial expands in circles; Square expands in square bands.',
        options: [
          { value: 'left-right', label: 'Left to right' },
          { value: 'right-left', label: 'Right to left' },
          { value: 'top-bottom', label: 'Top to bottom' },
          { value: 'bottom-top', label: 'Bottom to top' },
          { value: 'radial', label: 'Radial' },
          { value: 'square', label: 'Square' },
        ],
      },
      progressionX: {
        ...imagePosition,
        label: 'Progression center X',
        description:
          'Move the horizontal midpoint/origin of the progression field independently of the tile layout.',
      },
      progressionY: {
        ...imagePosition,
        label: 'Progression center Y',
        description:
          'Move the vertical midpoint/origin of the progression field independently of the tile layout.',
      },
      progressionRange: {
        kind: 'number',
        label: 'Progression range',
        min: 10,
        max: 200,
        step: 1,
        unit: 'image-percent',
        default: 100,
        description:
          'Width/height of a directional progression as a percentage of that image axis. Radial/Square use half this percentage of the shorter side as their endpoint radius. Smaller ranges reach the final values sooner.',
      },
      ringThickness: {
        kind: 'number',
        label: 'Ring thickness',
        min: 0.01,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0.25,
        description:
          'Ring wall thickness as a fraction of its outer radius. 100% fills the hole and produces a disk. Used only by Ring.',
      },
      feather: {
        kind: 'number',
        label: 'Edge softness',
        min: 0,
        max: 25,
        step: 0.1,
        unit: 'image-percent',
        default: 0,
        description:
          'Feather edges as a percentage of the shorter image side in Single, or tile spacing in Tiled. 0% keeps a crisp antialiased edge; higher values create a gradual falloff.',
      },
      distortionScale: {
        kind: 'number',
        label: 'Content scale',
        min: 0.25,
        max: 4,
        step: 0.01,
        unit: 'multiplier',
        default: 1.5,
        description:
          'Zoom the image contents within the primitive in Distort mode. This changes sampled content, independently of the primitive Size and Scale.',
      },
      twist: {
        ...rotation,
        label: 'Twist',
        min: -180,
        max: 180,
        default: 45,
        description:
          'Twist the image contents around the primitive center in Distort mode. Rotation still controls the shape boundary.',
      },
      shapeColor: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Shape color',
        default: '#f4ce65',
        description:
          'Color painted within the primitive in Overlay mode. Blend mode and Opacity control its combination with the input.',
      },
      edgeHandling,
    },
  },
  mandelbrot: {
    title: 'Mandelbrot',
    finish: 'image',
    description: 'Weave images through Mandelbrot and Julia fractals.',
    hint: 'Explore the fractal boundary, repeat image pieces with Image Weave, or use orbit distortion, color texture, and cutouts.',
    parameters: {
      amount,
      ...IMAGE_FINISH_PARAMETERS,
      operation: {
        kind: 'choice',
        label: 'Operation',
        default: 'weave',
        description:
          'Image Weave repeats and transforms image pieces through the fractal orbit. Color Texture paints escape-time bands. Distort displaces pixels. Keep set and Cut out mask the bounded region.',
        options: [
          { value: 'weave', label: 'Image Weave' },
          { value: 'texture', label: 'Color Texture' },
          { value: 'distort', label: 'Distort' },
          { value: 'keep-set', label: 'Keep set' },
          { value: 'cut-out', label: 'Cut out' },
        ],
      },
      formula: {
        kind: 'choice',
        label: 'Fractal set',
        default: FRACTAL_DEFAULTS.formula,
        description:
          'Mandelbrot varies the formula parameter across the image; Julia uses a fixed parameter and varies the starting point.',
        options: [
          { value: 'mandelbrot', label: 'Mandelbrot' },
          { value: 'julia', label: 'Julia' },
        ],
      },
      juliaReal: {
        kind: 'number',
        label: 'Julia real',
        min: -2,
        max: 2,
        step: 0.0001,
        unit: 'coordinate',
        default: FRACTAL_DEFAULTS.juliaReal,
        description:
          'Real part of Julia’s formula parameter. Small changes reshape the fractal; this is separate from its view center.',
      },
      juliaImaginary: {
        kind: 'number',
        label: 'Julia imaginary',
        min: -2,
        max: 2,
        step: 0.0001,
        unit: 'coordinate',
        default: FRACTAL_DEFAULTS.juliaImaginary,
        description:
          'Imaginary part of Julia’s formula parameter. Use Explore for curated starting shapes and precise values.',
      },
      centerReal: {
        kind: 'number',
        label: 'Real center',
        min: -3,
        max: 3,
        step: 0.0000000001,
        unit: 'coordinate',
        default: -0.5,
        description:
          'Real coordinate at the center of the fractal viewport. Move horizontally through the complex plane; this does not move the source image.',
      },
      centerImaginary: {
        kind: 'number',
        label: 'Imaginary center',
        min: -3,
        max: 3,
        step: 0.0000000001,
        unit: 'coordinate',
        default: 0,
        description:
          'Imaginary coordinate at the center of the fractal viewport. Move vertically through the complex plane.',
      },
      zoom: {
        kind: 'number',
        label: 'Fractal zoom',
        min: 0.25,
        max: 100000,
        step: 0.01,
        unit: 'multiplier',
        default: 1,
        description:
          'Zoom the complex-plane viewport around Real/Imaginary center. 1× shows 3.4 complex units across the shorter image side. Higher values reveal boundary detail.',
      },
      rotation: {
        ...rotation,
        description:
          'Rotate the complex-plane viewport around its center without changing source-image orientation.',
      },
      iterations: {
        kind: 'number',
        label: 'Iterations',
        min: 8,
        max: 512,
        step: 1,
        unit: 'count',
        default: 64,
        description:
          'Maximum z² + c steps before treating a point as inside. Higher values resolve more boundary detail but take longer. Classification is a finite approximation.',
      },
      paletteCycles: {
        kind: 'number',
        label: 'Palette cycles',
        min: 1,
        max: 16,
        step: 0.1,
        unit: 'cycles',
        default: 4,
        description:
          'Number of color oscillations over the escape-time range in Texture mode. Higher values produce more contrasting fractal bands.',
      },
      paletteOffset: {
        kind: 'number',
        label: 'Palette offset',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: 0,
        description:
          'Shift the texture palette through one complete color cycle. This changes colors without moving the fractal geometry.',
      },
      outsideColor: {
        kind: 'color',
        gradient: 'field',
        label: 'Outside color',
        default: '#f4ce65',
        description: 'One end of the exterior escape-time palette in Texture mode.',
      },
      insideColor: {
        kind: 'color',
        label: 'Inside color',
        default: '#162b60',
        description:
          'Color of the bounded region, and the other end of the exterior palette in Texture mode.',
      },
      distortion: {
        kind: 'number',
        label: 'Distortion',
        min: 0,
        max: 50,
        step: 0.1,
        unit: 'image-percent',
        default: 18,
        description:
          'Maximum source displacement in Distort mode, as a percentage of the shorter original image side. The bounded complex orbit determines the direction; zero leaves source pixels unchanged.',
      },
      weaveScale: {
        kind: 'number',
        label: 'Image scale',
        min: 0.25,
        max: 8,
        step: 0.01,
        unit: 'multiplier',
        default: FRACTAL_DEFAULTS.weaveScale,
        description:
          'Scale image pieces inside Image Weave without changing the fractal view. Larger values enlarge recognizable pieces.',
      },
      weaveRotation: {
        ...rotation,
        label: 'Image rotation',
        default: FRACTAL_DEFAULTS.weaveRotation,
        description:
          'Rotate sampled image pieces independently of fractal view rotation in Image Weave.',
      },
      weaveMirror: {
        kind: 'choice',
        label: 'Mirror pieces',
        default: FRACTAL_DEFAULTS.weaveMirror,
        description:
          'Alternate reflected image pieces according to the chosen orbit step in Image Weave.',
        options: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
      },
      abstraction: {
        kind: 'number',
        label: 'Abstraction',
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        default: FRACTAL_DEFAULTS.abstraction,
        description:
          'Move source coordinates from the incoming image toward repeated orbit-mapped pieces. 0% preserves the image; 100% fully follows the fractal.',
      },
      edgeHandling,
    },
  },
  scanlines: {
    title: 'Scanlines',
    finish: 'pattern',
    description: 'Add TV raster lines and monitor phosphor patterns.',
    hint: 'Monitor uses crisp bands; TV softens them; Interlaced darkens alternate fields; Phosphor grille separates RGB stripes. Patterns stay anchored to the original image and preserve transparency.',
    parameters: {
      amount,
      style: {
        kind: 'choice',
        label: 'Style',
        default: 'monitor',
        description:
          'Monitor creates crisp raster bands; TV uses rounded dark bands; Interlaced darkens alternating raster intervals; Phosphor grille creates vertical RGB stripes.',
        options: [
          { value: 'monitor', label: 'Monitor' },
          { value: 'tv', label: 'TV' },
          { value: 'interlaced', label: 'Interlaced' },
          { value: 'grille', label: 'Phosphor grille' },
        ],
      },
      blendMode: {
        ...blendMode,
        description:
          'Combine the line color with the incoming image: Normal paints it; Multiply darkens; Screen lightens; Add increases brightness; Overlay combines contrast; Difference creates inverted contrasts. Intensity and Opacity control the mix.',
      },
      color: {
        kind: 'color',
        gradient: 'spatial',
        label: 'Line color',
        default: SCANLINE_FINISH_DEFAULTS.color,
        description:
          'Choose the color of the scanlines and their halo. Black darkens in Normal or Multiply; white brightens in Normal, Screen, or Add. Grille uses the color with its separate RGB stripe masks. Click the swatch to open the color picker.',
      },
      invert: {
        kind: 'choice',
        label: 'Invert lines',
        default: SCANLINE_FINISH_DEFAULTS.invert,
        description:
          'Invert the selected line color: black becomes white, white becomes black, and custom colors become their complementary colors. This leaves the line placement unchanged.',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ],
      },
      frequency: {
        kind: 'number',
        label: 'Frequency',
        default: 80,
        min: 1,
        max: 1000,
        step: 1,
        unit: 'cycles',
        description:
          'Number of raster intervals across a distance equal to the shorter original image side. Higher values make finer lines. Interlaced darkens every other interval; Phosphor grille counts complete RGB stripe groups. Fine patterns are averaged when smaller than a preview or export pixel.',
      },
      thickness: {
        kind: 'number',
        label: 'Thickness',
        default: 0.35,
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        description:
          'Width of each dark band as a percentage of its raster interval. For Phosphor grille, this sets the dark gap between colored stripes. 0% removes the gaps; 100% fills them.',
      },
      intensity: {
        kind: 'number',
        label: 'Intensity',
        default: 0.65,
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        description:
          'How strongly the pattern darkens the image or separates its RGB colors. 0% leaves the incoming pixels unchanged; 100% applies the deepest bands or strongest color separation. Transparency stays unchanged.',
      },
      rotation: {
        kind: 'number',
        label: 'Rotation',
        default: 0,
        min: 0,
        max: 180,
        step: 1,
        unit: 'degrees',
        description:
          'Rotate the pattern from its native orientation. At 0°, Monitor, TV, and Interlaced run horizontally; Phosphor grille runs vertically. 90° turns the pattern a quarter turn.',
      },
      offset: {
        kind: 'number',
        label: 'Offset',
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        description:
          'Slide the pattern through one complete repeating cycle. 0% and 100% align identically. Interlaced repeats over two raster intervals; a grille cycle includes all three RGB stripes.',
      },
      field: {
        kind: 'choice',
        label: 'Field',
        default: 'even',
        description:
          'Choose which alternating raster field is darkened in Interlaced style. Even darkens the first interval of each pair; Odd darkens the second. This is a still-image treatment, with no animated field switching.',
        options: [
          { value: 'even', label: 'Even' },
          { value: 'odd', label: 'Odd' },
        ],
      },
      glow: {
        kind: 'number',
        label: 'Glow',
        default: SCANLINE_FINISH_DEFAULTS.glow,
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        description:
          'Spread a soft halo around the lines using their color and blend mode. White or bright colors create glow; black creates a soft shadow. 0% keeps the original crisp pattern. The halo stays within existing transparency.',
      },
      glowSize: {
        kind: 'number',
        label: 'Glow size',
        default: SCANLINE_FINISH_DEFAULTS.glowSize,
        min: 0.1,
        max: 10,
        step: 0.1,
        unit: 'image-percent',
        description:
          'Radius of the line halo as a percentage of the shorter original image side. Larger values spread it across more neighboring bands. Glow must be above 0% to enable this control.',
      },
      signalError: {
        kind: 'choice',
        label: 'Signal error',
        default: SCANLINE_FINISH_DEFAULTS.signalError,
        description:
          'Simulate still-image signal failures: Line Jitter shifts individual raster intervals; Sync Loss jumps groups and their vertical alignment; Rolling Tear displaces one seeded tear band; Dropout removes selected bands. New pattern changes the failure layout.',
        options: [
          { value: 'none', label: 'None' },
          { value: 'jitter', label: 'Line Jitter' },
          { value: 'sync-loss', label: 'Sync Loss' },
          { value: 'tear', label: 'Rolling Tear' },
          { value: 'dropout', label: 'Dropout' },
        ],
      },
      errorStrength: {
        kind: 'number',
        label: 'Error strength',
        default: SCANLINE_FINISH_DEFAULTS.errorStrength,
        min: 0,
        max: 1,
        step: 0.01,
        unit: 'percent',
        description:
          'Strength of the selected signal failure. Increase travel for Jitter/Sync Loss, the width and travel of a tear band, or the fraction of dropped bands. 0% restores a stable raster. Displaced content carries its transparency.',
      },
      errorPositionX: {
        ...errorPosition,
        label: 'Error position X',
        description:
          'Move the signal failure right (positive) or left (negative), as a percentage of image width. This moves only the failure field, leaving raster Offset unchanged. Full-width horizontal bands have no horizontal position; rotate the lines to enable this axis.',
      },
      errorPositionY: {
        ...errorPosition,
        label: 'Error position Y',
        description:
          'Move the signal failure down (positive) or up (negative), as a percentage of image height. This moves only the failure field, leaving raster Offset unchanged. Full-height vertical bands have no vertical position; rotate the lines to enable this axis.',
      },
      edgeHandling,
    },
  },
};

// Flat, optional parameters travel through the existing edit/project/preset paths.
// Color metadata also keeps the editor and validation in agreement for new filters.
export const HEIGHT_FIELD_DEFAULTS = Object.fromEntries(
  DEPTH_FIELD_KEYS.map((key) => [
    key,
    BASE_EFFECT_DEFINITIONS['depth-field'].parameters[key]!.default,
  ]),
) as HeightFieldParams;
export function heightFieldParams(params: Partial<HeightFieldParams>): HeightFieldParams {
  return Object.fromEntries(
    DEPTH_FIELD_KEYS.map((key) => [key, params[key] ?? HEIGHT_FIELD_DEFAULTS[key]]),
  ) as HeightFieldParams;
}
const FIELD_CONSUMER_PARAMETERS: Readonly<Record<string, ParameterDefinition>> = Object.fromEntries(
  DEPTH_FIELD_KEYS.map((key) => [key, BASE_EFFECT_DEFINITIONS['depth-field'].parameters[key]!]),
);
const BLUR_FOCUS_PARAMETERS: Readonly<Record<string, ParameterDefinition>> = {
  nearBlur: reductionNumber(
    'Near blur strength',
    1,
    0,
    3,
    'multiplier',
    'Scale Radius on the near/high side of the focus band. Zero keeps this side sharp; 1× retains the original blur.',
  ),
  farBlur: reductionNumber(
    'Far blur strength',
    1,
    0,
    3,
    'multiplier',
    'Scale Radius on the far/low side of the focus band independently. Focus position, range and falloff still define the sharp band.',
  ),
  focusPosition: {
    kind: 'number',
    label: 'Focus position',
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'percent',
    default: 0.5,
    description: 'Height value at the center of the sharp focus band. Black is 0%; white is 100%.',
  },
  focusRange: {
    kind: 'number',
    label: 'Focus range',
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'percent',
    default: 0.2,
    description:
      'Full width of the sharp height band around Focus position. Pixels in this band remain unchanged.',
  },
  focusFalloff: {
    kind: 'number',
    label: 'Focus falloff',
    min: 0,
    max: 1,
    step: 0.01,
    unit: 'percent',
    default: 0.3,
    description:
      'Height distance beyond the focus band over which blur grows smoothly to Radius. Zero gives a hard focus boundary.',
  },
};
const RECURSIVE_FIELD_PARAMETERS: Readonly<Record<string, ParameterDefinition>> = {
  fieldEnabled: {
    kind: 'choice',
    label: 'Depth field',
    default: 'off',
    description:
      'Use a static stage-source height field to vary this recursive layout. Off preserves the ordinary layout.',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
  fieldRepetition: {
    kind: 'number',
    label: 'Field repetition',
    min: -1,
    max: 1,
    step: 0.01,
    unit: 'percent',
    default: 0.5,
    description:
      'Vary local repetition spacing around its ordinary value. Positive packs repetitions more closely in white/high areas; negative reverses it.',
  },
  fieldImageScale: {
    kind: 'number',
    label: 'Field image scale',
    min: -1,
    max: 1,
    step: 0.01,
    unit: 'percent',
    default: 0,
    description:
      'Vary source-image scale with field height. Positive enlarges image pieces in white/high areas; negative reverses it.',
  },
  fieldDistortion: {
    kind: 'number',
    label: 'Field distortion',
    min: -50,
    max: 50,
    step: 1,
    unit: 'image-percent',
    default: 0,
    description:
      'Displace recursive-layout coordinates horizontally and vertically according to height relative to mid-gray, as a percentage of the shorter image side.',
  },
};
export const EFFECT_DEFINITIONS: Readonly<Record<EffectType, EffectDefinition>> =
  Object.fromEntries(
    Object.entries(BASE_EFFECT_DEFINITIONS).map(([type, definition]) => {
      const parameters: Record<string, ParameterDefinition> = {};
      let baseParameters =
        type === 'blur'
          ? { ...definition.parameters, ...FIELD_CONSUMER_PARAMETERS, ...BLUR_FOCUS_PARAMETERS }
          : type === 'recursive-space'
            ? {
                ...definition.parameters,
                ...RECURSIVE_FIELD_PARAMETERS,
                ...FIELD_CONSUMER_PARAMETERS,
              }
            : [
                  'signal-tearing',
                  'depth-parallax',
                  'depth-haze',
                  'depth-color-map',
                  'cutout',
                  'contour-waves',
                  'shader-spectral-terrain',
                  'shader-liquid-marbling',
                  'shader-contour-melt',
                  'shader-liquid-foil',
                ].includes(type)
              ? { ...definition.parameters, ...FIELD_CONSUMER_PARAMETERS }
              : definition.parameters;
      if (type === 'shader-spectral-terrain') {
        const fieldSource = FIELD_CONSUMER_PARAMETERS.fieldSource!;
        if (fieldSource.kind !== 'choice') throw new Error('Expected height field source choices.');
        baseParameters = { ...baseParameters, fieldSource: { ...fieldSource, default: 'perlin' } };
      }
      if ((DIRECTION_CONSUMERS as readonly string[]).includes(type))
        baseParameters = {
          ...baseParameters,
          ...Object.fromEntries(
            Object.entries(DIRECTION_PARAMETERS).filter(
              ([key]) => type === 'glyph' || key !== 'directionDrift',
            ),
          ),
        };
      baseParameters = { ...baseParameters, ...SET2_EXTENSION_PARAMETERS[type as EffectType] };
      for (const [key, parameter] of Object.entries(baseParameters)) {
        parameters[key] = parameter;
        if (parameter.kind !== 'color' || !parameter.gradient) continue;
        const label = parameter.label;
        parameters[`${key}Mode`] = {
          kind: 'choice',
          colorSource: key,
          label: `${label} mode`,
          default: type === 'depth-color-map' && key === 'depthColor' ? 'gradient' : 'solid',
          description:
            type === 'depth-color-map'
              ? 'Solid uses one color; Gradient maps height from the far start color to the near end color, including intermediate stops.'
              : parameter.gradient === 'field'
                ? 'Solid keeps the original exterior palette. Gradient maps the escape-time bands between two colors; the bounded interior keeps its separate fill.'
                : 'Choose one solid color or a two-color gradient fixed to the image canvas. Switching modes keeps both colors and placement settings.',
          options: [
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
          ],
        };
        parameters[`${key}End`] = {
          kind: 'color',
          colorSource: key,
          label: `${label} end`,
          default:
            type === 'depth-color-map' && key === 'depthColor' ? '#ffd078' : DEFAULT_GRADIENT_END,
          description:
            'Choose the color at the end of the gradient. Both colors use the existing blend, strength, and application controls.',
        };
        parameters[`${key}Stops`] = {
          kind: 'stops',
          colorSource: key,
          label: `${label} stops`,
          default: '[]',
          description:
            'Add, move or remove intermediate color stops. Endpoints stay at 0% and 100%.',
        };
        if (parameter.gradient === 'field') continue;
        for (const [suffix, title, initial, min, max, description] of [
          [
            'Angle',
            'direction',
            0,
            0,
            360,
            'Gradient direction in the image: 0° runs left to right; 90° runs top to bottom.',
          ],
          [
            'CenterX',
            'position X',
            50,
            0,
            100,
            'Move the gradient midpoint horizontally across the image.',
          ],
          [
            'CenterY',
            'position Y',
            50,
            0,
            100,
            'Move the gradient midpoint vertically across the image.',
          ],
          [
            'Span',
            'span',
            100,
            10,
            200,
            'Width of the color transition as a percentage of the image span in its direction. Colors hold at the ends outside the transition.',
          ],
        ] as const) {
          parameters[`${key}${suffix}`] = {
            kind: 'number',
            colorSource: key,
            label: `${label} ${title}`,
            default: initial,
            min,
            max,
            step: 1,
            unit: suffix === 'Angle' ? 'degrees' : 'image-percent',
            description,
          };
        }
      }
      if (type === 'gradient-map')
        parameters.shadowsStops = {
          kind: 'stops',
          colorSource: 'shadows',
          label: 'Tonal ramp stops',
          default: '[]',
          description: 'Map brightness through up to sixteen colors.',
        };
      return [type, { ...definition, parameters }];
    }),
  ) as Record<EffectType, EffectDefinition>;

export function shaderParameterKey(key: string): string {
  return `shader_${key}`;
}
export function importedShaderValues(effect: ImportedShaderEffect) {
  return Object.fromEntries(
    effect.shader.controls.map((control) => [
      control.key,
      effect.params[shaderParameterKey(control.key)]!,
    ]),
  );
}
export function getEffectDefinition(effect: EffectInstance): EffectDefinition {
  if (effect.type !== 'shader-import') return EFFECT_DEFINITIONS[effect.type];
  const common = Object.fromEntries(
    Object.entries(EFFECT_DEFINITIONS['shader-plasma'].parameters).filter(
      ([key]) => !['alpha', 'strength', 'scale', 'centerX', 'centerY'].includes(key),
    ),
  );
  const parameters: Record<string, ParameterDefinition> = { ...common };
  for (const control of effect.shader.controls) {
    parameters[shaderParameterKey(control.key)] =
      control.kind === 'number'
        ? { ...control, unit: control.unit === 'number' ? 'coordinate' : control.unit }
        : { ...control };
  }
  return {
    title: effect.shader.name,
    description: effect.shader.description,
    hint: `Imported shader. Requires ${effect.shader.language === 'isf' ? 'WebGL2' : 'WebGPU'}. The package and controls are embedded in projects and presets.`,
    finish: 'image',
    parameters,
  };
}
export function createImportedShader(
  shader: ShaderPackage,
  instanceId: string,
): ImportedShaderEffect {
  assertExecutableShader(shader);
  const effect = {
    instanceId,
    type: 'shader-import',
    version: 1,
    enabled: true,
    seedOffset: 0,
    application: { region: 'all', coverage: 1, softness: 0 },
    shader: structuredClone(shader),
    params: {},
  } as unknown as ImportedShaderEffect;
  const defaults = Object.fromEntries(
    Object.entries(getEffectDefinition(effect).parameters).map(([key, control]) => [
      key,
      control.default,
    ]),
  );
  Object.assign(effect, { params: defaults });
  assertEffect(effect);
  return effect;
}
export function effectDefaults(effect: EffectInstance): EffectInstance {
  return effect.type === 'shader-import'
    ? createImportedShader(effect.shader, effect.instanceId)
    : createEffect(effect.type, effect.instanceId);
}
export function createEffect(type: EffectType, instanceId: string): EffectInstance {
  const definition = EFFECT_DEFINITIONS[type];
  if (!definition) throw new RangeError('Unknown effect type');
  const effect = {
    instanceId,
    type,
    version: 1,
    enabled: true,
    seedOffset: 0,
    application: { region: 'all', coverage: 1, softness: 0 },
    params: Object.fromEntries(
      Object.entries(definition.parameters).map(([key, parameter]) => [key, parameter.default]),
    ),
  } as EffectInstance;
  assertEffect(effect);
  return effect;
}

export function assertEffect(effect: EffectInstance): void {
  if (effect.type === 'shader-import') {
    assertExecutableShader(effect.shader);
    assertShaderValues(effect.shader, importedShaderValues(effect));
  } else if ('shader' in effect) throw new Error('This effect does not support shader packages.');
  const definition = getEffectDefinition(effect);
  if (
    !effect.instanceId ||
    effect.version !== 1 ||
    typeof effect.enabled !== 'boolean' ||
    !definition
  )
    throw new RangeError('Invalid effect');
  assertSeed(effect.seedOffset);
  if (effect.locked !== undefined && typeof effect.locked !== 'boolean')
    throw new RangeError('Invalid effect lock.');
  if (
    effect.patternId !== undefined &&
    (typeof effect.patternId !== 'string' || !effect.patternId || effect.patternId.length > 1024)
  )
    throw new RangeError('Invalid effect pattern identity.');
  if (effect.paintedMask !== undefined) assertPaintedMask(effect.paintedMask);
  if ('drawing' in effect && effect.drawing !== undefined) {
    if (effect.type !== 'solid') throw new Error('This effect does not support drawing.');
    assertCanvasDrawing(effect.drawing);
  }
  if ('glyphFont' in effect && effect.glyphFont !== undefined) {
    if (effect.type !== 'glyph') throw new Error('This effect does not support glyph fonts.');
    assertGlyphFont(effect.glyphFont);
  }
  if ('image' in effect && effect.image !== undefined) {
    if (!supportsLayerImage(effect)) throw new Error('This effect does not support image inputs.');
    assertLayerImage(effect.image as LayerImage);
  }
  if (effect.directionImage !== undefined) {
    if (!supportsDirectionField(effect))
      throw new Error('This effect does not support direction maps.');
    assertLayerImage(effect.directionImage);
  }
  if ('fieldImage' in effect && effect.fieldImage !== undefined) {
    if (!supportsHeightField(effect)) throw new Error('This effect does not support depth maps.');
    assertLayerImage(effect.fieldImage as LayerImage);
  }
  if (
    !effect.application ||
    !APPLICATION_REGIONS.some((option) => option.value === effect.application.region) ||
    !Number.isFinite(effect.application.coverage) ||
    effect.application.coverage < 0 ||
    effect.application.coverage > 1 ||
    !Number.isFinite(effect.application.softness) ||
    effect.application.softness < 0 ||
    effect.application.softness > 1
  )
    throw new RangeError('Invalid effect application');
  const app = effect.application;
  for (const [key, [min, max]] of Object.entries({
    rangeStart: [0, 1],
    rangeEnd: [0, 1],
    detailScale: [0.1, 10],
    bandFrequency: [1, 128],
    bandOffset: [0, 1],
  })) {
    const value = app[key as keyof EffectApplication];
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value) || value < min! || value > max!)
    )
      throw new RangeError(`Invalid application ${key}`);
  }
  if (app.invert !== undefined && !['on', 'off'].includes(app.invert))
    throw new RangeError('Invalid application inversion.');
  if (app.depthImage) assertLayerImage(app.depthImage);
  if (app.depthField) {
    if (
      Object.keys(app.depthField).some(
        (key) => !DEPTH_FIELD_KEYS.includes(key as (typeof DEPTH_FIELD_KEYS)[number]),
      )
    )
      throw new RangeError('Invalid Application field parameter.');
    const field = createEffect('depth-field', 'application-validation') as DepthFieldEffect;
    assertEffect({ ...field, params: { ...field.params, ...app.depthField } });
  }

  const params = effect.params as Readonly<Record<string, number | string>>;
  if (
    (effect.type === 'levels-curves' || effect.type === 'threshold') &&
    !(effect.params.inputBlack < effect.params.inputWhite)
  )
    throw new RangeError('Input black must be below Input white.');
  if (Object.keys(params).some((key) => !Object.hasOwn(definition.parameters, key)))
    throw new RangeError('Invalid effect parameters');
  for (const [key, parameter] of Object.entries(definition.parameters)) {
    // Older version-one recipes omit Edge Handling and retain their extended borders.
    if (
      !Object.hasOwn(params, key) &&
      (Object.hasOwn(DIRECTION_DEFAULTS, key) ||
        (effect.type === 'shader-contour-melt' && key === 'hue') ||
        (effect.type === 'shader-filament-flow' && key === 'hue') ||
        (effect.type === 'shader-hatched-solids' && ['scatterX', 'scatterY'].includes(key)) ||
        (effect.type === 'shader-mandelbrot-slices' && key === 'sliceIndex') ||
        Object.hasOwn(SET2_EXTENSION_PARAMETERS[effect.type as EffectType] ?? {}, key) ||
        (effect.type === 'shader-paint-flow' && key === 'colorVariation') ||
        (effect.type === 'shader-billowing-smoke' && ['eddyStrength', 'eddyScale'].includes(key)) ||
        parameter.colorSource !== undefined ||
        (['blur', 'recursive-space', 'signal-tearing'].includes(effect.type) &&
          (Object.hasOwn(FIELD_CONSUMER_PARAMETERS, key) ||
            (effect.type === 'blur' && Object.hasOwn(BLUR_FOCUS_PARAMETERS, key)) ||
            (effect.type === 'recursive-space' &&
              Object.hasOwn(RECURSIVE_FIELD_PARAMETERS, key)))) ||
        (key === 'edgeHandling' &&
          !['motion-mosh', 'shapes', 'mandelbrot', 'recursive-space', 'blur'].includes(
            effect.type,
          )) ||
        (effect.type === 'bit-crush' && Object.hasOwn(BIT_CRUSH_CHANNEL_DEFAULTS, key)) ||
        (effect.type === 'noise-grain' && Object.hasOwn(NOISE_EXTRA_DEFAULTS, key)) ||
        (effect.type === 'bit-damage' && Object.hasOwn(BIT_DAMAGE_DEFAULTS, key)) ||
        (effect.type === 'cutout' && Object.hasOwn(CUTOUT_REFINEMENT_DEFAULTS, key)) ||
        (effect.type === 'depth-parallax' && ['nearStrength', 'farStrength'].includes(key)) ||
        (effect.type === 'motion-mosh' && key === 'coherence') ||
        (effect.type === 'reference-mosh' &&
          ['replacementDensity', 'referenceX', 'referenceY'].includes(key)) ||
        (effect.type === 'spatial-crush' && Object.hasOwn(SPATIAL_CRUSH_DEFAULTS, key)) ||
        (effect.type === 'scanlines' && Object.hasOwn(SCANLINE_FINISH_DEFAULTS, key)) ||
        (effect.type === 'shapes' && Object.hasOwn(SHAPE_TILE_DEFAULTS, key)) ||
        (effect.type === 'depth-field' && Object.hasOwn(DEPTH_TREATMENT_DEFAULTS, key)) ||
        (definition.finish === 'image' && Object.hasOwn(IMAGE_FINISH_DEFAULTS, key)) ||
        (definition.finish === 'pattern' && key === 'blendMode') ||
        (effect.type === 'mandelbrot' && Object.hasOwn(FRACTAL_DEFAULTS, key)) ||
        (effect.type === 'glyph' && Object.hasOwn(GLYPH_DEFAULTS, key)) ||
        (['mirroring', 'kaleidoscope'].includes(effect.type) &&
          Object.hasOwn(OUTPUT_ALIGNMENT_DEFAULTS, key)))
    )
      continue;
    const value = params[key];
    if (parameter.kind === 'stops') {
      parseGradientStops(value);
      continue;
    }
    if (parameter.kind === 'text') {
      if (!isParameterText(value, parameter.maxLength))
        throw new RangeError(`Invalid ${definition.title} parameter: ${key}`);
      continue;
    }
    if (
      parameter.kind === 'number'
        ? typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < parameter.min ||
          value > parameter.max ||
          (['bits', 'count'].includes(parameter.unit) && !Number.isInteger(value))
        : parameter.kind === 'choice'
          ? !parameter.options.some((option) => option.value === value)
          : typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)
    )
      throw new RangeError(`Invalid ${definition.title} parameter: ${key}`);
  }
}

export interface ImageSource {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly format: 'png' | 'jpeg' | 'webp';
  readonly hasAlpha: boolean;
}

export function assertImageSource(source: ImageSource): void {
  if (
    !source.id ||
    !source.name ||
    !['png', 'jpeg', 'webp'].includes(source.format) ||
    !Number.isSafeInteger(source.width) ||
    !Number.isSafeInteger(source.height) ||
    source.width < 1 ||
    source.height < 1
  ) {
    throw new TypeError('Invalid image source');
  }
}

export function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Seed must be an unsigned 32-bit integer');
  }
}

export function createProject(name: string, masterSeed = 0): ProjectState {
  assertSeed(masterSeed);
  return Object.freeze({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    masterSeed,
    source: null,
    effects: Object.freeze([]),
    origin: null,
    sourceSnapshotId: null,
    snapshots: Object.freeze([]),
  });
}

export function assertProject(value: unknown): asserts value is ProjectState {
  if (!value || typeof value !== 'object') throw new Error('Invalid project.');
  const project = value as ProjectState;
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION)
    throw new Error('Unsupported project version.');
  if (
    typeof project.name !== 'string' ||
    !project.name ||
    project.name.length > 1024 ||
    !Array.isArray(project.effects) ||
    project.effects.length > 1000
  )
    throw new Error('Invalid project.');
  assertSeed(project.masterSeed);
  if (project.source !== null) {
    if (!project.source || typeof project.source !== 'object')
      throw new Error('Invalid project image.');
    assertImageSource(project.source);
    if (
      typeof project.source.id !== 'string' ||
      typeof project.source.name !== 'string' ||
      typeof project.source.hasAlpha !== 'boolean' ||
      project.source.width > 32768 ||
      project.source.height > 32768 ||
      project.source.width * project.source.height > 64 * 1024 * 1024
    )
      throw new Error('Invalid project image.');
  }
  const ids = new Set<string>();
  for (const effect of project.effects) {
    if (
      !effect ||
      typeof effect !== 'object' ||
      typeof effect.instanceId !== 'string' ||
      effect.instanceId.length > 1024 ||
      ids.has(effect.instanceId) ||
      !effect.params ||
      typeof effect.params !== 'object'
    )
      throw new Error('Invalid project effect.');
    assertEffect(effect);
    ids.add(effect.instanceId);
  }
  if (!project.source && project.effects.length) throw new Error('Project image is missing.');
  if (!Array.isArray(project.snapshots) || project.snapshots.length > 1000)
    throw new Error('Invalid project snapshots.');
  const snapshots = new Map<string, StageSnapshot>();
  for (const snapshot of project.snapshots) {
    if (
      !snapshot ||
      typeof snapshot.id !== 'string' ||
      !snapshot.id ||
      snapshot.id.length > 1024 ||
      snapshots.has(snapshot.id) ||
      typeof snapshot.name !== 'string' ||
      !snapshot.name.trim() ||
      snapshot.name.length > 120 ||
      typeof snapshot.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(snapshot.createdAt))
    )
      throw new Error('Invalid snapshot.');
    // Parents must already exist. This also rejects cycles and dangling branches.
    const parent = snapshot.parentId === null ? null : snapshots.get(snapshot.parentId);
    if (snapshot.parentId !== null && (!parent || parent.rendered.id !== snapshot.source?.id))
      throw new Error('Invalid snapshot lineage.');
    assertProject({
      ...createProject('Snapshot'),
      source: snapshot.source,
      origin: snapshot.source,
      effects: snapshot.effects,
      masterSeed: snapshot.masterSeed,
    });
    assertImageSource(snapshot.rendered);
    if (
      snapshot.rendered.width !== snapshot.source.width ||
      snapshot.rendered.height !== snapshot.source.height ||
      snapshot.rendered.format !== 'png' ||
      snapshot.rendered.id === snapshot.source.id
    )
      throw new Error('Invalid snapshot output.');
    snapshots.set(snapshot.id, snapshot);
  }
  if (
    project.sourceSnapshotId !== null &&
    snapshots.get(project.sourceSnapshotId)?.rendered.id !== project.source?.id
  )
    throw new Error('Invalid working source lineage.');
  if (project.origin !== null) assertImageSource(project.origin);
  if (!project.source && (project.origin || project.snapshots.length))
    throw new Error('Project image is missing.');
  projectSources(project);
  layerImages([...project.effects, ...project.snapshots.flatMap((snapshot) => snapshot.effects)]);
}

/** Asset identity includes metadata; inconsistent references are never silently merged. */
export function projectSources(project: ProjectState): readonly ImageSource[] {
  const sources = new Map<string, ImageSource>();
  for (const source of [
    project.source,
    project.origin,
    ...project.snapshots.flatMap((snapshot) => [snapshot.source, snapshot.rendered]),
  ]) {
    if (!source) continue;
    assertImageSource(source);
    if (
      typeof source.id !== 'string' ||
      source.id.length > 1024 ||
      typeof source.name !== 'string' ||
      source.name.length > 1024 ||
      typeof source.hasAlpha !== 'boolean' ||
      source.width > 32768 ||
      source.height > 32768 ||
      source.width * source.height > 64 * 1024 * 1024
    )
      throw new Error('Invalid project image.');
    const existing = sources.get(source.id);
    if (
      existing &&
      Object.entries(existing).some(([key, value]) => source[key as keyof ImageSource] !== value)
    )
      throw new Error('Conflicting project image references.');
    sources.set(source.id, source);
  }
  return [...sources.values()];
}

// Version this rule before changing it: saved recipes depend on stable derived seeds.
// FNV-1a over UTF-16 code units, followed by a 32-bit avalanche.
export function deriveEffectSeed(masterSeed: number, effectInstanceId: string): number {
  assertSeed(masterSeed);
  let hash = (0x811c9dc5 ^ masterSeed) >>> 0;
  for (let index = 0; index < effectInstanceId.length; index++) {
    hash = Math.imul(hash ^ effectInstanceId.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Whether the current recipe exposes an active seeded pattern control. */
export function supportsSeedVariation(effect: EffectInstance): boolean {
  const shapeTiles = effect.type === 'shapes' ? { ...SHAPE_TILE_DEFAULTS, ...effect.params } : null;
  const tiled = shapeTiles?.layout === 'tiled';
  const shapeRotates = shapeTiles && !['circle', 'ring'].includes(shapeTiles.shape);
  const polygon = shapeTiles?.shape === 'polygon';
  return (
    (effect.type === 'contour-waves' &&
      ((effect.params.breakup ?? 0) > 0 || (effect.params.tearStrength ?? 0) > 0)) ||
    (effect.type === 'glyph' &&
      ((effect.params.rotationJitter ?? 0) > 0 ||
        (effect.params.positionJitter ?? 0) > 0 ||
        (effect.params.missing ?? 0) > 0 ||
        (effect.params.duplicate ?? 0) > 0 ||
        (effect.params.glitch ?? 0) > 0 ||
        (effect.params.style === 'emoji' && effect.params.emojiMapping === 'random'))) ||
    [
      'vector-corruption',
      'reference-mosh',
      'window-fragments',
      'system-crash',
      'terminal-wireframe',
      'signal-weave',
      'data-weave',
      'micro-collage',
      'pixel-dissolve',
      'neon-print',
      'pixel-stretch',
      'led-matrix',
      'granular-echo',
      'pigment-drag',
    ].includes(effect.type) ||
    (effect.type === 'depth-parallax' && effect.params.style === 'tearing') ||
    (effect.type === 'temporal-echo' && effect.params.jitter > 0 && effect.params.spacing > 0) ||
    (effect.type === 'bit-damage' &&
      effect.params.density > 0 &&
      (effect.params.density < 1 ||
        (effect.params.visualize === 'off' &&
          (['scramble', 'inject', 'byte-scramble'].includes(effect.params.operation) ||
            (effect.params.probability ?? 1) < 1)))) ||
    (effect.type === 'freeze-dropout' && effect.params.density > 0) ||
    effect.type === 'signal-tearing' ||
    (effect.type === 'indexed-palette' &&
      (effect.params.colorSwap > 0 ||
        effect.params.hueDamage > 0 ||
        effect.params.saturationDamage > 0 ||
        effect.params.drift > 0 ||
        (['random', 'blue-noise'].includes(effect.params.dither) &&
          effect.params.ditherStrength > 0))) ||
    (effect.type === 'threshold' &&
      effect.params.style === 'photocopy' &&
      effect.params.dirt > 0) ||
    (effect.type === 'dither' &&
      ((['random', 'blue-noise'].includes(effect.params.algorithm) &&
        effect.params.ditherStrength > 0) ||
        (effect.params.algorithm === 'corrupted' &&
          (effect.params.skippedCells > 0 ||
            effect.params.blockInterruptions > 0 ||
            (effect.params.ditherStrength > 0 &&
              (effect.params.errorDisplacement > 0 ||
                effect.params.randomDirection > 0 ||
                (effect.params.coloring === 'rgb' && effect.params.channelDivergence > 0))))))) ||
    (effect.type === 'compression-breakup' &&
      effect.params.damageDensity > 0 &&
      effect.params.damageStrength > 0) ||
    (effect.type === 'pixel-sort' &&
      ((effect.params.density > 0 && effect.params.density < 1) || effect.params.breakup > 0)) ||
    (effect.type === 'chroma-mosh' && effect.params.style !== 'smear') ||
    isBuiltinShader(effect) ||
    effect.type === 'shader-import' ||
    effect.type === 'feedback-bloom' ||
    effect.type === 'noise-grain' ||
    (effect.type === 'blur' && effect.params.style === 'grainy') ||
    (effect.application.coverage > 0 &&
      effect.application.coverage < 1 &&
      ['all', 'subject', 'background'].includes(effect.application.region)) ||
    effect.type === 'block-corruption' ||
    effect.type === 'wave-distortion' ||
    (tiled &&
      ((shapeRotates && shapeTiles.rotationStyle === 'random') ||
        (polygon && shapeTiles.polygonStyle === 'random'))) ||
    (effect.type === 'motion-mosh' &&
      effect.params.travel > 0 &&
      effect.params.density > 0 &&
      (effect.params.density < 1 || (effect.params.coherence ?? 1) < 1)) ||
    (effect.type === 'scanlines' &&
      (effect.params.signalError ?? 'none') !== 'none' &&
      (effect.params.errorStrength ?? 0.35) > 0) ||
    (effect.type === 'bit-crush' &&
      bitCrushDepths(effect.params).some((bits) => bits < 8) &&
      effect.params.dither === 'random' &&
      effect.params.ditherAmount > 0) ||
    (effect.type === 'spatial-crush' &&
      (effect.params.sampling === 'random' ||
        (effect.params.sampling === 'dirty-nearest' && (effect.params.jitter ?? 0.5) > 0) ||
        (effect.params.sampling === 'corrupted' && (effect.params.corruption ?? 0.5) > 0)))
  );
}
