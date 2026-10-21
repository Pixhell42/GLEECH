// Audio analysis for timeline modulators and the audio track. It runs once at
// import and is stored with the project, so preview, scrubbing and export read
// identical values. Pure: no DOM or Node APIs, safe in workers and tests.
import type { AudioAnalysis } from '@gleech/project-model';

/** Analysis frames per second. */
export const ANALYSIS_RATE = 60;
/** Log-spaced spectrum bins, centered at minHz·(maxHz/minHz)^((bin+0.5)/bins). */
export const ANALYSIS_BINS = 24;
export const ANALYSIS_MIN_HZ = 20;
export const ANALYSIS_MAX_HZ = 20000;
/** Band energy 0–255 spans this many dB below the loudest band in the track. */
const DYNAMIC_RANGE_DB = 60;
/** dB relative to a full-scale sine. Anything quieter is silence. */
const FLOOR_DB = -100;
const SILENT_TRACK_DB = -90;
/** Onset detection: log bands between these frequencies, floored so noise can't flicker. */
const ONSET_BANDS = 48;
const ONSET_MIN_HZ = 30;
const ONSET_MAX_HZ = 11000;
const ONSET_FLOOR_DB = -80;
const MIN_BPM = 60;
const MAX_BPM = 200;
const PREFERRED_MIN_BPM = 80;
const PREFERRED_MAX_BPM = 170;
/** Shortest track worth estimating a tempo for, in seconds. */
const MIN_TEMPO_SECONDS = 4;
/** Beat periodicity weaker than this (autocorrelation / energy) reports bpm 0. */
const MIN_TEMPO_CONFIDENCE = 0.1;
/**
 * Log spectral flux peaks as a transient enters the analysis window, about this
 * fraction of the window before the hit (measured on click tracks).
 */
const ONSET_LEAD = 0.36;
/** The project model stores beats up to an hour. */
const MAX_BEAT_SECONDS = 3600;

// ---------------------------------------------------------------------------
// FFT

/** Power spectrum of a real signal via a half-size complex radix-2 FFT. */
class RealFft {
  readonly size: number;
  private readonly half: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly splitCos: Float64Array;
  private readonly splitSin: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    this.size = size;
    const half = (this.half = size >> 1);
    this.re = new Float64Array(half);
    this.im = new Float64Array(half);
    this.cos = new Float64Array(half >> 1);
    this.sin = new Float64Array(half >> 1);
    for (let index = 0; index < half >> 1; index++) {
      this.cos[index] = Math.cos((2 * Math.PI * index) / half);
      this.sin[index] = Math.sin((2 * Math.PI * index) / half);
    }
    this.splitCos = new Float64Array(half);
    this.splitSin = new Float64Array(half);
    for (let index = 0; index < half; index++) {
      this.splitCos[index] = Math.cos((2 * Math.PI * index) / size);
      this.splitSin[index] = Math.sin((2 * Math.PI * index) / size);
    }
    this.reverse = new Uint32Array(half);
    const bits = Math.log2(half);
    for (let index = 0; index < half; index++) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) reversed |= ((index >> bit) & 1) << (bits - 1 - bit);
      this.reverse[index] = reversed;
    }
  }

  /** Writes |X[k]|² for k = 0…size/2 into `power`. */
  power(input: Float64Array, power: Float64Array): void {
    const { half, re, im, cos, sin, reverse } = this;
    // Pack even samples as real parts and odd samples as imaginary parts.
    for (let index = 0; index < half; index++) {
      const target = reverse[index]!;
      re[target] = input[2 * index]!;
      im[target] = input[2 * index + 1]!;
    }
    for (let span = 2; span <= half; span <<= 1) {
      const step = half / span;
      const middle = span >> 1;
      for (let start = 0; start < half; start += span) {
        for (let offset = 0, twiddle = 0; offset < middle; offset++, twiddle += step) {
          const a = start + offset;
          const b = a + middle;
          const wr = cos[twiddle]!;
          const wi = -sin[twiddle]!;
          const br = re[b]!;
          const bi = im[b]!;
          const tr = br * wr - bi * wi;
          const ti = br * wi + bi * wr;
          const ar = re[a]!;
          const ai = im[a]!;
          re[b] = ar - tr;
          im[b] = ai - ti;
          re[a] = ar + tr;
          im[a] = ai + ti;
        }
      }
    }
    // Split the packed transform into the spectrum of the real input.
    power[0] = (re[0]! + im[0]!) ** 2;
    power[half] = (re[0]! - im[0]!) ** 2;
    const { splitCos, splitSin } = this;
    for (let k = 1; k < half; k++) {
      const a = re[k]!;
      const b = im[k]!;
      const c = re[half - k]!;
      const d = im[half - k]!;
      const evenRe = (a + c) * 0.5;
      const evenIm = (b - d) * 0.5;
      const oddRe = (b + d) * 0.5;
      const oddIm = (c - a) * 0.5;
      const wr = splitCos[k]!;
      const ws = splitSin[k]!;
      const xr = evenRe + wr * oddRe + ws * oddIm;
      const xi = evenIm + wr * oddIm - ws * oddRe;
      power[k] = xr * xr + xi * xi;
    }
  }
}

