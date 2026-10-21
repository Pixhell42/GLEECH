import { describe, expect, it } from 'vitest';
import { analysisBinFrequency, assertAudioAnalysis, bandEnergy } from '@gleech/project-model';
import {
  ANALYSIS_BINS,
  ANALYSIS_RATE,
  analysisDuration,
  analyzeAudio,
  decodeBase64,
  encodeBase64,
  waveformColumns,
} from '../shared/audio-analysis';

const RATE = 22050;

/** Deterministic noise in [-1, 1]. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function clickTrack(bpm: number, seconds: number, offset = 0, sampleRate = RATE): Float32Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const random = noise(7);
  for (let beat = offset; beat < seconds; beat += 60 / bpm) {
    const start = Math.round(beat * sampleRate);
    // A 10 ms decaying noise burst, like a rim click.
    for (let index = 0; index < sampleRate * 0.01 && start + index < samples.length; index++)
      samples[start + index] = random() * 0.8 * Math.exp(-index / (sampleRate * 0.002));
  }
  return samples;
}

/** Kick on every beat, snare on 2 and 4, eighth-note hats and a held bass note. */
function drumLoop(bpm: number, seconds: number, offset: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const random = noise(9);
  const beat = 60 / bpm;
  const hit = (time: number, length: number, sound: (index: number) => number) => {
    const start = Math.round(time * RATE);
    for (let index = 0; index < length * RATE && start + index < samples.length; index++)
      samples[start + index]! += sound(index);
  };
  for (let count = 0; offset + count * beat < seconds; count++) {
    const time = offset + count * beat;
    hit(time, 0.3, (index) => {
      const pitch = 55 + 80 * Math.exp(-index / 400);
      return (
        0.7 * Math.sin((2 * Math.PI * pitch * index) / RATE) * Math.exp(-index / (RATE * 0.12))
      );
    });
    if (count % 2) hit(time, 0.2, (index) => 0.4 * random() * Math.exp(-index / (RATE * 0.05)));
    for (const hat of [time, time + beat / 2])
      hit(hat, 0.05, (index) => 0.15 * random() * Math.exp(-index / (RATE * 0.01)));
  }
  for (let index = 0; index < samples.length; index++)
    samples[index]! += 0.15 * Math.sin((2 * Math.PI * 41 * index) / RATE);
  return samples;
}

function sine(frequency: number, seconds: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < samples.length; index++)
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE);
  return samples;
}

/** Signed distance from each beat to the nearest click, in seconds. */
function beatErrors(beats: readonly number[], bpm: number, offset: number): number[] {
  const period = 60 / bpm;
  return beats.map((beat) => {
    const phase = (beat - offset) / period;
    return (phase - Math.round(phase)) * period;
  });
}

