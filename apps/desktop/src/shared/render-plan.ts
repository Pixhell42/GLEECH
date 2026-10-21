// Which timeline instants a render visits, and at what size effects run.
// Shared by desktop and terminal hosts; no browser or runtime dependencies.
import {
  timeFrame,
  workRange,
  frameCount,
  type EffectInstance,
  type Timeline,
} from '@gleech/project-model';
import type {
  GifRenderSettings,
  OutputFrame,
  RangeKind,
  RenderRange,
  UpscaleMethod,
  VideoRenderSettings,
} from './render';

export function renderRange(kind: RangeKind, timeline: Timeline): RenderRange {
  const end = frameCount(timeline) / timeline.fps;
  if (kind === 'work' && timeline.workArea) return { kind, ...workRange(timeline) };
  if (kind === 'inout' && timeline.inOut)
    return {
      kind,
      start: Math.max(0, timeline.inOut.start),
      end: Math.min(end, timeline.inOut.end),
    };
  return { kind: 'whole', start: 0, end };
}

/** Uniform instants from start (inclusive) to end (exclusive) at a rate. */
export function uniformTimes(start: number, end: number, rate: number): number[] {
  const count = Math.max(1, Math.round((end - start) * rate));
  return Array.from({ length: count }, (_, index) => start + index / rate);
}

/** Timeline seconds for every frame the Video tab renders. */
export function videoFrameTimes(
  settings: VideoRenderSettings,
  range: Pick<RenderRange, 'start' | 'end'>,
  timeline: Timeline,
  effects: readonly EffectInstance[],
): number[] {
  const all = uniformTimes(range.start, range.end, settings.fps);
  if (settings.output !== 'sequence') return all;
  const every = settings.sequence.every;
  if (every === 'all') return all;
  if (every === '2') return all.filter((_, index) => index % 2 === 0);
  const wanted =
    every === 'keys'
      ? effects.flatMap((effect) =>
          Object.values(effect.animation ?? {}).flatMap((lane) => lane.keys.map((key) => key.t)),
        )
      : timeline.markers.map((marker) => marker.t);
  const frames = new Set(
    wanted
      .filter((t) => t >= range.start - 1e-9 && t < range.end - 1e-9)
      .map((t) => timeFrame(t - range.start, settings.fps)),
  );
  const picked = all.filter((_, index) => frames.has(index));
  return picked.length ? picked : [all[0]!];
}

/**
 * Input frames for a loop. The encoder applies speed, loop style and output
 * rate; without smoothing we render exactly the frames the loop shows.
 */
export function gifInputRate(settings: GifRenderSettings, timelineFps: number): number {
  const speed = Math.min(4, Math.max(0.25, settings.speed));
  return settings.smoothing === 'off' ? settings.fps / speed : timelineFps;
}
export function gifFrameTimes(
  settings: GifRenderSettings,
  range: Pick<RenderRange, 'start' | 'end'>,
  timelineFps: number,
): number[] {
  const rate = gifInputRate(settings, timelineFps);
  const segments =
    settings.loop === 'concat' && settings.segments.length ? settings.segments : [range];
  return segments.flatMap((segment) =>
    segment.end > segment.start ? uniformTimes(segment.start, segment.end, rate) : [],
  );
}

/** Uniform spacing lets the video decoder stream frames instead of seeking each one. */
export function isUniform(times: readonly number[], rate: number): boolean {
  return times.every(
    (t, index) => index === 0 || Math.abs(t - times[index - 1]! - 1 / rate) < 1e-6,
  );
}

const MAX_RENDER_DIMENSION = 8192;

/**
 * Size effects render at. Effects draw natively at the output size when the
 * target is larger ("Render at full size" or "Upscale source first"); otherwise
 * at source size, and the encoder resizes.
 */
export function effectRenderSize(
  source: { width: number; height: number },
  frame: Pick<OutputFrame, 'width' | 'height' | 'fit'>,
  method: UpscaleMethod,
): { width: number; height: number; scale: number } {
  const sx = frame.width / source.width;
  const sy = frame.height / source.height;
  const scale =
    frame.fit === 'crop' || frame.fit === 'stretch'
      ? Math.max(sx, sy)
      : frame.fit === 'letterbox-h'
        ? sx
        : frame.fit === 'letterbox-v'
          ? sy
          : Math.min(sx, sy);
  if (method === 'upscale-result' || scale <= 1.001)
    return { width: source.width, height: source.height, scale: 1 };
  const limited = Math.min(
    scale,
    MAX_RENDER_DIMENSION / source.width,
    MAX_RENDER_DIMENSION / source.height,
  );
  return {
    width: Math.max(1, Math.round(source.width * limited)),
    height: Math.max(1, Math.round(source.height * limited)),
    scale: limited,
  };
}
