import { dirname, join } from 'node:path';
import { clampFrame, frameCount, frameTime, type Timeline } from '@gleech/project-model';
import { renderRange } from '../../shared/render-plan';
import { outputStem, renderSourceSize } from '../../shared/render-request';
import type { RangeKind } from '../../shared/render';
import type { Session } from '../session';
import {
  renderSafety,
  type RenderSafetySettings,
  type RenderMemoryAssessment,
} from '../../shared/render-safety';

export const timelineRanges = (timeline: Timeline): RangeKind[] => [
  'whole',
  ...(timeline.workArea ? ['work' as const] : []),
  ...(timeline.inOut ? ['inout' as const] : []),
];

/** Navigation state is separate from project history and dirty state. */
export class TimelineTransport {
  frame = 0;
  playing = false;
  rangeKind: RangeKind = 'whole';
  timeline: Timeline | undefined;
  constructor(timeline?: Timeline) {
    this.sync(timeline);
  }
  sync(timeline: Timeline | undefined) {
    this.timeline = timeline;
    if (!timeline) {
      this.frame = 0;
      this.playing = false;
      this.rangeKind = 'whole';
      return;
    }
    this.frame = clampFrame(this.frame, timeline);
    if (!timelineRanges(timeline).includes(this.rangeKind)) this.rangeKind = 'whole';
  }
  get time() {
    return this.timeline ? frameTime(this.frame, this.timeline.fps) : 0;
  }
  get count() {
    return this.timeline ? frameCount(this.timeline) : 1;
  }
  get range() {
    return this.timeline
      ? renderRange(this.rangeKind, this.timeline)
      : { kind: 'whole' as const, start: 0, end: 1 };
  }
  seek(frame: number) {
    this.playing = false;
    this.frame = this.timeline ? clampFrame(frame, this.timeline) : 0;
  }
  displayed(time: number) {
    if (this.timeline) this.frame = clampFrame(Math.round(time * this.timeline.fps), this.timeline);
  }
  private bounds() {
    const fps = this.timeline!.fps;
    const range = this.range;
    // Stored timeline seconds are rounded to microseconds. Avoid advancing an
    // exact frame boundary because e.g. 0.066667 * 30 is slightly above two.
    const boundary = (time: number) => Math.ceil((time - 1e-6) * fps);
    return {
      start: Math.max(0, boundary(range.start)),
      end: Math.min(this.count, boundary(range.end)),
    };
  }
  play() {
    if (!this.timeline) return;
    const { start, end } = this.bounds();
    if (end <= start) return;
    if (this.frame < start || this.frame >= end - 1) this.frame = start;
    this.playing = true;
  }
  cycleRange() {
    if (!this.timeline) return;
    const kinds = timelineRanges(this.timeline);
    this.rangeKind = kinds[(kinds.indexOf(this.rangeKind) + 1) % kinds.length]!;
  }
  /** Keep terminal playback at at most 15 FPS, sampling exact project frames. */
  schedule() {
    if (!this.timeline) return { times: [0], fps: 1, endTime: 1 };
    const stride = Math.max(1, Math.ceil(this.timeline.fps / 15));
    const { end } = this.bounds();
    const times = Array.from(
      { length: Math.max(1, Math.ceil((end - this.frame) / stride)) },
      (_, i) => frameTime(this.frame + i * stride, this.timeline!.fps),
    );
    return { times, fps: this.timeline.fps / stride, endTime: this.range.end };
  }
  completed() {
    if (!this.timeline) return;
    const { start, end } = this.bounds();
    this.playing = this.timeline.loop;
    this.frame = this.playing ? start : Math.max(start, end - 1);
  }
}

export interface TimelineExportModal {
  safety: RenderSafetySettings;
  memory?: RenderMemoryAssessment | undefined;
  memoryKey?: string;
  kind: 'timeline-export';
  row: number;
  format: 'mp4' | 'gif' | 'png';
  range: RangeKind;
  fps: string;
  width: string;
  audio: boolean;
  path: string;
  pathEdited: boolean;
  fpsEdited: boolean;
  widthEdited: boolean;
  error?: string | undefined;
  overwritePath?: string | undefined;
}

export function timelineOutputPath(session: Session, format: TimelineExportModal['format']) {
  const stem = outputStem(session.path?.split(/[\\/]/).pop() ?? session.name) || 'GLEECH';
  return join(
    session.path ? dirname(session.path) : process.cwd(),
    `${stem}${format === 'png' ? '-frames' : `-timeline.${format}`}`,
  );
}

export function timelineSafetyValues(modal: TimelineExportModal): Record<string, unknown> {
  const safety = modal.safety;
  const movie = modal.format === 'mp4';
  return {
    'memory-mode': safety.mode,
    'no-memory-check': !safety.checkMemory,
    'processing-resolution': safety.processing,
    'tile-size': String(safety.tileSize),
    'segment-seconds': String(movie ? safety.segmentSeconds : 0),
    'keep-parts': movie && safety.keepParts,
    resume: movie && safety.resume,
  };
}

export function timelineExportModal(session: Session, range: RangeKind): TimelineExportModal {
  return {
    kind: 'timeline-export',
    safety: renderSafety(),
    row: 0,
    format: 'mp4',
    range,
    fps: String(session.state.timeline!.fps),
    width: String(renderSourceSize(session.state).width),
    audio: true,
    path: timelineOutputPath(session, 'mp4'),
    pathEdited: false,
    fpsEdited: false,
    widthEdited: false,
  };
}
