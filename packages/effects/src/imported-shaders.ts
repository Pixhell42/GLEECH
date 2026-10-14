import {
  importedShaderValues,
  maskPatternAffine,
  type ImportedShaderEffect,
} from '@gleech/project-model';
import { shaderControlUniforms } from '@gleech/project-model/shader-package';

export function importedShaderInvocation(
  effect: ImportedShaderEffect,
  seed: number,
  reference: { width: number; height: number },
) {
  let hash = Math.imul(seed ^ effect.seedOffset, 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 16), 0x846ca68b);
  const matrix = maskPatternAffine(effect.paintedMask);
  return {
    program: effect.shader.language === 'isf' ? ('isf' as const) : ('imported' as const),
    source: effect.shader.source,
    uniforms: new Float32Array([
      reference.width,
      reference.height,
      0,
      0,
      effect.params.phase % 1,
      0,
      0,
      ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000,
      0,
      0,
      0,
      0,
      matrix[0],
      matrix[2],
      matrix[4],
      0,
      matrix[1],
      matrix[3],
      matrix[5],
      0,
    ]),
    controls: shaderControlUniforms(effect.shader, importedShaderValues(effect)),
    bindings: (effect.shader.isfInputs ?? []).map((input) => ({
      name: input.name,
      type: input.type,
      slots: input.keys.map((key) =>
        effect.shader.controls.findIndex((control) => control.key === key),
      ),
    })),
  };
}
