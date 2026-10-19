import type { EffectRequest, EffectReply } from '../renderer/src/effect-protocol';

export interface GpuCapabilities {
  webgpu: boolean;
  webgl2: boolean;
  reason?: string;
}
export interface ImageFile {
  file: string;
  width: number;
  height: number;
}
export interface GpuManifest {
  source: ImageFile;
  layers: { id: string; image: ImageFile }[];
  subject?: ImageFile;
  request: Extract<EffectRequest, { kind: 'render' }>;
}
export type GpuParentMessage = { kind: 'render' | 'cancel'; id: number } | { kind: 'shutdown' };
export type GpuChildMessage =
  | { kind: 'ready'; capabilities: GpuCapabilities }
  | { kind: 'error'; id?: number; error: string }
  | { kind: 'cancelled'; id: number }
  | { kind: 'success'; id: number; width: number; height: number; backend: string };
export interface GpuBridge {
  onRequest(callback: (request: EffectRequest) => void): void;
  reply(reply: EffectReply): void;
  ready(capabilities: GpuCapabilities): void;
}