describe('analyzeAudio', () => {
  it('finds 120 BPM and beats on the clicks of a click track', () => {
    const analysis = analyzeAudio(clickTrack(120, 20), RATE);
    expect(analysis.bpm).toBeCloseTo(120, 0);
    expect(analysis.beats.length).toBeGreaterThanOrEqual(39);
    expect(analysis.beats.length).toBeLessThanOrEqual(41);
    expect(analysis.beats[0]).toBeLessThan(0.02);
    for (const error of beatErrors(analysis.beats, 120, 0))
      expect(Math.abs(error)).toBeLessThan(0.015);
    assertAudioAnalysis(analysis);
  });

  it('aligns the beat grid to off-grid clicks across tempos and sample rates', () => {
    for (const [bpm, offset, sampleRate] of [
      [97, 0.1, RATE],
      [128, 0.4, 44100],
      [174, 0.05, 48000],
    ] as const) {
      const analysis = analyzeAudio(clickTrack(bpm, 30, offset, sampleRate), sampleRate);
      expect(Math.abs(analysis.bpm - bpm)).toBeLessThanOrEqual(0.2);
      for (const error of beatErrors(analysis.beats, bpm, offset))
        expect(Math.abs(error)).toBeLessThan(0.015);
    }
  });

  it('reports the beat of a drum loop, not its hats, and folds fast tempos onto beats', () => {
    for (const [bpm, offset] of [
      [92, 0.3],
      [140, 0.2],
      [165, 0],
    ] as const) {
      const analysis = analyzeAudio(drumLoop(bpm, 40, offset), RATE);
      expect(Math.abs(analysis.bpm - bpm)).toBeLessThanOrEqual(0.2);
      for (const error of beatErrors(analysis.beats, bpm, offset))
        expect(Math.abs(error)).toBeLessThan(0.015);
    }
    // 184 BPM is outside the preferred 80–170 range: half tempo, still on the beats.
    const folded = analyzeAudio(drumLoop(184, 40, 0.12), RATE);
    expect(Math.abs(folded.bpm - 92)).toBeLessThanOrEqual(0.2);
    for (const error of beatErrors(folded.beats, 184, 0.12))
      expect(Math.abs(error)).toBeLessThan(0.015);
  });

  it('lights the low bins for a 100 Hz sine and leaves the high bins dark', () => {
    const analysis = analyzeAudio(sine(100, 5), RATE);
    const spectrum = decodeBase64(analysis.spectrum);
    const frames = Math.floor(spectrum.length / analysis.bins);
    expect(frames).toBe(5 * ANALYSIS_RATE);
    // Skip the fade-in where the first windows overlap silence before the start.
    for (let frame = 10; frame < frames - 10; frame++) {
      const row = spectrum.subarray(frame * analysis.bins, (frame + 1) * analysis.bins);
      const loudest = row.indexOf(Math.max(...row));
      expect(analysisBinFrequency(analysis, loudest)).toBeGreaterThan(80);
      expect(analysisBinFrequency(analysis, loudest)).toBeLessThan(125);
      for (let bin = 0; bin < analysis.bins; bin++)
        if (analysisBinFrequency(analysis, bin) > 400) expect(row[bin]).toBe(0);
    }
    const low = bandEnergy(analysis, 40, 160);
    const high = bandEnergy(analysis, 2000, 16000);
    expect(low[150]).toBeGreaterThan(0.3);
    expect(bandEnergy(analysis, 500, 2000)[150]).toBe(0);
    expect(high.every((value) => value === 0)).toBe(true);
    expect(analysis.bpm).toBe(0);
    // Peaks follow the 0.5 amplitude.
    const peaks = decodeBase64(analysis.peaks);
    expect(Math.abs(peaks[100]! - 0.5 * 255)).toBeLessThan(2);
  });

  it('returns zeros and no tempo for silence', () => {
    const analysis = analyzeAudio(new Float32Array(RATE * 10), RATE);
    expect(decodeBase64(analysis.spectrum).every((value) => value === 0)).toBe(true);
    expect(decodeBase64(analysis.peaks).every((value) => value === 0)).toBe(true);
    expect(decodeBase64(analysis.spectrum).length).toBe(10 * ANALYSIS_RATE * ANALYSIS_BINS);
    expect(analysis.bpm).toBe(0);
    expect(analysis.beats).toEqual([]);
    assertAudioAnalysis(analysis);
  });

  it('handles empty input and steady noise without inventing a tempo', () => {
    const empty = analyzeAudio(new Float32Array(0), RATE);
    expect(empty.spectrum).toBe('');
    expect(empty.bpm).toBe(0);
    assertAudioAnalysis(empty);
    const random = noise(11);
    const hiss = new Float32Array(RATE * 20).map(() => random() * 0.3);
    const analysis = analyzeAudio(hiss, RATE);
    expect(analysis.bpm).toBe(0);
    expect(() => analyzeAudio(hiss, 0)).toThrow(RangeError);
  });

  it('analyzes ten minutes in a couple of seconds', () => {
    const clicks = clickTrack(126, 600);
    const random = noise(3);
    for (let index = 0; index < clicks.length; index++) clicks[index]! += random() * 0.05;
    const started = performance.now();
    const analysis = analyzeAudio(clicks, RATE);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(analysis.bpm).toBeCloseTo(126, 0);
    // The grid stays on the clicks to the end of a long track.
    const errors = beatErrors(analysis.beats.slice(-20), 126, 0);
    for (const error of errors) expect(Math.abs(error)).toBeLessThan(0.015);
    assertAudioAnalysis(analysis);
  }, 30000);
});

describe('base64 helpers', () => {
  it('round-trips bytes and matches Node encoding', () => {
    const random = noise(5);
    for (let length = 0; length < 40; length++) {
      const bytes = Uint8Array.from({ length }, () => Math.floor(((random() + 1) / 2) * 256) & 255);
      const text = encodeBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(decodeBase64(text))).toEqual(Array.from(bytes));
    }
    expect(() => decodeBase64('abc')).toThrow(RangeError);
    expect(() => decodeBase64('ab$=')).toThrow(RangeError);
  });
});

describe('waveformColumns', () => {
  it('draws the loudest peak per column over a time range', () => {
    const samples = new Float32Array(RATE * 4);
    samples.fill(0.8, 0, RATE * 2);
    samples.fill(0.2, RATE * 2);
    const analysis = analyzeAudio(samples, RATE);
    expect(analysisDuration(analysis)).toBeCloseTo(4, 5);
    const whole = waveformColumns(analysis, 8);
    expect(whole.length).toBe(8);
    expect(whole[0]).toBeCloseTo(0.8, 1);
    expect(whole[7]).toBeCloseTo(0.2, 1);
    const zoomed = waveformColumns(analysis, 4, 2.5, 3.5);
    expect(Array.from(zoomed).every((value) => Math.abs(value - 0.2) < 0.01)).toBe(true);
    expect(waveformColumns(analysis, 0).length).toBe(0);
    expect(Array.from(waveformColumns(analysis, 3, 10, 12))).toEqual([0, 0, 0]);
  });
});
