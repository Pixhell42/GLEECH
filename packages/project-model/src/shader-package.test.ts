import { describe, expect, it } from 'vitest';
import {
  assertShaderPackage,
  assertShaderValues,
  shaderControlDefaults,
  shaderControlUniforms,
  decodeShaderPackage,
  encodeShaderPackage,
  MAX_SHADER_PACKAGE_BYTES,
  type ShaderPackage,
} from './shader-package';

const fixture = (): ShaderPackage => ({
  format: 'gleech-shader',
  schemaVersion: 1,
  id: 'test.original',
  version: '1.0.0',
  name: 'Test shader',
  description: 'A package fixture, not a shipped shader.',
  authors: [{ name: 'Test author', url: 'https://example.com/author' }],
  sourceUrl: 'https://example.com/shader',
  license: { expression: 'MIT', text: 'Fixture license metadata.' },
  kind: 'image',
  language: 'wgsl',
  entryPoint: 'gleechShade',
  controls: [
    {
      key: 'strength',
      kind: 'number',
      label: 'Strength',
      description: 'Refraction distance.',
      min: 0,
      max: 10,
      step: 0.1,
      default: 3,
      unit: 'number',
    },
    {
      key: 'shape',
      kind: 'choice',
      label: 'Shape',
      description: 'Pattern style.',
      default: 'rings',
      options: [
        { value: 'rings', label: 'Rings', shaderValue: 0 },
        { value: 'cells', label: 'Cells', shaderValue: 2 },
      ],
    },
    { key: 'ink', kind: 'color', label: 'Ink', description: 'Pattern color.', default: '#4080ff' },
  ],
  source: 'fn gleechShade(context: GleechShaderContext) -> vec4f { return context.source; }',
});
describe('portable shader package foundation', () => {
  it('round-trips source, versions, authors, links and license text without fetching anything', () => {
    const pkg = fixture();
    expect(decodeShaderPackage(encodeShaderPackage(pkg))).toEqual(pkg);
    expect(shaderControlDefaults(pkg)).toEqual({ strength: 3, shape: 'rings', ink: '#4080ff' });
  });
  it('uses aligned control slots and explicit choice codes instead of their array positions', () => {
    const pkg = fixture();
    const uniforms = shaderControlUniforms(pkg, { strength: 7.25, shape: 'cells', ink: '#FF8000' });
    expect(uniforms).toHaveLength(12);
    expect([...uniforms.slice(0, 8)]).toEqual([7.25, 0, 0, 0, 2, 0, 0, 0]);
    expect(uniforms[8]).toBe(1);
    expect(uniforms[9]).toBeCloseTo(128 / 255);
    expect(uniforms[10]).toBe(0);
    expect(uniforms[11]).toBe(1);
    expect(shaderControlUniforms({ ...pkg, controls: [] }, {})).toHaveLength(0);
  });
  it.each([
    null,
    [],
    { ...fixture(), format: 'shadertoy' },
    { ...fixture(), schemaVersion: 2 },
    { ...fixture(), language: 'glsl' },
    { ...fixture(), entryPoint: 'mainImage' },
    { ...fixture(), javascript: 'alert(1)' },
    { ...fixture(), id: '../../escape' },
    { ...fixture(), version: 'latest' },
    { ...fixture(), name: '' },
    { ...fixture(), authors: [] },
    { ...fixture(), license: {} },
  ])('rejects malformed or unsupported metadata %j', (value) => {
    expect(() => assertShaderPackage(value)).toThrow();
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'file:///C:/secret',
    'http://example.com',
    'https://user:password@example.com',
    'not a url',
  ])('rejects unsafe credit links %s', (url) => {
    expect(() => assertShaderPackage({ ...fixture(), sourceUrl: url })).toThrow();
    expect(() =>
      assertShaderPackage({ ...fixture(), authors: [{ name: 'Author', url }] }),
    ).toThrow();
  });
  it('rejects duplicate/reserved controls, range errors, f32 overflow and GPU choice-code collisions', () => {
    const pkg = fixture(),
      number = pkg.controls[0]!,
      choice = pkg.controls[1]!;
    const invalid = [
      [number, number],
      [{ ...number, key: 'phase' }],
      [{ ...number, key: '__proto__' }],
      [{ ...number, min: 10, max: 1 }],
      [{ ...number, step: 0 }],
      [{ ...number, step: 1e-100 }],
      [{ ...number, min: 16777216, max: 16777217, default: 16777216 }],
      [{ ...number, default: 11 }],
      [{ ...number, max: Infinity }],
      [{ ...number, max: 1e100 }],
      [
        {
          ...choice,
          options: [
            { value: 'a', label: 'A', shaderValue: 16777216 },
            { value: 'b', label: 'B', shaderValue: 16777217 },
          ],
          default: 'a',
        },
      ],
      [
        {
          ...choice,
          options: [
            { value: 'same', label: 'A', shaderValue: 0 },
            { value: 'same', label: 'B', shaderValue: 1 },
          ],
          default: 'same',
        },
      ],
      [{ ...choice, default: 'missing' }],
      [{ ...number, kind: 'script' }],
      Array.from({ length: 33 }, (_, i) => ({ ...number, key: `param${i}` })),
    ];
    for (const controls of invalid)
      expect(() => assertShaderPackage({ ...pkg, controls })).toThrow();
  });
  it.each([
    { strength: 11, shape: 'rings', ink: '#ffffff' },
    { strength: NaN, shape: 'rings', ink: '#ffffff' },
    { strength: 1, shape: 'missing', ink: '#ffffff' },
    { strength: 1, shape: 'rings', ink: '#fff' },
    { strength: 1, shape: 'rings' },
    { strength: 1, shape: 'rings', ink: '#ffffff', extra: 1 },
  ])('rejects malformed parameter values %j', (values) => {
    expect(() => assertShaderValues(fixture(), values)).toThrow();
  });
  it('does not confuse nested comment text with active GPU bindings or entry points', () => {
    const pkg = fixture();
    expect(() =>
      assertShaderPackage({
        ...pkg,
        source:
          '/* outer @compute /* nested @binding(0) */ end */\n// fn gleechShade ignored\n' +
          pkg.source,
      }),
    ).not.toThrow();
    expect(() => assertShaderPackage({ ...pkg, source: '/* never closed ' + pkg.source })).toThrow(
      'Unclosed',
    );
    for (const declaration of [
      '@group(0) @binding(0)',
      '@ /* split */ compute',
      'var<storage, read> buffer: array<f32>;',
      'var<workgroup> shared: f32;',
    ])
      expect(() =>
        assertShaderPackage({ ...pkg, source: declaration + '\n' + pkg.source }),
      ).toThrow('GLEECH owns');
    expect(() => assertShaderPackage({ ...pkg, source: pkg.source + '\n' + pkg.source })).toThrow(
      'must define',
    );
  });
  it('checks UTF-8 source/package sizes and validates JSON before returning a package', () => {
    expect(() => decodeShaderPackage(' '.repeat(MAX_SHADER_PACKAGE_BYTES + 1))).toThrow('256 KiB');
    expect(() => decodeShaderPackage('{')).toThrow('JSON');
    expect(() =>
      assertShaderPackage({
        ...fixture(),
        source: fixture().source + '/*' + '⭐'.repeat(24000) + '*/',
      }),
    ).toThrow('64 KiB');
    const pkg = {
      ...fixture(),
      description: 'a'.repeat(2048),
      controls: Array.from({ length: 32 }, (_, i) => ({
        ...fixture().controls[0]!,
        key: `p${i}`,
        description: '⭐'.repeat(1024),
      })),
    } as ShaderPackage;
    expect(() => encodeShaderPackage(pkg)).not.toThrow();
  });
});
