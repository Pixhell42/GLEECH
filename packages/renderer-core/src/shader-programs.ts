import { BETA_SHADER_WGSL } from './beta-shader-programs';
import { REFERENCE_SHADER_WGSL } from './reference-shader-programs';
import { SET2_SHADER_WGSL } from './set2-shader-programs';
import { ADVANCED_SHADER_WGSL } from './set2-advanced-programs';
// Original GLEECH shaders. Uniforms: geometry, frozen phase/origin/seed, options.
export const BUILTIN_SHADER_WGSL =
  `
struct Settings { geometry: vec4f, motion: vec4f, options: vec4f, patternX: vec4f, patternY: vec4f, details: vec4f, accent: vec4f, shadow: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var outputImage: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> settings: Settings;
const PI: f32 = 3.141592653589793;
fn gleechPatternUv(uv: vec2f) -> vec2f {
  return vec2f(dot(settings.patternX.xy, uv)+settings.patternX.z, dot(settings.patternY.xy, uv)+settings.patternY.z);
}
fn gleechPatternOffset(offset: vec2f) -> vec2f {
  let a=settings.patternX.x; let c=settings.patternX.y;
  let b=settings.patternY.x; let d=settings.patternY.y;
  return vec2f(d*offset.x-c*offset.y, -b*offset.x+a*offset.y)/(a*d-b*c);
}
fn gleechCanvasUv(uv: vec2f) -> vec2f {
  return gleechPatternOffset(uv-vec2f(settings.patternX.z,settings.patternY.z));
}
fn edge(value: i32, size: i32) -> i32 {
  if (settings.options.x < 0.5) { return clamp(value, 0, size - 1); }
  let period = select(size, size * 2, settings.options.x > 1.5);
  let position = ((value % period) + period) % period;
  return select(period - 1 - position, position, position < size);
}
fn at(p: vec2i, size: vec2i) -> vec4f {
  return textureLoad(source, vec2i(edge(p.x, size.x), edge(p.y, size.y)), 0);
}
fn sampleSource(coordinate: vec2f, size: vec2i) -> vec4f {
  var p = coordinate;
  if (settings.options.x < 0.5) { p = clamp(p, vec2f(0), vec2f(size - 1)); }
  let base = vec2i(floor(p));
  let f = p - floor(p);
  let a = at(base, size); let b = at(base + vec2i(1, 0), size);
  let c = at(base + vec2i(0, 1), size); let d = at(base + vec2i(1, 1), size);
  let weights = vec4f((1-f.x)*(1-f.y), f.x*(1-f.y), (1-f.x)*f.y, f.x*f.y);
  let alphaWeights = weights * vec4f(a.a, b.a, c.a, d.a);
  let alpha = dot(alphaWeights, vec4f(1));
  if (alpha > 0) {
    return vec4f((a.rgb*alphaWeights.x + b.rgb*alphaWeights.y + c.rgb*alphaWeights.z + d.rgb*alphaWeights.w) / alpha, alpha);
  }
  return vec4f(a.rgb*weights.x + b.rgb*weights.y + c.rgb*weights.z + d.rgb*weights.w, 0);
}
@compute @workgroup_size(8, 8)
fn ripple(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(source);
  if (id.x >= size.x || id.y >= size.y) { return; }
  if (settings.geometry.w == 0) {
    textureStore(outputImage, vec2i(id.xy), textureLoad(source, vec2i(id.xy), 0));
    return;
  }
  let uv = gleechPatternUv((vec2f(id.xy) + 0.5) / vec2f(size));
  let p = (uv - settings.motion.yz) * settings.geometry.xy;
  let radius = length(p);
  let wave = sin(radius * settings.geometry.z * 2 * PI - settings.motion.x + settings.motion.w);
  let offset = wave * settings.geometry.w / (1 + radius * 2);
  let direction = select(vec2f(0), p / max(radius, 0.000001), radius > 0.000001);
  // Offset the integer pixel location directly. An unnecessary UV round trip
  // can move a nominally exact source pixel beside a nearly transparent edge.
  let coordinate = vec2f(id.xy) + gleechPatternOffset(direction * offset / settings.geometry.xy) * vec2f(size);
  let color = sampleSource(coordinate, vec2i(size));
  textureStore(outputImage, vec2i(id.xy), color);
}
@compute @workgroup_size(8, 8)
fn plasma(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(source);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = gleechPatternUv((vec2f(id.xy) + 0.5) / vec2f(size));
  let p = (uv - settings.motion.yz) * settings.geometry.xy * settings.geometry.z * 2 * PI;
  let t = settings.motion.x;
  let field = (sin(p.x+t) + sin(p.y+t*2) + sin((p.x+p.y)*0.7-t) + sin(length(p)+t)) / 4 * settings.geometry.w;
  let color = 0.5 + 0.5 * cos(vec3f(field * PI + settings.motion.w) + vec3f(0, 2*PI/3, 4*PI/3));
  let alpha = select(textureLoad(source, vec2i(id.xy), 0).a, 1.0, settings.options.y > 0.5);
  textureStore(outputImage, vec2i(id.xy), vec4f(color, alpha));
}
fn refractField(id: vec3u, flowing: bool) {
  let size = textureDimensions(source);
  if (id.x >= size.x || id.y >= size.y) { return; }
  if (settings.geometry.w == 0) {
    textureStore(outputImage, vec2i(id.xy), textureLoad(source, vec2i(id.xy), 0));
    return;
  }
  let uv = gleechPatternUv((vec2f(id.xy) + 0.5) / vec2f(size));
  let q = (uv - settings.motion.yz) * settings.geometry.xy * settings.geometry.z * 2 * PI;
  let t = settings.motion.x; let s = settings.motion.w;
  let ax = q.x + t + s; let by = q.y - t;
  var direction = vec2f(sin(ax)*cos(by), cos(q.x-t)*sin(q.y+t+s));
  if (flowing) {
    // Derivatives of a smooth stream function create a coherent curl field.
    let diagonal = 0.25 * cos((q.x+q.y)*0.5+t);
    direction = vec2f(-sin(ax)*sin(by)+diagonal, -cos(ax)*cos(by)-diagonal) / 1.25;
  }
  let coordinate = vec2f(id.xy) + gleechPatternOffset(direction * settings.geometry.w / settings.geometry.xy) * vec2f(size);
  textureStore(outputImage, vec2i(id.xy), sampleSource(coordinate, vec2i(size)));
}
@compute @workgroup_size(8, 8)
fn glass(@builtin(global_invocation_id) id: vec3u) { refractField(id, false); }
@compute @workgroup_size(8, 8)
fn flow(@builtin(global_invocation_id) id: vec3u) { refractField(id, true); }
fn materialField(id: vec3u, holographic: bool) {
  let size = textureDimensions(source);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let original = textureLoad(source, vec2i(id.xy), 0);
  if (settings.geometry.w == 0) {
    textureStore(outputImage, vec2i(id.xy), original);
    return;
  }
  let uv = gleechPatternUv((vec2f(id.xy)+0.5) / vec2f(size));
  let q = (uv-settings.motion.yz)*settings.geometry.xy*settings.geometry.z*2*PI;
  let t = settings.motion.x; let s = settings.motion.w;
  let luminance = dot(original.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let field = 0.35*sin(q.x+t+s)+0.35*cos(q.y-t)+luminance*4;
  let palette = 0.5+0.5*cos(vec3f(field*PI)+vec3f(0, 2*PI/3, 4*PI/3));
  var treatment = original.rgb*0.35+palette*(0.25+0.75*luminance);
  if (holographic) {
    let bands = 0.5+0.5*sin(q.y+t+s+0.5*sin(q.x-t));
    let contour = pow(0.5+0.5*cos(luminance*24+q.x*0.2+sin(t)), 8.0);
    let light = luminance*0.7+bands*0.35+contour*0.45;
    treatment = original.rgb*0.35+vec3f(0.12, 0.65, 1)*light;
  }
  textureStore(outputImage, vec2i(id.xy), vec4f(clamp(mix(original.rgb, treatment, settings.geometry.w), vec3f(0), vec3f(1)), original.a));
}
@compute @workgroup_size(8, 8)
fn iridescence(@builtin(global_invocation_id) id: vec3u) { materialField(id, false); }
@compute @workgroup_size(8, 8)
fn hologram(@builtin(global_invocation_id) id: vec3u) { materialField(id, true); }
@compute @workgroup_size(8, 8)
fn caustics(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(source);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let original = textureLoad(source, vec2i(id.xy), 0);
  if (settings.geometry.w == 0) { textureStore(outputImage, vec2i(id.xy), original); return; }
  let uv = gleechPatternUv((vec2f(id.xy)+0.5) / vec2f(size));
  let q = (uv-settings.motion.yz)*settings.geometry.xy*settings.geometry.z*2*PI;
  let ax = q.x+sin(q.y+settings.motion.x)*0.7+settings.motion.w;
  let by = q.y+sin(q.x-settings.motion.x)*0.65;
  let light = pow(max(1-abs(sin(ax)), 1-abs(sin(by))), settings.options.z);
  let spectral = pow(vec3f(1)-abs(sin(vec3f(ax)+settings.options.w*vec3f(-0.3, 0, 0.3))), vec3f(settings.options.z));
  let intensity = vec3f(light)*(1-settings.options.w)+spectral*settings.options.w;
  let treatment = original.rgb*(0.65+intensity*0.8)+intensity*0.65;
  let rgb = clamp(original.rgb*(1-settings.geometry.w)+treatment*settings.geometry.w, vec3f(0), vec3f(1));
  textureStore(outputImage, vec2i(id.xy), vec4f(rgb, original.a));
}
fn extendedRefraction(id: vec3u, chrome: bool) {
  let size = textureDimensions(source);
  if (id.x >= size.x || id.y >= size.y) { return; }
  if (settings.geometry.w == 0) {
    textureStore(outputImage, vec2i(id.xy), textureLoad(source, vec2i(id.xy), 0)); return;
  }
  let uv = gleechPatternUv((vec2f(id.xy)+0.5)/vec2f(size));
  let q = (uv-settings.motion.yz)*settings.geometry.xy*settings.geometry.z*2*PI;
  let t = settings.motion.x; let s = settings.motion.w;
  var direction = vec2f(sin(q.x+t+cos(q.y+s)*1.4), cos(q.y-t+sin(q.x+s)*1.4));
  if (!chrome) {
    let wave = 0.65*sin(q.y*1.7+sin(q.x*0.5+t)*1.2+s)+0.25*sin(q.x*2.3-t+s)+0.1*cos((q.x-q.y)*3+t);
    var envelope = 1.0;
    if (settings.options.w > 0) { envelope = pow(max(0.0, 1-abs((uv.y-settings.motion.z)*2)), settings.options.w*4); }
    direction = vec2f(cos(settings.options.z), sin(settings.options.z))*wave*envelope;
  }
  let coordinate = vec2f(id.xy)+gleechPatternOffset(direction*settings.geometry.w/settings.geometry.xy)*vec2f(size);
  var color = sampleSource(coordinate, vec2i(size));
  if (chrome) {
    let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let metal = 0.5+0.5*sin(luminance*settings.options.w*PI+sin(q.x+q.y)*0.7);
    let shine = pow(0.5+0.5*cos(q.x+t+cos(q.y-s)), 12.0)*settings.options.z;
    color = vec4f(clamp(color.rgb*0.3+metal*0.7+shine, vec3f(0), vec3f(1)), color.a);
  }
  textureStore(outputImage, vec2i(id.xy), color);
}
@compute @workgroup_size(8, 8)
fn chrome(@builtin(global_invocation_id) id: vec3u) { extendedRefraction(id, true); }
@compute @workgroup_size(8, 8)
fn mirage(@builtin(global_invocation_id) id: vec3u) { extendedRefraction(id, false); }
@compute @workgroup_size(8, 8)
fn nebula(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(source);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = gleechPatternUv((vec2f(id.xy)+0.5)/vec2f(size));
  let q = (uv-settings.motion.yz)*settings.geometry.xy*settings.geometry.z*2*PI;
  var density = 0.0; var weightSum = 0.0; var weight = 1.0; var frequency = 1.0;
  for (var octave = 0u; octave < u32(round(settings.options.z)); octave++) {
    let a = q.x*frequency+settings.motion.x+settings.motion.w*f32(octave+1u);
    let b = q.y*frequency-settings.motion.x;
    let field = sin(a+cos(b)*1.3)*cos(b+sin(a)*0.7);
    density = density+field*weight;
    weightSum = weightSum+weight;
    weight = weight*0.5; frequency = frequency*1.93;
  }
  let cloud = clamp(0.5+density/weightSum*0.75*settings.geometry.w, 0.0, 1.0);
  let glow = pow(cloud, 8.0)*settings.options.w*2;
  let phase = cloud*PI+settings.motion.w+sin(settings.motion.x)*0.5;
  let palette = 0.3+0.7*(0.5+0.5*cos(vec3f(phase)+vec3f(0, 2.2, 4.2)));
  let rgb = clamp(vec3f(0.015, 0.025, 0.08)*(1-cloud)+palette*cloud*cloud+glow, vec3f(0), vec3f(1));
  let alpha = select(textureLoad(source, vec2i(id.xy), 0).a, 1.0, settings.options.y > 0.5);
  textureStore(outputImage, vec2i(id.xy), vec4f(rgb, alpha));
}
` +
  BETA_SHADER_WGSL +
  REFERENCE_SHADER_WGSL +
  SET2_SHADER_WGSL +
  ADVANCED_SHADER_WGSL;
