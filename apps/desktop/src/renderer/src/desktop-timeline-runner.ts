// Browser/IPC adapters for the shared timeline runner. No timeline semantics
// live here; terminal hosts can supply Node codecs and their reusable engine.
import { EffectProcessor } from './EffectProcessor';
import { unwrap } from '../../shared/image-api';
import type { RenderFrame } from '../../shared/render';
import {
  runTimelineRender,
  type TimelineRenderAdapters,
  type TimelineRenderRequest,
  type TimelineRunOptions,
} from '../../shared/timeline-runner';

export interface DesktopTimelineRenderRequest extends TimelineRenderRequest {
  /** Desktop registry token; the shared runner never needs it. */
  readonly videoMediaId?: string;
}

function resizePixels(image: RenderFrame, width: number, height: number): RenderFrame {
  const from = new OffscreenCanvas(image.width, image.height);
  from
    .getContext('2d')!
    .putImageData(
      new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
      0,
      0,
    );
  const to = new OffscreenCanvas(width, height);
  const context = to.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(from, 0, 0, width, height);
  return {
    width,
    height,
    pixels: context.getImageData(0, 0, width, height).data.buffer as ArrayBuffer,
  };
}

export async function runDesktopTimelineRender(
  request: DesktopTimelineRenderRequest,
  options: TimelineRunOptions,
) {
  let processor = new EffectProcessor();
  const sourceId = request.project.source?.id;
  const mediaId = request.videoMediaId;
  const adapters: TimelineRenderAdapters = {
    memoryBudget: async () => unwrap(await window.gleech.renderMemoryBudget()),
    releaseEffects: () => {
      processor.dispose();
      processor = new EffectProcessor();
    },
    source: mediaId
      ? {
          kind: 'video',
          frameAt: async (t, size) => unwrap(await window.gleech.videoFrameAt(mediaId, t, size)),
          openReader: async (settings) => {
            const reader = unwrap(await window.gleech.openVideoReader(mediaId, settings));
            return {
              read: async () => unwrap(await window.gleech.readVideoFrame(reader)),
              close: async () => unwrap(await window.gleech.closeVideoReader(reader)),
            };
          },
        }
      : {
          kind: 'still',
          read: async () => unwrap(await window.gleech.originalPixels(sourceId!)),
        },
    resize: resizePixels,
    render: (image, effects, context) =>
      processor.render(image, effects, {
        masterSeed: context.masterSeed,
        reference: image,
        purpose: 'export',
        ...(context.subjectMask ? { subjectMask: context.subjectMask } : {}),
      }),
    subject: async () => unwrap(await window.gleech.subjectMask(sourceId!)),
    begin: async (spec) => {
      const encoder = unwrap(await window.gleech.beginRender(spec));
      return {
        resumeFrames: unwrap(await window.gleech.renderResumeFrames(encoder)),
        frame: async (image, original) =>
          unwrap(await window.gleech.renderFrame(encoder, image, original)),
        finish: async () => unwrap(await window.gleech.finishRender(encoder)),
        cancel: async () => unwrap(await window.gleech.cancelRender(encoder)),
      };
    },
    cancelEffects: () => processor.cancelAll(),
  };
  try {
    return await runTimelineRender(request, adapters, options);
  } finally {
    processor.dispose();
  }
}
