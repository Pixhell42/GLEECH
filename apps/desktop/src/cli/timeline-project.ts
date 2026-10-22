import { dirname, resolve } from 'node:path';
import type { ProjectState } from '@gleech/project-model';

/** Resolve external media once when opening a document, so Save As keeps it linked. */
export function resolveTimelineMedia(project: ProjectState, projectPath: string): ProjectState {
  const timeline = project.timeline;
  if (!timeline?.video && !timeline?.audio) return project;
  const folder = dirname(resolve(projectPath));
  return {
    ...project,
    timeline: {
      ...timeline,
      ...(timeline.video
        ? { video: { ...timeline.video, path: resolve(folder, timeline.video.path) } }
        : {}),
      ...(timeline.audio
        ? { audio: { ...timeline.audio, path: resolve(folder, timeline.audio.path) } }
        : {}),
    },
  };
}
