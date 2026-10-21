// Desktop media registration sits outside the shared render plan. Terminal
// hosts resolve project media paths through their own source adapters.
import { activeVideo } from '@gleech/project-model';
import { buildTimelineRenderRequest } from '../../shared/render-request';
import type { RenderRequest } from './render-queue';

export * from '../../shared/render-request';

export function buildRenderRequest(
  input: Parameters<typeof buildTimelineRenderRequest>[0] & { videoMediaId: string | null },
): RenderRequest {
  const clip = activeVideo(input.project);
  if (clip && !input.videoMediaId)
    throw new Error(
      'The video clip is offline or still loading. Add it again from the Tracks menu.',
    );
  return {
    ...buildTimelineRenderRequest(input),
    ...(clip && input.videoMediaId ? { videoMediaId: input.videoMediaId } : {}),
  };
}
