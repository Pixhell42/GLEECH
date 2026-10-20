// Timeline data model and per-frame evaluation. This module only imports types
// from the main model so index.ts can call its validators without a cycle.
import type { ParameterDefinition } from './index';

export const TIMELINE_VERSION = 1 as const;
export const MAX_TIMELINE_SECONDS = 3600;
export const MAX_KEYS_PER_PARAMETER = 4096;
export const MAX_MODULATORS_PER_PARAMETER = 8;
export const MAX_ANIMATED_PARAMETERS = 256;
export const MAX_MARKERS = 1000;
export const MAX_MEDIA_PATH = 4096;
/** Common project rates. Any rate from 1 to 120 fps is valid. */
export const FRAME_RATES = [10, 12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60] as const;

export const INTERPOLATIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in-out' },
  { value: 'hold', label: 'Hold' },
  { value: 'bezier', label: 'Bezier (custom)' },
] as const;
export type Interpolation = (typeof INTERPOLATIONS)[number]['value'];

/** A bezier handle offset: seconds along the segment and a fraction of the parameter range. */
export interface KeyHandle {
  readonly dt: number;
  readonly dv: number;
}
export interface Keyframe {
  /** Seconds from the timeline start. Keys sit on frame boundaries. */
  readonly t: number;
  readonly value: number | string;
  /** How the segment after this key eases toward the next key. */
  readonly interpolation: Interpolation;
  readonly inHandle?: KeyHandle;
  readonly outHandle?: KeyHandle;
}

export type ModulatorCombine = 'replace' | 'add' | 'multiply';
export const AUDIO_BANDS = [
  { value: 'low', label: 'Low', low: 40, high: 160 },
  { value: 'mid', label: 'Mid', low: 160, high: 2000 },
  { value: 'high', label: 'High', low: 2000, high: 16000 },
  { value: 'custom', label: 'Custom', low: 40, high: 160 },
] as const;
export type AudioBand = (typeof AUDIO_BANDS)[number]['value'];
export interface AudioModulator {
  readonly kind: 'audio';
  readonly id: string;
  readonly enabled: boolean;
  readonly band: AudioBand;
  /** Used when band is custom. Hz. */
  readonly lowHz: number;
  readonly highHz: number;
  readonly attackMs: number;
  readonly releaseMs: number;
  /** Output range as fractions of the parameter range. */
  readonly outMin: number;
  readonly outMax: number;
  readonly combine: ModulatorCombine;
}
export const LFO_SHAPES = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'square', label: 'Square' },
  { value: 'saw', label: 'Saw' },
  { value: 'random', label: 'Random steps' },
] as const;
export type LfoShape = (typeof LFO_SHAPES)[number]['value'];
/** Tempo divisions in beats (4/4). */
export const LFO_DIVISIONS = [
  { value: '4', label: '4 bars', beats: 16 },
  { value: '2', label: '2 bars', beats: 8 },
  { value: '1', label: '1 bar', beats: 4 },
  { value: '1/2', label: '1/2 bar', beats: 2 },
  { value: '1/4', label: '1 beat', beats: 1 },
  { value: '1/8', label: '1/8', beats: 0.5 },
  { value: '1/16', label: '1/16', beats: 0.25 },
] as const;
export type LfoDivision = (typeof LFO_DIVISIONS)[number]['value'];
export interface LfoModulator {
  readonly kind: 'lfo';
  readonly id: string;
  readonly enabled: boolean;
  readonly shape: LfoShape;
  readonly sync: boolean;
  readonly division: LfoDivision;
  /** Free-running rate in Hz when sync is off. */
  readonly rate: number;
  /** ± fraction of the parameter range. */
  readonly depth: number;
  /** Degrees. */
  readonly phase: number;
  readonly combine: Exclude<ModulatorCombine, 'replace'>;
}
export type Modulator = AudioModulator | LfoModulator;

export interface ParameterAnimation {
  readonly keys: readonly Keyframe[];
  readonly modulators?: readonly Modulator[];
}
export type EffectAnimation = Readonly<Record<string, ParameterAnimation>>;
export interface ActiveRange {
  readonly start: number;
  readonly end: number;
}

export type SeedMode = 'fixed' | 'every-frame' | 'every-n';
export interface SeedTrack {
  readonly mode: SeedMode;
  /** Frames per seed when mode is every-n. */
  readonly every: number;
}
export interface TimelineMarker {
  readonly id: string;
  readonly t: number;
  readonly name: string;
  readonly snapshotId?: string;
}
export interface VideoClip {
  readonly path: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly hasAudio: boolean;
  /**
   * Source image made from one clip frame: the first frame on open, then the
   * playhead frame whenever Image mode starts. The clip drives frames only while
   * its poster is the source.
   */
  readonly posterId?: string;
  /** Clip time in seconds of the poster frame. Absent means the first frame. */
  readonly posterTime?: number;
}
export interface AudioAnalysis {
  /** Analysis frames per second (independent of the project rate). */
  readonly rate: number;
  /** Log-spaced spectrum bins per analysis frame. */
  readonly bins: number;
  readonly minHz: number;
  readonly maxHz: number;
  /** base64 Uint8 [frames × bins] band energy, 0–255. */
  readonly spectrum: string;
  /** base64 Uint8 [frames] peak amplitude, 0–255. */
  readonly peaks: string;
  /** Beat times in seconds. */
  readonly beats: readonly number[];
  readonly bpm: number;
}
export interface AudioClip {
  readonly path: string;
  readonly name: string;
  readonly duration: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly analysis?: AudioAnalysis;
}
export interface Timeline {
  readonly version: typeof TIMELINE_VERSION;
  readonly fps: number;
  readonly duration: number;
  readonly workArea: ActiveRange | null;
  /** In and Out points (I / O keys), offered as a render range. */
  readonly inOut?: ActiveRange;
  readonly loop: boolean;
  readonly seed: SeedTrack;
  readonly markers: readonly TimelineMarker[];
  readonly video?: VideoClip;
  readonly audio?: AudioClip;
  readonly bpm?: number;
}

