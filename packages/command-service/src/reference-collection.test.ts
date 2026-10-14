import { expect, it } from 'vitest';
import {
  createProject,
  assertPresetRecipe,
  effectImages,
  type LayerImage,
} from '@gleech/project-model';
import { createCommandService, copySettings, pastedSettings } from './index';
it.each([
  'shader-chromatic-erosion',
  'shader-radial-extrusion',
  'shader-cellular-mesh',
  'shader-particle-burst',
  'shader-spectral-terrain',
  'shader-neon-edges',
  'shader-wire-ghost',
  'shader-prismatic-shatter',
  'shader-bloom-field',
  'window-fragments',
  'contour-waves',
  'pixel-dissolve',
  'neon-print',
  'system-crash',
  'terminal-wireframe',
  'signal-weave',
  'data-weave',
  'micro-collage',
] as const)('%s retains controls through undo, duplication and presets', (type) => {
  const commands = createCommandService(createProject('Collection', 8172));
  commands.setSource({
    id: 'source',
    name: 'source.png',
    width: 71,
    height: 53,
    format: 'png',
    hasAlpha: true,
  });
  commands.addEffect(type, 'reference');
  const before = commands.getState();
  commands.updateEffect('reference', { params: { amount: 0.4 } });
  commands.undo();
  expect(commands.getState()).toBe(before);
  commands.redo();
  expect(commands.getState().effects[0]!.params.amount).toBe(0.4);
  commands.setEffectLocked('reference', true);
  commands.duplicateEffect('reference', 'copy');
  expect(commands.getState().effects[1]!.params).toEqual(commands.getState().effects[0]!.params);
  expect(commands.getState().effects.every((e) => e.locked)).toBe(true);
  const recipe = {
    schemaVersion: 1 as const,
    masterSeed: 8172,
    effects: commands.getState().effects,
  };
  commands.applyPreset(recipe, 'replace');
  expect(commands.getState().effects).toHaveLength(2);
});
const asset: LayerImage = {
  source: {
    id: 'reference-map',
    name: 'reference.png',
    width: 1,
    height: 1,
    format: 'png',
    hasAlpha: true,
  },
  png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
};
it.each(['window-fragments', 'micro-collage', 'contour-waves', 'shader-spectral-terrain'] as const)(
  '%s embeds its optional image through recipes, clipboard and duplication',
  (type) => {
    const service = createCommandService(createProject('Images', 8172));
    service.setSource({
      id: 'source',
      name: 'source.png',
      width: 71,
      height: 53,
      format: 'png',
      hasAlpha: true,
    });
    service.addEffect(type, 'asset');
    service.updateEffect(
      'asset',
      type === 'window-fragments' || type === 'micro-collage'
        ? { image: asset }
        : { fieldImage: asset, params: { fieldSource: 'image' } },
    );
    const e = service.getState().effects[0]!;
    expect(effectImages(e)).toEqual([asset]);
    const recipe = JSON.parse(JSON.stringify({ schemaVersion: 1, masterSeed: 8172, effects: [e] }));
    assertPresetRecipe(recipe);
    expect(effectImages(recipe.effects[0]!)).toEqual([asset]);
    service.duplicateEffect('asset', 'copy');
    expect(effectImages(service.getState().effects[1]!)).toEqual([asset]);
    const copied = copySettings(e, { kind: 'effect' });
    if (!copied) throw new Error('Expected an effect settings payload.');
    const pasted = pastedSettings(service.getState().effects[1]!, copied, { kind: 'effect' });
    expect(pasted && effectImages(pasted)).toEqual([asset]);
  },
);
