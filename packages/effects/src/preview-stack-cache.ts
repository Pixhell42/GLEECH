import { withoutImageData, type EffectInstance } from '@gleech/project-model';
import type { EffectImage, RenderOptions } from './index';

/** Immutable checkpoints for a single small preview. No full-size/export images. */
export class PreviewStackCache {
  private entries: {
    context: unknown[];
    keys: string[];
    checkpoints: Map<number, Uint8Array<ArrayBuffer>>;
  }[] = [];
  clear() {
    this.entries = [];
  }
  begin(image: EffectImage, effects: readonly EffectInstance[], options: RenderOptions) {
    if (Math.max(image.width, image.height) > 256) return null;
    const reference = options.reference ?? image;
    const context = [
      image.pixels,
      image.width,
      image.height,
      options.masterSeed ?? 0,
      reference.width,
      reference.height,
      options.subjectMask?.values,
      options.paletteSource?.pixels,
      options.fieldMaxDimension,
      ...[...(options.layerImages ?? [])]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([id, layer]) => [id, layer.width, layer.height, layer.pixels]),
    ];
    const keys = effects.map((effect) => JSON.stringify(withoutImageData(effect)));
    const matches = (entry: (typeof this.entries)[number]) =>
      context.length === entry.context.length && context.every((v, i) => v === entry.context[i]);
    const old = this.entries.find(matches);
    let common = 0;
    if (old) while (common < keys.length && keys[common] === old.keys[common]) common++;
    const retained = new Map([...(old?.checkpoints ?? [])].filter(([count]) => count <= common));
    const count = Math.max(0, ...retained.keys());
    const pixels = retained.get(count);
    // Each transaction owns its map. Cancelled/concurrent renders cannot publish
    // partial output or mutate the arrays used by another render.
    const pending = new Map(retained);
    return {
      count,
      pixels,
      capture: (count: number, pixels: Uint8Array) => {
        pending.set(count, new Uint8Array(pixels));
        while (pending.size > 32) pending.delete(pending.keys().next().value!);
      },
      commit: () => {
        // Keep all four adaptive draft sizes warm, rather than rebuilding a
        // long prefix each time the preview budget changes resolution.
        this.entries = this.entries.filter((entry) => !matches(entry));
        this.entries.push({ context, keys, checkpoints: pending });
        while (this.entries.length > 4) this.entries.shift();
      },
    };
  }
}
