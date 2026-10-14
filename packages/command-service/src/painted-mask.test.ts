import { describe, expect, it } from 'vitest';
import { createProject, createPaintedMask, DEFAULT_MASK_BRUSH } from '@gleech/project-model';
import { createCommandService } from './index';

function service() {
  const commands = createCommandService(createProject('Mask', 123));
  commands.setSource({
    id: 'source',
    name: 'source.png',
    width: 101,
    height: 101,
    format: 'png',
    hasAlpha: true,
  });
  commands.addEffect('hue-saturation', 'tone');
  return commands;
}
describe('painted mask commands', () => {
  it('creates and changes a mask as individual undoable commands', () => {
    const commands = service(),
      before = commands.getState();
    commands.setEffectMask('tone', createPaintedMask(101, 101));
    const empty = commands.getState();
    const stroke = {
      ...DEFAULT_MASK_BRUSH,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.7 },
      ],
    };
    commands.setEffectMask('tone', { ...empty.effects[0]!.paintedMask!, strokes: [stroke] });
    const painted = commands.getState();
    stroke.points[0]!.x = 0.9;
    expect(painted.effects[0]!.paintedMask!.strokes[0]!.points[0]!.x).toBe(0.2);
    commands.undo();
    expect(commands.getState()).toBe(empty);
    commands.undo();
    expect(commands.getState()).toBe(before);
    commands.redo();
    commands.redo();
    expect(commands.getState()).toBe(painted);
    commands.updateEffect('tone', { params: { lightness: 0.5 } });
    expect(commands.getState().effects[0]!.paintedMask).toBe(painted.effects[0]!.paintedMask);
  });
  it('preserves masks through snapshots, presets, toggling and manual seed changes', () => {
    const commands = service();
    commands.setEffectMask('tone', {
      ...createPaintedMask(101, 101),
      strokes: [{ ...DEFAULT_MASK_BRUSH, points: [{ x: 0.5, y: 0.5 }] }],
    });
    const recipe = {
      effects: commands.getState().effects,
      masterSeed: commands.getState().masterSeed,
    };
    commands.captureSnapshot(
      'snap',
      'Masked',
      { ...commands.getState().source!, id: 'rendered' },
      '2026-10-05T00:00:00.000Z',
      true,
    );
    expect(commands.getState().effects).toHaveLength(0);
    commands.restoreSnapshot('snap', 'recipe');
    expect(commands.getState().effects).toEqual(recipe.effects);
    commands.setSeed(456);
    expect(commands.getState().effects).toEqual(recipe.effects);
    commands.applyPreset(recipe, 'replace');
    expect(commands.getState().effects).toEqual(recipe.effects);
    commands.setEffectMask('tone', {
      ...commands.getState().effects[0]!.paintedMask!,
      enabled: false,
    });
    expect(commands.getState().effects[0]!.paintedMask!.enabled).toBe(false);
    commands.setEffectMask('tone', null);
    expect(commands.getState().effects[0]!.paintedMask).toBeUndefined();
    commands.undo();
    expect(commands.getState().effects[0]!.paintedMask!.enabled).toBe(false);
  });
  it('rejects invalid points and missing effect targets without changing history', () => {
    const commands = service(),
      before = commands.getState();
    expect(() => commands.setEffectMask('missing', createPaintedMask(101, 101))).toThrow();
    expect(() =>
      commands.setEffectMask('tone', {
        ...createPaintedMask(101, 101),
        strokes: [{ ...DEFAULT_MASK_BRUSH, points: [{ x: NaN, y: 0.5 }] }],
      }),
    ).toThrow();
    expect(commands.getState()).toBe(before);
  });
});
