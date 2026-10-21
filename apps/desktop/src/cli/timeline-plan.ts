import { dirname, extname, join, resolve } from 'node:path';
import type { ParseArgsConfig } from 'node:util';
import { type ProjectState } from '@gleech/project-model';
import { buildTimelineRenderRequest, outputStem, renderSourceSize } from '../shared/render-request';
import { defaultGifSettings, defaultVideoSettings } from '../shared/render-presets';
import { renderRange } from '../shared/render-plan';
import type { GifRenderSettings, RangeKind } from '../shared/render';
import { UsageError } from './errors';

export const TIMELINE_OPTIONS: ParseArgsConfig['options'] = {
  timeline: { type: 'boolean' },
  fps: { type: 'string' },
  range: { type: 'string' },
  start: { type: 'string' },
  end: { type: 'string' },
  width: { type: 'string' },
  'no-audio': { type: 'boolean' },
};

export function validateTimelineOptions(values: Record<string, unknown>): void {
  if (!values['timeline']) {
    for (const key of Object.keys(TIMELINE_OPTIONS!))
      if (key !== 'timeline' && values[key] !== undefined)
        throw new UsageError(`--${key} requires --timeline.`);
    return;
  }
  for (const key of ['quality', 'max-size', 'show', 'save-project', 'save-preset'])
    if (values[key] !== undefined)
      throw new UsageError(`--${key} is for still renders; omit it with --timeline.`);
}

function numberOption(
  values: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (values[key] === undefined) return fallback;
  const value = Number(values[key]);
  if (String(values[key]).trim() === '' || !Number.isFinite(value) || value < min || value > max)
    throw new UsageError(`--${key} must be a number from ${min} to ${max}.`);
  return value;
}

/** Terminal options become the very same immutable plan used by desktop. */
export function cliTimelinePlan(
  original: ProjectState,
  input: string,
  values: Record<string, unknown>,
) {
  validateTimelineOptions(values);
  if (!original.timeline || !original.source)
    throw new UsageError('This project has no timeline. Save it in Timeline mode first.');
  // Saved media is external. Relative references belong to the project folder,
  // independently of the shell's working directory.
  const project: ProjectState = {
    ...original,
    timeline: {
      ...original.timeline,
      ...(original.timeline.video
        ? {
            video: {
              ...original.timeline.video,
              path: resolve(dirname(input), original.timeline.video.path),
            },
          }
        : {}),
      ...(original.timeline.audio
        ? {
            audio: {
              ...original.timeline.audio,
              path: resolve(dirname(input), original.timeline.audio.path),
            },
          }
        : {}),
    },
  };
  const timeline = project.timeline!;
  const output = values['output'] === undefined ? undefined : resolve(String(values['output']));
  const extension = output ? extname(output).toLowerCase().slice(1) : '';
  const format = String(
    values['format'] ?? (['mp4', 'gif'].includes(extension) ? extension : 'mp4'),
  );
  if (!['mp4', 'gif', 'png'].includes(format))
    throw new UsageError('Timeline --format must be mp4, gif or png (a frame sequence).');
  if (format !== 'png' && output && extension !== format)
    throw new UsageError(`Use a .${format} output file, or --format png for a sequence folder.`);
  const rangeKind = String(values['range'] ?? 'whole');
  if (!['whole', 'work', 'inout'].includes(rangeKind))
    throw new UsageError('--range must be whole, work or inout.');
  if (rangeKind === 'inout' && !timeline.inOut)
    throw new UsageError('This timeline has no In/Out points.');
  const whole = renderRange('whole', timeline);
  const selected = renderRange(rangeKind as RangeKind, timeline);
  const range = {
    start: numberOption(values, 'start', selected.start, 0, whole.end),
    end: numberOption(values, 'end', selected.end, 0, whole.end),
  };
  if (range.end <= range.start) throw new UsageError('--end must be after --start.');
  const fps = numberOption(values, 'fps', format === 'gif' ? 15 : timeline.fps, 1, 240);
  if (format === 'gif' && ![10, 12, 15, 24, 30].includes(fps))
    throw new UsageError('GIF --fps must be 10, 12, 15, 24 or 30.');
  if (Math.round((range.end - range.start) * fps) > 1_000_000)
    throw new UsageError('Choose a shorter range or lower FPS (at most 1,000,000 frames).');
  const source = renderSourceSize(project);
  const width = numberOption(
    values,
    'width',
    format === 'gif' ? Math.max(16, Math.min(480, source.width)) : source.width,
    format === 'gif' ? 16 : 2,
    format === 'gif' ? 4096 : 8192,
  );
  if (!Number.isInteger(width)) throw new UsageError('--width must be an integer.');
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  const size = {
    width: format === 'mp4' ? even(width) : Math.max(2, width),
    height:
      format === 'mp4'
        ? even((width * source.height) / source.width)
        : Math.max(2, Math.round((width * source.height) / source.width)),
  };
  if (size.width > 8192 || size.height > 8192 || size.width * size.height > 64 * 1024 * 1024)
    throw new UsageError('Choose a smaller --width (output must fit within 8192 × 8192).');
  const name = outputStem(input.split(/[\\/]/).pop() ?? '') || 'GLEECH';
  const outputPath =
    output ??
    join(dirname(input), `${name}${format === 'png' ? '-frames' : `-timeline.${format}`}`);
  const video = defaultVideoSettings({ ...source, fps });
  const gif = defaultGifSettings();
  const request = buildTimelineRenderRequest({
    tab: format === 'gif' ? 'gif' : 'video',
    project,
    timeline,
    range,
    outputPath,
    name,
    video: {
      ...video,
      preset: 'custom',
      output: format === 'png' ? 'sequence' : 'movie',
      fps,
      frame: { ...video.frame, ...size, bars: 'black' },
      audio: { ...video.audio, source: 'mix', enabled: format === 'mp4' && !values['no-audio'] },
      sequence: { ...video.sequence, depth: 8, subfolder: false, separateAudio: false },
    },
    gif: {
      ...gif,
      preset: 'custom',
      width,
      fps: fps as GifRenderSettings['fps'],
      sizeLimitMb: 0,
    },
  });
  return { request, format, range, size, outputPath, overwrite: !!values['overwrite'] };
}