export function createTimeline(
  options: Partial<Pick<Timeline, 'fps' | 'duration'>> = {},
): Timeline {
  const timeline: Timeline = {
    version: TIMELINE_VERSION,
    fps: options.fps ?? 30,
    duration: options.duration ?? 10,
    workArea: null,
    loop: true,
    seed: { mode: 'fixed', every: 2 },
    markers: [],
  };
  assertTimeline(timeline);
  return timeline;
}

// ---------------------------------------------------------------------------
// Time helpers

export function frameCount(timeline: Pick<Timeline, 'fps' | 'duration'>): number {
  return Math.max(1, Math.round(timeline.duration * timeline.fps));
}
export function frameTime(frame: number, fps: number): number {
  return roundTime(frame / fps);
}
export function timeFrame(t: number, fps: number): number {
  return Math.round(t * fps + 1e-6);
}
/** Keep stored times compact and stable across float noise. */
export function roundTime(t: number): number {
  return Math.round(t * 1e6) / 1e6;
}
export function clampFrame(frame: number, timeline: Pick<Timeline, 'fps' | 'duration'>): number {
  return Math.min(Math.max(0, Math.round(frame)), frameCount(timeline) - 1);
}
/** MM:SS:FF, as shown in the transport (frames within the current second). */
export function formatTimecode(frame: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const whole = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(whole / rate);
  const frames = whole - totalSeconds * rate;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return [minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':');
}
/** 3.2 s style label. */
export function formatSeconds(t: number): string {
  return `${(Math.round(t * 10) / 10).toFixed(1)} s`;
}
export function workRange(timeline: Timeline): ActiveRange {
  const end = frameCount(timeline) / timeline.fps;
  const area = timeline.workArea;
  if (!area || area.start >= end) return { start: 0, end };
  return { start: Math.max(0, area.start), end: Math.min(end, area.end) };
}
/** Keep the work area and In/Out inside the timeline after its length changes. */
export function clampTimelineRanges(timeline: Timeline): Timeline {
  const end = frameCount(timeline) / timeline.fps;
  const clamp = (range: ActiveRange | null | undefined): ActiveRange | null => {
    if (!range) return null;
    const start = Math.max(0, range.start);
    const stop = Math.min(end, range.end);
    return stop - start >= 1 / timeline.fps - 1e-9 ? { start, end: roundTime(stop) } : null;
  };
  const workArea = clamp(timeline.workArea);
  const inOut = clamp(timeline.inOut);
  const next: Timeline = { ...timeline, workArea };
  if (inOut) return { ...next, inOut };
  const copy = { ...next } as { -readonly [K in keyof Timeline]: Timeline[K] };
  delete copy.inOut;
  return copy;
}

// ---------------------------------------------------------------------------
// Validation

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
function assertId(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value || value.length > 1024)
    throw new RangeError(`Invalid ${label}.`);
}
function assertTime(value: unknown, label: string): asserts value is number {
  if (!isFiniteNumber(value) || value < 0 || value > MAX_TIMELINE_SECONDS)
    throw new RangeError(`Invalid ${label}.`);
}
function assertRange(range: unknown, label: string): asserts range is ActiveRange {
  if (!range || typeof range !== 'object') throw new RangeError(`Invalid ${label}.`);
  const { start, end } = range as ActiveRange;
  assertTime(start, label);
  assertTime(end, label);
  if (!(end > start)) throw new RangeError(`Invalid ${label}.`);
  if (Object.keys(range).some((key) => key !== 'start' && key !== 'end'))
    throw new RangeError(`Invalid ${label}.`);
}
export function assertActiveRange(range: unknown): asserts range is ActiveRange {
  assertRange(range, 'effect active range');
}
function assertMediaPath(value: unknown): void {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > MAX_MEDIA_PATH ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new RangeError('Invalid media path.');
}
function assertName(value: unknown, max = 1024): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new RangeError('Invalid media name.');
}
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function assertAudioAnalysis(analysis: unknown): asserts analysis is AudioAnalysis {
  if (!analysis || typeof analysis !== 'object') throw new RangeError('Invalid audio analysis.');
  const value = analysis as AudioAnalysis;
  if (
    !isFiniteNumber(value.rate) ||
    value.rate < 1 ||
    value.rate > 240 ||
    !Number.isInteger(value.bins) ||
    value.bins < 1 ||
    value.bins > 128 ||
    !isFiniteNumber(value.minHz) ||
    !isFiniteNumber(value.maxHz) ||
    value.minHz <= 0 ||
    value.maxHz <= value.minHz ||
    typeof value.spectrum !== 'string' ||
    typeof value.peaks !== 'string' ||
    value.spectrum.length > 24 * 1024 * 1024 ||
    value.peaks.length > 4 * 1024 * 1024 ||
    value.spectrum.length % 4 !== 0 ||
    value.peaks.length % 4 !== 0 ||
    !BASE64.test(value.spectrum) ||
    !BASE64.test(value.peaks) ||
    !Array.isArray(value.beats) ||
    value.beats.length > 100000 ||
    value.beats.some((beat) => !isFiniteNumber(beat) || beat < 0 || beat > MAX_TIMELINE_SECONDS) ||
    !isFiniteNumber(value.bpm) ||
    value.bpm < 0 ||
    value.bpm > 400
  )
    throw new RangeError('Invalid audio analysis.');
}

