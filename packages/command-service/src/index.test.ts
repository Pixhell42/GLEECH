import { describe, expect, it } from 'vitest';
import { createProject, createEffect, createPaintedMask } from '@gleech/project-model';
import { createCommandService } from './index';

describe('project command state', () => {
  it('retains immutable unchanged layers during edits without trusting shallow-frozen inputs', () => {
    const external = Object.freeze(createEffect('rgb-split', 'a'));
    const source = {
      id: 'source',
      name: 'image.png',
      width: 100,
      height: 50,
      format: 'png',
      hasAlpha: true,
    } as const;
    const service = createCommandService({ ...createProject('Test'), source, effects: [external] });
    service.addEffect('blur', 'b');
    service.setEffectMask('a', createPaintedMask(100, 50));
    const before = service.getState();
    const unchanged = before.effects[0]!;
    expect(unchanged.params).not.toBe(external.params);
    expect(Object.isFrozen(unchanged.params)).toBe(true);
    expect(Object.isFrozen(unchanged.paintedMask!.strokes)).toBe(true);
    service.beginHistoryGroup();
    service.updateEffect('b', { params: { radius: 5 } });
    service.updateEffect('b', { params: { radius: 8 } });
    service.endHistoryGroup();
    expect(service.getState().effects[0]).toBe(unchanged);
    expect(service.getState().effects[1]).not.toBe(before.effects[1]);
    service.undo();
    expect(service.getState()).toBe(before);
    service.redo();
    expect(service.getState().effects[0]).toBe(unchanged);
    const edited = service.getState();
    expect(() => service.updateEffect('b', { params: { radius: NaN } })).toThrow();
    expect(service.getState()).toBe(edited);
  });
  it('commits arbitrary drag positions once and groups coverage changes in undo history', () => {
    const service = createCommandService(createProject('Test'));
    service.setSource({
      id: 'source',
      name: 'source.png',
      width: 100,
      height: 50,
      format: 'png',
      hasAlpha: true,
    });
    for (const id of ['a', 'b', 'c', 'd']) service.addEffect('rgb-split', id);
    const original = service.getState();
    service.moveEffectTo('a', 3);
    expect(service.getState().effects.map((effect) => effect.instanceId)).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
    service.undo();
    expect(service.getState()).toBe(original);
    service.redo();
    service.updateEffect('a', { application: { region: 'top' } });
    service.beginHistoryGroup();
    service.updateEffect('a', { application: { coverage: 0.7 } });
    service.updateEffect('a', { application: { coverage: 0.4 } });
    service.endHistoryGroup();
    service.undo();
    expect(service.getState().effects[3]?.application).toEqual({
      region: 'top',
      coverage: 1,
      softness: 0,
    });
    service.redo();
    const beforeSoftness = service.getState();
    service.beginHistoryGroup();
    service.updateEffect('a', { application: { softness: 0.2 } });
    service.updateEffect('a', { application: { softness: 0.8 } });
    service.endHistoryGroup();
    service.undo();
    expect(service.getState()).toBe(beforeSoftness);
    service.redo();
    expect(service.getState().effects[3]?.application.softness).toBe(0.8);
    const before = service.getState();
    expect(Object.isFrozen(before.effects[3]?.application)).toBe(true);
    expect(() => service.updateEffect('a', { application: { coverage: NaN } })).toThrow();
    expect(() => service.updateEffect('a', { application: { softness: Infinity } })).toThrow();
    expect(() => service.moveEffectTo('a', 4)).toThrow();
    expect(service.getState()).toBe(before);
  });
  it('undoes seed and instance variations, reorder, sampling, and reset as independent edits', () => {
    const service = createCommandService(createProject('Test', 8172));
    service.setSource({
      id: 'source',
      name: 'source.png',
      width: 100,
      height: 50,
      format: 'png',
      hasAlpha: true,
    });
    service.addEffect('block-corruption', 'a');
    service.addEffect('spatial-crush', 'b');
    const original = service.getState();
    service.varyEffect('a');
    expect(service.getState().effects[0]?.seedOffset).toBe(1);
    expect(service.getState().effects[0]?.params).toEqual(original.effects[0]?.params);
    service.setSeed(4);
    service.updateEffect('b', { params: { sampling: 'random' } });
    service.moveEffect('a', 1);
    expect(service.getState().effects.map((effect) => effect.instanceId)).toEqual(['b', 'a']);
    for (let i = 0; i < 4; i++) service.undo();
    expect(service.getState()).toBe(original);
    for (let i = 0; i < 4; i++) service.redo();
    expect(service.getState().effects[1]?.seedOffset).toBe(1);
    const before = service.getState();
    expect(() => service.updateEffect('a', { params: { sampling: 'random' } })).toThrow();
    expect(service.getState()).toBe(before);
  });
  it('groups slider edits and restores image replacement, with redo cleared by a new edit', () => {
    const service = createCommandService(createProject('Test', 10));
    const image = {
      id: 'first',
      name: 'first.png',
      width: 100,
      height: 50,
      format: 'png' as const,
      hasAlpha: true,
    };
    expect(service.canUndo()).toBe(false);
    service.setSource(image);
    service.addEffect('rgb-split', 'a');
    service.beginHistoryGroup();
    service.updateEffect('a', { params: { horizontal: 2 } });
    service.updateEffect('a', { params: { horizontal: 3 } });
    service.endHistoryGroup();
    service.undo();
    expect(service.getState().effects[0]?.params).toMatchObject({ horizontal: 1 });
    service.redo();
    expect(service.getState().effects[0]?.params).toMatchObject({ horizontal: 3 });
    service.setSource({ ...image, id: 'second', name: 'second.png' });
    service.undo();
    expect(service.getState().source?.id).toBe('first');
    expect(service.retainedSourceIds()).toEqual(new Set(['first', 'second']));
    service.updateEffect('a', { enabled: false });
    expect(service.canRedo()).toBe(false);
    expect(service.retainedSourceIds()).toEqual(new Set(['first']));
    service.undo();
    service.undo();
    service.undo();
    service.undo();
    expect(service.getState().source).toBeNull();
    expect(service.canUndo()).toBe(false);
    service.redo();
    expect(service.getState().source?.id).toBe('first');
  });

  it('releases sources outside the fifty-edit history window', () => {
    const service = createCommandService(createProject('Test'));
    service.setSource({
      id: 'old',
      name: 'old.png',
      width: 1,
      height: 1,
      format: 'png',
      hasAlpha: false,
    });
    service.setSource({
      id: 'new',
      name: 'new.png',
      width: 1,
      height: 1,
      format: 'png',
      hasAlpha: false,
    });
    for (let seed = 1; seed <= 51; seed++) service.setSeed(seed);
    expect(service.retainedSourceIds()).toEqual(new Set(['new']));
    for (let index = 0; index < 50; index++) service.undo();
    expect(service.getState().masterSeed).toBe(1);
    expect(service.canUndo()).toBe(false);
  });
  it('adds, validates, reorders, toggles, and removes independent effect instances', () => {
    const service = createCommandService(createProject('Test'));
    expect(() => service.addEffect('rgb-split', 'a')).toThrow('Open an image');
    service.setSource({
      id: 'source',
      name: 'source.png',
      width: 100,
      height: 50,
      format: 'png',
      hasAlpha: true,
    });
    service.addEffect('rgb-split', 'a');
    service.addEffect('rgb-split', 'b');
    const before = service.getState();
    expect(() => service.updateEffect('a', { params: { amount: NaN } })).toThrow();
    expect(() => service.addEffect('rgb-split', 'a')).toThrow('already exists');
    expect(service.getState()).toBe(before);
    service.updateEffect('a', { enabled: false, params: { horizontal: -5 } });
    expect(before.effects[0]?.enabled).toBe(true);
    expect(Object.isFrozen(service.getState().effects[0]?.params)).toBe(true);
    service.moveEffect('a', 1);
    expect(service.getState().effects.map((effect) => effect.instanceId)).toEqual(['b', 'a']);
    expect(service.getState().effects[1]?.params).toMatchObject({ horizontal: -5 });
    service.removeEffect('b');
    expect(service.getState().effects.map((effect) => effect.instanceId)).toEqual(['a']);
  });
  it('replaces source metadata atomically while retaining the project seed', () => {
    const service = createCommandService(createProject('Test', 10));
    const before = service.getState();
    let notifications = 0;
    service.subscribe(() => notifications++);
    const source = {
      id: 'image-1',
      name: 'test.png',
      width: 10,
      height: 20,
      format: 'png' as const,
      hasAlpha: true,
    };
    service.setSource(source);
    source.width = 99;
    expect(service.getState().source?.width).toBe(10);
    expect(service.getState().masterSeed).toBe(10);
    expect(before.source).toBeNull();
    expect(notifications).toBe(1);
    expect(() => service.setSource({ ...source, width: 0 })).toThrow();
    expect(notifications).toBe(1);
  });

  it('publishes immutable state and stops notifying removed subscribers', () => {
    const service = createCommandService(createProject('Test', 10));
    const before = service.getState();
    const seen: number[] = [];
    const unsubscribe = service.subscribe(() => seen.push(service.getState().masterSeed));
    service.setSeed(11);
    service.setSeed(11);
    unsubscribe();
    service.setSeed(12);
    expect(seen).toEqual([11]);
    expect(before.masterSeed).toBe(10);
    expect(Object.isFrozen(service.getState())).toBe(true);
  });

  it('loads a validated project as a fresh immutable editing history', () => {
    const service = createCommandService(createProject('Test', 10));
    service.setSeed(11);
    const saved = service.getState();
    expect(() => service.loadProject({ ...saved, masterSeed: -1 })).toThrow();
    expect(service.getState()).toBe(saved);
    expect(service.canUndo()).toBe(true);
    service.loadProject({ ...saved, name: 'Saved project', masterSeed: 42 });
    const loaded = service.getState();
    expect(loaded.masterSeed).toBe(42);
    expect(Object.isFrozen(loaded.effects)).toBe(true);
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);
    service.setSeed(43);
    service.undo();
    expect(service.getState()).toBe(loaded);
  });

  it('rejects invalid commands without changing state or notifying the UI', () => {
    const service = createCommandService(createProject('Test', 10));
    const before = service.getState();
    let notifications = 0;
    service.subscribe(() => notifications++);
    for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000]) {
      expect(() => service.setSeed(seed)).toThrow(RangeError);
    }
    expect(service.getState()).toBe(before);
    expect(notifications).toBe(0);
  });
});
