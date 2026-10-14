import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createImportedShader,
  createProject,
  assertEffect,
  getEffectDefinition,
  importedShaderValues,
  type ImportedShaderEffect,
} from '@gleech/project-model';
import { assertExecutableShader, type ShaderPackage } from '@gleech/project-model/shader-package';
import {
  renderEffects,
  renderEffectsAsync,
  importedShaderInvocation,
} from '../../effects/src/index';
import {
  createCommandService,
  copySettings,
  encodeSettings,
  decodeSettings,
  resetSettings,
  pastedSettings,
  generateVariations,
} from './index';

const sample = (): ShaderPackage =>
  JSON.parse(
    readFileSync(
      new URL('../../../apps/desktop/resources/shaders/prism-weave.gleech-shader', import.meta.url),
      'utf8',
    ),
  );
const image = () => ({
  width: 2,
  height: 1,
  pixels: Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255]).buffer,
});
function service() {
  const commands = createCommandService(createProject('Imported shader', 8172));
  commands.setSource({
    id: 'image',
    name: 'image.png',
    width: 2,
    height: 1,
    format: 'png',
    hasAlpha: true,
  });
  return commands;
}
describe('executable imported shaders', () => {
  it('exposes declared controls and shared finishing, and isolates the original package', () => {
    const pkg = sample(),
      effect = createImportedShader(pkg, 'a');
    expect(() => assertEffect(effect)).not.toThrow();
    expect(getEffectDefinition(effect).parameters.shader_density?.label).toBe('Weave density');
    expect(getEffectDefinition(effect).parameters.amount?.label).toBe('Opacity');
    expect(importedShaderValues(effect)).toEqual({
      density: 5,
      bend: 0.035,
      style: 'gold',
      ink: '#f1cc6b',
      light: 0.5,
    });
    (pkg as { name: string }).name = 'Mutated';
    expect(effect.shader.name).toBe('Prism Weave');
    expect(() =>
      assertEffect({ ...effect, params: { ...effect.params, shader_style: 'unknown' } }),
    ).toThrow();
    expect(() =>
      assertEffect({ ...effect, params: { ...effect.params, shader_density: 25 } }),
    ).toThrow();
  });
  it.each([
    'loop {}',
    'for (var i=0; i<10; i++) {}',
    'let x = textureLoad(gleechInput, vec2i(0), 0);',
    'let x = gleechSettings;',
    'let x = unknownFunction(0.0);',
    'return context.source; } fn helper() -> f32 { return 0.0;',
    'let x = array<f32, 2>(0.0, 1.0);',
    Array.from({ length: 100 }, (_, i) => `let x${i} = sin(0.0);`).join('\n'),
    ' '.repeat(4096) + 'return context.source;',
  ])('rejects work outside the initial bounded runtime: %s', (body) => {
    const pkg = sample();
    expect(() =>
      assertExecutableShader({
        ...pkg,
        source: `fn gleechShade(context: GleechShaderContext) -> vec4f { ${body} return context.source; }`,
      }),
    ).toThrow();
  });
  it('ignores comments when enforcing executable limits', () => {
    const pkg = sample();
    expect(() =>
      assertExecutableShader({ ...pkg, source: '/* loop for textureLoad */\n' + pkg.source }),
    ).not.toThrow();
  });
  it('retains embedded source across undo, redo, duplicate and independent preset merge identities', () => {
    const commands = service(),
      pkg = sample();
    commands.addShader(pkg, 'a');
    const original = commands.getState();
    const effect = original.effects[0] as ImportedShaderEffect;
    expect(Object.isFrozen(effect.shader.controls)).toBe(true);
    expect(Object.isFrozen(effect.shader.authors[0])).toBe(true);
    commands.duplicateEffect('a', 'b');
    expect((commands.getState().effects[1] as ImportedShaderEffect).shader).toEqual(effect.shader);
    commands.undo();
    expect(commands.getState()).toBe(original);
    commands.redo();
    commands.applyPreset(
      {
        masterSeed: 8172,
        effects: [createImportedShader({ ...pkg, id: 'gleech.other' }, 'incoming')],
      },
      'merge',
      ['c'],
    );
    expect(commands.getState().effects).toHaveLength(1);
    expect((commands.getState().effects[0] as ImportedShaderEffect).shader.id).toBe('gleech.other');
    commands.undo();
    commands.applyPreset(
      {
        masterSeed: 8172,
        effects: [
          createImportedShader(pkg, 'incoming'),
          createImportedShader({ ...pkg, id: 'gleech.other' }, 'other'),
        ],
      },
      'merge',
      ['c', 'd'],
    );
    expect(commands.getState().effects).toHaveLength(3);
    expect(
      commands.getState().effects.filter((e) => e.instanceId === 'a' || e.instanceId === 'b'),
    ).toHaveLength(2);
  });
  it('round-trips custom clipboard values, colors and tint gradients, and resets to package defaults', () => {
    const base = createImportedShader(sample(), 'a');
    const changed = {
      ...base,
      params: {
        ...base.params,
        shader_density: 12,
        shader_ink: '#ff0080',
        colorMode: 'gradient',
        colorEnd: '#00ff00',
      },
    } as ImportedShaderEffect;
    for (const target of [
      { kind: 'parameter', key: 'shader_density' },
      { kind: 'color', key: 'shader_ink' },
      { kind: 'color', key: 'color' },
      { kind: 'effect' },
    ] as const) {
      const copied = copySettings(changed, target)!;
      const decoded = decodeSettings(encodeSettings(copied));
      expect(decoded).toEqual(copied);
      expect(pastedSettings(base, decoded!, target)).not.toBeNull();
    }
    expect(
      (resetSettings(changed, { kind: 'parameter', key: 'shader_density' }) as ImportedShaderEffect)
        .params.shader_density,
    ).toBe(5);
    expect(
      (resetSettings(changed, { kind: 'color', key: 'shader_ink' }) as ImportedShaderEffect).params
        .shader_ink,
    ).toBe('#f1cc6b');
  });
  it('varies imported controls while preserving source and locked copies', () => {
    const base = createImportedShader(sample(), 'a');
    const locked = { ...base, instanceId: 'locked', locked: true };
    const variations = generateVariations([base, locked], 42, 1);
    expect(variations).toHaveLength(9);
    for (const variation of variations) {
      expect(variation.effects[1]).toEqual(locked);
      expect((variation.effects[0] as ImportedShaderEffect).shader).toEqual(base.shader);
      expect(() => assertEffect(variation.effects[0]!)).not.toThrow();
    }
    expect(
      variations.some((v) => JSON.stringify(v.effects[0]?.params) !== JSON.stringify(base.params)),
    ).toBe(true);
  });
  it('packs controls in declaration order and freezes Phase and seed deterministically', () => {
    const effect = createImportedShader(sample(), 'a');
    const invoke = importedShaderInvocation(effect, 42, { width: 2048, height: 1024 });
    expect([...invoke.uniforms.slice(0, 2)]).toEqual([2048, 1024]);
    expect(invoke.controls[0]).toBe(5);
    expect(invoke.controls[4]).toBeCloseTo(0.035);
    expect(invoke.controls[8]).toBe(0);
    expect(invoke.controls[12]).toBeCloseTo(241 / 255);
    expect(invoke.controls[16]).toBe(0.5);
    expect(
      importedShaderInvocation({ ...effect, params: { ...effect.params, phase: 1 } }, 42, {
        width: 2048,
        height: 1024,
      }).uniforms,
    ).toEqual(invoke.uniforms);
    expect(
      importedShaderInvocation({ ...effect, seedOffset: 1 }, 42, { width: 2048, height: 1024 })
        .uniforms,
    ).not.toEqual(invoke.uniforms);
  });
  it('reports unsupported CPU execution but skips disabled, zero opacity and zero coverage', () => {
    const effect = createImportedShader(sample(), 'a'),
      input = image();
    expect(() => renderEffects(input, [effect])).toThrow(/requires WebGPU/);
    for (const candidate of [
      { ...effect, enabled: false },
      { ...effect, params: { ...effect.params, amount: 0 } },
      { ...effect, application: { ...effect.application, coverage: 0 } },
    ])
      expect(new Uint8Array(renderEffects(input, [candidate]).pixels)).toEqual(
        new Uint8Array(input.pixels),
      );
  });
  it('applies finishing opacity and procedural masks after an imported GPU result', async () => {
    const effect = createImportedShader(sample(), 'a');
    const masked = {
      ...effect,
      application: { region: 'left' as const, coverage: 0.5, softness: 0 },
      params: { ...effect.params, amount: 0.5 },
    };
    const result = await renderEffectsAsync(image(), [masked], {
      yieldControl: async () => {},
      renderShader: async () => Uint8Array.from([110, 120, 130, 255, 140, 150, 160, 255]).buffer,
    });
    expect([...new Uint8Array(result.pixels)]).toEqual([60, 70, 80, 255, 40, 50, 60, 255]);
  });
});
