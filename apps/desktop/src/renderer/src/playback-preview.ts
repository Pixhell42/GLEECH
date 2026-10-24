/** Draft sizes only. Paused frames and exports always request full detail. */
export function playbackDimension(width: number, height: number): number {
  return Math.max(360, Math.min(1280, Math.ceil(Math.max(width, height) / 2)));
}

/**
 * Match the existing processed video draft, which used to halve the source at
 * decode and halve it again in the effect worker. Resize before readback/IPC so
 * those stages no longer copy four times the pixels the effects will use.
 */
export function videoPlaybackDimension(width: number, height: number, processed = true): number {
  const half = Math.ceil(Math.max(width, height) / 2);
  if (!processed) return half;
  return Math.min(half, playbackDimension(Math.ceil(width / 2), Math.ceil(height / 2)));
}

/** A playback budget survives source-frame changes; only transient previews use it. */
export class PlaybackPreviewBudget {
  private source = '';
  private base = 0;
  private active = false;
  private index = 0;
  private slow = 0;
  private fast = 0;
  private milliseconds = 1000 / 30;
  private readonly scales = [1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125];
  get maximum(): number {
    return Math.min(this.base, Math.max(96, Math.round(this.base * this.scales[this.index]!)));
  }
  configure(source: string, maximum: number, active: boolean, fps = 30): void {
    if (source !== this.source || maximum !== this.base || !this.active) {
      this.index = this.slow = this.fast = 0;
    }
    this.source = source;
    this.base = maximum;
    this.active = active;
    this.milliseconds = 1000 / Math.max(1, Math.min(60, fps));
  }
  record(milliseconds: number): void {
    if (!this.active || !Number.isFinite(milliseconds) || milliseconds < 0) return;
    if (milliseconds > 150 || (milliseconds > this.milliseconds * 1.25 && ++this.slow >= 2)) {
      this.index = Math.min(this.scales.length - 1, this.index + (milliseconds > 150 ? 2 : 1));
      this.slow = this.fast = 0;
    } else if (milliseconds < this.milliseconds * 0.7) {
      this.slow = 0;
      if (++this.fast >= 12) {
        this.index = Math.max(0, this.index - 1);
        this.fast = 0;
      }
    } else if (milliseconds <= this.milliseconds * 1.25) this.slow = this.fast = 0;
  }
}
