import type { EffectInstance, SubjectMask } from '@gleech/project-model';
import type { PixelImage } from '@gleech/renderer-core';
import type { JpegPassOptions } from '@gleech/effects';

export interface EffectContext {
  masterSeed: number;
  reference: { width: number; height: number };
  purpose: 'preview' | 'export';
  /** CLI strict GPU mode forbids retrying built-in shaders on CPU. */
  shaderMode?: 'auto' | 'gpu';
  previewMaxDimension?: number;
  /** Keep the active brush's rasterizer resident in long masked stacks. */
  activeMaskId?: string;
  subjectMask?: SubjectMask | undefined;
}
export type EffectRequest =
  | { kind: 'jpeg-result'; id: number; codecId: number; pixels: ArrayBuffer }
  | { kind: 'jpeg-error'; id: number; codecId: number; error: string }
  | ({
      kind: 'render';
      id: number;
      image?: PixelImage;
      effects: readonly EffectInstance[];
      layerImages?: readonly { id: string; image: PixelImage }[];
    } & EffectContext)
  | { kind: 'cancel'; id: number };
export type EffectReply =
  | {
      kind: 'jpeg-request';
      id: number;
      codecId: number;
      image: PixelImage;
      options: JpegPassOptions;
    }
  | { kind: 'success'; id: number; image: PixelImage }
  | { kind: 'cancelled'; id: number }
  | { kind: 'error'; id: number; error: string };