/** ~93 ms windows: 2048 samples at 22.05 kHz, 4096 at 44.1/48 kHz. */
function fftSizeFor(sampleRate: number): number {
  const exponent = Math.round(Math.log2(sampleRate * 0.0929));
  return 2 ** Math.min(14, Math.max(8, exponent));
}

/** FFT bin → band index for log-spaced bands, with a nearest-bin fallback for bands narrower than a bin. */
function bandMap(
  bands: number,
  minHz: number,
  maxHz: number,
  binHz: number,
  half: number,
): { bandOf: Int16Array; nearest: Int32Array } {
  const bandOf = new Int16Array(half + 1).fill(-1);
  const counts = new Int32Array(bands);
  const span = Math.log(maxHz / minHz);
  for (let bin = 1; bin <= half; bin++) {
    const frequency = bin * binHz;
    if (frequency < minHz || frequency >= maxHz) continue;
    const band = Math.min(bands - 1, Math.floor((Math.log(frequency / minHz) / span) * bands));
    bandOf[bin] = band;
    counts[band]!++;
  }
  const nearest = new Int32Array(bands).fill(-1);
  for (let band = 0; band < bands; band++) {
    if (counts[band]) continue;
    const low = minHz * Math.exp((span * band) / bands);
    // Bands above Nyquist stay silent.
    if (low >= half * binHz) continue;
    const center = minHz * Math.exp((span * (band + 0.5)) / bands);
    nearest[band] = Math.min(half, Math.max(1, Math.round(center / binHz)));
  }
  return { bandOf, nearest };
}

// ---------------------------------------------------------------------------
// Tempo

function tempoPrior(bpm: number): number {
  if (bpm >= PREFERRED_MIN_BPM && bpm <= PREFERRED_MAX_BPM) return 1;
  const edge = bpm < PREFERRED_MIN_BPM ? PREFERRED_MIN_BPM : PREFERRED_MAX_BPM;
  const octaves = Math.log2(bpm / edge) / 0.25;
  return Math.exp(-0.5 * octaves * octaves);
}

/** Squared magnitude and phase of the onset envelope's Fourier component at `omega` rad/frame. */
function fourier(envelope: Float64Array, omega: number): { power: number; phase: number } {
  const stepRe = Math.cos(omega);
  const stepIm = -Math.sin(omega);
  let re = 0;
  let im = 0;
  let rotRe = 1;
  let rotIm = 0;
  for (let t = 0; t < envelope.length; t++) {
    if ((t & 1023) === 0) {
      // Re-anchor the rotation so rounding can't drift over long tracks.
      rotRe = Math.cos(omega * t);
      rotIm = -Math.sin(omega * t);
    }
    const value = envelope[t]!;
    re += value * rotRe;
    im += value * rotIm;
    const nextRe = rotRe * stepRe - rotIm * stepIm;
    rotIm = rotRe * stepIm + rotIm * stepRe;
    rotRe = nextRe;
  }
  return { power: re * re + im * im, phase: Math.atan2(im, re) };
}

/** Mean onset energy within ±1.5 frames of offset + k·period. */
function foldedStrength(rises: Float64Array, offset: number, period: number): number {
  let sum = 0;
  let beats = 0;
  for (let center = offset; center < rises.length; center += period, beats++) {
    const to = Math.min(rises.length - 1, Math.floor(center + 1.5));
    for (let t = Math.max(0, Math.ceil(center - 1.5)); t <= to; t++) sum += rises[t]!;
  }
  return beats ? sum / beats : 0;
}

