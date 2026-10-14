import {
  isBetaShader,
  isReferenceShader,
  isSet2Shader,
  isAdvancedShader,
  BETA_REFRACTION_TYPES,
  maskPatternAffine,
  type BuiltinShaderEffect,
  type EdgeHandling,
} from '@gleech/project-model';
import { betaShaderPixels } from './beta-shaders';
import { referenceShaderPixels } from './reference-shaders';
import { set2ShaderInvocation, set2ShaderPixels } from './set2-shaders';
import type { HeightField } from './depth-field';
import type { DirectionSampler } from './direction-field';
import {
  advancedShaderInvocation,
  advancedShaderPixels,
  usesAdvancedMaterial,
} from './set2-advanced-shaders';
const rgbColor = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);

// The first 20 floats retain the original layout; built-ins append 12 floats
// for the geometric suite. Imported packages keep their separate 20-float ABI.
// Quantizing inputs to f32 makes CPU fallback and GPU use the same stored values.
export function builtinShaderInvocation(
  effect: BuiltinShaderEffect,
  seed: number,
  reference: { width: number; height: number },
  heightField?: HeightField,
  direction?: DirectionSampler,
) {
  let hash = Math.imul(seed ^ effect.seedOffset, 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 16), 0x846ca68b);
  const seedPhase = (((hash ^ (hash >>> 16)) >>> 0) / 0x100000000) * Math.PI * 2;
  const shorter = Math.min(reference.width, reference.height);
  const matrix = maskPatternAffine(effect.paintedMask);
  const beta = isBetaShader(effect);
  if (isAdvancedShader(effect) || usesAdvancedMaterial(effect))
    return advancedShaderInvocation(effect, seedPhase, reference, heightField, direction);
  if (isSet2Shader(effect)) return set2ShaderInvocation(effect, seedPhase, reference, heightField);
  if (isReferenceShader(effect)) {
    const p = effect.params,
      terrain = effect.type === 'shader-spectral-terrain' ? effect.params : undefined;
    const programs = {
      'shader-signal-collapse': 'signalcollapse',
      'shader-paint-flow': 'paintflow',
      'shader-billowing-smoke': 'billowingsmoke',
      'shader-bloom-field': 'bloomfield',
      'shader-chromatic-erosion': 'chromaticerosion',
      'shader-neon-edges': 'neonedges',
      'shader-wire-ghost': 'wireghost',
      'shader-prismatic-shatter': 'prismaticshatter',
      'shader-radial-extrusion': 'radialextrusion',
      'shader-cellular-mesh': 'cellularmesh',
      'shader-particle-burst': 'particleburst',
      'shader-spectral-terrain': 'spectralterrain',
    } as const;
    const details = {
      'shader-signal-collapse': [
        p.collapse ?? 0.65,
        p.stretch ?? 0.6,
        p.static ?? 0.3,
        p.dropout ?? 0.2,
        p.ribbons ?? 0.55,
      ],
      'shader-paint-flow': [
        p.density ?? 0.7,
        p.radius ?? 0.45,
        p.paintStyle === 'liquid' ? 1 : 0,
        (p.travel ?? 12) / 100,
        p.viscosity ?? 0.6,
      ],
      'shader-billowing-smoke': [
        p.density ?? 0.65,
        p.turbulence ?? 0.65,
        p.volume ?? 0.65,
        p.light ?? 0.7,
        p.softness ?? 0.6,
      ],
      'shader-bloom-field': [
        p.petals ?? 5,
        p.radius ?? 0.22,
        p.density ?? 0.55,
        p.dotSize ?? 0.075,
        p.noiseScale ?? 3,
      ],
      'shader-chromatic-erosion': [
        (p.distortion ?? 9) / 100,
        p.banding ?? 9,
        p.erosion ?? 0.22,
        0,
        0,
      ],
      'shader-neon-edges': [(p.edgeWidth ?? 0.3) / 100, p.glow ?? 0.7, p.darkness ?? 0.9, 0, 0],
      'shader-wire-ghost': [
        (p.edgeWidth ?? 0.3) / 100,
        (p.travel ?? 8) / 100,
        p.trails ?? 4,
        p.disruption ?? 0.25,
        p.glow ?? 0.5,
      ],
      'shader-prismatic-shatter': [
        (p.distortion ?? 8) / 100,
        p.interference ?? 0.65,
        p.shredding ?? 0.3,
        p.grain ?? 0.5,
        0,
      ],
      'shader-radial-extrusion': [
        p.spokes ?? 48,
        p.depth ?? 0.65,
        p.tunnel ?? 0.18,
        0,
        p.facets ?? 0.65,
      ],
      'shader-cellular-mesh': [
        p.holes ?? 0.35,
        p.rounding ?? 0.6,
        p.fractures ?? 0.2,
        p.wireframe ?? 0.35,
        0,
      ],
      'shader-particle-burst': [
        p.density ?? 0.6,
        p.particleSize ?? 0.13,
        p.scatter ?? 0.5,
        p.branches ?? 0.45,
        p.focalGlow ?? 0.55,
      ],
      'shader-spectral-terrain': [
        terrain?.ridges ?? 12,
        terrain?.height ?? 0.4,
        terrain?.mode === 'terrain' ? 1 : 0,
        terrain?.lineWidth ?? 0.18,
        terrain?.perspective ?? 0.65,
      ],
    }[effect.type];
    return {
      program: programs[effect.type],
      ...(terrain && heightField ? { heightField } : {}),
      uniforms: new Float32Array([
        reference.width / shorter,
        reference.height / shorter,
        p.scale,
        p.strength,
        (p.phase % 1) * Math.PI * 2,
        p.centerX / 100,
        p.centerY / 100,
        seedPhase,
        p.edgeHandling === 'wrap' ? 1 : p.edgeHandling === 'mirror' ? 2 : 0,
        p.alpha === 'opaque' ? 1 : 0,
        p.smokeLayers ?? p.sourceMix ?? p.focalLength ?? 0.35,
        p.colorMix,
        matrix[0],
        matrix[2],
        matrix[4],
        terrain
          ? (heightField?.width ?? 1)
          : effect.type === 'shader-billowing-smoke'
            ? (p.eddyStrength ?? 0.75)
            : (p.colorVariation ?? 0),
        matrix[1],
        matrix[3],
        matrix[5],
        terrain
          ? (heightField?.height ?? 1)
          : effect.type === 'shader-billowing-smoke'
            ? (p.eddyScale ?? 2.5)
            : 0,
        details[0]!,
        details[1]!,
        (p.rotation / 180) * Math.PI,
        details[2]!,
        ...rgbColor(p.patternColor),
        details[3]!,
        ...rgbColor(p.backgroundColor),
        details[4]!,
      ]),
    };
  }

  const refracts = beta
    ? BETA_REFRACTION_TYPES.includes(effect.type)
    : 'edgeHandling' in effect.params;
  const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const programs = {
    'shader-ripple': 'ripple',
    'shader-plasma': 'plasma',
    'shader-liquid-glass': 'glass',
    'shader-flow-field': 'flow',
    'shader-iridescence': 'iridescence',
    'shader-hologram': 'hologram',
    'shader-caustics': 'caustics',
    'shader-liquid-chrome': 'chrome',
    'shader-heat-mirage': 'mirage',
    'shader-nebula': 'nebula',
    'shader-cellular-membrane': 'membrane',
    'shader-moire': 'moire',
    'shader-digital-fracture': 'fracture',
    'shader-diffraction': 'diffraction',
    'shader-infinity-tunnel': 'tunnel',
    'shader-crystal-facets': 'crystal',
    'shader-circuit-matrix': 'circuit',
    'shader-data-lattice': 'lattice',
    'shader-op-art': 'opart',
    'shader-polar-grid': 'polar',
  } as const;
  return {
    program: programs[effect.type],
    uniforms: new Float32Array([
      reference.width / shorter,
      reference.height / shorter,
      effect.params.scale,
      refracts ? effect.params.strength / 100 : effect.params.strength,
      (effect.params.phase % 1) * Math.PI * 2,
      effect.params.centerX / 100,
      effect.params.centerY / 100,
      seedPhase,
      'edgeHandling' in effect.params
        ? effect.params.edgeHandling === 'wrap'
          ? 1
          : effect.params.edgeHandling === 'mirror'
            ? 2
            : 0
        : 0,
      'alpha' in effect.params && effect.params.alpha === 'opaque' ? 1 : 0,
      beta
        ? (effect.params.threshold ?? 0.65)
        : 'focus' in effect.params
          ? effect.params.focus
          : 'shine' in effect.params
            ? effect.params.shine
            : 'direction' in effect.params
              ? (effect.params.direction * Math.PI) / 180
              : 'detail' in effect.params
                ? effect.params.detail
                : 0,
      beta
        ? effect.params.colorMix
        : 'dispersion' in effect.params
          ? effect.params.dispersion
          : 'contrast' in effect.params
            ? effect.params.contrast
            : 'falloff' in effect.params
              ? effect.params.falloff
              : 'core' in effect.params
                ? effect.params.core
                : 0,
      matrix[0],
      matrix[2],
      matrix[4],
      0,
      matrix[1],
      matrix[3],
      matrix[5],
      0,
      ...(beta
        ? [
            effect.params.structure,
            effect.params.accent,
            (effect.params.rotation * Math.PI) / 180,
            ['first', 'second', 'third'].indexOf(effect.params.variant),
            ...rgb(effect.params.patternColor),
            0,
            ...rgb(effect.params.backgroundColor),
            0,
          ]
        : new Array<number>(12).fill(0)),
    ]),
  };
}

