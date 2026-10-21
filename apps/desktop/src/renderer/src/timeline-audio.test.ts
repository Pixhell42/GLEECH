import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineAudio } from './timeline-audio';

class AudioDouble extends EventTarget {
  static current: AudioDouble;
  currentTime = 0;
  duration = 0.5;
  paused = true;
  seeking = false;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  constructor() {
    super();
    AudioDouble.current = this;
  }
  end() {
    this.currentTime = this.duration;
    this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }
}

beforeEach(() => vi.stubGlobal('Audio', AudioDouble));
afterEach(() => vi.unstubAllGlobals());

describe('timeline audio playback', () => {
  it('allows playback to restart when the timeline wraps after the audio ends', async () => {
    const player = new TimelineAudio('track');
    const audio = AudioDouble.current;
    await player.play(0);
    expect(player.isPlaying).toBe(true);
    audio.end();
    expect(player.isPlaying).toBe(false);

    // The playback loop can now restart the ended element on a backward seek.
    await player.play(0.1);
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBe(0.1);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(player.isPlaying).toBe(true);
  });

  it('keeps explicitly paused audio paused when seeking or syncing', async () => {
    const player = new TimelineAudio('track');
    await player.play(0);
    player.pause();
    player.seek(0.2);
    player.sync(0.3);
    expect(player.isPlaying).toBe(false);
    expect(AudioDouble.current.paused).toBe(true);
    expect(AudioDouble.current.currentTime).toBe(0.2);
    expect(AudioDouble.current.play).toHaveBeenCalledTimes(1);
  });
});