/** Tempo from the autocorrelation of the onset envelope, then a beat grid at its strongest phase. */
function detectTempo(
  flux: Float64Array,
  rate: number,
  windowSeconds: number,
): { bpm: number; beats: number[] } {
  const none = { bpm: 0, beats: [] };
  const frames = flux.length;
  const duration = frames / rate;
  if (duration < MIN_TEMPO_SECONDS) return none;
  // Keep rises above a one-second moving average, then remove the mean.
  const radius = Math.round(rate / 2);
  const prefix = new Float64Array(frames + 1);
  for (let t = 0; t < frames; t++) prefix[t + 1] = prefix[t]! + flux[t]!;
  const rises = new Float64Array(frames);
  let mean = 0;
  for (let t = 0; t < frames; t++) {
    const from = Math.max(0, t - radius);
    const to = Math.min(frames, t + radius + 1);
    const local = (prefix[to]! - prefix[from]!) / (to - from);
    rises[t] = Math.max(0, flux[t]! - local);
    mean += rises[t]!;
  }
  mean /= frames;
  const envelope = rises.map((value) => value - mean);

  const minLag = Math.floor((60 * rate) / MAX_BPM);
  const maxLag = Math.ceil((60 * rate) / MIN_BPM);
  const topLag = Math.min(frames - 1, 2 * maxLag + 2);
  if (topLag < 2 * maxLag + 2) return none;
  const correlation = new Float64Array(topLag + 1);
  for (let lag = 0; lag <= topLag; lag++) {
    let sum = 0;
    for (let t = 0; t + lag < frames; t++) sum += envelope[t]! * envelope[t + lag]!;
    correlation[lag] = sum / (frames - lag);
  }
  const energy = correlation[0]!;
  if (!(energy > 1e-12)) return none;
  // A beat period also correlates at twice its length; that support picks the
  // beat over its offbeat subdivision, and the prior settles octave ties.
  const score = (lag: number) => correlation[lag]! + 0.5 * correlation[2 * lag]!;
  let best = -1;
  let bestWeighted = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const weighted = score(lag) * tempoPrior((60 * rate) / lag);
    if (weighted > bestWeighted) {
      bestWeighted = weighted;
      best = lag;
    }
  }
  if (best < 0 || correlation[best]! / energy < MIN_TEMPO_CONFIDENCE) return none;
  const y0 = score(best - 1);
  const y1 = score(best);
  const y2 = score(best + 1);
  const curve = y0 - 2 * y1 + y2;
  const offset = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / curve)) : 0;
  const coarse = (60 * rate) / (best + offset);

  // Refine: the tempo whose pulse train best matches the whole track. A finer
  // step on long tracks keeps the grid in phase to the end.
  const step = Math.min(0.05, 15 / duration);
  const lowest = coarse * 0.97;
  const count = Math.ceil((coarse * 0.06) / step) + 1;
  const powers = new Float64Array(count);
  let peak = 0;
  for (let index = 0; index < count; index++) {
    const bpm = lowest + index * step;
    powers[index] = fourier(envelope, (2 * Math.PI * bpm) / (60 * rate)).power;
    if (powers[index]! > powers[peak]!) peak = index;
  }
  let refined = lowest + peak * step;
  if (peak > 0 && peak < count - 1) {
    const p0 = powers[peak - 1]!;
    const p1 = powers[peak]!;
    const p2 = powers[peak + 1]!;
    const bend = p0 - 2 * p1 + p2;
    if (bend < 0) refined += step * Math.max(-0.5, Math.min(0.5, (0.5 * (p0 - p2)) / bend));
  }
  // Beat phase: the Fourier phase of the grid rate and its first harmonic give
  // candidate offsets (the harmonic matters when the tempo was folded into the
  // preferred range); keep the one with the most onset energy.
  const omega = (2 * Math.PI * refined) / (60 * rate);
  const periodFrames = (2 * Math.PI) / omega;
  let bestOffset = 0;
  let bestStrength = -Infinity;
  for (const harmonic of [1, 2]) {
    // Onsets at t0 + k·period give a component with phase -harmonic·omega·t0.
    const { phase } = fourier(envelope, omega * harmonic);
    const spacing = periodFrames / harmonic;
    const base = (((-phase / (omega * harmonic)) % spacing) + spacing) % spacing;
    for (let index = 0; index < harmonic; index++) {
      const offset = base + index * spacing;
      const strength = foldedStrength(rises, offset, periodFrames);
      if (strength > bestStrength + 1e-12) {
        bestStrength = strength;
        bestOffset = offset;
      }
    }
  }
  const period = periodFrames / rate;
  const first = (((bestOffset / rate + ONSET_LEAD * windowSeconds) % period) + period) % period;
  const beats: number[] = [];
  const end = Math.min(duration, MAX_BEAT_SECONDS);
  for (let beat = first; beat < end; beat += period) beats.push(Math.round(beat * 10000) / 10000);
  return { bpm: Math.round(refined * 10) / 10, beats };
}

