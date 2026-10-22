import type { ProjectState } from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import { setTimeout as delay } from 'node:timers/promises';
import { renderSourceSize } from '../shared/render-request';
import { runTimelineRender } from '../shared/timeline-runner';
import type { RenderFrame } from '../shared/render';
import { draftFor, type HeadlessRenderResult } from './engine';
import { terminalTimelineHost } from './timeline-host';
import type { Session } from './session';

export interface TimelinePreviewFrame extends HeadlessRenderResult {
  readonly time: number;
  readonly original: RenderFrame;
}

/** A capture encoder lets the shared runner drive a preview without writing files. */
export async function previewTimeline(
  session: Session,
  project: ProjectState,
  times: readonly number[],
  options: {
    signal?: AbortSignal;
    maxDimension?: number;
    sourceFrame?: RenderFrame;
    /** A uniformly sampled playback stream; single-frame seeks omit this. */
    fps?: number;
    paced?: boolean;
    /** Hold the final playback frame until this timeline time. */
    endTime?: number;
    onFrame(frame: TimelinePreviewFrame): void | Promise<void>;
  },
): Promise<void> {
  const host = terminalTimelineHost(session, project, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.maxDimension ? { previewMaxDimension: options.maxDimension } : {}),
    ...(options.sourceFrame ? { sourceFrame: options.sourceFrame } : {}),
  });
  let index = 0;
  let clock: number | undefined;
  const fps = options.fps ?? project.timeline?.fps ?? 30;
  try {
    await runTimelineRender(
      {
        kind: 'video',
        label: 'Timeline preview',
        project,
        spec: { kind: 'video', name: 'preview', outputPath: '' },
        times,
        inputFps: fps,
        renderSize: renderSourceSize(project),
        overlay: true,
      },
      {
        ...host.adapters,
        begin: async () => ({
          async frame(image, original) {
            if (options.signal?.aborted) throw new RenderCancelledError();
            // Start the playback clock after the first decoded/rendered frame.
            clock ??= performance.now();
            const wait = options.paced ? clock + (index * 1000) / fps - performance.now() : 0;
            if (wait > 0)
              await delay(wait, undefined, options.signal ? { signal: options.signal } : {});
            if (options.signal?.aborted) throw new RenderCancelledError();
            const rendered = host.lastRender();
            const matching = rendered?.image === image ? rendered : null;
            const output =
              !matching && options.maxDimension
                ? await draftFor(image, options.maxDimension)
                : image;
            await options.onFrame({
              image: output,
              original: original!,
              time: times[index++]!,
              milliseconds: matching?.milliseconds ?? 0,
              backend: matching?.backend ?? 'source',
              warnings: matching?.warnings ?? [],
            });
          },
          async finish() {
            if (options.paced && options.endTime !== undefined && clock !== undefined) {
              const wait = clock + (options.endTime - times[0]!) * 1000 - performance.now();
              if (wait > 0)
                await delay(wait, undefined, options.signal ? { signal: options.signal } : {});
            }
            return { outputPath: '', bytes: 0, files: 0, notes: [] };
          },
          cancel: async () => {},
        }),
      },
      { ...(options.signal ? { signal: options.signal } : {}) },
    );
  } finally {
    host.dispose();
  }
}
