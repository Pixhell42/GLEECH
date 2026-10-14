import {
  createEffect,
  createImportedShader,
  type PresetRecipe,
  type RgbSplitEffect,
  effectsNeedSubject,
} from '@gleech/project-model';
import type { ShaderPackage } from '@gleech/project-model/shader-package';
import { unwrap, type PresetThumbnails } from '../../shared/image-api';
import type { PixelImage } from '../../shared/image-api';
import { EffectProcessor } from './EffectProcessor';

async function preview(
  processor: EffectProcessor,
  id: string | null,
  recipe: PresetRecipe,
  signal?: AbortSignal,
): Promise<string> {
  const input = unwrap(await window.gleech.shaderPreviewSource(id, recipe));
  signal?.throwIfAborted();
  const rendered = await processor.render(input.image, recipe.effects, {
    masterSeed: recipe.masterSeed,
    reference: input.reference,
    purpose: 'export',
    ...(input.subjectMask ? { subjectMask: input.subjectMask } : {}),
  });
  signal?.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  canvas
    .getContext('2d')!
    .putImageData(
      new ImageData(new Uint8ClampedArray(rendered.pixels), rendered.width, rendered.height),
      0,
      0,
    );
  return canvas.toDataURL('image/png');
}
/** Automation previews use the same bounded source preparation and effect processor. */
export async function renderMcpPreview(
  id: string,
  recipe: PresetRecipe,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const processor = new EffectProcessor();
  const abort = () => processor.dispose();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    // Source preparation accepts preset recipes (at least one effect). A zero
    // opacity identity effect lets an empty stack use the same bounded input
    // preparation without creating a layer or changing the project.
    const identity = createEffect('rgb-split', 'mcp-preview-identity') as RgbSplitEffect;
    return await preview(
      processor,
      id,
      recipe.effects.length
        ? recipe
        : { ...recipe, effects: [{ ...identity, params: { ...identity.params, amount: 0 } }] },
      signal,
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    processor.dispose();
  }
}
export async function renderMcpImage(
  sourceId: string,
  image: PixelImage,
  recipe: PresetRecipe,
  signal?: AbortSignal,
): Promise<PixelImage> {
  signal?.throwIfAborted();
  const processor = new EffectProcessor();
  const abort = () => processor.dispose();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const subjectMask = effectsNeedSubject(recipe.effects, image.pixels)
      ? unwrap(await window.gleech.subjectMask(sourceId))
      : undefined;
    signal?.throwIfAborted();
    return await processor.render(image, recipe.effects, {
      masterSeed: recipe.masterSeed,
      reference: image,
      purpose: 'export',
      ...(subjectMask ? { subjectMask } : {}),
    });
  } finally {
    signal?.removeEventListener('abort', abort);
    processor.dispose();
  }
}
export async function shaderPackageThumbnail(pkg: ShaderPackage): Promise<string> {
  const processor = new EffectProcessor();
  try {
    return await preview(processor, null, {
      masterSeed: 8172,
      effects: [createImportedShader(pkg, 'shader-library-preview')],
    });
  } finally {
    processor.dispose();
  }
}
export async function presetThumbnails(
  id: string | null,
  recipe: PresetRecipe,
): Promise<PresetThumbnails> {
  if (!recipe.effects.some((effect) => effect.type === 'shader-import'))
    return unwrap(await window.gleech.presetThumbnails(id, recipe));
  const processor = new EffectProcessor();
  try {
    return {
      image: id === null ? null : await preview(processor, id, recipe),
      statue: await preview(processor, null, recipe),
    };
  } finally {
    processor.dispose();
  }
}