// ---------------------------------------------------------------------------
// Analysis

/**
 * Analyze mono samples: per-frame log-band energy and peak amplitude at 60
 * frames/s, onsets by spectral flux, tempo and a beat grid. Deterministic.
 */
export function analyzeAudio(samples: Float32Array, sampleRate: number): AudioAnalysis {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid sample rate.');
  const rate = ANALYSIS_RATE;
  const bins = ANALYSIS_BINS;
  const frames = samples.length ? Math.ceil((samples.length / sampleRate) * rate - 1e-9) : 0;
  const spectrum = new Uint8Array(frames * bins);
  const peaks = new Uint8Array(frames);
  const flux = new Float64Array(frames);
  const hop = sampleRate / rate;

  // Peak amplitude over each frame's own samples.
  for (let frame = 0; frame < frames; frame++) {
    const from = Math.round(frame * hop);
    const to = Math.min(samples.length, Math.round((frame + 1) * hop));
    let peak = 0;
    for (let index = from; index < to; index++) {
      const value = Math.abs(samples[index]!);
      if (value > peak) peak = value;
    }
    peaks[frame] = Math.round(Math.min(1, peak) * 255);
  }

  if (frames) {
    const size = fftSizeFor(sampleRate);
    const half = size >> 1;
    const fft = new RealFft(size);
    const window = new Float64Array(size);
    let windowPower = 0;
    for (let index = 0; index < size; index++) {
      window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
      windowPower += window[index]! ** 2;
    }
    // Scales one-sided power so a full-scale sine sums to 1 (0 dB) in its band.
    const scale = 4 / (size * windowPower);
    const binHz = sampleRate / size;
    const display = bandMap(bins, ANALYSIS_MIN_HZ, ANALYSIS_MAX_HZ, binHz, half);
    const onset = bandMap(
      ONSET_BANDS,
      ONSET_MIN_HZ,
      Math.min(ONSET_MAX_HZ, sampleRate * 0.49),
      binHz,
      half,
    );
    const input = new Float64Array(size);
    const power = new Float64Array(half + 1);
    const bandPower = new Float64Array(bins);
    const onsetPower = new Float64Array(ONSET_BANDS);
    const previous = new Float64Array(ONSET_BANDS).fill(ONSET_FLOOR_DB);
    const bandDb = new Float32Array(frames * bins);
    let loudest = -Infinity;
    for (let frame = 0; frame < frames; frame++) {
      // Window centered on the middle of the frame's time slice.
      const begin = Math.round((frame + 0.5) * hop - size / 2);
      for (let index = 0; index < size; index++) {
        const source = begin + index;
        input[index] =
          source >= 0 && source < samples.length ? samples[source]! * window[index]! : 0;
      }
      fft.power(input, power);
      bandPower.fill(0);
      onsetPower.fill(0);
      for (let bin = 1; bin <= half; bin++) {
        const value = power[bin]!;
        const band = display.bandOf[bin]!;
        if (band >= 0) bandPower[band]! += value;
        const onsetBand = onset.bandOf[bin]!;
        if (onsetBand >= 0) onsetPower[onsetBand]! += value;
      }
      for (let band = 0; band < bins; band++) {
        const nearest = display.nearest[band]!;
        const value = nearest >= 0 ? power[nearest]! : bandPower[band]!;
        const db = 10 * Math.log10(value * scale + 1e-30);
        bandDb[frame * bins + band] = db;
        if (db > loudest) loudest = db;
      }
      let rise = 0;
      for (let band = 0; band < ONSET_BANDS; band++) {
        const nearest = onset.nearest[band]!;
        const value = nearest >= 0 ? power[nearest]! : onsetPower[band]!;
        const db = Math.max(ONSET_FLOOR_DB, 10 * Math.log10(value * scale + 1e-30));
        if (db > previous[band]!) rise += db - previous[band]!;
        previous[band] = db;
      }
      flux[frame] = rise / ONSET_BANDS;
    }
    if (loudest >= SILENT_TRACK_DB) {
      const floor = Math.max(FLOOR_DB, loudest - DYNAMIC_RANGE_DB);
      const range = loudest - floor;
      for (let index = 0; index < bandDb.length; index++) {
        const level = (bandDb[index]! - floor) / range;
        spectrum[index] = level <= 0 ? 0 : level >= 1 ? 255 : Math.round(level * 255);
      }
    }
  }

  const tempo = detectTempo(flux, rate, fftSizeFor(sampleRate) / sampleRate);
  return {
    rate,
    bins,
    minHz: ANALYSIS_MIN_HZ,
    maxHz: ANALYSIS_MAX_HZ,
    spectrum: encodeBase64(spectrum),
    peaks: encodeBase64(peaks),
    beats: tempo.beats,
    bpm: tempo.bpm,
  };
}

