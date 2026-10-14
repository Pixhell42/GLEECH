import { describe, expect, it } from 'vitest';
import { createEffect, createProject, EFFECT_DEFINITIONS } from '@gleech/project-model';
import { createCommandService, resetSettings } from './index';

describe('individual control Reset', () => {
  it('resets just one control, preserves locks and pattern identity, and is undoable', () => {
    const commands = createCommandService(createProject('Reset', 17));
    commands.setSource({
      id: 'source',
      name: 'test.png',
      width: 20,
      height: 20,
      format: 'png',
      hasAlpha: true,
    });
    commands.addEffect('signal-tearing', 'a');
    commands.updateEffect('a', { params: { displacement: 23, orientation: 45 } });
    commands.setEffectLocked('a', true);
    commands.varyEffect('a');
    const before = commands.getState();
    expect(commands.resetEffectSetting('a', { kind: 'parameter', key: 'displacement' })).toBe(true);
    const after = commands.getState();
    expect(after.effects[0]).toEqual({
      ...before.effects[0],
      params: { ...before.effects[0]!.params, displacement: 8 },
    });
    commands.undo();
    expect(commands.getState()).toEqual(before);
    commands.redo();
    expect(commands.getState()).toEqual(after);
  });
  it('does not record default no-ops, discard redo, or reset an entire filter or mask', () => {
    const commands = createCommandService(createProject('Reset'));
    commands.setSource({
      id: 'source',
      name: 'test.png',
      width: 20,
      height: 20,
      format: 'png',
      hasAlpha: true,
    });
    commands.addEffect('wave-distortion', 'a');
    commands.updateEffect('a', { params: { strength: 10 } });
    commands.undo();
    const before = commands.getState();
    expect(commands.resetEffectSetting('a', { kind: 'parameter', key: 'strength' })).toBe(true);
    expect(commands.getState()).toBe(before);
    expect(commands.canRedo()).toBe(true);
    for (const target of [
      { kind: 'effect' },
      { kind: 'mask' },
      { kind: 'parameter', key: 'missing' },
    ] as const)
      expect(commands.resetEffectSetting('a', target)).toBe(false);
    expect(commands.getState()).toBe(before);
  });
  it('resets application controls independently', () => {
    const effect = {
      ...createEffect('crt', 'a'),
      application: { region: 'left' as const, coverage: 0.3, softness: 0.8 },
    };
    for (const [key, value] of [
      ['region', 'all'],
      ['coverage', 1],
      ['softness', 0],
    ] as const) {
      expect(
        resetSettings(effect, { kind: 'parameter', key: 'application.' + key })!.application,
      ).toEqual({ ...effect.application, [key]: value });
    }
  });
  it('resets a color field alone or the complete gradient group', () => {
    const effect = createEffect('crt', 'a');
    Object.assign(effect.params, {
      glowColor: '#123456',
      glowColorMode: 'gradient',
      glowColorEnd: '#ff0000',
      glowColorAngle: 90,
      bloom: 1,
    });
    const one = resetSettings(effect, { kind: 'parameter', key: 'glowColor' })!;
    expect(one.params).toEqual({ ...effect.params, glowColor: '#ffcf88' });
    const group = resetSettings(effect, { kind: 'color', key: 'glowColor' })!;
    for (const key of Object.keys(EFFECT_DEFINITIONS.crt.parameters).filter((k) =>
      k.startsWith('glowColor'),
    ))
      expect((group.params as Record<string, string | number>)[key]).toEqual(
        EFFECT_DEFINITIONS.crt.parameters[key]!.default,
      );
    expect(group.params).toMatchObject({ bloom: 1 });
  });
  it('resets special ramps and keeps Solid content consistent', () => {
    for (const [type, start, end] of [
      ['gradient-map', 'shadows', 'highlights'],
      ['dither', 'rampStart', 'rampEnd'],
      ['indexed-palette', 'paletteStart', 'paletteEnd'],
    ] as const) {
      const effect = createEffect(type, 'a');
      Object.assign(effect.params, { [start]: '#123456', [end]: '#123456' });
      const result = resetSettings(effect, { kind: 'color', key: start })!;
      expect(result.params).toMatchObject({
        [start]: EFFECT_DEFINITIONS[type].parameters[start]!.default,
        [end]: EFFECT_DEFINITIONS[type].parameters[end]!.default,
      });
    }
    const solid = createEffect('solid', 's');
    Object.assign(solid.params, { content: 'gradient', fillColorMode: 'gradient' });
    expect(resetSettings(solid, { kind: 'parameter', key: 'fillColorMode' })!.params).toMatchObject(
      { content: 'color', fillColorMode: 'solid' },
    );
  });
  it('resets coupled level endpoints to valid defaults', () => {
    for (const type of ['levels-curves', 'threshold'] as const) {
      const effect = createEffect(type, 'a');
      Object.assign(effect.params, { inputBlack: 0.2, inputWhite: 0.7 });
      expect(resetSettings(effect, { kind: 'parameter', key: 'inputBlack' })!.params).toMatchObject(
        { inputBlack: 0, inputWhite: 0.7 },
      );
      expect(resetSettings(effect, { kind: 'parameter', key: 'inputWhite' })!.params).toMatchObject(
        { inputBlack: 0.2, inputWhite: 1 },
      );
    }
  });
});
