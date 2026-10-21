// Runs the import-time audio analysis off the UI thread (see timeline-audio.ts).
import { analyzeAudio } from '../../shared/audio-analysis';

self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    self.postMessage({
      ok: true,
      analysis: analyzeAudio(event.data.samples, event.data.sampleRate),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Audio analysis failed.',
    });
  }
};
