import { describe, expect, it } from 'vitest';
import { createCommandService } from '@gleech/command-service';
import {
  createProject,
  createEffect,
  createPaintedMask,
  createImportedShader,
} from '@gleech/project-model';
import { createMcpCommands } from './commands';
import type { ShaderPackage } from '@gleech/project-model/shader-package';

const newId = 'cc1df9ce-11f8-4d4e-b209-8e997fe01ae6';
function setup() {
  const commands = createCommandService({
    ...createProject('MCP test', 8172),
    source: {
      id: 'source',
      name: 'source.png',
      width: 100,
      height: 50,
      format: 'png',
      hasAlpha: true,
    },
    effects: [createEffect('rgb-split', 'bottom'), createEffect('shader-paint-flow', 'top')],
  });
  const adapter = createMcpCommands(commands, () => newId);
  return { commands, adapter };
}
describe('MCP live command adapter', () => {
  it('records bounded GUI/MCP operations with exact before/after states and rejects expired IDs', () => {
    const { commands, adapter } = setup();
    const before = commands.getState();
    commands.setSeed(12);
    const after = commands.getState();
    const operations = adapter.execute({ action: 'list_operations' }).operations as {
      id: string;
    }[];
    expect(operations).toHaveLength(1);
    expect(adapter.operationTarget(operations[0]!.id, 'before')).toBe(before);
    expect(adapter.operationTarget(operations[0]!.id, 'after')).toBe(after);
    expect(adapter.state().operationId).toBe(operations[0]!.id);
    for (let i = 0; i < 33; i++) commands.setSeed(100 + i);
    expect(adapter.execute({ action: 'list_operations' }).operations).toHaveLength(32);
    expect(() => adapter.operationTarget(operations[0]!.id, 'before')).toThrow(/expired/);
    adapter.dispose();
  });
  it('creates, copies, inverts and disables masks atomically with locks and core geometry validation', () => {
    const { commands, adapter } = setup();
    const before = commands.getState();
    const stroke = {
      size: 20,
      shape: 'circle',
      hardness: 0.5,
      falloff: 'smooth',
      mode: 'paint',
      points: [{ x: 0.5, y: 0.5 }],
    };
    adapter.execute({
      action: 'apply_operations',
      operations: [
        { action: 'create_mask', instanceId: 'bottom', strokes: [stroke] },
        { action: 'invert_mask', instanceId: 'bottom' },
        { action: 'set_mask_enabled', instanceId: 'bottom', enabled: false },
      ],
    });
    const mask = commands.getState().effects[0]!.paintedMask!;
    expect(mask).toMatchObject({
      width: 100,
      height: 50,
      enabled: false,
      inverted: true,
      strokes: [stroke],
    });
    expect(adapter.execute({ action: 'list_masks' })).toHaveProperty(
      'masks.0.instanceId',
      'bottom',
    );
    expect(adapter.execute({ action: 'get_effect_mask', instanceId: 'bottom' }).mask).toEqual(mask);
    commands.undo();
    expect(commands.getState()).toBe(before);
    adapter.execute({
      action: 'apply_operations',
      operations: [{ action: 'set_effect_mask', instanceId: 'top', mask }],
    });
    const copied = commands.getState();
    expect(copied.effects[1]!.paintedMask).toEqual(mask);
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [
          {
            action: 'set_effect_mask',
            instanceId: 'bottom',
            mask: { ...mask, strokes: [{ ...stroke, points: [{ x: 9, y: 0.5 }] }] },
          },
        ],
      }),
    ).toThrow();
    expect(commands.getState()).toBe(copied);
    commands.setEffectLocked('top', true);
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [{ action: 'invert_mask', instanceId: 'top' }],
      }),
    ).toThrow(/locked/);
  });
  it('maps semantic controls into valid visible parameters, respects locks, and is independent of input key order', () => {
    const { commands, adapter } = setup();
    commands.setEffectLocked('top', true);
    const before = commands.getState();
    adapter.execute({
      action: 'apply_operations',
      operations: [
        {
          action: 'set_semantic_controls',
          controls: { corruption: 0.2, structure_preservation: 0.7, background_isolation: 0.4 },
        },
      ],
    });
    expect(commands.getState().effects[0]).toMatchObject({
      params: { amount: 0.3 },
      application: { region: 'background', coverage: 0.4 },
    });
    expect(commands.getState().effects[1]).toBe(before.effects[1]);
    const first = commands.getState();
    commands.undo();
    adapter.execute({
      action: 'apply_operations',
      operations: [
        {
          action: 'set_semantic_controls',
          controls: { background_isolation: 0.4, structure_preservation: 0.7, corruption: 0.2 },
        },
      ],
    });
    expect(commands.getState()).toEqual(first);
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [{ action: 'set_semantic_controls', controls: { corruption: 2 } }],
      }),
    ).toThrow();
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [{ action: 'set_semantic_controls', controls: { invented: 0.5 } }],
      }),
    ).toThrow();
  });
  it('matches every UI preset placement and groups preset plus parameter edits into one history entry', () => {
    const preset = {
      schemaVersion: 1 as const,
      id: 'preset',
      name: 'Test preset',
      createdAt: '2026-10-11T00:00:00Z',
      thumbnail: 'data:image/png;base64,aGVsbG8=',
      masterSeed: 99,
      effects: [createEffect('scanlines', 'preset-lines')],
    };
    for (const placement of ['replace', 'above', 'below', 'merge'] as const) {
      const { commands, adapter } = setup();
      const before = commands.getState();
      const expected = createCommandService(before);
      expected.applyPreset(preset, placement, [newId]);
      expected.updateEffect(newId, { params: { amount: 0.4 } });
      adapter.execute(
        {
          action: 'apply_operations',
          operations: [
            { action: 'apply_preset', presetId: preset.id, placement, instanceIds: [newId] },
            { action: 'set_parameters', instanceId: newId, parameters: { amount: 0.4 } },
          ],
        },
        { presets: [preset] },
      );
      expect(commands.getState()).toEqual(expected.getState());
      expect(adapter.state().revision).toBe(1);
      commands.undo();
      expect(commands.getState()).toBe(before);
      expect(commands.canUndo()).toBe(false);
    }
  });
  it('round trips exact recipes and rejects invalid/missing recipes without losing Undo or Redo', () => {
    const { commands, adapter } = setup();
    commands.setEffectMask('top', createPaintedMask(100, 50));
    const recipe = adapter.execute({ action: 'get_style_recipe' }).recipe;
    const before = commands.getState();
    adapter.execute({
      action: 'apply_operations',
      operations: [
        { action: 'clear_effect_stack' },
        { action: 'apply_style_recipe', recipe, placement: 'replace' },
      ],
    });
    expect(commands.getState()).toEqual(before);
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [{ action: 'apply_preset', presetId: 'missing', placement: 'replace' }],
      }),
    ).toThrow(/Preset does not exist/);
    expect(commands.getState()).toEqual(before);
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [
          {
            action: 'apply_style_recipe',
            recipe: { masterSeed: 1, effects: [{ type: 'fake' }] },
            placement: 'replace',
          },
        ],
      }),
    ).toThrow();
  });
  it('uses the same seeded GLEECH generator as the UI and preserves locked layers in each retention mode', () => {
    for (const mode of [
      'replace-all',
      'keep-locked',
      'keep-all-add',
      'randomize-add',
      'existing-only',
    ] as const) {
      const { commands, adapter } = setup();
      commands.setEffectLocked('top', true);
      const before = commands.getState();
      const expected = createCommandService(before);
      expected.gleech({ complexity: 'simple', mode, seed: 4242 });
      adapter.execute({
        action: 'apply_operations',
        operations: [{ action: 'randomize', complexity: 'simple', mode, seed: 4242 }],
      });
      expect(commands.getState()).toEqual(expected.getState());
      if (mode !== 'replace-all')
        expect(commands.getState().effects.find((effect) => effect.instanceId === 'top')).toEqual(
          before.effects[1],
        );
      commands.undo();
      expect(commands.getState()).toBe(before);
    }
  });
  it('returns nine distinct variation handles, keeps locks, rejects superseded/stale selections and applies with Undo', () => {
    const { commands, adapter } = setup();
    commands.setEffectLocked('top', true);
    const before = commands.getState();
    const first = adapter.execute({ action: 'create_variation', seed: 8, intensity: 0.5 })
      .variations as { id: string; similarity: string }[];
    expect(first.map((candidate) => candidate.similarity)).toEqual([
      'close',
      'close',
      'close',
      'medium',
      'medium',
      'medium',
      'distant',
      'distant',
      'distant',
    ]);
    expect(new Set(first.map((candidate) => candidate.id)).size).toBe(9);
    const expected = adapter.variation(first[8]!.id);
    expect(expected.effects[1]).toBe(before.effects[1]);
    const second = adapter.execute({ action: 'create_variation', seed: 8, intensity: 0.5 })
      .variations as { id: string }[];
    expect(() => adapter.variation(first[8]!.id)).toThrow(/does not exist/);
    expect(adapter.variation(second[8]!.id).effects).toEqual(expected.effects);
    adapter.execute({ action: 'apply_variation', variationId: second[8]!.id });
    expect(commands.getState().effects).toEqual(expected.effects);
    commands.undo();
    expect(commands.getState()).toBe(before);
    commands.setSeed(9);
    expect(() => adapter.variation(second[8]!.id)).toThrow(/project changed/);
  });
  it('uses visible stack order and exposes actual values and parameter units', () => {
    const { commands, adapter } = setup();
    commands.updateEffect('top', { params: { viscosity: 0.2 } });
    expect(adapter.state().effects.map((effect) => [effect.instanceId, effect.index])).toEqual([
      ['top', 0],
      ['bottom', 1],
    ]);
    expect(adapter.state().effects[0]!.parameters).toMatchObject({ viscosity: 0.2 });
    expect(
      adapter.execute({ action: 'get_effect_parameters', instanceId: 'top' }).values,
    ).toMatchObject({ viscosity: 0.2 });
    expect(
      adapter.execute({ action: 'list_effect_types', type: 'shader-paint-flow' }),
    ).toHaveProperty('parameters.viscosity.min', 0);
  });
  it('applies mixed operations atomically with one notification and one Undo/Redo', () => {
    const { commands, adapter } = setup();
    let notifications = 0;
    commands.subscribe(() => notifications++);
    const before = commands.getState();
    adapter.execute({
      action: 'apply_operations',
      expectedRevision: 0,
      operations: [
        { action: 'add_effect', type: 'scanlines', instanceId: newId },
        {
          action: 'set_parameters',
          instanceId: newId,
          parameters: { amount: 0.4, 'application.region': 'left', 'application.coverage': 0.25 },
        },
        { action: 'move_effect', instanceId: 'bottom', index: 0 },
        { action: 'set_enabled', instanceId: 'top', enabled: false },
        { action: 'set_master_seed', seed: 100 },
      ],
    });
    expect(notifications).toBe(1);
    expect(adapter.state().revision).toBe(1);
    expect(adapter.state().effects[0]!.instanceId).toBe('bottom');
    expect(commands.getState().effects.find((effect) => effect.instanceId === newId)).toMatchObject(
      { params: { amount: 0.4 }, application: { region: 'left', coverage: 0.25 } },
    );
    const after = commands.getState();
    adapter.execute({ action: 'undo', expectedRevision: 1 });
    expect(commands.getState()).toBe(before);
    expect(commands.canUndo()).toBe(false);
    adapter.execute({ action: 'redo', expectedRevision: 2 });
    expect(commands.getState()).toBe(after);
  });
  it('leaves the stack and existing redo history untouched when any operation is invalid', () => {
    const { commands, adapter } = setup();
    commands.setSeed(99);
    commands.undo();
    const before = commands.getState();
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [
          { action: 'add_effect', type: 'blur' },
          { action: 'set_parameters', instanceId: 'top', parameters: { viscosity: 5 } },
        ],
      }),
    ).toThrow();
    expect(commands.getState()).toBe(before);
    expect(commands.canRedo()).toBe(true);
    expect(adapter.state().revision).toBe(2);
  });
  it('rejects stale revisions after GUI edits, invalid IDs, unknown parameters and proto keys', () => {
    const { commands, adapter } = setup();
    commands.setSeed(9);
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        expectedRevision: 0,
        operations: [{ action: 'remove_effect', instanceId: 'top' }],
      }),
    ).toThrow(/Project changed/);
    for (const operation of [
      { action: 'remove_effect', instanceId: 'missing' },
      { action: 'move_effect', instanceId: 'top', index: 7 },
      { action: 'set_parameters', instanceId: 'top', parameters: { nonsense: 3 } },
      { action: 'set_parameters', instanceId: 'top', parameters: { 'application.nonsense': 3 } },
      { action: 'set_parameters', instanceId: 'top', parameters: JSON.parse('{"__proto__":1}') },
      { action: 'add_effect', type: '__proto__' },
    ])
      expect(() =>
        adapter.execute({ action: 'apply_operations', operations: [operation] }),
      ).toThrow();
  });
  it('preserves locks until explicit unlock and generates IDs for duplication', () => {
    const { commands, adapter } = setup();
    commands.setEffectLocked('top', true);
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [{ action: 'randomize_effect', instanceId: 'top' }],
      }),
    ).toThrow(/locked/);
    adapter.execute({
      action: 'apply_operations',
      operations: [
        { action: 'set_locked', instanceId: 'top', locked: false },
        { action: 'randomize_effect', instanceId: 'top' },
        { action: 'duplicate_effect', instanceId: 'top' },
      ],
    });
    expect(adapter.state().effects[0]!.instanceId).toBe(newId);
    expect(adapter.state().effects[0]!.seedOffset).toBe(1);
  });
  it('does not expose large mask strokes or embedded shader source', () => {
    const { commands, adapter } = setup();
    commands.setEffectMask('top', createPaintedMask(100, 50));
    const shader: ShaderPackage = {
      format: 'gleech-shader',
      schemaVersion: 1,
      id: 'example',
      version: '1.0.0',
      kind: 'image',
      entryPoint: 'gleechShade',
      name: 'Test',
      description: 'Test',
      authors: [{ name: 'GLEECH' }],
      license: { expression: 'GPL-3.0-or-later' },
      language: 'wgsl',
      source: 'fn gleechShade(context: GleechShaderContext) -> vec4f { return context.color; }',
      controls: [],
    };
    commands.addShader(shader, 'imported');
    const text = JSON.stringify(adapter.state());
    expect(text).not.toContain('gleechShade');
    expect(text).not.toContain('points');
    expect(
      adapter.execute({ action: 'get_effect_parameters', instanceId: 'imported' }),
    ).toHaveProperty('parameters');
    expect(createImportedShader(shader, 'unused').type).toBe('shader-import');
  });
  it('requires an image, bounds batch size and supports all built-in catalogue definitions', () => {
    const adapter = createMcpCommands(createCommandService(createProject('Empty')));
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: [{ action: 'add_effect', type: 'blur' }],
      }),
    ).toThrow(/Open an image/);
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        operations: Array.from({ length: 65 }, () => ({ action: 'set_master_seed', seed: 1 })),
      }),
    ).toThrow();
    const catalogue = adapter.execute({ action: 'list_effect_types' }).effects as {
      type: string;
    }[];
    for (const effect of catalogue)
      expect(() =>
        adapter.execute({ action: 'list_effect_types', type: effect.type }),
      ).not.toThrow();
  });
});
