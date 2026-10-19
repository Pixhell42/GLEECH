import type sharpModule from 'sharp';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { InferenceSession, Tensor as OnnxTensor } from 'onnxruntime-node';
import type { SubjectMask } from '@gleech/project-model';
import type { PixelImage } from '../shared/image-api';

type Sharp = typeof sharpModule;
interface OnnxRuntime {
  InferenceSession: Pick<typeof InferenceSession, 'create'>;
  Tensor: typeof OnnxTensor;
}

// Sharp and ONNX Runtime are injected so the CLI can load them lazily and
// still share the desktop app's exact inference path.
export function createSubjectDetector(sharp: Sharp, loadRuntime: () => Promise<OnnxRuntime>) {
  const MODEL_SHA256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
  let session: Promise<Pick<InferenceSession, 'run' | 'inputNames' | 'outputNames'>> | null = null;
  let serial: Promise<unknown> = Promise.resolve();

  return function detectSubject(image: PixelImage, modelPath: string): Promise<SubjectMask> {
    // One cached session; serialize inference to bound CPU and native scratch memory.
    const task = serial
      .catch(() => {})
      .then(async () => {
        const { InferenceSession, Tensor } = await loadRuntime();
        if (!session) {
          session = (async () => {
            const model = await readFile(modelPath);
            if (createHash('sha256').update(model).digest('hex') !== MODEL_SHA256)
              throw new Error('The bundled subject model is damaged. Reinstall GLEECH.');
            return InferenceSession.create(model, {
              executionProviders: ['cpu'],
              intraOpNumThreads: 2,
              interOpNumThreads: 1,
            });
          })();
          void session.catch(() => {
            session = null;
          });
        }
        const runtime = await session;
        const rgb = await sharp(Buffer.from(image.pixels), {
          raw: { width: image.width, height: image.height, channels: 4 },
        })
          .flatten({ background: '#ffffff' })
          .resize(320, 320, { fit: 'fill', kernel: 'lanczos3' })
          .removeAlpha()
          .raw()
          .toBuffer();
        let max = 1;
        for (const value of rgb) max = Math.max(max, value);
        const input = new Float32Array(3 * 320 * 320);
        const means = [0.485, 0.456, 0.406],
          std = [0.229, 0.224, 0.225];
        for (let index = 0; index < 320 * 320; index++)
          for (let channel = 0; channel < 3; channel++)
            input[channel * 320 * 320 + index] =
              (rgb[index * 3 + channel]! / max - means[channel]!) / std[channel]!;
        const result = await runtime.run({
          [runtime.inputNames[0]!]: new Tensor('float32', input, [1, 3, 320, 320]),
        });
        const output = result[runtime.outputNames[0]!]!;
        if (!(output.data instanceof Float32Array) || output.data.length !== 320 * 320)
          throw new Error('The subject model returned an invalid mask.');
        let min = Infinity,
          maximum = -Infinity;
        for (const value of output.data) {
          if (!Number.isFinite(value))
            throw new Error('The subject model returned invalid probabilities.');
          min = Math.min(min, value);
          maximum = Math.max(maximum, value);
        }
        const values = new Uint8Array(output.data.length);
        const range = maximum - min;
        for (let index = 0; index < values.length; index++)
          values[index] =
            range > 1e-6
              ? Math.round(((output.data[index]! - min) / range) * 255)
              : output.data[index]! >= 0.5
                ? 255
                : 0;
        return { width: 320, height: 320, values: values.buffer };
      });
    serial = task;
    return task;
  };
}
