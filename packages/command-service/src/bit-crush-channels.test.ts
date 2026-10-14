import { describe, expect, it } from 'vitest';
import {
  bitCrushDepths,
  createEffect,
  createProject,
  type BitCrushEffect,
} from '@gleech/project-model';
import {
  createCommandService,
  copySettings,
  pastedSettings,
  resetSettings,
  settingsPasteTarget,
  generateVariations,
} from './index';
function service() {
  const commands = createCommandService(createProject('Bit channels'));
  commands.setSource({
    id: 'source',
    name: 'source.png',
    width: 16,
    height: 16,
    format: 'png',
    hasAlpha: true,
  });
  commands.addEffect('bit-crush', 'bits');
  return commands;
}
describe('bit crush channel editing', () => {
  it('unlinks at the current RGB depth, relinks at Red and keeps alpha independent with undo/redo', () => {
    const commands = service();
    commands.updateEffect('bits', { params: { bits: 5, alphaBits: 2 } });
    const linked = commands.getState();
    commands.updateEffect('bits', { params: { linkRGB: 'off' } });
    const unlinked = commands.getState();
    expect(bitCrushDepths(unlinked.effects[0]!.params as BitCrushEffect['params'])).toEqual([
      5, 5, 5, 2,
    ]);
    commands.undo();
    expect(commands.getState()).toBe(linked);
    commands.redo();
    expect(commands.getState()).toBe(unlinked);
    commands.updateEffect('bits', { params: { redBits: 1, greenBits: 3, blueBits: 7 } });
    commands.updateEffect('bits', { params: { linkRGB: 'on' } });
    expect(
      bitCrushDepths(commands.getState().effects[0]!.params as BitCrushEffect['params']),
    ).toEqual([1, 1, 1, 2]);
    commands.resetEffectSetting('bits', { kind: 'parameter', key: 'alphaBits' });
    expect(commands.getState().effects[0]!.params).toMatchObject({ alphaBits: 8 });
  });
  it('pastes compatible channel depths into the chosen channel and unlinks consistently', () => {
    const original = createEffect('bit-crush', 'original');
    Object.assign(original.params, { bits: 6 });
    const packet = copySettings(original, { kind: 'parameter', key: 'redBits' })!;
    const destination = createEffect('bit-crush', 'destination');
    Object.assign(destination.params, { bits: 2 });
    const target = { kind: 'parameter' as const, key: 'blueBits' };
    expect(settingsPasteTarget(destination, packet, target)).toEqual(target);
    const pasted = pastedSettings(destination, packet, target) as BitCrushEffect;
    expect(pasted.params.linkRGB).toBe('off');
    expect(bitCrushDepths(pasted.params)).toEqual([2, 2, 6, 8]);
    const reset = resetSettings(pasted, target) as BitCrushEffect;
    expect(bitCrushDepths(reset.params)).toEqual([2, 2, 3, 8]);
    const alpha = pastedSettings(destination, packet, {
      kind: 'parameter',
      key: 'alphaBits',
    }) as BitCrushEffect;
    expect(bitCrushDepths(alpha.params)).toEqual([2, 2, 2, 6]);
    const coverage = copySettings(original, { kind: 'parameter', key: 'application.coverage' });
    if (coverage)
      expect(pastedSettings(destination, coverage, { kind: 'effect' })!.application).toEqual(
        original.application,
      );
  });
  it('preserves mixed channels through duplicate and full-settings paste', () => {
    const commands = service();
    commands.updateEffect('bits', {
      params: { linkRGB: 'off', redBits: 3, greenBits: 5, blueBits: 2, alphaBits: 4 },
    });
    const original = commands.getState().effects[0]!;
    commands.duplicateEffect('bits', 'duplicate');
    expect(commands.getState().effects[1]!.params).toEqual(original.params);
    const packet = copySettings(original, { kind: 'effect' })!;
    expect(
      pastedSettings(createEffect('bit-crush', 'destination'), packet, { kind: 'effect' })!.params,
    ).toEqual(original.params);
  });
  it('keeps linking and full alpha precision stable in GLEECH variations', () => {
    const effect = createEffect('bit-crush', 'variation');
    Object.assign(effect.params, { linkRGB: 'off', redBits: 2, greenBits: 5, blueBits: 7 });
    for (const candidate of generateVariations([effect], 453, 1)) {
      expect(candidate.effects[0]!.params).toMatchObject({ linkRGB: 'off', alphaBits: 8 });
    }
  });
});
