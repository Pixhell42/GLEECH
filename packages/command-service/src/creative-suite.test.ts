import { expect, it } from 'vitest';
import {
  assertEffect,
  assertPresetRecipe,
  createProject,
  createPaintedMask,
} from '@gleech/project-model';
import { createCommandService, generateVariations, copySettings, pastedSettings } from './index';

it.each([
  'cel-shading',
  'shader-signal-collapse',
  'shader-paint-flow',
  'shader-billowing-smoke',
] as const)(
  '%s participates in editing, masks, duplication, settings, presets and locked variations',
  (type) => {
    const service = createCommandService(createProject('Creative suite', 8172));
    service.setSource({
      id: 'source',
      name: 'source.png',
      width: 73,
      height: 57,
      format: 'png',
      hasAlpha: true,
    });
    service.addEffect(type, 'original');
    service.updateEffect('original', { params: { amount: 0.4, blendMode: 'color-burn' } });
    service.setEffectMask('original', createPaintedMask(73, 57));
    const before = service.getState();
    service.varyEffect('original');
    expect(service.getState().effects[0]!.seedOffset).toBe(1);
    service.undo();
    expect(service.getState()).toBe(before);
    service.redo();
    service.setEffectLocked('original', true);
    service.duplicateEffect('original', 'copy');
    service.setEffectLocked('copy', false);
    const stack = service.getState().effects;
    expect(stack[1]!.params).toEqual(stack[0]!.params);
    expect(stack[1]!.paintedMask).toEqual(stack[0]!.paintedMask);
    const settings = copySettings(stack[0]!, { kind: 'effect' });
    expect(settings).not.toBeNull();
    expect(pastedSettings(stack[1]!, settings!, { kind: 'effect' })?.params).toMatchObject({
      amount: 0.4,
      blendMode: 'color-burn',
    });
    for (const candidate of generateVariations(stack, 635, 0.8)) {
      expect(candidate.effects[0]).toBe(stack[0]);
      candidate.effects.forEach(assertEffect);
    }
    const recipe = JSON.parse(
      JSON.stringify({ schemaVersion: 1, masterSeed: 8172, effects: stack }),
    );
    assertPresetRecipe(recipe);
    service.applyPreset(recipe, 'replace');
    expect(service.getState().effects.map((e) => e.params)).toEqual(stack.map((e) => e.params));
  },
);
