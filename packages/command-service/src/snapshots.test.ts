import { describe, expect, it } from 'vitest';
import { assertProject, createProject, projectSources } from '@gleech/project-model';
import { createCommandService } from './index';

const source = {
  id: 'original',
  name: 'original.png',
  width: 11,
  height: 7,
  format: 'png' as const,
  hasAlpha: true,
};
const output = (id: string) => ({ ...source, id, name: id + '.png' });
const time = '2026-10-03T19:00:00.000Z';
describe('snapshot stages and branches', () => {
  it('restores feedback, gradient stops and reusable depth recipes after baking and reopening', () => {
    const commands = createCommandService(createProject('Fields', 42));
    commands.setSource(source);
    commands.addEffect('feedback-bloom', 'feedback');
    commands.addEffect('gradient-map', 'gradient');
    commands.addEffect('depth-field', 'depth');
    commands.addEffect('compression-breakup', 'damage');
    commands.updateEffect('damage', {
      params: { damageMode: 'coefficient-loss', damageDensity: 0.7, colorResolution: 'quarter' },
    });
    commands.addEffect('blur', 'focus');
    commands.addEffect('recursive-space', 'space');
    commands.updateEffect('focus', {
      params: {
        style: 'depth',
        fieldSource: 'simplex',
        fieldSeed: 54321,
        focusPosition: 0.7,
        focusRange: 0.1,
        focusFalloff: 0.3,
      },
    });
    commands.updateEffect('space', {
      params: {
        fieldEnabled: 'on',
        fieldSource: 'simplex',
        fieldSeed: 54321,
        fieldRepetition: -0.4,
        fieldImageScale: 0.3,
        fieldDistortion: 12,
      },
    });
    commands.updateEffect('gradient', {
      params: {
        shadowsStops: JSON.stringify([
          { position: 0, color: '#000000' },
          { position: 0.3, color: '#ffaa00' },
          { position: 1, color: '#ffffff' },
        ]),
      },
    });
    commands.updateEffect('depth', {
      params: { fieldSource: 'simplex', fieldSeed: 54321, fieldNormalize: 'on' },
    });
    commands.setEffectLocked('depth', true);
    const recipe = commands.getState().effects;
    commands.captureSnapshot('fields', 'Fields', output('fields-render'), time, true);
    commands.loadProject(JSON.parse(JSON.stringify(commands.getState())));
    commands.restoreSnapshot('fields', 'recipe');
    expect(commands.getState().effects).toEqual(recipe);
    expect(commands.getState().source?.id).toBe(source.id);
    commands.undo();
    expect(commands.getState().source?.id).toBe('fields-render');
    expect(commands.getState().effects).toEqual([]);
  });
  it('bakes atomically, restores both recipes and forks without overwriting descendants', () => {
    const commands = createCommandService(createProject('Test', 42));
    commands.setSource(source);
    commands.addEffect('block-corruption', 'stable-a');
    commands.updateEffect('stable-a', {
      application: { region: 'subject', coverage: 0.54, softness: 0.67 },
    });
    commands.varyEffect('stable-a');
    const firstRecipe = commands.getState();
    commands.captureSnapshot('a', 'First', output('render-a'), time, true);
    expect(commands.getState().effects).toEqual([]);
    expect(commands.getState().sourceSnapshotId).toBe('a');
    const baked = commands.getState();
    commands.undo();
    expect(commands.getState()).toBe(firstRecipe);
    commands.redo();
    expect(commands.getState()).toBe(baked);
    commands.addEffect('spatial-crush', 'stable-b');
    commands.setSeed(71);
    commands.captureSnapshot('b', 'Second', output('render-b'), time, false);
    const second = commands.getState().snapshots[1]!;
    expect(second.parentId).toBe('a');
    commands.restoreSnapshot('a', 'recipe');
    expect(commands.getState().effects).toEqual(firstRecipe.effects);
    expect(commands.getState().masterSeed).toBe(42);
    expect(commands.getState().source?.id).toBe('original');
    commands.setSeed(43);
    commands.captureSnapshot('c', 'First variation', output('render-c'), time, true);
    expect(commands.getState().snapshots[1]).toBe(second);
    expect(commands.getState().snapshots[2]?.parentId).toBeNull();
    commands.restoreSnapshot('b', 'recipe');
    expect(commands.getState().sourceSnapshotId).toBe('a');
    expect(commands.getState().source?.id).toBe('render-a');
    expect(commands.getState().masterSeed).toBe(71);
    commands.restoreSnapshot('a', 'source');
    commands.addEffect('rgb-split', 'branch-d');
    commands.captureSnapshot('d', 'Second variation', output('render-d'), time, false);
    expect(commands.getState().snapshots[3]?.parentId).toBe('a');
    expect(commands.getState().snapshots[1]).toBe(second);
    commands.restoreOrigin();
    expect(commands.getState().source).toEqual(source);
    expect(commands.getState().effects).toEqual([]);
    expect(commands.getState().snapshots).toHaveLength(4);
  });
  it('deep freezes loaded recipes, retains all stage assets beyond undo and rejects damaged graphs atomically', () => {
    const commands = createCommandService(createProject('Test'));
    commands.setSource(source);
    commands.addEffect('rgb-split', 'effect');
    commands.captureSnapshot('a', 'A', output('render-a'), time, true);
    commands.addEffect('rgb-split', 'next');
    commands.captureSnapshot('b', 'B', output('render-b'), time, true);
    const project = JSON.parse(JSON.stringify(commands.getState()));
    commands.loadProject(project);
    project.snapshots[0]!.effects[0]!.application.softness = 0.4;
    expect(commands.getState().snapshots[0]?.effects[0]?.application.softness).toBe(0);
    for (let seed = 1; seed <= 51; seed++) commands.setSeed(seed);
    expect(commands.retainedSourceIds()).toEqual(new Set(['original', 'render-a', 'render-b']));
    const before = commands.getState();
    expect(() =>
      commands.captureSnapshot('a', 'Duplicate', output('duplicate'), time, false),
    ).toThrow();
    expect(() => commands.renameSnapshot('a', ' ')).toThrow();
    expect(commands.getState()).toBe(before);
    commands.renameSnapshot('a', 'Renamed');
    expect(commands.getState().snapshots[1]?.parentId).toBe('a');
    commands.undo();
    expect(commands.getState()).toBe(before);
    const bad = {
      ...before,
      snapshots: [{ ...before.snapshots[0]!, parentId: 'b' }, before.snapshots[1]!],
    };
    expect(() => assertProject(bad)).toThrow('lineage');
    expect(() => assertProject({ ...before, sourceSnapshotId: 'a' })).toThrow('lineage');
    expect(() => commands.loadProject(bad)).toThrow();
    expect(commands.getState()).toBe(before);
    expect(projectSources(before).length).toBe(3);
  });
});