export function assertTimeline(value: unknown): asserts value is Timeline {
  if (!value || typeof value !== 'object') throw new RangeError('Invalid timeline.');
  const timeline = value as Timeline;
  if (timeline.version !== TIMELINE_VERSION) throw new RangeError('Unsupported timeline version.');
  if (!isFiniteNumber(timeline.fps) || timeline.fps < 1 || timeline.fps > 120)
    throw new RangeError('Timeline frame rate must be between 1 and 120 fps.');
  if (
    !isFiniteNumber(timeline.duration) ||
    timeline.duration <= 0 ||
    timeline.duration > MAX_TIMELINE_SECONDS
  )
    throw new RangeError('Timeline duration must be between 0 and 60 minutes.');
  if (timeline.workArea !== null) assertRange(timeline.workArea, 'work area');
  if (timeline.inOut !== undefined) assertRange(timeline.inOut, 'in and out points');
  if (typeof timeline.loop !== 'boolean') throw new RangeError('Invalid timeline loop.');
  if (
    !timeline.seed ||
    !['fixed', 'every-frame', 'every-n'].includes(timeline.seed.mode) ||
    !Number.isInteger(timeline.seed.every) ||
    timeline.seed.every < 1 ||
    timeline.seed.every > 1000
  )
    throw new RangeError('Invalid seed track.');
  if (!Array.isArray(timeline.markers) || timeline.markers.length > MAX_MARKERS)
    throw new RangeError('Invalid timeline markers.');
  const markerIds = new Set<string>();
  for (const marker of timeline.markers) {
    if (!marker || typeof marker !== 'object') throw new RangeError('Invalid timeline marker.');
    assertId(marker.id, 'timeline marker');
    if (markerIds.has(marker.id)) throw new RangeError('Duplicate timeline marker.');
    markerIds.add(marker.id);
    assertTime(marker.t, 'timeline marker time');
    if (typeof marker.name !== 'string' || marker.name.length > 120)
      throw new RangeError('Invalid timeline marker name.');
    if (marker.snapshotId !== undefined) assertId(marker.snapshotId, 'marker snapshot');
  }
  if (timeline.video !== undefined) {
    const video = timeline.video;
    if (!video || typeof video !== 'object') throw new RangeError('Invalid video clip.');
    assertMediaPath(video.path);
    assertName(video.name);
    if (
      !Number.isSafeInteger(video.width) ||
      !Number.isSafeInteger(video.height) ||
      video.width < 1 ||
      video.height < 1 ||
      video.width > 16384 ||
      video.height > 16384 ||
      !isFiniteNumber(video.fps) ||
      video.fps <= 0 ||
      video.fps > 1000 ||
      !isFiniteNumber(video.duration) ||
      video.duration <= 0 ||
      video.duration > MAX_TIMELINE_SECONDS * 4 ||
      typeof video.hasAudio !== 'boolean'
    )
      throw new RangeError('Invalid video clip.');
    if (video.posterId !== undefined) assertId(video.posterId, 'video poster');
    if (
      video.posterTime !== undefined &&
      (!isFiniteNumber(video.posterTime) ||
        video.posterTime < 0 ||
        video.posterTime > MAX_TIMELINE_SECONDS * 4)
    )
      throw new RangeError('Invalid video poster time.');
  }
  if (timeline.audio !== undefined) {
    const audio = timeline.audio;
    if (!audio || typeof audio !== 'object') throw new RangeError('Invalid audio clip.');
    assertMediaPath(audio.path);
    assertName(audio.name);
    if (
      !isFiniteNumber(audio.duration) ||
      audio.duration <= 0 ||
      audio.duration > MAX_TIMELINE_SECONDS * 4 ||
      !Number.isInteger(audio.sampleRate) ||
      audio.sampleRate < 1 ||
      audio.sampleRate > 768000 ||
      !Number.isInteger(audio.channels) ||
      audio.channels < 1 ||
      audio.channels > 64
    )
      throw new RangeError('Invalid audio clip.');
    if (audio.analysis !== undefined) assertAudioAnalysis(audio.analysis);
  }
  if (
    timeline.bpm !== undefined &&
    (!isFiniteNumber(timeline.bpm) || timeline.bpm < 20 || timeline.bpm > 400)
  )
    throw new RangeError('Invalid tempo.');
}

function assertHandle(handle: unknown, direction: 'in' | 'out'): void {
  if (!handle || typeof handle !== 'object') throw new RangeError('Invalid keyframe handle.');
  const { dt, dv } = handle as KeyHandle;
  if (
    !isFiniteNumber(dt) ||
    !isFiniteNumber(dv) ||
    Math.abs(dt) > MAX_TIMELINE_SECONDS ||
    Math.abs(dv) > 100 ||
    (direction === 'in' ? dt > 0 : dt < 0)
  )
    throw new RangeError('Invalid keyframe handle.');
}

