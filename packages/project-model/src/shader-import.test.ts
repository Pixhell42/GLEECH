import { describe, expect, it } from 'vitest';
import {
  decodeShaderImport,
  encodeShaderPackage,
  decodeShaderPackage,
  shaderControlDefaults,
  shaderControlUniforms,
  assertExecutableShader,
} from './shader-package';

const isf = (
  metadata: Record<string, unknown>,
  code = 'void main(){gl_FragColor=vec4(isf_FragNormCoord,0.5,1.0);}',
) =>
  `/*${JSON.stringify({ ISFVSN: '2', CREDIT: 'by Test Creator', LICENSE: 'MIT', ...metadata })}*/\n${code}`;
describe('local and HTTPS shader file conversion', () => {
  it('imports numeric, toggle, discrete, point, color and image inputs with portable metadata', () => {
    const pkg = decodeShaderImport(
      isf({
        CREDIT_URL: 'https://example.com/creator',
        INPUTS: [
          { NAME: 'inputImage', TYPE: 'image' },
          { NAME: 'gain', TYPE: 'float', DEFAULT: 0.5 },
          { NAME: 'enabled', TYPE: 'bool', DEFAULT: true },
          { NAME: 'mode', TYPE: 'long', VALUES: [0, 2], LABELS: ['A', 'B'], DEFAULT: 2 },
          { NAME: 'center', TYPE: 'point2D', DEFAULT: [0.25, 0.75] },
          { NAME: 'ink', TYPE: 'color', DEFAULT: [1, 0, 0.5, 0.4] },
        ],
      }),
      'sample.fs',
      'https://example.com/sample.fs',
    );
    expect(pkg.language).toBe('isf');
    expect(pkg.kind).toBe('image');
    expect(pkg.name).toBe('sample');
    expect(pkg.authors).toEqual([{ name: 'Test Creator', url: 'https://example.com/creator' }]);
    expect(pkg.license.expression).toBe('MIT');
    expect(pkg.sourceUrl).toBe('https://example.com/sample.fs');
    expect(pkg.controls).toHaveLength(7);
    expect(pkg.isfInputs?.[4]?.keys).toEqual(['isf4X', 'isf4Y']);
    const values = shaderControlDefaults(pkg),
      uniforms = shaderControlUniforms(pkg, values);
    expect(values).toMatchObject({
      isf1: 0.5,
      isf2: 'on',
      isf3: 'v1',
      isf4X: 0.25,
      isf4Y: 0.75,
      isf5: '#ff0080',
      isf5Alpha: 0.4,
    });
    expect([...uniforms.slice(0, 13)]).toEqual([0.5, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0.25]);
    expect(decodeShaderPackage(encodeShaderPackage(pkg))).toEqual(pkg);
  });
  it('accepts generators and raw native WGSL without inventing author or license', () => {
    const contents =
      'fn gleechShade(context: GleechShaderContext) -> vec4f { return context.source; }';
    const pkg = decodeShaderImport(contents, 'Identity.wgsl');
    expect(pkg.language).toBe('wgsl');
    expect(pkg.authors[0]?.name).toBe('Unknown author');
    expect(pkg.license.expression).toBe('LicenseRef-Unspecified');
    expect(decodeShaderImport(contents, 'Different.wgsl').id).toBe(pkg.id);
    expect(decodeShaderImport(isf({ INPUTS: [] }), 'generator.fs').kind).toBe('generator');
  });
  it.each([
    { INPUTS: [{ NAME: 'music', TYPE: 'audio' }] },
    { IMPORTED: { picture: { PATH: 'file.png' } } },
    { PASSES: [{ TARGET: 'buffer' }, {}] },
    {
      INPUTS: [
        { NAME: 'a', TYPE: 'image' },
        { NAME: 'b', TYPE: 'image' },
      ],
    },
    { INPUTS: [{ NAME: 'TIME', TYPE: 'float' }] },
    { INPUTS: [{ NAME: 'x', TYPE: 'float', MIN: 1, MAX: 0 }] },
    { INPUTS: [{ NAME: 'mode', TYPE: 'long', VALUES: [0, 0] }] },
    { INPUTS: [{ NAME: 'ink', TYPE: 'color', DEFAULT: [-1, 0, 0, 1] }] },
  ])('rejects unsupported resources or invalid declared controls %j', (metadata) => {
    expect(() => decodeShaderImport(isf(metadata), 'bad.fs')).toThrow();
  });
  it.each([
    'void main(){for(int i=0;i<10;i++){} gl_FragColor=vec4(1.0);}',
    'uniform sampler2D external; void main(){gl_FragColor=vec4(1.0);}',
    '#define bad 1\nvoid main(){gl_FragColor=vec4(1.0);}',
    'void main(){gl_FragColor=vec4(gleechSecret);}',
  ])('keeps managed resources and bounded import policy %s', (code) => {
    expect(() => decodeShaderImport(isf({ INPUTS: [] }, code), 'bad.fs')).toThrow();
  });
  it('keeps the native WGSL policy after conversion', () => {
    expect(() =>
      decodeShaderImport(
        'fn gleechShade(context: GleechShaderContext) -> vec4f { loop {} return context.source; }',
        'bad.wgsl',
      ),
    ).toThrow();
    const pkg = decodeShaderImport(isf({ INPUTS: [] }), 'one.fs');
    expect(() =>
      assertExecutableShader({
        ...pkg,
        isfInputs: [{ name: 'x', type: 'float', keys: ['missing'] }],
      }),
    ).toThrow();
  });
});