// ---------------------------------------------------------------------------
// base64 (no Buffer, atob or btoa, so it runs anywhere)

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ENCODE = Uint8Array.from(ALPHABET, (character) => character.charCodeAt(0));
const DECODE = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index++) DECODE[ALPHABET.charCodeAt(index)] = index;
const PAD = 61; // '='

export function encodeBase64(bytes: Uint8Array): string {
  const length = bytes.length;
  const out = new Uint8Array(Math.ceil(length / 3) * 4);
  let o = 0;
  let index = 0;
  for (; index + 2 < length; index += 3) {
    const n = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    out[o++] = ENCODE[n >> 18]!;
    out[o++] = ENCODE[(n >> 12) & 63]!;
    out[o++] = ENCODE[(n >> 6) & 63]!;
    out[o++] = ENCODE[n & 63]!;
  }
  if (index < length) {
    const n = (bytes[index]! << 16) | (index + 1 < length ? bytes[index + 1]! << 8 : 0);
    out[o++] = ENCODE[n >> 18]!;
    out[o++] = ENCODE[(n >> 12) & 63]!;
    out[o++] = index + 1 < length ? ENCODE[(n >> 6) & 63]! : PAD;
    out[o] = PAD;
  }
  // Every byte is ASCII, so UTF-8 decoding maps them one to one.
  return new TextDecoder().decode(out);
}

export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4) throw new RangeError('Invalid base64.');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let index = 0; index < text.length; index += 4) {
    let n = 0;
    for (let offset = 0; offset < 4; offset++) {
      const code = text.charCodeAt(index + offset);
      const value = code === PAD ? 0 : code < 128 ? DECODE[code]! : -1;
      if (value < 0) throw new RangeError('Invalid base64.');
      n = (n << 6) | value;
    }
    if (o < out.length) out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing helpers

const decodedPeaks = new WeakMap<AudioAnalysis, Uint8Array>();
function analysisPeaks(analysis: AudioAnalysis): Uint8Array {
  let peaks = decodedPeaks.get(analysis);
  if (!peaks) decodedPeaks.set(analysis, (peaks = decodeBase64(analysis.peaks)));
  return peaks;
}

/** Seconds covered by the analysis. */
export function analysisDuration(analysis: AudioAnalysis): number {
  return analysisPeaks(analysis).length / analysis.rate;
}

/**
 * Peak amplitude (0–1) per drawing column across [start, end) seconds, by
 * default the whole track. Each column takes the loudest frame it covers.
 */
export function waveformColumns(
  analysis: AudioAnalysis,
  columns: number,
  start = 0,
  end = analysisDuration(analysis),
): Float32Array {
  const out = new Float32Array(Math.max(0, Math.floor(columns)));
  const peaks = analysisPeaks(analysis);
  const span = end - start;
  if (!out.length || !peaks.length || !(span > 0)) return out;
  for (let column = 0; column < out.length; column++) {
    const from = Math.floor((start + (column / out.length) * span) * analysis.rate);
    const to = Math.max(
      from + 1,
      Math.ceil((start + ((column + 1) / out.length) * span) * analysis.rate),
    );
    let peak = 0;
    for (let frame = Math.max(0, from); frame < Math.min(peaks.length, to); frame++)
      if (peaks[frame]! > peak) peak = peaks[frame]!;
    out[column] = peak / 255;
  }
  return out;
}
