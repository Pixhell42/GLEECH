import { describe, expect, it } from 'vitest';
import {
  createProject,
  createEffect,
  type PresetPlacement,
  type PresetRecipe,
  type SpatialCrushEffect,
} from '@gleech/project-model';
import { createCommandService } from './index';

const source = {
  id: 'source',
  name: 'image.png',
  width: 64,
  height: 32,
  format: 'png' as const,
  hasAlpha: true,
};
const recipe: PresetRecipe = {
  masterSeed: 90210,
  effects: [
    {
      ...createEffect('block-corruption', 'preset-a'),
      seedOffset: 4,
      application: { region: 'subject', coverage: 0.6, softness: 0.8 },
    },
    {
      ...(createEffect('spatial-crush', 'preset-b') as SpatialCrushEffect),
      enabled: false,
      params: { amount: 0.4, blockSize: 0.1, sampling: 'random' },
    },
  ],
};
const service = () => {
  const command = createCommandService(createProject('Test', 17));
  command.setSource(source);
  command.addEffect('rgb-split', 'existing');
  command.captureSnapshot(
    'stage',
    'Stage',
    { ...source, id: 'baked' },
    '2026-10-04T00:00:00Z',
    false,
  );
  return command;
};

describe('preset stack commands', () => {
  it.each(['replace', 'above', 'below'] as const)(
    'applies %s as exactly one undoable edit while retaining source and stages',
    (placement) => {
      const command = service();
      const before = command.getState();
      let notifications = 0;
      command.subscribe(() => notifications++);
      command.applyPreset(recipe, placement);
      const after = command.getState();
      const expected =
        placement === 'replace'
          ? ['preset-a', 'preset-b']
          : placement === 'above'
            ? ['existing', 'preset-a', 'preset-b']
            : ['preset-a', 'preset-b', 'existing'];
      expect(after.effects.map((effect) => effect.instanceId)).toEqual(expected);
      expect(after.masterSeed).toBe(placement === 'replace' ? 90210 : 17);
      expect(after.effects.filter((effect) => effect.instanceId !== 'existing')).toEqual(
        recipe.effects,
      );
      expect(after.source).toBe(before.source);
      expect(after.origin).toBe(before.origin);
      expect(after.snapshots).toBe(before.snapshots);
      expect(after.sourceSnapshotId).toBe(before.sourceSnapshotId);
      expect(Object.isFrozen(after.effects[0]?.params)).toBe(true);
      expect(Object.isFrozen(after.effects[0]?.application)).toBe(true);
      expect(notifications).toBe(1);
      command.undo();
      expect(command.getState()).toBe(before);
      command.redo();
      expect(command.getState()).toBe(after);
    },
  );

  it('requires unique instance IDs when repeatedly inserting the same preset', () => {
    const command = service();
    command.applyPreset(recipe, 'above');
    const before = command.getState();
    expect(() => command.applyPreset(recipe, 'below')).toThrow();
    expect(command.getState()).toBe(before);
    command.applyPreset(recipe, 'below', ['copy-a', 'copy-b']);
    expect(command.getState().effects.map((effect) => effect.instanceId)).toEqual([
      'copy-a',
      'copy-b',
      'existing',
      'preset-a',
      'preset-b',
    ]);
    expect(command.getState().masterSeed).toBe(17);
    command.undo();
    expect(command.getState()).toBe(before);
  });

  it('merges by effect type, keeping current settings and adding/removing effects in one undoable edit', () => {
    const command = service();
    command.updateEffect('existing', {
      enabled: false,
      params: { amount: 0.37 },
      application: { region: 'left', coverage: 0.42, softness: 0.81 },
    });
    command.varyEffect('existing');
    command.addEffect('block-corruption', 'remove-me');
    const before = command.getState();
    const mergeRecipe = {
      masterSeed: 99,
      effects: [createEffect('spatial-crush', 'add-me'), createEffect('rgb-split', 'preset-rgb')],
    };
    let notifications = 0;
    command.subscribe(() => notifications++);
    command.applyPreset(mergeRecipe, 'merge');
    const after = command.getState();
    expect(after.effects).toEqual([mergeRecipe.effects[0], before.effects[0]]);
    expect(after.masterSeed).toBe(before.masterSeed);
    expect(after.source).toBe(before.source);
    expect(after.origin).toBe(before.origin);
    expect(after.snapshots).toBe(before.snapshots);
    expect(after.sourceSnapshotId).toBe(before.sourceSnapshotId);
    expect(notifications).toBe(1);
    command.undo();
    expect(command.getState()).toBe(before);
    command.redo();
    expect(command.getState()).toBe(after);
  });

  it('keeps every current copy of a matching type, adds all preset copies of missing types, and uses visible preset order', () => {
    const command = service();
    command.addEffect('rgb-split', 'existing-top');
    command.updateEffect('existing-top', { params: { amount: 0.25 } });
    command.addEffect('spatial-crush', 'remove-me');
    const before = command.getState();
    const mergeRecipe = {
      masterSeed: 99,
      effects: [
        createEffect('rgb-split', 'preset-rgb-bottom'),
        createEffect('block-corruption', 'new-block-bottom'),
        createEffect('block-corruption', 'new-block-top'),
        createEffect('rgb-split', 'preset-rgb-top'),
      ],
    };
    command.applyPreset(mergeRecipe, 'merge');
    expect(command.getState().effects).toEqual([
      mergeRecipe.effects[1],
      mergeRecipe.effects[2],
      before.effects[0],
      before.effects[1],
    ]);
    expect(
      command
        .getState()
        .effects.map((effect) => effect.instanceId)
        .reverse(),
    ).toEqual(['existing-top', 'existing', 'new-block-top', 'new-block-bottom']);
    command.undo();
    expect(command.getState()).toBe(before);
  });

  it('merges into an empty stack with the current seed and adds no undo entry for an identical second merge', () => {
    const command = createCommandService(createProject('Empty', 17));
    command.setSource(source);
    const before = command.getState();
    command.applyPreset(recipe, 'merge');
    const after = command.getState();
    expect(after.effects).toEqual(recipe.effects);
    expect(after.masterSeed).toBe(17);
    command.applyPreset(recipe, 'merge');
    expect(command.getState()).toBe(after);
    command.undo();
    expect(command.getState()).toBe(before);
  });

  it.each(['replace', 'merge'] as const)(
    'applies %s on a baked source without changing the source stage or its captured recipe',
    (placement) => {
      const command = service();
      command.restoreSnapshot('stage', 'source');
      command.addEffect('rgb-split', 'post-bake');
      const before = command.getState();
      command.applyPreset(recipe, placement);
      const after = command.getState();
      expect(after.sourceSnapshotId).toBe('stage');
      expect(after.source).toBe(before.source);
      expect(after.origin).toBe(before.origin);
      expect(after.snapshots).toBe(before.snapshots);
      expect(after.snapshots[0]?.effects[0]?.instanceId).toBe('existing');
      command.undo();
      expect(command.getState()).toBe(before);
    },
  );

  it('rejects malformed recipes, placement and IDs without changing state or history', () => {
    const command = service();
    const before = command.getState();
    for (const apply of [
      () => command.applyPreset({ ...recipe, masterSeed: -1 }, 'replace'),
      () => command.applyPreset({ ...recipe, effects: [] }, 'replace'),
      () => command.applyPreset({ ...recipe, effects: [null] } as unknown as PresetRecipe, 'above'),
      () => command.applyPreset(recipe, 'sideways' as PresetPlacement),
      () => command.applyPreset(recipe, 'above', ['only-one']),
      () => command.applyPreset(recipe, 'above', ['existing', 'copy-b']),
      () => command.applyPreset(recipe, 'merge', ['duplicate', 'duplicate']),
    ]) {
      expect(apply).toThrow();
      expect(command.getState()).toBe(before);
    }
    command.undo();
    expect(command.getState().snapshots).toHaveLength(0);
    expect(() =>
      createCommandService(createProject('Empty')).applyPreset(recipe, 'replace'),
    ).toThrow('Open an image');
  });
});
