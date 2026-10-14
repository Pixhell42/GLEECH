import { ADVANCED_KERNEL_WGSL } from './set2-advanced-kernel';
export const ADVANCED_PROGRAMS = [
  'contourmelt',
  'filamentflow',
  'signalorb',
  'hatchedsolids',
  'mandelbrotslices',
  'arcnetwork',
  'beadweave',
  'facetmandala',
  'particleweb',
  'liquidfoil',
  'signalslabs',
  'spectrumprojector',
] as const;
export const ADVANCED_SHADER_WGSL =
  `
@group(0) @binding(4) var<storage,read> advancedData:array<f32>;
var<private> advancedIncoming:vec4f;
var<private> advancedOut:vec3f;
var<private> advancedAa:f32;
var<private> advancedPatternUv:vec2f;
fn a_P(i:f32)->f32{return advancedData[u32(i)];}
fn a_U(i:f32)->f32{
 let lane=u32(i)%4u;
 switch u32(i)/4u {
 case 0u:{return settings.geometry[lane];}case 1u:{return settings.motion[lane];}
 case 2u:{return settings.options[lane];}case 3u:{return settings.patternX[lane];}
 case 4u:{return settings.patternY[lane];}case 5u:{return settings.details[lane];}
 case 6u:{return settings.accent[lane];}default:{return settings.shadow[lane];}
 }
}
fn a_AA()->f32{return advancedAa;}
fn a_I(i:f32)->f32{return advancedIncoming[u32(i)];}
fn a_R(x:f32,y:f32,lane:f32)->f32{return betaHash(vec2i(floor(vec2f(x,y))),u32(floor(settings.motion.w*100000)),u32(lane));}
fn a_N(x:f32,y:f32)->f32{return referenceNoise(vec2f(x,y),u32(floor(settings.motion.w*100000)));}
fn a_H(u:f32,v:f32)->f32{return referenceHeight(vec2f(u,v));}
fn a_ATAN(y:f32,x:f32)->f32 {if(abs(x)+abs(y)<0.000001){return 0.0;}return atan2(y,x);}
// Exact Q20 multiply using signed high words and unsigned low words. Splitting
// into ten-bit halves keeps all intermediates in range without requiring i64.
fn fractalMultiply(a:i32,b:i32)->i32 {
 let ah=a>>10;let bh=b>>10;let al=a&1023;let bl=b&1023;
 let mid=ah*bl+al*bh;
 return ah*bh+(mid>>10)+(((mid&1023)*1024+al*bl)>>20);
}
fn fractalOrbit(cx:i32,cy:i32,limit:f32)->f32 {
 var zx=0;var zy=0;var count=limit;
 for(var j=0;j<i32(limit);j++) {
  let next=fractalMultiply(zx,zx)-fractalMultiply(zy,zy)+cx;
  zy=2*fractalMultiply(zx,zy)+cy;zx=next;
  let ax=f32(zx)/1048576.0;let ay=f32(zy)/1048576.0;let norm=ax*ax+ay*ay;
  if(norm>64.0){count=f32(j+1)-log(max(1.0,log(norm)))/0.693147;break;}
 }
 return clamp(count/limit,0.0,1.0);
}
fn a_M(x:f32,y:f32,limit:f32)->f32 {
 let p=vec2f(x,y)*8192.0;let cell=vec2i(floor(p));let t=p-floor(p);
 let a=fractalOrbit(cell.x*128,cell.y*128,limit);let b=fractalOrbit((cell.x+1)*128,cell.y*128,limit);
 let c=fractalOrbit(cell.x*128,(cell.y+1)*128,limit);let d=fractalOrbit((cell.x+1)*128,(cell.y+1)*128,limit);
 return mix(mix(a,b,t.x),mix(c,d,t.x),t.y);
}
fn a_T(u:f32,v:f32,ch:f32)->f32 {if(all(vec2f(u,v)==advancedPatternUv)){return advancedIncoming[u32(ch)];}let size=textureDimensions(source);return sampleSource(gleechCanvasUv(vec2f(u,v))*vec2f(size)-.5,vec2i(size))[u32(ch)];}
fn a_D(u:f32,v:f32,ch:f32)->f32 {
 let size=vec2f(advancedData[64],advancedData[65]);let p=clamp(vec2f(u,v)*size-.5,vec2f(0),size-1);
 let a=vec2u(floor(p));let b=min(a+vec2u(1),vec2u(size)-1);let t=fract(p);let w=u32(size.x);let c=u32(ch);
 let aa=advancedData[66u+(a.y*w+a.x)*2u+c];let ab=advancedData[66u+(a.y*w+b.x)*2u+c];
 let ba=advancedData[66u+(b.y*w+a.x)*2u+c];let bb=advancedData[66u+(b.y*w+b.x)*2u+c];
 return mix(mix(aa,ab,t.x),mix(ba,bb,t.x),t.y);
}
` +
  ADVANCED_KERNEL_WGSL +
  `
fn advancedBegin(id:vec3u){
 let size=textureDimensions(source);if(id.x>=size.x||id.y>=size.y){return;}
 advancedIncoming=textureLoad(source,vec2i(id.xy),0);
 if(settings.geometry.w==0){textureStore(outputImage,vec2i(id.xy),advancedIncoming);return;}
 let uv=gleechPatternUv((vec2f(id.xy)+.5)/vec2f(size));
 advancedPatternUv=uv;
 advancedAa=max(settings.geometry.x/f32(size.x),settings.geometry.y/f32(size.y));
 advancedOut=vec3f(0);
}
fn advancedEnd(id:vec3u){
 let alpha=select(advancedIncoming.a,1.0,settings.options.y>.5);
 textureStore(outputImage,vec2i(id.xy),clamp(mix(advancedIncoming,vec4f(advancedOut,alpha),settings.geometry.w),vec4f(0),vec4f(1)));
}
` +
  ADVANCED_PROGRAMS.map(
    (name, i) =>
      `@compute @workgroup_size(8,8) fn ${name}(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(source);if(id.x>=size.x||id.y>=size.y){return;}if(settings.geometry.w==0){textureStore(outputImage,vec2i(id.xy),textureLoad(source,vec2i(id.xy),0));return;}advancedBegin(id);a_Shade${i}(advancedPatternUv.x,advancedPatternUv.y,f32(id.x),f32(id.y));advancedEnd(id);}`,
  ).join('\n');
