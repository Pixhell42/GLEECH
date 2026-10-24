import { useEffect, useMemo, useState } from 'react';
import { timeFrame } from '@gleech/project-model';
import type { VideoFrameSource } from '../video-frames';
import type { TimelineVideo } from './use-media';

const THUMBNAILS = 48;
const LOAD_TIMEOUT_MS = 60000;
export interface FilmstripFrame {
  readonly frame: number;
  readonly url: string;
}
export interface FilmstripPreview {
  readonly frames: readonly FilmstripFrame[];
  readonly loading: boolean;
  readonly completed: number;
  readonly total: number;
  readonly failed: boolean;
}
interface Result {
  request: { source: VideoFrameSource | undefined; span: number };
  status: 'loading' | 'ready' | 'failed';
  completed: number;
  urls: readonly string[];
}

/** Only the clip and visible time span rebuild thumbnails; other timeline edits do not. */
export function useFilmstrip(
  video: TimelineVideo | null,
  span: number,
  fps: number,
): FilmstripPreview {
  const [result, setResult] = useState<Result | null>(null);
  const source = video?.frames;
  const request = useMemo(() => ({ source, span }), [source, span]);
  const times = useMemo(
    () => Array.from({ length: THUMBNAILS }, (_, index) => (index / THUMBNAILS) * span),
    [span],
  );
  useEffect(() => {
    if (!source || span <= 0) return;
    const controller = new AbortController();
    const failed = () => setResult({ request, status: 'failed', completed: 0, urls: [] });
    const timer = setTimeout(() => {
      failed();
      controller.abort();
    }, LOAD_TIMEOUT_MS);
    void source
      .thumbnails(times, 48, controller.signal, (completed) => {
        if (!controller.signal.aborted)
          setResult({ request, status: 'loading', completed, urls: [] });
      })
      .then((urls) => {
        clearTimeout(timer);
        if (!controller.signal.aborted)
          setResult({ request, status: 'ready', completed: THUMBNAILS, urls });
      })
      .catch(() => {
        clearTimeout(timer);
        if (!controller.signal.aborted) failed();
      });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, span, times, request]);
  const current = result?.request === request ? result : null;
  const frames = useMemo(
    () =>
      current?.status === 'ready'
        ? current.urls.map((url, index) => ({ frame: timeFrame(times[index]!, fps), url }))
        : [],
    [current, times, fps],
  );
  return {
    frames,
    loading: Boolean(source && span > 0 && (!current || current.status === 'loading')),
    completed: current?.completed ?? 0,
    total: THUMBNAILS,
    failed: current?.status === 'failed',
  };
}
