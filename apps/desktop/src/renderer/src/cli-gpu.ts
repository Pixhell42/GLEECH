import type { GpuBridge } from '../../shared/cli-gpu-api';
import type { EffectReply } from './effect-protocol';
const bridge = (window as unknown as { gleechGpu: GpuBridge }).gleechGpu;
const worker = new Worker(new URL('./effect-worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (event: MessageEvent<EffectReply>) => bridge.reply(event.data);
worker.onerror = (event) =>
  bridge.reply({ kind: 'error', id: -1, error: event.message || 'GPU worker crashed.' });
bridge.onRequest((request) => worker.postMessage(request));
void (async () => {
  let webgpu = false;
  let webgl2 = false;
  let reason: string | undefined;
  try {
    webgpu = !!(await navigator.gpu?.requestAdapter());
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    webgl2 = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* Report the unavailable backend. */
  }
  bridge.ready({ webgpu, webgl2, ...(reason ? { reason } : {}) });
})();
