import { describe, expect, it } from 'vitest';
import { builtinShaderSource } from './shader-source';
import { BUILTIN_SHADER_WGSL } from './shader-programs';

describe('lazy built-in shader source', () => {
  const entries = [
    ...BUILTIN_SHADER_WGSL.matchAll(/@compute\s+@workgroup_size\([^)]*\)\s*fn\s+(\w+)/g),
  ].map((match) => match[1]!);
  it.each(entries)('%s retains only its entry point and all called helpers', (entry) => {
    const code = builtinShaderSource(entry);
    expect(code.match(/@compute\b/g)).toHaveLength(1);
    expect(code).toContain(`fn ${entry}(`);
    const originalNames = new Set(
      [...BUILTIN_SHADER_WGSL.matchAll(/\bfn\s+(\w+)\(/g)].map((match) => match[1]),
    );
    const present = new Set([...code.matchAll(/\bfn\s+(\w+)\(/g)].map((match) => match[1]));
    for (const call of code.matchAll(/\b(\w+)\(/g)) {
      if (originalNames.has(call[1])) expect(present.has(call[1])).toBe(true);
    }
    expect(builtinShaderSource(entry)).toBe(code);
  });
  it('does not drag fractal kernels into a simple ripple', () => {
    const code = builtinShaderSource('ripple');
    expect(code.length).toBeLessThan(BUILTIN_SHADER_WGSL.length / 10);
    expect(code).not.toContain('fn fractalOrbit');
  });
  it('specializes a material without pulling in unrelated expensive geometry', () => {
    const contour = builtinShaderSource('contourmelt');
    expect(contour).toContain('fn a_Shade0(');
    expect(contour).not.toContain('fn a_Primitive(');
    expect(contour).not.toContain('fn fractalOrbit(');
    expect(contour).not.toContain('fn a_Shade3(');
  });
  it('rejects unknown programs', () => expect(() => builtinShaderSource('missing')).toThrow());
});
