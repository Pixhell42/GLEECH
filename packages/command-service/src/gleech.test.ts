import { describe, expect, it } from 'vitest';
import {
  EFFECT_DEFINITIONS,
  getEffectDefinition,
  assertEffect,
  createEffect,
  createProject,
  createPaintedMask,
  ADVANCED_SHADER_TYPES,
  type EffectType,
} from '@gleech/project-model';
import {
  createCommandService,
  generateGleechStack,
  generateVariations,
  type GleechComplexity,
} from './index';

const types = Object.keys(EFFECT_DEFINITIONS) as EffectType[];
it('keeps optional 3D composition stable in close Set 2 variations and preserves locks', () => {
  const stack = ADVANCED_SHADER_TYPES.map((type, i) => createEffect(type, `advanced-${i}`));
  for (const e of stack) if ('objects' in e.params) Object.assign(e.params, { objects: 'on' });
  const locked = { ...stack[0]!, locked: true };
  stack[0] = locked;
  for (const candidate of generateVariations(stack, 8172, 1).slice(0, 3)) {
    expect(candidate.effects[0]).toBe(locked);
    candidate.effects.forEach((e, i) => {
      assertEffect(e);
      const original = stack[i]!;
      if ('objects' in e.params && 'objects' in original.params)
        expect(e.params.objects).toBe(original.params.objects);
    });
  }
});
it('preserves user-written glyph text and custom symbol sets in all variation candidates', () => {
  const glyph = createEffect('glyph', 'glyph');
  Object.assign(glyph.params, {
    style: 'custom-text',
    text: 'KEEP ME',
    glyphSet: ' .▲█',
    emojiSet: '😀⭐',
  });
  for (const variation of generateVariations([glyph], 453, 1))
    expect(variation.effects[0]!.params).toMatchObject({
      text: 'KEEP ME',
      glyphSet: ' .▲█',
      emojiSet: '😀⭐',
    });
});
const source = {
  id: 'image',
  name: 'fixture.png',
  width: 31,
  height: 19,
  format: 'png' as const,
  hasAlpha: true,
};
const all = () => types.map((type, index) => createEffect(type, 'effect-' + index));
function commands() {
  const service = createCommandService(createProject('GLEECH', 124));
  service.setSource(source);
  service.addEffect('wave-distortion', 'wave');
  service.addEffect('noise-grain', 'noise');
  service.setEffectMask('wave', createPaintedMask(31, 19));
  service.setEffectLocked('wave', true);
  return service;
}
describe('GLEECH and Var', () => {
  it('keeps all existing recipes and adds fresh effects above them at each complexity', () => {
    const stack = commands().getState().effects;
    for (const [complexity, min, max] of [
      ['simple', 2, 3],
      ['complex', 5, 7],
      ['gleeched', 9, 12],
    ] as const) {
      const options = { complexity, mode: 'keep-all-add' as const, seed: 124 };
      const generated = generateGleechStack(stack, options);
      stack.forEach((effect, index) => expect(generated[index]).toBe(effect));
      const additions = generated.slice(stack.length);
      expect(additions.length).toBeGreaterThanOrEqual(min);
      expect(additions.length).toBeLessThanOrEqual(max);
      expect(additions.every((effect) => !effect.locked && effect.enabled)).toBe(true);
      expect(generated).toEqual(generateGleechStack(stack, options));
      const again = generateGleechStack(generated, options);
      expect(again.slice(0, generated.length)).toEqual(generated);
      expect(new Set(again.map((effect) => effect.instanceId)).size).toBe(again.length);
    }
  });
  it('keeps every effect even when all are locked, and undoes additions as one edit', () => {
    const service = commands();
    service.setEffectLocked('noise', true);
    const original = service.getState();
    service.gleech({ complexity: 'simple', mode: 'keep-all-add', seed: 83 });
    const generated = service.getState();
    expect(generated.effects.slice(0, original.effects.length)).toEqual(original.effects);
    expect(generated.effects.length).toBeGreaterThan(original.effects.length);
    expect(generated.masterSeed).toBe(original.masterSeed);
    service.undo();
    expect(service.getState()).toBe(original);
    service.redo();
    expect(service.getState()).toBe(generated);
  });
  it('randomizes unlocked recipes while preserving membership, masks, locks and order before adding effects', () => {
    const stack = all().map((effect, index) => ({
      ...effect,
      enabled: index % 2 === 0,
      paintedMask: createPaintedMask(31, 19),
      locked: index % 4 === 0,
    }));
    const before = JSON.stringify(stack);
    for (const [complexity, min, max] of [
      ['simple', 2, 3],
      ['complex', 5, 7],
      ['gleeched', 9, 12],
    ] as const) {
      const options = { complexity, mode: 'randomize-add' as const, seed: 988 };
      const generated = generateGleechStack(stack, options);
      const retained = generated.slice(0, stack.length);
      expect(
        retained.map((effect) => [
          effect.instanceId,
          effect.type,
          effect.enabled,
          effect.paintedMask,
        ]),
      ).toEqual(
        stack.map((effect) => [effect.instanceId, effect.type, effect.enabled, effect.paintedMask]),
      );
      stack.forEach((effect, index) => {
        if (effect.locked) expect(retained[index]).toBe(effect);
      });
      expect(
        retained.some(
          (effect, index) =>
            !effect.locked &&
            JSON.stringify(effect.params) !== JSON.stringify(stack[index]!.params),
        ),
      ).toBe(true);
      const added = generated.slice(stack.length);
      expect(added.length).toBeGreaterThanOrEqual(min);
      expect(added.length).toBeLessThanOrEqual(max);
      expect(added.every((effect) => effect.enabled && !effect.locked)).toBe(true);
      expect(new Set(generated.map((effect) => effect.instanceId)).size).toBe(generated.length);
      expect(generated).toEqual(generateGleechStack(stack, options));
    }
    expect(JSON.stringify(stack)).toBe(before);
  });
  it('undoes randomization and additions together without changing the project seed', () => {
    const service = commands(),
      original = service.getState();
    service.gleech({ complexity: 'complex', mode: 'randomize-add', seed: 83 });
    const generated = service.getState();
    expect(generated.masterSeed).toBe(original.masterSeed);
    expect(generated.effects[0]).toEqual(original.effects[0]);
    expect(generated.effects[1]!.params).not.toEqual(original.effects[1]!.params);
    expect(generated.effects.length).toBeGreaterThan(original.effects.length);
    service.undo();
    expect(service.getState()).toBe(original);
    service.redo();
    expect(service.getState()).toBe(generated);
  });
  it('creates distinct deterministic stacks at each complexity, with fresh unlocked IDs', () => {
    for (const complexity of ['simple', 'complex', 'gleeched'] as const) {
      const generated = generateGleechStack([], { complexity, mode: 'replace-all', seed: 124 });
      expect(generated).toEqual(
        generateGleechStack([], { complexity, mode: 'replace-all', seed: 124 }),
      );
      const [min, max] =
        complexity === 'simple' ? [2, 3] : complexity === 'complex' ? [5, 7] : [9, 12];
      expect(generated.length).toBeGreaterThanOrEqual(min!);
      expect(generated.length).toBeLessThanOrEqual(max!);
      expect(new Set(generated.map((effect) => effect.instanceId)).size).toBe(generated.length);
      expect(new Set(generated.map((effect) => effect.type)).size).toBe(generated.length);
      expect(generated.every((effect) => !effect.locked)).toBe(true);
      expect(generated).not.toEqual(
        generateGleechStack([], { complexity, mode: 'replace-all', seed: 125 }),
      );
    }
  });
  it('keeps locked effects byte-for-byte in order, and replaces even locks in Replace All', () => {
    const stack = all().map((effect, index) =>
      index % 3 === 0
        ? { ...effect, locked: true, paintedMask: createPaintedMask(31, 19) }
        : effect,
    );
    const locked = stack.filter((effect) => effect.locked);
    for (let seed = 0; seed < 40; seed++) {
      const retained = generateGleechStack(stack, {
        complexity: 'complex',
        mode: 'keep-locked',
        seed,
      });
      expect(retained.filter((effect) => effect.locked)).toEqual(locked);
      for (const effect of locked)
        expect(retained.find((candidate) => candidate.instanceId === effect.instanceId)).toBe(
          effect,
        );
      const replaced = generateGleechStack(stack, {
        complexity: 'simple',
        mode: 'replace-all',
        seed,
      });
      expect(
        replaced.some((effect) =>
          stack.some((original) => original.instanceId === effect.instanceId),
        ),
      ).toBe(false);
      expect(replaced.some((effect) => effect.locked)).toBe(false);
    }
  });
  it('uses only existing effects without changing IDs, types, order, masks or enabled state', () => {
    const stack = all().map((effect, index) => ({
      ...effect,
      enabled: index % 2 === 0,
      paintedMask: createPaintedMask(31, 19),
      locked: index % 4 === 0,
    }));
    const generated = generateGleechStack(stack, {
      complexity: 'gleeched',
      mode: 'existing-only',
      seed: 988,
    });
    expect(
      generated.map((effect) => [
        effect.instanceId,
        effect.type,
        effect.enabled,
        effect.paintedMask,
      ]),
    ).toEqual(
      stack.map((effect) => [effect.instanceId, effect.type, effect.enabled, effect.paintedMask]),
    );
    expect(
      generated.some(
        (effect, index) =>
          !effect.locked && JSON.stringify(effect.params) !== JSON.stringify(stack[index]!.params),
      ),
    ).toBe(true);
    for (let index = 0; index < stack.length; index++)
      if (stack[index]!.locked) expect(generated[index]).toBe(stack[index]);
  });
  it.each(Array.from({ length: 8 }, (_, i) => [i * 10, i * 10 + 10] as const))(
    'produces valid recipes across every effect, policy and intensity for seeds %i–%i without mutating inputs',
    (start, end) => {
      const stack = all();
      const snapshot = JSON.stringify(stack);
      for (let seed = start; seed < end; seed++) {
        for (const complexity of ['simple', 'complex', 'gleeched'] as const) {
          for (const mode of [
            'replace-all',
            'keep-locked',
            'keep-all-add',
            'randomize-add',
            'existing-only',
          ] as const)
            for (const effect of generateGleechStack(stack, { complexity, mode, seed }))
              expect(() => assertEffect(effect)).not.toThrow();
        }
        for (const intensity of [0, 0.25, 0.5, 1])
          for (const candidate of generateVariations(stack, seed, intensity))
            for (const effect of candidate.effects)
              expect(() => assertEffect(effect)).not.toThrow();
      }
      expect(JSON.stringify(stack)).toBe(snapshot);
    },
    30000,
  );
  it('makes lock toggles, GLEECH and selecting Var one undoable edit each', () => {
    const service = commands();
    const original = service.getState();
    service.gleech({ complexity: 'complex', mode: 'keep-locked', seed: 86 });
    const generated = service.getState();
    expect(generated.masterSeed).toBe(original.masterSeed);
    expect(generated.effects.find((effect) => effect.instanceId === 'wave')).toEqual(
      original.effects[0],
    );
    service.undo();
    expect(service.getState()).toBe(original);
    service.redo();
    expect(service.getState()).toBe(generated);
    const candidates = generateVariations(generated.effects, 778, 0.7);
    expect(service.getState()).toBe(generated);
    service.applyVariation(candidates[8]!.effects);
    const varied = service.getState();
    expect(varied.masterSeed).toBe(original.masterSeed);
    service.undo();
    expect(service.getState()).toBe(generated);
    service.redo();
    expect(service.getState()).toBe(varied);
    service.setEffectLocked('wave', false);
    expect(service.getState().effects.find((effect) => effect.instanceId === 'wave')!.locked).toBe(
      false,
    );
    service.undo();
    expect(service.getState()).toBe(varied);
    service.updateEffect('wave', { params: { frequency: 7 } });
    expect(
      service.getState().effects.find((effect) => effect.instanceId === 'wave')!.params,
    ).toMatchObject({ frequency: 7 });
  });
  it('offers nine candidates with the agreed rows and stable identities while the slider changes', () => {
    const fullStack = all();
    for (const candidate of generateVariations(fullStack, 445, 1).slice(0, 3)) {
      candidate.effects.forEach((effect, index) => {
        const original = fullStack[index]!;
        expect(effect.seedOffset).toBe(original.seedOffset);
        for (const [key, def] of Object.entries(getEffectDefinition(effect).parameters))
          if (def.kind === 'choice')
            expect((effect.params as Record<string, number | string>)[key]).toBe(
              (original.params as Record<string, number | string>)[key],
            );
      });
    }
    const stack = commands().getState().effects;
    const low = generateVariations(stack, 223, 0.2);
    const high = generateVariations(stack, 223, 0.8);
    expect(low.map((candidate) => candidate.similarity)).toEqual([
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
    expect(low.map((candidate) => candidate.id)).toEqual(high.map((candidate) => candidate.id));
    expect(high).toEqual(generateVariations(stack, 223, 0.8));
    expect(high).not.toEqual(generateVariations(stack, 224, 0.8));
    for (const candidate of [...low, ...high]) expect(candidate.effects[0]).toBe(stack[0]);
    for (const candidate of generateVariations(stack, 223, 0))
      expect(candidate.effects).toEqual(stack);
    const service = commands(),
      before = service.getState();
    service.applyVariation(generateVariations(before.effects, 224, 0)[0]!.effects);
    expect(service.getState()).toBe(before);
    const wave = [createEffect('wave-distortion', 'wave')];
    const gentle = generateVariations(wave, 443, 0.25),
      stronger = generateVariations(wave, 443, 0.75);
    gentle.forEach((candidate, index) => {
      const a = Number(candidate.effects[0]!.params.amount) - 1;
      const b = Number(stronger[index]!.effects[0]!.params.amount) - 1;
      expect(Math.abs(b)).toBeGreaterThanOrEqual(Math.abs(a));
      expect(a * b).toBeGreaterThanOrEqual(0);
    });
  });
  it('rejects changed membership or locks and bad input without creating history', () => {
    const service = commands(),
      before = service.getState();
    const candidates = generateVariations(before.effects, 345, 0.5);
    expect(() => service.applyVariation(candidates[0]!.effects.slice(1))).toThrow();
    expect(() =>
      service.applyVariation(
        candidates[0]!.effects.map((effect) => ({ ...effect, locked: false })),
      ),
    ).toThrow();
    expect(() =>
      service.applyVariation(
        candidates[0]!.effects.map((effect) => ({ ...effect, seedOffset: 334 })),
      ),
    ).toThrow();
    expect(service.getState()).toBe(before);
    expect(() => generateVariations(before.effects, 0, 1.01)).toThrow();
    expect(() => generateVariations(before.effects, -1, 0.5)).toThrow();
    expect(() =>
      generateGleechStack([], {
        complexity: 'bad' as GleechComplexity,
        mode: 'replace-all',
        seed: 1,
      }),
    ).toThrow();
    expect(() => assertEffect({ ...before.effects[0]!, locked: 1 } as never)).toThrow();
    const empty = createCommandService(createProject('Empty'));
    expect(() => empty.gleech({ complexity: 'simple', mode: 'replace-all', seed: 123 })).toThrow();
  });
});