type Sampler = (
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Float64Array,
  edges: EdgeHandling,
) => void;

// Our built-ins deliberately have a CPU implementation. Imported shaders
// will need a separate capability policy; this is not an arbitrary WGSL emulator.
export function* builtinShaderPixels(
  input: Uint8Array,
  output: Uint8Array,
  width: number,
  height: number,
  effect: BuiltinShaderEffect,
  seed: number,
  reference: { width: number; height: number },
  sample: Sampler,
  heightField?: HeightField,
  direction?: DirectionSampler,
): Generator<void> {
  const invocation = builtinShaderInvocation(effect, seed, reference, heightField, direction);
  const u = invocation.uniforms;
  if ((isAdvancedShader(effect) || usesAdvancedMaterial(effect)) && 'extra' in invocation) {
    yield* advancedShaderPixels(input, output, width, height, effect, invocation, sample);
    return;
  }
  if (isSet2Shader(effect)) {
    yield* set2ShaderPixels(input, output, width, height, effect, u, sample, heightField);
    return;
  }
  if (isReferenceShader(effect)) {
    yield* referenceShaderPixels(input, output, width, height, effect, u, sample, heightField);
    return;
  }
  if (isBetaShader(effect)) {
    yield* betaShaderPixels(input, output, width, height, effect, u, sample);
    return;
  }
  const f32 = Math.fround;
  const pi = f32(Math.PI);
  const add = (a: number, b: number) => f32(a + b);
  const mul = (a: number, b: number) => f32(a * b);
  const sin = (v: number) => f32(Math.sin(v));
  const cos = (v: number) => f32(Math.cos(v));
  const pow = (v: number, exponent: number) => f32(Math.pow(v, exponent));
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const writeRgb = (index: number, r: number, g: number, b: number, alpha: number) => {
    output[index] = Math.round(clamp(r) * 255);
    output[index + 1] = Math.round(clamp(g) * 255);
    output[index + 2] = Math.round(clamp(b) * 255);
    output[index + 3] = Math.round(alpha);
  };
  const color = new Float64Array(4);
  const determinant = f32(mul(u[12]!, u[17]!) - mul(u[13]!, u[16]!));
  const offset = (dx: number, dy: number) => ({
    x: f32(add(mul(u[17]!, dx), -mul(u[13]!, dy)) / determinant),
    y: f32(add(-mul(u[16]!, dx), mul(u[12]!, dy)) / determinant),
  });
  const sampleOffset = (x: number, y: number, dx: number, dy: number, edges: EdgeHandling) => {
    const world = offset(dx, dy);
    sample(
      input,
      width,
      height,
      f32(x + mul(world.x, width)),
      f32(y + mul(world.y, height)),
      color,
      edges,
    );
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const canvasX = f32((x + 0.5) / width),
        canvasY = f32((y + 0.5) / height);
      const uvX = add(add(mul(u[12]!, canvasX), mul(u[13]!, canvasY)), u[14]!),
        uvY = add(add(mul(u[16]!, canvasX), mul(u[17]!, canvasY)), u[18]!);
      const px = f32(f32(uvX - u[5]!) * u[0]!),
        py = f32(f32(uvY - u[6]!) * u[1]!);
      const index = (y * width + x) * 4;
      if (effect.type !== 'shader-plasma' && effect.type !== 'shader-nebula' && u[3] === 0) {
        output.set(input.subarray(index, index + 4), index);
        continue;
      }
      if (effect.type === 'shader-caustics') {
        const qx = mul(mul(mul(px, u[2]!), 2), pi);
        const qy = mul(mul(mul(py, u[2]!), 2), pi);
        const ax = add(add(qx, mul(sin(add(qy, u[4]!)), f32(0.7))), u[7]!);
        const by = add(qy, mul(sin(add(qx, -u[4]!)), f32(0.65)));
        const light = pow(Math.max(f32(1 - Math.abs(sin(ax))), f32(1 - Math.abs(sin(by)))), u[10]!);
        const treatment = [0, 1, 2].map((c) => {
          const shifted = add(ax, mul(u[11]!, f32((c - 1) * 0.3)));
          const spectral = pow(f32(1 - Math.abs(sin(shifted))), u[10]!);
          const intensity = add(mul(light, f32(1 - u[11]!)), mul(spectral, u[11]!));
          const source = f32(input[index + c]! / 255);
          const target = add(
            mul(source, add(f32(0.65), mul(intensity, f32(0.8)))),
            mul(intensity, f32(0.65)),
          );
          return add(mul(source, f32(1 - u[3]!)), mul(target, u[3]!));
        });
        writeRgb(index, treatment[0]!, treatment[1]!, treatment[2]!, input[index + 3]!);
      } else if (effect.type === 'shader-liquid-chrome' || effect.type === 'shader-heat-mirage') {
        const qx = mul(mul(mul(px, u[2]!), 2), pi);
        const qy = mul(mul(mul(py, u[2]!), 2), pi);
        const t = u[4]!,
          s = u[7]!;
        let dx: number, dy: number;
        if (effect.type === 'shader-liquid-chrome') {
          dx = sin(add(add(qx, t), mul(cos(add(qy, s)), f32(1.4))));
          dy = cos(add(add(qy, -t), mul(sin(add(qx, s)), f32(1.4))));
        } else {
          const wave = add(
            add(
              mul(
                f32(0.65),
                sin(add(add(mul(qy, f32(1.7)), mul(sin(add(mul(qx, f32(0.5)), t)), f32(1.2))), s)),
              ),
              mul(f32(0.25), sin(add(add(mul(qx, f32(2.3)), -t), s))),
            ),
            mul(f32(0.1), cos(add(mul(add(qx, -qy), 3), t))),
          );
          const envelope =
            u[11] === 0
              ? 1
              : pow(Math.max(0, f32(1 - Math.abs(mul(f32(uvY - u[6]!), 2)))), mul(u[11]!, 4));
          const travel = mul(wave, envelope);
          dx = mul(cos(u[10]!), travel);
          dy = mul(sin(u[10]!), travel);
        }
        sampleOffset(
          x,
          y,
          f32(mul(dx, u[3]!) / u[0]!),
          f32(mul(dy, u[3]!) / u[1]!),
          effect.params.edgeHandling,
        );
        if (effect.type === 'shader-liquid-chrome') {
          const luminance = add(
            add(mul(f32(color[0]! / 255), f32(0.2126)), mul(f32(color[1]! / 255), f32(0.7152))),
            mul(f32(color[2]! / 255), f32(0.0722)),
          );
          const metal = add(
            0.5,
            mul(0.5, sin(add(mul(mul(luminance, u[11]!), pi), mul(sin(add(qx, qy)), f32(0.7))))),
          );
          const shine = mul(
            pow(add(0.5, mul(0.5, cos(add(add(qx, t), cos(add(qy, -s)))))), 12),
            u[10]!,
          );
          writeRgb(
            index,
            add(add(mul(f32(color[0]! / 255), f32(0.3)), mul(metal, f32(0.7))), shine),
            add(add(mul(f32(color[1]! / 255), f32(0.3)), mul(metal, f32(0.7))), shine),
            add(add(mul(f32(color[2]! / 255), f32(0.3)), mul(metal, f32(0.7))), shine),
            color[3]!,
          );
        } else for (let c = 0; c < 4; c++) output[index + c] = Math.round(color[c]!);
      } else if (effect.type === 'shader-nebula') {
        const qx = mul(mul(mul(px, u[2]!), 2), pi);
        const qy = mul(mul(mul(py, u[2]!), 2), pi);
        let density = 0,
          weightSum = 0,
          weight = 1,
          frequency = 1;
        for (let octave = 0; octave < Math.round(u[10]!); octave++) {
          const a = add(add(mul(qx, frequency), u[4]!), mul(u[7]!, f32(octave + 1)));
          const b = add(mul(qy, frequency), -u[4]!);
          const field = mul(sin(add(a, mul(cos(b), f32(1.3)))), cos(add(b, mul(sin(a), f32(0.7)))));
          density = add(density, mul(field, weight));
          weightSum = add(weightSum, weight);
          weight = mul(weight, 0.5);
          frequency = mul(frequency, f32(1.93));
        }
        const cloud = f32(clamp(add(0.5, mul(mul(f32(density / weightSum), f32(0.75)), u[3]!))));
        const glow = mul(mul(pow(cloud, 8), u[11]!), 2);
        const colorPhase = add(add(mul(cloud, pi), u[7]!), mul(sin(u[4]!), f32(0.5)));
        const rgb = [0, 1, 2].map((c) => {
          const palette = add(
            f32(0.3),
            mul(f32(0.7), add(0.5, mul(0.5, cos(add(colorPhase, f32([0, 2.2, 4.2][c]!)))))),
          );
          return add(
            add(
              mul(f32([0.015, 0.025, 0.08][c]!), f32(1 - cloud)),
              mul(mul(palette, cloud), cloud),
            ),
            glow,
          );
        });
        writeRgb(index, rgb[0]!, rgb[1]!, rgb[2]!, u[9] === 1 ? 255 : input[index + 3]!);
      } else if (effect.type === 'shader-liquid-glass' || effect.type === 'shader-flow-field') {
        const qx = mul(mul(mul(px, u[2]!), 2), pi);
        const qy = mul(mul(mul(py, u[2]!), 2), pi);
        const ax = add(add(qx, u[4]!), u[7]!);
        const by = add(qy, -u[4]!);
        let dx: number, dy: number;
        if (effect.type === 'shader-liquid-glass') {
          dx = mul(sin(ax), cos(by));
          dy = mul(cos(add(qx, -u[4]!)), sin(add(add(qy, u[4]!), u[7]!)));
        } else {
          const diagonal = mul(0.25, cos(add(mul(add(qx, qy), 0.5), u[4]!)));
          dx = f32(add(-mul(sin(ax), sin(by)), diagonal) / 1.25);
          dy = f32(add(-mul(cos(ax), cos(by)), -diagonal) / 1.25);
        }
        sampleOffset(
          x,
          y,
          f32(mul(dx, u[3]!) / u[0]!),
          f32(mul(dy, u[3]!) / u[1]!),
          effect.params.edgeHandling,
        );
        for (let c = 0; c < 4; c++) output[index + c] = Math.round(color[c]!);
      } else if (effect.type === 'shader-iridescence' || effect.type === 'shader-hologram') {
        const qx = mul(mul(mul(px, u[2]!), 2), pi);
        const qy = mul(mul(mul(py, u[2]!), 2), pi);
        const rgb = [0, 1, 2].map((c) => f32(input[index + c]! / 255));
        const luminance = add(
          add(mul(rgb[0]!, f32(0.2126)), mul(rgb[1]!, f32(0.7152))),
          mul(rgb[2]!, f32(0.0722)),
        );
        const phase = u[4]!,
          seedPhase = u[7]!;
        let target: number[];
        if (effect.type === 'shader-iridescence') {
          const field = add(
            add(
              mul(f32(0.35), sin(add(add(qx, phase), seedPhase))),
              mul(f32(0.35), cos(add(qy, -phase))),
            ),
            mul(luminance, 4),
          );
          target = rgb.map((v, c) => {
            const palette = add(
              0.5,
              mul(0.5, cos(add(mul(field, pi), f32((c * 2 * Math.PI) / 3)))),
            );
            return add(mul(v, f32(0.35)), mul(palette, add(0.25, mul(0.75, luminance))));
          });
        } else {
          const bands = add(
            0.5,
            mul(0.5, sin(add(add(add(qy, phase), seedPhase), mul(0.5, sin(add(qx, -phase)))))),
          );
          const contour = f32(
            Math.pow(
              add(0.5, mul(0.5, cos(add(add(mul(luminance, 24), mul(qx, f32(0.2))), sin(phase))))),
              8,
            ),
          );
          const light = add(
            add(mul(luminance, f32(0.7)), mul(bands, f32(0.35))),
            mul(contour, f32(0.45)),
          );
          target = rgb.map((v, c) => add(mul(v, f32(0.35)), mul(f32([0.12, 0.65, 1][c]!), light)));
        }
        for (let c = 0; c < 3; c++) {
          const result = add(mul(rgb[c]!, f32(1 - u[3]!)), mul(target[c]!, u[3]!));
          output[index + c] = Math.round(Math.max(0, Math.min(1, result)) * 255);
        }
        output[index + 3] = input[index + 3]!;
      } else if (effect.type === 'shader-ripple') {
        if (u[3] === 0) {
          output.set(input.subarray(index, index + 4), index);
          continue;
        }
        const radius = f32(Math.sqrt(f32(f32(px * px) + f32(py * py))));
        const angle = f32(f32(f32(f32(f32(radius * u[2]!) * 2) * pi) - u[4]!) + u[7]!);
        const wave = f32(Math.sin(angle));
        const offset = f32(f32(wave * u[3]!) / f32(1 + f32(radius * 2)));
        const dx = radius > 0.000001 ? f32(f32(px / radius) * offset) : 0;
        const dy = radius > 0.000001 ? f32(f32(py / radius) * offset) : 0;
        sampleOffset(x, y, f32(dx / u[0]!), f32(dy / u[1]!), effect.params.edgeHandling);
        for (let c = 0; c < 4; c++) output[index + c] = Math.round(color[c]!);
      } else {
        const a = px * u[2]! * Math.PI * 2,
          b = py * u[2]! * Math.PI * 2;
        const v =
          ((Math.sin(a + u[4]!) +
            Math.sin(b + u[4]! * 2) +
            Math.sin((a + b) * 0.7 - u[4]!) +
            Math.sin(Math.hypot(a, b) + u[4]!)) /
            4) *
          u[3]!;
        for (let c = 0; c < 3; c++)
          output[index + c] = Math.round(
            (0.5 + 0.5 * Math.cos(v * Math.PI + u[7]! + (c * Math.PI * 2) / 3)) * 255,
          );
        output[index + 3] = u[9] === 1 ? 255 : input[index + 3]!;
      }
    }
    yield;
  }
}