export function assertModulator(modulator: unknown): asserts modulator is Modulator {
  if (!modulator || typeof modulator !== 'object') throw new RangeError('Invalid modulator.');
  const value = modulator as Modulator;
  assertId(value.id, 'modulator');
  if (typeof value.enabled !== 'boolean') throw new RangeError('Invalid modulator.');
  if (value.kind === 'audio') {
    if (
      !AUDIO_BANDS.some((band) => band.value === value.band) ||
      !isFiniteNumber(value.lowHz) ||
      !isFiniteNumber(value.highHz) ||
      value.lowHz < 10 ||
      value.highHz > 24000 ||
      value.highHz <= value.lowHz ||
      !isFiniteNumber(value.attackMs) ||
      !isFiniteNumber(value.releaseMs) ||
      value.attackMs < 0 ||
      value.attackMs > 5000 ||
      value.releaseMs < 0 ||
      value.releaseMs > 10000 ||
      !isFiniteNumber(value.outMin) ||
      !isFiniteNumber(value.outMax) ||
      value.outMin < 0 ||
      value.outMax > 1 ||
      value.outMin > value.outMax ||
      !['replace', 'add', 'multiply'].includes(value.combine)
    )
      throw new RangeError('Invalid audio modulator.');
    return;
  }
  if (value.kind === 'lfo') {
    if (
      !LFO_SHAPES.some((shape) => shape.value === value.shape) ||
      typeof value.sync !== 'boolean' ||
      !LFO_DIVISIONS.some((division) => division.value === value.division) ||
      !isFiniteNumber(value.rate) ||
      value.rate < 0.01 ||
      value.rate > 60 ||
      !isFiniteNumber(value.depth) ||
      value.depth < 0 ||
      value.depth > 1 ||
      !isFiniteNumber(value.phase) ||
      value.phase < 0 ||
      value.phase > 360 ||
      !['add', 'multiply'].includes(value.combine)
    )
      throw new RangeError('Invalid LFO modulator.');
    return;
  }
  throw new RangeError('Invalid modulator.');
}

/** Parameter kinds that can carry keys. Text and gradient stop lists stay static. */
export function isAnimatableParameter(definition: ParameterDefinition | undefined): boolean {
  return Boolean(
    definition &&
    (definition.kind === 'number' || definition.kind === 'choice' || definition.kind === 'color'),
  );
}

export function assertKeyValue(value: unknown, definition: ParameterDefinition): void {
  if (definition.kind === 'number') {
    if (!isFiniteNumber(value) || value < definition.min || value > definition.max)
      throw new RangeError(`Invalid keyframe value for ${definition.label}.`);
  } else if (definition.kind === 'choice') {
    if (!definition.options.some((option) => option.value === value))
      throw new RangeError(`Invalid keyframe value for ${definition.label}.`);
  } else if (definition.kind === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))
      throw new RangeError(`Invalid keyframe value for ${definition.label}.`);
  } else throw new RangeError(`${definition.label} cannot be animated.`);
}

export function assertParameterAnimation(
  animation: unknown,
  definition: ParameterDefinition | undefined,
  key: string,
): asserts animation is ParameterAnimation {
  if (!definition || !isAnimatableParameter(definition))
    throw new RangeError(`Parameter ${key} cannot be animated.`);
  if (!animation || typeof animation !== 'object') throw new RangeError('Invalid animation.');
  const value = animation as ParameterAnimation;
  if (!Array.isArray(value.keys) || value.keys.length > MAX_KEYS_PER_PARAMETER)
    throw new RangeError('Invalid animation keys.');
  let previous = -1;
  for (const keyframe of value.keys) {
    if (!keyframe || typeof keyframe !== 'object') throw new RangeError('Invalid keyframe.');
    assertTime(keyframe.t, 'keyframe time');
    if (keyframe.t <= previous) throw new RangeError('Keyframes must be sorted by time.');
    previous = keyframe.t;
    assertKeyValue(keyframe.value, definition);
    if (!INTERPOLATIONS.some((option) => option.value === keyframe.interpolation))
      throw new RangeError('Invalid keyframe interpolation.');
    if (keyframe.inHandle !== undefined) assertHandle(keyframe.inHandle, 'in');
    if (keyframe.outHandle !== undefined) assertHandle(keyframe.outHandle, 'out');
  }
  if (value.modulators !== undefined) {
    if (!Array.isArray(value.modulators) || value.modulators.length > MAX_MODULATORS_PER_PARAMETER)
      throw new RangeError('Invalid modulators.');
    if (value.modulators.length && definition.kind !== 'number')
      throw new RangeError('Only numeric parameters can use modulators.');
    const ids = new Set<string>();
    for (const modulator of value.modulators) {
      assertModulator(modulator);
      if (ids.has(modulator.id)) throw new RangeError('Duplicate modulator.');
      ids.add(modulator.id);
    }
  }
  if (!value.keys.length && !value.modulators?.length)
    throw new RangeError('An animated parameter needs a key or modulator.');
}

export function assertEffectAnimation(
  animation: unknown,
  definitionFor: (key: string) => ParameterDefinition | undefined,
): asserts animation is EffectAnimation {
  if (!animation || typeof animation !== 'object' || Array.isArray(animation))
    throw new RangeError('Invalid effect animation.');
  const entries = Object.entries(animation);
  if (entries.length > MAX_ANIMATED_PARAMETERS)
    throw new RangeError('Too many animated parameters.');
  for (const [key, value] of entries) assertParameterAnimation(value, definitionFor(key), key);
}

