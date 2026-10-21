// Timeline audio playback and import-time analysis in the renderer.
import type { AudioAnalysis } from '@gleech/project-model';
import { analyzeAudio } from '../../shared/audio-analysis';
import { mediaUrl } from './video-frames';

/** Rate main decodes analysis audio at (main/media-probe.ts AUDIO_SAMPLE_RATE). */
const ANALYSIS_SAMPLE_RATE = 22050;
const MAX_ANALYSIS_SECONDS = 30 * 60;

/**
 * Plays a media file's audio in step with the timeline playhead. Media time is
 * timeline time + offset (seconds into the file at timeline zero).
 */
export class TimelineAudio {
  private readonly element: HTMLAudioElement;
  private offset = 0;
  private playing = false;
  private request = 0;
  private disposed = false;

  /** `onError` runs when Chromium can't load or decode the file's sound. */
  constructor(mediaId: string, onError?: () => void) {
    const audio = (this.element = new Audio());
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.addEventListener('ended', () => {
      this.playing = false;
    });
    audio.addEventListener('error', () => {
      if (!this.disposed) onError?.();
    });
    audio.src = mediaUrl(mediaId);
  }

  /** Timeline seconds by the audio clock, the steadiest clock to follow while playing. */
  get time(): number {
    return this.element.currentTime - this.offset;
  }

  /** Seconds of audio in the file, NaN until its metadata loads. */
  get duration(): number {
    return this.element.duration;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Start playback at timeline time `fromSeconds`. Resolves once audio is running. */
  async play(fromSeconds: number, offsetSeconds = this.offset): Promise<void> {
    if (this.disposed) return;
    this.offset = offsetSeconds;
    this.playing = true;
    const request = ++this.request;
    this.setPosition(fromSeconds);
    try {
      await this.element.play();
    } catch (error) {
      // pause() or a newer play() interrupted this one.
      if (request !== this.request || this.disposed) return;
      this.playing = false;
      throw error;
    }
    if (request !== this.request) this.element.pause();
  }

  pause(): void {
    this.playing = false;
    this.request++;
    this.element.pause();
  }

  /** Move to timeline time t without changing play/pause. */
  seek(t: number): void {
    this.setPosition(t);
  }

  /**
   * Call from the frame loop with the playhead while playing; re-seeks only
   * when audio drifted further than `tolerance` seconds.
   */
  sync(t: number, tolerance = 0.08): void {
    if (!this.playing || this.element.seeking) return;
    if (Math.abs(this.time - t) > tolerance) this.setPosition(t);
  }

  setMuted(muted: boolean): void {
    this.element.muted = muted;
  }

  setVolume(volume: number): void {
    this.element.volume = Math.max(0, Math.min(1, volume));
  }

  dispose(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.element.removeAttribute('src');
    this.element.load();
  }

  private setPosition(t: number): void {
    let media = Math.max(0, t + this.offset);
    if (Number.isFinite(this.element.duration)) media = Math.min(media, this.element.duration);
    this.element.currentTime = media;
  }
}

export interface LoadedAudio {
  /** Mono samples, at most 30 minutes. */
  readonly samples: Float32Array;
  readonly sampleRate: number;
  /** Seconds in the file. */
  readonly duration: number;
  /** Source channel count when decoded here; null when main decoded it (use the probe). */
  readonly channels: number | null;
}

/**
 * Mono samples for analysis: decoded by ffmpeg in main, or by WebAudio here
 * when ffmpeg isn't available (then `duration`/`channels` fill in the probe,
 * which main leaves at 0 without ffmpeg).
 */
export async function loadAudioSamples(mediaId: string): Promise<LoadedAudio> {
  const result = await window.gleech.readAudioSamples(mediaId);
  if (result.ok) {
    const samples = new Float32Array(result.value.samples);
    const sampleRate = result.value.sampleRate;
    return { samples, sampleRate, duration: samples.length / sampleRate, channels: null };
  }
  try {
    return await decodeWithWebAudio(mediaId);
  } catch {
    throw new Error(result.error);
  }
}

async function decodeWithWebAudio(mediaId: string): Promise<LoadedAudio> {
  const response = await fetch(mediaUrl(mediaId));
  if (!response.ok) throw new Error('The audio could not be read.');
  // decodeAudioData resamples to the context's rate.
  const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const length = Math.min(buffer.length, ANALYSIS_SAMPLE_RATE * MAX_ANALYSIS_SECONDS);
  const samples = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    const weight = 1 / buffer.numberOfChannels;
    for (let index = 0; index < length; index++) samples[index]! += data[index]! * weight;
  }
  return {
    samples,
    sampleRate: buffer.sampleRate,
    duration: buffer.duration,
    channels: buffer.numberOfChannels,
  };
}

/** Run analyzeAudio in a worker so a long track doesn't stall the UI. Takes ownership of `samples`. */
export function analyzeSamples(samples: Float32Array, sampleRate: number): Promise<AudioAnalysis> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./audio-analysis-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return Promise.resolve().then(() => analyzeAudio(samples, sampleRate));
  }
  return new Promise<AudioAnalysis>((resolve, reject) => {
    worker.onmessage = (
      event: MessageEvent<{ ok: true; analysis: AudioAnalysis } | { ok: false; error: string }>,
    ) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.analysis);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      event.preventDefault();
      reject(new Error(event.message || 'Audio analysis failed.'));
    };
    worker.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
}

/**
 * Decode and analyze a registered audio (or video-with-audio) file: the
 * analysis to store in AudioClip.analysis, plus what WebAudio learned when
 * ffmpeg was unavailable.
 */
export async function analyzeMediaAudio(mediaId: string): Promise<{
  analysis: AudioAnalysis;
  duration: number;
  channels: number | null;
}> {
  const audio = await loadAudioSamples(mediaId);
  const analysis = await analyzeSamples(audio.samples, audio.sampleRate);
  return { analysis, duration: audio.duration, channels: audio.channels };
}
