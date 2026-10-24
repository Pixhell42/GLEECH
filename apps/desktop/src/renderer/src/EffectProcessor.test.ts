import { afterEach, expect, it, vi } from 'vitest';
import type {} from './env';
import { EffectProcessor } from './EffectProcessor';
import type { EffectRequest, EffectReply } from './effect-protocol';
import { createEffect, type SolidEffect } from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';

class WorkerDouble {
  static current: WorkerDouble;
  onmessage: ((event: { data: EffectReply }) => void) | null = null;
  onerror: unknown;
  messages: EffectRequest[] = [];
  terminated = false;
  constructor() {
    WorkerDouble.current = this;
  }
  postMessage(message: EffectRequest) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
const image = { width: 1, height: 1, pixels: new Uint8Array([10, 20, 30, 255]).buffer };
const context = { masterSeed: 1, reference: image, purpose: 'export' as const };
afterEach(() => vi.unstubAllGlobals());

it('recovers a stalled preview worker and resends the source to its replacement', async () => {
  vi.stubGlobal('Worker', WorkerDouble);
  const processor = new EffectProcessor();
  try {
    const first = processor.render(image, [], { ...context, purpose: 'preview' });
    const rejected = expect(first).rejects.toThrow(RenderCancelledError);
    await vi.waitFor(() => expect(WorkerDouble.current.messages).toHaveLength(1));
    const old = WorkerDouble.current;
    processor.cancelPreview();
    expect(processor.restartPreviews()).toBe(true);
    await rejected;
    expect(old.terminated).toBe(true);
    const replacement = WorkerDouble.current;
    const next = processor.render(image, [], { ...context, purpose: 'preview' });
    await vi.waitFor(() => expect(replacement.messages).toHaveLength(1));
    const request = replacement.messages[0]!;
    expect(request).toHaveProperty('image', image);
    old.onmessage!({ data: { kind: 'success', id: request.id, image } });
    replacement.onmessage!({ data: { kind: 'success', id: request.id, image } });
    await expect(next).resolves.toEqual(image);
  } finally {
    processor.dispose();
  }
});

it('does not restart a worker that has an export in progress', async () => {
  vi.stubGlobal('Worker', WorkerDouble);
  const processor = new EffectProcessor();
  try {
    const pending = processor.render(image, [], context);
    await vi.waitFor(() => expect(WorkerDouble.current.messages).toHaveLength(1));
    expect(processor.restartPreviews()).toBe(false);
    expect(WorkerDouble.current.terminated).toBe(false);
    const request = WorkerDouble.current.messages[0]!;
    WorkerDouble.current.onmessage!({ data: { kind: 'success', id: request.id, image } });
    await expect(pending).resolves.toEqual(image);
  } finally {
    processor.dispose();
  }
});

it('cancels active exports, ignores late replies and resends source pixels for the next render', async () => {
  vi.stubGlobal('Worker', WorkerDouble);
  const processor = new EffectProcessor();
  try {
    const first = processor.render(image, [], context);
    const rejected = expect(first).rejects.toThrow(RenderCancelledError);
    await vi.waitFor(() => expect(WorkerDouble.current.messages).toHaveLength(1));
    const original = WorkerDouble.current.messages[0]!;
    processor.cancelAll();
    await rejected;
    const next = processor.render(image, [], context);
    await vi.waitFor(() => expect(WorkerDouble.current.messages).toHaveLength(3));
    const request = WorkerDouble.current.messages[2]!;
    expect(request.kind).toBe('render');
    expect(request).toHaveProperty('image', image);
    WorkerDouble.current.onmessage!({ data: { kind: 'success', id: original.id, image } });
    WorkerDouble.current.onmessage!({ data: { kind: 'success', id: request.id, image } });
    await expect(next).resolves.toEqual(image);
  } finally {
    processor.dispose();
  }
});

it('never posts a cancelled export after embedded image decoding completes late', async () => {
  vi.stubGlobal('Worker', WorkerDouble);
  let release!: (value: { ok: true; value: typeof image }) => void;
  vi.stubGlobal('window', {
    gleech: {
      decodeLayerImage: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const processor = new EffectProcessor();
  const effect = {
    ...createEffect('solid', 'image'),
    image: {
      source: {
        id: 'layer',
        name: 'layer.png',
        width: 1,
        height: 1,
        format: 'png',
        hasAlpha: true,
      },
      png: 'encoded',
    },
  } as SolidEffect;
  try {
    const pending = processor.render(image, [effect], context);
    const rejected = expect(pending).rejects.toThrow(RenderCancelledError);
    processor.cancelAll();
    await rejected;
    release({ ok: true, value: image });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(WorkerDouble.current.messages.every((message) => message.kind === 'cancel')).toBe(true);
  } finally {
    processor.dispose();
  }
});
