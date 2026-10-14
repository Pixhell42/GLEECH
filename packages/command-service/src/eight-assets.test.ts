import { describe, expect, it } from 'vitest';
import {
  createProject,
  createEffect,
  assertEffect,
  effectImages,
  withoutImageData,
  supportsLayerImage,
  supportsHeightField,
  type EffectInstance,
  type LayerImage,
} from '@gleech/project-model';
import {
  createCommandService,
  copySettings,
  pastedSettings,
  generateGleechStack,
  generateVariations,
} from './index';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const asset: LayerImage = {
  source: { id: 'embedded', name: 'map.png', width: 1, height: 1, format: 'png', hasAlpha: true },
  png,
};
const types = [
  'reference-mosh',
  'motion-transfer',
  'depth-parallax',
  'depth-haze',
  'depth-color-map',
  'cutout',
] as const;
describe.each(types)('%s portable assets', (type) => {
  it('preserves independent frozen attachments through history, duplication and settings copy/paste', () => {
    const service = createCommandService(createProject('Assets', 23));
    service.setSource(asset.source);
    service.addEffect(type, 'first');
    const e = service.getState().effects[0]!;
    const change = supportsLayerImage(e) ? { image: asset } : { fieldImage: asset };
    service.updateEffect('first', change);
    const updated = service.getState().effects[0]!;
    expect(Object.isFrozen(effectImages(updated)[0])).toBe(true);
    expect(Object.isFrozen(effectImages(updated)[0]!.source)).toBe(true);
    expect(effectImages(updated)[0]!.png).toBe(png);
    expect(effectImages(withoutImageData(updated))[0]!.png).toBe('');
    service.undo();
    expect(effectImages(service.getState().effects[0]!)).toHaveLength(0);
    service.redo();
    const data = copySettings(updated, { kind: 'effect' })!;
    const pasted = pastedSettings(createEffect(type, 'other'), data, { kind: 'effect' })!;
    expect(effectImages(pasted)[0]).toEqual(asset);
    expect(pasted.instanceId).toBe('other');
    const empty = copySettings(createEffect(type, 'empty'), { kind: 'effect' })!;
    expect(effectImages(pastedSettings(updated, empty, { kind: 'effect' })!)).toHaveLength(0);
  });
  it('retains attachments and locks while varying only compatible recipes', () => {
    const base = createEffect(type, type);
    const e = {
      ...base,
      ...(supportsLayerImage(base) ? { image: asset } : { fieldImage: asset }),
    } as EffectInstance;
    const variations = generateVariations(
      [e, { ...e, instanceId: 'locked', locked: true }],
      123,
      0.75,
    );
    for (const variation of variations) {
      expect(effectImages(variation.effects[0]!)[0]).toEqual(asset);
      expect(variation.effects[1]).toEqual({ ...e, instanceId: 'locked', locked: true });
      variation.effects.forEach(assertEffect);
    }
  });
});
describe('image and map routing', () => {
  it('rejects attachments on unsupported effects and separates image inputs from height fields', () => {
    const invalid = { ...createEffect('vignette', 'bad'), image: asset } as EffectInstance;
    expect(() => assertEffect(invalid)).toThrow(/image inputs/);
    expect(supportsHeightField(createEffect('reference-mosh', 'image'))).toBe(false);
    expect(supportsLayerImage(createEffect('depth-haze', 'depth'))).toBe(false);
  });
  it('does not create source-dependent effects or subject detection in new GLEECH stacks', () => {
    for (let seed = 0; seed < 100; seed++)
      for (const e of generateGleechStack([], {
        seed,
        complexity: 'gleeched',
        mode: 'replace-all',
      })) {
        expect(['solid', 'reference-mosh', 'motion-transfer']).not.toContain(e.type);
        if (e.type === 'cutout') expect(e.params.mode).toBe('depth');
      }
  });
});
