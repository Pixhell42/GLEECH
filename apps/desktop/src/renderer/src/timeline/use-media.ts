// Timeline media in the renderer: registers clip/track files with main,
// keeps one frame source and one audio player per file, and streams preview
// frames for the playhead.
import { useEffect, useRef, useState } from 'react';
import type { Timeline } from '@gleech/project-model';
import type { PixelImage } from '@gleech/renderer-core';
import { unwrap } from '../../../shared/image-api';
import type { AudioProbe, OpenedMedia, VideoProbe } from '../../../shared/render';
import { VideoFrameSource } from '../video-frames';
import { TimelineAudio } from '../timeline-audio';

type Opened = OpenedMedia<VideoProbe | AudioProbe>;
const registry = new Map<string, Promise<Opened>>();
const registryKey = (path: string, kind: 'video' | 'audio') => `${kind}:${path}`;

/** Media just opened through a dialog is already registered; reuse its id. */
export function rememberMedia(kind: 'video' | 'audio', opened: Opened): void {
  registry.set(registryKey(opened.path, kind), Promise.resolve(opened));
}
function registered(path: string, kind: 'video' | 'audio'): Promise<Opened> {
  const key = registryKey(path, kind);
  let pending = registry.get(key);
  if (!pending) {
    pending = window.gleech.registerMedia(path, kind).then(unwrap);
    registry.set(key, pending);
    pending.catch(() => registry.delete(key));
  }
  return pending;
}

export interface TimelineVideo {
  readonly path: string;
  readonly mediaId: string;
  readonly frames: VideoFrameSource;
}
export interface TimelineTrack {
  readonly path: string;
  readonly mediaId: string;
  readonly player: TimelineAudio;
}

export function useTimelineMedia(
  timeline: Timeline | undefined,
  onError: (message: string) => void,
): { video: TimelineVideo | null; audio: TimelineTrack | null } {
  const [video, setVideo] = useState<TimelineVideo | null>(null);
  const [audio, setAudio] = useState<TimelineTrack | null>(null);
  const videoPath = timeline?.video?.path;
  const audioPath = timeline?.audio?.path;
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!videoPath) return;
    let active = true;
    let frames: VideoFrameSource | null = null;
    registered(videoPath, 'video')
      .then((opened) => {
        if (!active) return;
        frames = new VideoFrameSource(opened.mediaId, opened.info as VideoProbe);
        setVideo({ path: videoPath, mediaId: opened.mediaId, frames });
      })
      .catch((failure: unknown) => {
        if (active)
          report.current(
            `Video clip is offline: ${failure instanceof Error ? failure.message : videoPath}`,
          );
      });
    return () => {
      active = false;
      frames?.dispose();
    };
  }, [videoPath]);

  useEffect(() => {
    if (!audioPath) return;
    let active = true;
    let player: TimelineAudio | null = null;
    registered(audioPath, 'audio')
      .then((opened) => {
        if (!active) return;
        player = new TimelineAudio(opened.mediaId, () => {
          if (active)
            report.current(
              `GLEECH can't play the sound of ${opened.name} in preview. Renders still include it.`,
            );
        });
        setAudio({ path: audioPath, mediaId: opened.mediaId, player });
      })
      .catch((failure: unknown) => {
        if (active)
          report.current(
            `Audio track is offline: ${failure instanceof Error ? failure.message : audioPath}`,
          );
      });
    return () => {
      active = false;
      player?.dispose();
    };
  }, [audioPath]);

  return {
    video: video && video.path === videoPath ? video : null,
    audio: audio && audio.path === audioPath ? audio : null,
  };
}

/**
 * The decoded clip frame for the playhead. Requests never pile up: while one
 * decode runs, only the newest wanted frame is fetched next, so playback shows
 * the latest frame it can rather than stalling. While `playing`, the clip's
 * hidden player runs alongside the playhead so frames arrive without a seek each.
 */
export function useVideoFrame(
  video: TimelineVideo | null,
  frame: number,
  t: number,
  maxDimension: number,
  playing = false,
): { frame: number; image: PixelImage } | null {
  const [shown, setShown] = useState<{
    mediaId: string;
    frame: number;
    max: number;
    image: PixelImage;
  } | null>(null);
  const wanted = useRef({ frame, t, maxDimension, video });
  const pumping = useRef(false);
  // Effects run in order: record the request, start playback, then pump, so the
  // first frame after Play already comes from the running player.
  useEffect(() => {
    wanted.current = { frame, t, maxDimension, video };
  }, [frame, t, maxDimension, video]);
  useEffect(() => {
    if (!video || !playing) return;
    video.frames.startPlayback(wanted.current.t);
    return () => video.frames.stopPlayback();
  }, [video, playing]);
  useEffect(() => {
    wanted.current = { frame, t, maxDimension, video };
    if (!video || pumping.current) return;
    pumping.current = true;
    void (async () => {
      try {
        for (;;) {
          const target = wanted.current;
          // The clip can change while a frame decodes; always fetch from the newest one.
          if (!target.video) break;
          const image = await target.video.frames.frameAt(target.t, target.maxDimension);
          setShown({
            mediaId: target.video.mediaId,
            frame: target.frame,
            max: target.maxDimension,
            image,
          });
          const next = wanted.current;
          if (
            next.video === target.video &&
            next.frame === target.frame &&
            next.maxDimension === target.maxDimension
          )
            break;
        }
      } catch {
        // A disposed or failed source falls back to the poster image.
      } finally {
        pumping.current = false;
      }
    })();
  }, [video, frame, t, maxDimension]);
  return shown && video && shown.mediaId === video.mediaId
    ? { frame: shown.frame, image: shown.image }
    : null;
}