export function freezeAnimation(animation: EffectAnimation): EffectAnimation {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(animation).map(([key, value]) => [key, freezeParameterAnimation(value)]),
    ),
  );
}
export function freezeParameterAnimation(animation: ParameterAnimation): ParameterAnimation {
  if (Object.isFrozen(animation) && Object.isFrozen(animation.keys)) return animation;
  return Object.freeze({
    keys: Object.freeze(
      animation.keys.map((key) =>
        Object.freeze({
          ...key,
          ...(key.inHandle ? { inHandle: Object.freeze({ ...key.inHandle }) } : {}),
          ...(key.outHandle ? { outHandle: Object.freeze({ ...key.outHandle }) } : {}),
        }),
      ),
    ),
    ...(animation.modulators
      ? {
          modulators: Object.freeze(
            animation.modulators.map((modulator) => Object.freeze({ ...modulator })),
          ),
        }
      : {}),
  });
}
export function freezeTimeline(timeline: Timeline): Timeline {
  if (Object.isFrozen(timeline)) return timeline;
  return Object.freeze({
    ...timeline,
    workArea: timeline.workArea ? Object.freeze({ ...timeline.workArea }) : null,
    ...(timeline.inOut ? { inOut: Object.freeze({ ...timeline.inOut }) } : {}),
    seed: Object.freeze({ ...timeline.seed }),
    markers: Object.freeze(timeline.markers.map((marker) => Object.freeze({ ...marker }))),
    ...(timeline.video ? { video: Object.freeze({ ...timeline.video }) } : {}),
    ...(timeline.audio
      ? {
          audio: Object.freeze({
            ...timeline.audio,
            ...(timeline.audio.analysis
              ? {
                  analysis: Object.freeze({
                    ...timeline.audio.analysis,
                    beats: Object.freeze([...timeline.audio.analysis.beats]),
                  }),
                }
              : {}),
          }),
        }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Interpolation

const NAMED_EASES: Record<
  Exclude<Interpolation, 'hold' | 'bezier'>,
  readonly [number, number, number, number]
> = {
  linear: [0, 0, 1, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

function cubic(a: number, b: number, c: number, d: number, s: number): number {
  const inverse = 1 - s;
  return (
    inverse * inverse * inverse * a +
    3 * inverse * inverse * s * b +
    3 * inverse * s * s * c +
    s * s * s * d
  );
}
/** Solve a monotonic cubic bezier x(s) = x for s in [0, 1]. */
function solveBezierParameter(x0: number, x1: number, x2: number, x3: number, x: number): number {
  if (x <= x0) return 0;
  if (x >= x3) return 1;
  let low = 0;
  let high = 1;
  let s = (x - x0) / (x3 - x0);
  for (let iteration = 0; iteration < 8; iteration++) {
    const value = cubic(x0, x1, x2, x3, s) - x;
    if (Math.abs(value) < 1e-9) return s;
    const inverse = 1 - s;
    const slope =
      3 * inverse * inverse * (x1 - x0) + 6 * inverse * s * (x2 - x1) + 3 * s * s * (x3 - x2);
    if (Math.abs(slope) < 1e-9) break;
    const next = s - value / slope;
    if (next < 0 || next > 1) break;
    s = next;
  }
  for (let iteration = 0; iteration < 48; iteration++) {
    s = (low + high) / 2;
    const value = cubic(x0, x1, x2, x3, s);
    if (Math.abs(value - x) < 1e-10) break;
    if (value < x) low = s;
    else high = s;
  }
  return s;
}
/** CSS-style cubic-bezier easing of progress in [0, 1]. */
export function easeProgress(interpolation: Interpolation, progress: number): number {
  if (interpolation === 'hold') return progress >= 1 ? 1 : 0;
  if (interpolation === 'bezier') return progress;
  const [x1, y1, x2, y2] = NAMED_EASES[interpolation];
  if (interpolation === 'linear') return progress;
  const s = solveBezierParameter(0, x1, x2, 1, progress);
  return cubic(0, y1, y2, 1, s);
}

/** Default handles that reproduce a named ease, used when switching a key to bezier. */
export function defaultHandles(
  interpolation: Interpolation,
  segment: number,
  normalizedDelta: number,
): { outHandle: KeyHandle; inHandle: KeyHandle } {
  const [x1, y1, x2, y2] =
    interpolation === 'hold' || interpolation === 'bezier'
      ? NAMED_EASES['ease-in-out']
      : NAMED_EASES[interpolation];
  return {
    outHandle: { dt: roundTime(x1 * segment), dv: y1 * normalizedDelta },
    inHandle: { dt: roundTime((x2 - 1) * segment), dv: (y2 - 1) * normalizedDelta },
  };
}

export interface NumericRange {
  readonly min: number;
  readonly max: number;
}
function normalized(value: number, range: NumericRange): number {
  return range.max === range.min ? 0 : (value - range.min) / (range.max - range.min);
}
function denormalized(value: number, range: NumericRange): number {
  return range.min + value * (range.max - range.min);
}

function parseHex(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function fromLinear(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}
/** Blend two #RRGGBB colors in linear light. */
export function mixColor(a: string, b: string, amount: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  const mixed = from.map((channel, index) => {
    const start = toLinear(channel);
    const end = toLinear(to[index]!);
    return fromLinear(start + (end - start) * amount);
  });
  return (
    '#' +
    mixed
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/**
 * Value of a keyframed parameter at time t. Before the first key and after the
 * last key the nearest key holds. Choice parameters always step.
 */
export function evaluateKeys(
  keys: readonly Keyframe[],
  t: number,
  definition: ParameterDefinition,
): number | string | undefined {
  if (!keys.length) return undefined;
  const first = keys[0]!;
  if (t <= first.t || keys.length === 1) return first.value;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.value;
  // Binary search for the segment [keys[i], keys[i + 1]).
  let low = 0;
  let high = keys.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (keys[middle]!.t <= t) low = middle;
    else high = middle;
  }
  const from = keys[low]!;
  const to = keys[high]!;
  if (definition.kind === 'choice' || from.interpolation === 'hold') return from.value;
  const duration = to.t - from.t;
  const progress = duration > 0 ? (t - from.t) / duration : 1;
  if (definition.kind === 'color')
    return mixColor(
      String(from.value),
      String(to.value),
      easeProgress(from.interpolation === 'bezier' ? 'ease-in-out' : from.interpolation, progress),
    );
  if (definition.kind !== 'number') return from.value;
  const start = Number(from.value);
  const end = Number(to.value);
  if (from.interpolation === 'bezier') {
    const range = { min: definition.min, max: definition.max };
    const handles = defaultHandles(
      'ease-in-out',
      duration,
      normalized(end, range) - normalized(start, range),
    );
    const outHandle = from.outHandle ?? handles.outHandle;
    const inHandle = to.inHandle ?? handles.inHandle;
    const x1 = from.t + Math.min(Math.max(outHandle.dt, 0), duration);
    const x2 = to.t + Math.max(Math.min(inHandle.dt, 0), -duration);
    const s = solveBezierParameter(from.t, x1, x2, to.t, t);
    const y = cubic(
      normalized(start, range),
      normalized(start, range) + outHandle.dv,
      normalized(end, range) + inHandle.dv,
      normalized(end, range),
      s,
    );
    return denormalized(y, range);
  }
  return start + (end - start) * easeProgress(from.interpolation, progress);
}

// ---------------------------------------------------------------------------
// Modulators

export interface ModulationContext {
  /** Project tempo in BPM for synced LFOs. */
  readonly bpm: number;
  /** Project seed, so random-step LFOs reroll with the seed. */
  readonly seed: number;
  readonly audio?: AudioAnalysis | undefined;
}

function hash32(a: number, b: number): number {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function stringHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}

/** LFO output in [-1, 1] at time t. Computed from time and tempo, never free-running. */
export function lfoValue(modulator: LfoModulator, t: number, context: ModulationContext): number {
  const beats = LFO_DIVISIONS.find((division) => division.value === modulator.division)!.beats;
  const cycles = modulator.sync ? (t * Math.max(1, context.bpm)) / 60 / beats : t * modulator.rate;
  const position = cycles + modulator.phase / 360;
  const fraction = position - Math.floor(position);
  switch (modulator.shape) {
    case 'sine':
      return Math.sin(fraction * Math.PI * 2);
    case 'triangle':
      return fraction < 0.25 ? fraction * 4 : fraction < 0.75 ? 2 - fraction * 4 : fraction * 4 - 4;
    case 'square':
      return fraction < 0.5 ? 1 : -1;
    case 'saw':
      return fraction * 2 - 1;
    case 'random':
      return (
        (hash32(context.seed ^ stringHash(modulator.id), Math.floor(position)) / 0xffffffff) * 2 - 1
      );
  }
}

const decodedAnalysis = new WeakMap<AudioAnalysis, { spectrum: Uint8Array; peaks: Uint8Array }>();
function decodeBase64(text: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  const buffer = (
    globalThis as unknown as { Buffer: { from(text: string, encoding: string): Uint8Array } }
  ).Buffer.from(text, 'base64');
  return new Uint8Array(buffer);
}
export function decodeAudioAnalysis(analysis: AudioAnalysis): {
  spectrum: Uint8Array;
  peaks: Uint8Array;
} {
  let decoded = decodedAnalysis.get(analysis);
  if (!decoded) {
    decoded = { spectrum: decodeBase64(analysis.spectrum), peaks: decodeBase64(analysis.peaks) };
    decodedAnalysis.set(analysis, decoded);
  }
  return decoded;
}
/** Center frequency of each log-spaced analysis bin. */
export function analysisBinFrequency(analysis: AudioAnalysis, bin: number): number {
  return analysis.minHz * (analysis.maxHz / analysis.minHz) ** ((bin + 0.5) / analysis.bins);
}
export function bandLimits(modulator: AudioModulator): { low: number; high: number } {
  if (modulator.band === 'custom') return { low: modulator.lowHz, high: modulator.highHz };
  const band = AUDIO_BANDS.find((entry) => entry.value === modulator.band)!;
  return { low: band.low, high: band.high };
}
/** Raw band energy per analysis frame, 0–1. */
export function bandEnergy(analysis: AudioAnalysis, low: number, high: number): Float32Array {
  const { spectrum } = decodeAudioAnalysis(analysis);
  const frames = Math.floor(spectrum.length / analysis.bins);
  const bins: number[] = [];
  for (let bin = 0; bin < analysis.bins; bin++) {
    const frequency = analysisBinFrequency(analysis, bin);
    if (frequency >= low && frequency <= high) bins.push(bin);
  }
  if (!bins.length) {
    // A narrow custom band still follows its nearest bin.
    const center = Math.sqrt(low * high);
    let nearest = 0;
    for (let bin = 1; bin < analysis.bins; bin++)
      if (
        Math.abs(Math.log(analysisBinFrequency(analysis, bin) / center)) <
        Math.abs(Math.log(analysisBinFrequency(analysis, nearest) / center))
      )
        nearest = bin;
    bins.push(nearest);
  }
  const energy = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (const bin of bins) sum += spectrum[frame * analysis.bins + bin]!;
    energy[frame] = sum / bins.length / 255;
  }
  return energy;
}
const envelopes = new WeakMap<AudioAnalysis, Map<string, Float32Array>>();
/** Attack/release smoothed band envelope; deterministic because it is computed from frame 0. */
export function audioEnvelope(analysis: AudioAnalysis, modulator: AudioModulator): Float32Array {
  const { low, high } = bandLimits(modulator);
  const cacheKey = `${low}:${high}:${modulator.attackMs}:${modulator.releaseMs}`;
  let cache = envelopes.get(analysis);
  if (!cache) envelopes.set(analysis, (cache = new Map()));
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const raw = bandEnergy(analysis, low, high);
  // Normalize to the loudest frame so quiet tracks still drive the full range.
  let peak = 0;
  for (const value of raw) peak = Math.max(peak, value);
  const scale = peak > 0 ? 1 / peak : 0;
  const step = 1 / analysis.rate;
  const attack = modulator.attackMs > 0 ? 1 - Math.exp(-step / (modulator.attackMs / 1000)) : 1;
  const release = modulator.releaseMs > 0 ? 1 - Math.exp(-step / (modulator.releaseMs / 1000)) : 1;
  const envelope = new Float32Array(raw.length);
  let current = 0;
  for (let frame = 0; frame < raw.length; frame++) {
    const target = raw[frame]! * scale;
    current += (target - current) * (target > current ? attack : release);
    envelope[frame] = current;
  }
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, envelope);
  return envelope;
}
export function audioValue(
  modulator: AudioModulator,
  t: number,
  context: ModulationContext,
): number {
  if (!context.audio) return 0;
  const envelope = audioEnvelope(context.audio, modulator);
  if (!envelope.length) return 0;
  const position = t * context.audio.rate;
  const index = Math.floor(position);
  if (index < 0) return envelope[0]!;
  if (index >= envelope.length - 1) return envelope[envelope.length - 1]!;
  const fraction = position - index;
  return envelope[index]! + (envelope[index + 1]! - envelope[index]!) * fraction;
}

/** Apply modulators top to bottom to a normalized value, then clamp to 0–1. */
export function applyModulators(
  base: number,
  modulators: readonly Modulator[],
  t: number,
  context: ModulationContext,
): number {
  let value = base;
  for (const modulator of modulators) {
    if (!modulator.enabled) continue;
    if (modulator.kind === 'lfo') {
      const wave = lfoValue(modulator, t, context) * modulator.depth;
      value = modulator.combine === 'multiply' ? value * (1 + wave) : value + wave;
    } else {
      if (!context.audio) continue;
      const energy = audioValue(modulator, t, context);
      const output = modulator.outMin + (modulator.outMax - modulator.outMin) * energy;
      value =
        modulator.combine === 'replace'
          ? output
          : modulator.combine === 'multiply'
            ? value * output
            : value + energy * (modulator.outMax - modulator.outMin);
    }
  }
  return Math.min(1, Math.max(0, value));
}

export function roundParameter(value: number, definition: ParameterDefinition): number {
  if (definition.kind !== 'number') return value;
  let result = Math.min(definition.max, Math.max(definition.min, value));
  if (
    definition.unit === 'bits' ||
    definition.unit === 'count' ||
    (Number.isInteger(definition.step) && definition.step >= 1 && Number.isInteger(definition.min))
  )
    result = Math.round(result);
  return Math.min(definition.max, Math.max(definition.min, result));
}

/**
 * Value of one animated parameter at t: keys first, then modulators, then a
 * clamp to the parameter's range. Returns base when nothing applies.
 */
export function evaluateParameter(
  animation: ParameterAnimation,
  base: number | string,
  t: number,
  definition: ParameterDefinition,
  context: ModulationContext,
): number | string {
  const keyed = evaluateKeys(animation.keys, t, definition) ?? base;
  if (definition.kind !== 'number') return keyed;
  const modulators = animation.modulators?.filter((modulator) => modulator.enabled) ?? [];
  if (!modulators.length) return roundParameter(Number(keyed), definition);
  const range = { min: definition.min, max: definition.max };
  return roundParameter(
    denormalized(applyModulators(normalized(Number(keyed), range), modulators, t, context), range),
    definition,
  );
}

// ---------------------------------------------------------------------------
// Seeds and ranges

/** Seed for a frame. Frame zero (or Fixed mode) keeps the project seed exactly. */
export function frameSeed(masterSeed: number, seed: SeedTrack | undefined, frame: number): number {
  if (!seed || seed.mode === 'fixed') return masterSeed;
  const step = seed.mode === 'every-frame' ? frame : Math.floor(frame / Math.max(1, seed.every));
  if (step <= 0) return masterSeed;
  return hash32(masterSeed, step);
}
/** Frames where the seed changes, for the seed track ticks. */
export function seedChangeFrames(seed: SeedTrack, frames: number, limit = 4000): number[] {
  if (seed.mode === 'fixed') return [];
  const every = seed.mode === 'every-frame' ? 1 : Math.max(1, seed.every);
  const result: number[] = [];
  for (let frame = every; frame < frames && result.length < limit; frame += every)
    result.push(frame);
  return result;
}
export function inActiveRange(range: ActiveRange | undefined, t: number): boolean {
  return !range || (t >= range.start - 1e-9 && t < range.end - 1e-9);
}

// ---------------------------------------------------------------------------
// Key editing helpers (pure). Times snap to frames before they are stored.

export function keyIndexAtFrame(
  animation: ParameterAnimation | undefined,
  frame: number,
  fps: number,
): number {
  if (!animation) return -1;
  return animation.keys.findIndex((key) => timeFrame(key.t, fps) === frame);
}
export function upsertKey(
  animation: ParameterAnimation | undefined,
  t: number,
  value: number | string,
  fps: number,
  interpolation?: Interpolation,
): ParameterAnimation {
  const time = frameTime(timeFrame(t, fps), fps);
  const keys = [...(animation?.keys ?? [])];
  const index = keys.findIndex((key) => timeFrame(key.t, fps) === timeFrame(time, fps));
  if (index >= 0) {
    keys[index] = { ...keys[index]!, value, ...(interpolation ? { interpolation } : {}) };
  } else {
    // New keys inherit the ease of the key before them so a lane keeps one feel.
    const previous = [...keys].reverse().find((key) => key.t < time);
    keys.push({
      t: time,
      value,
      interpolation: interpolation ?? previous?.interpolation ?? 'ease-in-out',
    });
    keys.sort((a, b) => a.t - b.t);
  }
  return { ...(animation ?? {}), keys };
}
export function removeKeyAtFrame(
  animation: ParameterAnimation,
  frame: number,
  fps: number,
): ParameterAnimation | null {
  const keys = animation.keys.filter((key) => timeFrame(key.t, fps) !== frame);
  if (!keys.length && !animation.modulators?.length) return null;
  return { ...animation, keys };
}
/** Move keys (by index) by a frame delta. Colliding keys at the destination are replaced. */
export function moveKeys(
  animation: ParameterAnimation,
  indices: readonly number[],
  deltaFrames: number,
  fps: number,
  maxFrame: number,
): ParameterAnimation {
  if (!deltaFrames || !indices.length) return animation;
  const moving = new Set(indices);
  const moved = animation.keys
    .filter((_, index) => moving.has(index))
    .map((key) => ({
      ...key,
      t: frameTime(Math.min(maxFrame, Math.max(0, timeFrame(key.t, fps) + deltaFrames)), fps),
    }));
  const occupied = new Set(moved.map((key) => timeFrame(key.t, fps)));
  const staying = animation.keys.filter(
    (key, index) => !moving.has(index) && !occupied.has(timeFrame(key.t, fps)),
  );
  // Several moved keys can land on one clamped frame; keep the last one.
  const unique = new Map<number, Keyframe>();
  for (const key of moved) unique.set(timeFrame(key.t, fps), key);
  return {
    ...animation,
    keys: [...staying, ...unique.values()].sort((a, b) => a.t - b.t),
  };
}
export function adjacentKeyFrame(
  animation: ParameterAnimation | undefined,
  frame: number,
  fps: number,
  direction: -1 | 1,
): number | null {
  if (!animation) return null;
  const frames = animation.keys.map((key) => timeFrame(key.t, fps));
  const candidates = frames.filter((value) => (direction < 0 ? value < frame : value > frame));
  if (!candidates.length) return null;
  return direction < 0 ? Math.max(...candidates) : Math.min(...candidates);
}
export function setKeysInterpolation(
  animation: ParameterAnimation,
  indices: readonly number[] | 'all',
  interpolation: Interpolation,
): ParameterAnimation {
  const selected = indices === 'all' ? null : new Set(indices);
  return {
    ...animation,
    keys: animation.keys.map((key, index) => {
      if (selected && !selected.has(index)) return key;
      // The in-handle shapes the segment before this key, so it always stays;
      // the out-handle only matters while this key's own segment is Bezier.
      return {
        t: key.t,
        value: key.value,
        interpolation,
        ...(key.inHandle ? { inHandle: key.inHandle } : {}),
        ...(interpolation === 'bezier' && key.outHandle ? { outHandle: key.outHandle } : {}),
      };
    }),
  };
}
/** Re-time every key when the project frame rate changes so keys stay on frames. */
export function snapAnimationToRate(
  animation: ParameterAnimation,
  fps: number,
): ParameterAnimation {
  const unique = new Map<number, Keyframe>();
  for (const key of animation.keys)
    unique.set(timeFrame(key.t, fps), { ...key, t: frameTime(timeFrame(key.t, fps), fps) });
  return { ...animation, keys: [...unique.values()].sort((a, b) => a.t - b.t) };
}

export function createLfo(id: string): LfoModulator {
  return {
    kind: 'lfo',
    id,
    enabled: true,
    shape: 'sine',
    sync: true,
    division: '1/2',
    rate: 1,
    depth: 0.12,
    phase: 90,
    combine: 'add',
  };
}
export function createAudioModulator(id: string): AudioModulator {
  return {
    kind: 'audio',
    id,
    enabled: true,
    band: 'low',
    lowHz: 40,
    highHz: 160,
    attackMs: 8,
    releaseMs: 180,
    outMin: 0.4,
    outMax: 1,
    combine: 'replace',
  };
}
