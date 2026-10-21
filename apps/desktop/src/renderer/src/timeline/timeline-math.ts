// Geometry for the timeline lanes: frames ↔ pixels, ruler steps and snapping.

export interface LaneView {
  /** Frame at the left edge of the lanes (may be fractional while panning). */
  readonly start: number;
  readonly pxPerFrame: number;
}

export const TRACK_HEADER_WIDTH = 260;
export const MAX_PX_PER_FRAME = 48;

export function frameToX(frame: number, view: LaneView): number {
  return (frame - view.start) * view.pxPerFrame;
}
export function xToFrame(x: number, view: LaneView): number {
  return x / view.pxPerFrame + view.start;
}
export function visibleFrames(view: LaneView, width: number): { first: number; last: number } {
  return {
    first: Math.max(0, Math.floor(view.start)),
    last: Math.ceil(view.start + width / view.pxPerFrame),
  };
}
/** Room before frame 0 and after the last frame, so edge keys stay whole. */
export const LANE_PADDING = 10;
/** Fit the whole timeline into the lane width, with a little room at both ends. */
export function fitView(frames: number, width: number): LaneView {
  const pxPerFrame = Math.max(0.01, (width - LANE_PADDING * 2) / Math.max(1, frames));
  return { start: -LANE_PADDING / pxPerFrame, pxPerFrame };
}
export function clampView(view: LaneView, frames: number, width: number): LaneView {
  const minPx = Math.max(0.01, (width - LANE_PADDING * 2) / Math.max(1, frames));
  const pxPerFrame = Math.min(MAX_PX_PER_FRAME, Math.max(minPx, view.pxPerFrame));
  const minStart = -LANE_PADDING / pxPerFrame;
  const maxStart = Math.max(minStart, frames - (width - LANE_PADDING) / pxPerFrame);
  return { pxPerFrame, start: Math.min(maxStart, Math.max(minStart, view.start)) };
}
/** Zoom around a lane x position, keeping that frame under the pointer. */
export function zoomView(view: LaneView, pxPerFrame: number, anchorX: number): LaneView {
  const anchor = xToFrame(anchorX, view);
  return { pxPerFrame, start: anchor - anchorX / pxPerFrame };
}

/** Major ruler step in frames: labels stay at least ~72 px apart. */
export function rulerStep(pxPerFrame: number, fps: number): number {
  const rate = Math.max(1, Math.round(fps));
  const frameSteps = [1, 2, 5, 10].filter((step) => step < rate);
  const secondSteps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].map((seconds) =>
    Math.max(1, Math.round(seconds * rate)),
  );
  for (const step of [...frameSteps, ...secondSteps]) if (step * pxPerFrame >= 72) return step;
  return secondSteps[secondSteps.length - 1]!;
}
export function rulerLabel(frame: number, fps: number, step: number): string {
  const rate = Math.max(1, Math.round(fps));
  if (step < rate && step % rate !== 0 && rate % step !== 0) return `f${frame}`;
  const seconds = frame / rate;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  if (step < rate) {
    const whole = Math.floor(rest);
    const frames = Math.round((rest - whole) * rate);
    return frames
      ? `${minutes}:${String(whole).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
      : `${minutes}:${String(whole).padStart(2, '0')}`;
  }
  return `${minutes}:${String(Math.round(rest)).padStart(2, '0')}`;
}
/** 0:01.8 style label for ranges. */
export function shortTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** Nearest candidate within threshold frames, else the frame itself. */
export function snapFrame(
  frame: number,
  candidates: readonly number[],
  thresholdFrames: number,
): { frame: number; snapped: boolean } {
  let best = frame;
  let distance = thresholdFrames;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - frame);
    if (gap <= distance) {
      distance = gap;
      best = candidate;
    }
  }
  return { frame: Math.round(best), snapped: best !== frame };
}
