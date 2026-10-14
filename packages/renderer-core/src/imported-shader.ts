import { BUILTIN_SHADER_WGSL } from './shader-programs';

/** Engine-owned input, sampling and output. Packages supply one small shade function. */
export function importedShaderCode(source: string): string {
  const helpers = BUILTIN_SHADER_WGSL.slice(0, BUILTIN_SHADER_WGSL.indexOf('@compute'))
    // Imported packages retain their original 80-byte engine uniform contract.
    .replace(', details: vec4f, accent: vec4f, shadow: vec4f', '')
    .replace(/\bsource\b/g, 'gleechInput')
    .replace(/\boutputImage\b/g, 'gleechOutput')
    .replace(/\bsettings\b/g, 'gleechSettings')
    .replace(/\bsampleSource\b/g, 'gleechRawSample')
    .replace(/\bedge\b/g, 'gleechEdge')
    .replace(/\bat\b/g, 'gleechAt');
  return `${helpers}
@group(0) @binding(3) var<uniform> gleechControls: array<vec4f, 32>;
struct GleechShaderContext {
  uv: vec2f, position: vec2f, resolution: vec2f, reference: vec2f,
  source: vec4f, phase: f32, seed: f32
}
fn gleechControl(index: u32) -> vec4f { return gleechControls[min(index, 31u)]; }
fn gleechSample(uv: vec2f) -> vec4f {
  let size = textureDimensions(gleechInput);
  let safe = select(vec2f(0), uv, abs(uv) < vec2f(10000));
  return gleechRawSample(gleechCanvasUv(safe) * vec2f(size) - 0.5, vec2i(size));
}
${source}
@compute @workgroup_size(8, 8)
fn gleechKernel(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(gleechInput);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = gleechPatternUv((vec2f(id.xy)+0.5)/vec2f(size));
  var position = uv*vec2f(size)-0.5;
  if (all(gleechSettings.patternX.xyz == vec3f(1,0,0)) && all(gleechSettings.patternY.xyz == vec3f(0,1,0))) { position = vec2f(id.xy); }
  let context = GleechShaderContext(uv, position, vec2f(size),
    gleechSettings.geometry.xy, textureLoad(gleechInput, vec2i(id.xy), 0), gleechSettings.motion.x, gleechSettings.motion.w);
  let color = gleechShade(context);
  let finite = select(vec4f(0), color, abs(color) < vec4f(1e20));
  textureStore(gleechOutput, vec2i(id.xy), clamp(finite, vec4f(0), vec4f(1)));
}`;
}
