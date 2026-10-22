// Node adapters shared by CLI encoding and TUI playback/scrubbing.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { activeVideo, type ProjectState } from '@gleech/project-model';
import { bundledFfmpegCandidates, createFfmpegLocator, type FfmpegLocator } from '../main/ffmpeg';
import type { TimelineRenderAdapters } from '../shared/timeline-runner';
import type { RenderFrame } from '../shared/render';
import { cliVideoSource } from './timeline-video';
import { resizeImage } from './codec';
import { draftFor, renderHeadless, type HeadlessRenderResult } from './engine';
import { userDataCandidates } from './library';
import { resourcesDir } from './runtime';
import type { Session } from './session';

const locators = new WeakMap<Session, FfmpegLocator>();
export function terminalFfmpeg(session: Session): FfmpegLocator {
  let locator = locators.get(session);
  if (!locator) {
    const resources = resourcesDir();
    const configs = userDataCandidates().map((dir) => join(dir, 'ffmpeg.json'));
    locator = createFfmpegLocator({
      configFile: configs.find(existsSync) ?? configs[0]!,
      bundled: [
        ...bundledFfmpegCandidates(resources, dirname(resources), true),
        ...bundledFfmpegCandidates(resources, dirname(resources), false),
      ],
    });
    locators.set(session, locator);
  }
  return locator;
}

export function terminalTimelineHost(
  session: Session,
  project: ProjectState,
  options: { signal?: AbortSignal; previewMaxDimension?: number; sourceFrame?: RenderFrame } = {},
) {
  const sourceId = project.source?.id;
  const clip = activeVideo(project);
  const video =
    clip && !options.sourceFrame
      ? cliVideoSource(clip, terminalFfmpeg(session), options.signal)
      : null;
  const drafts = new WeakMap<ArrayBuffer, Promise<RenderFrame>>();
  const warnings = new Set<string>();
  const backends = new Set<string>();
  let lastRender: HeadlessRenderResult | null = null;
  const adapters: Omit<TimelineRenderAdapters, 'begin'> = {
    source: video?.source ?? {
      kind: 'still',
      read: () =>
        options.sourceFrame ? Promise.resolve(options.sourceFrame) : session.sourceImage(sourceId),
    },
    resize: resizeImage,
    subject: () => session.subject(sourceId),
    render: async (source, effects, context) => {
      const max = options.previewMaxDimension;
      let draft: RenderFrame | undefined;
      if (max) {
        let pending = drafts.get(source.pixels);
        if (!pending) drafts.set(source.pixels, (pending = draftFor(source, max)));
        draft = await pending;
      }
      const result = await renderHeadless({
        source,
        effects,
        masterSeed: context.masterSeed,
        subject: () =>
          context.subjectMask ? Promise.resolve(context.subjectMask) : session.subject(sourceId),
        isCancelled: context.isCancelled,
        ...(max ? { previewMaxDimension: max } : {}),
        ...(draft ? { draftSource: draft } : {}),
      });
      lastRender = result;
      result.warnings.forEach((warning) => warnings.add(warning));
      backends.add(result.backend);
      return result.image;
    },
  };
  return {
    adapters,
    warnings,
    backends,
    lastRender: () => lastRender,
    dispose: () => video?.dispose(),
  };
}
