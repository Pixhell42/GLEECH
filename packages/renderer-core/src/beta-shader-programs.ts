// Original still-image programs; paired with effects/beta-shaders.ts CPU fallbacks.
export const BETA_SHADER_WGSL =
  `
fn betaHash(cell: vec2i, seed: u32, lane: u32) -> f32 {
  var h = (bitcast<u32>(cell.x)*0x8da6b343u) ^ (bitcast<u32>(cell.y)*0xd8163841u) ^ seed ^ (lane*0xcb1ab31fu);
  h = (h ^ (h >> 16u))*0x7feb352du;
  h = (h ^ (h >> 15u))*0x846ca68bu;
  return f32(h ^ (h >> 16u))/4294967296.0;
}
fn betaRotate(p: vec2f, angle: f32) -> vec2f {
  let c=cos(angle); let s=sin(angle);
  return vec2f(c*p.x-s*p.y, s*p.x+c*p.y);
}
fn betaSample(id: vec2u, offset: vec2f, size: vec2u) -> vec4f {
  let local=betaRotate(offset, -settings.details.z)/settings.geometry.xy;
  return sampleSource(vec2f(id)+gleechPatternOffset(local)*vec2f(size),vec2i(size));
}
fn betaPalette(field: f32) -> vec3f { return mix(settings.shadow.rgb,settings.accent.rgb,clamp(field,0.0,1.0)); }
fn betaKernel(id: vec3u, mode: u32) {
  let size=textureDimensions(source);
  if (id.x>=size.x || id.y>=size.y) { return; }
  let incoming=textureLoad(source,vec2i(id.xy),0);
  if (settings.geometry.w==0) { textureStore(outputImage,vec2i(id.xy),incoming); return; }
  let uv=gleechPatternUv((vec2f(id.xy)+0.5)/vec2f(size));
  let p=(uv-settings.motion.yz)*settings.geometry.xy;
  let rotated=betaRotate(p,settings.details.z);
  let q=rotated*settings.geometry.z+vec2f(sin(settings.motion.x),cos(settings.motion.x))*0.2;
  let local=fract(q); let cell=vec2i(floor(q));
  let seed=u32(floor(settings.motion.w*100000));
  let a=settings.details.x; let b=settings.details.y; let variant=settings.details.w;
  let aa=max(settings.geometry.x/f32(size.x),settings.geometry.y/f32(size.y))*settings.geometry.z*0.85;
  var field=0.0; var rim=0.0; var light=0.0; var warped=false; var color=incoming;
  if (mode==0u) {
    var first=1e9; var second=1e9; var delta=vec2f(0);
    for (var yy=-1;yy<=1;yy++) { for (var xx=-1;xx<=1;xx++) {
      let cc=cell+vec2i(xx,yy);
      let d=vec2f(cc)+0.5+(vec2f(betaHash(cc,seed,0u),betaHash(cc,seed,1u))-0.5)*b-q;
      let distance=select(length(d),abs(d.x)+abs(d.y),variant==2);
      if (distance<first) { second=first;first=distance;delta=d; }
      else if (distance<second) { second=distance; }
    }}
    let gap=select(second-first,abs(first-0.35),variant==1);
    rim=1-smoothstep(a*0.25,a*0.25+aa,gap);
    color=betaSample(id.xy,delta*settings.geometry.w*(1-rim),size);
    light=rim;warped=true;
  } else if (mode==2u || mode==5u) {
    var qq=q;
    if (variant==1 && mode==2u) { qq.y=qq.y*0.25; }
    if (variant==2 && mode==2u) { qq.x=qq.x+qq.y*0.5; }
    if (variant==0 && mode==5u) { qq=vec2f(q.x+q.y,q.y-q.x)*0.70710678; }
    var cc=vec2i(floor(qq));let ll=fract(qq);
    var edge=min(min(ll.x,1-ll.x),min(ll.y,1-ll.y));
    if (variant==2 && mode==5u) {
      let row=i32(floor(q.y/0.8660254)); var first=1e9;var second=1e9;
      for(var yy=-1;yy<=1;yy++) { for(var xx=-1;xx<=1;xx++) {
        let hh=vec2i(cell.x+xx,row+yy);
        let delta=vec2f(f32(hh.x)+f32(hh.y&1)*0.5,f32(hh.y)*0.8660254)-q;
        let distance=length(delta);
        // Keep shared-edge refraction choices stable across GPU/CPU rounding.
        if(distance+0.00001<first){second=first;first=distance;cc=hh;}
        else if(distance<second){second=distance;}
      }}
      edge=max(0.0,second-first);
    }
    if (variant==1 && mode==5u) { edge=min(edge,abs(ll.x+ll.y-1)*0.70710678); }
    let delta=vec2f(betaHash(cc,seed,0u),betaHash(cc,seed,1u))*2-1;
    let tilt=select(1.0,-1.0,mode==5u && variant==1 && ll.x+ll.y>1);
    color=betaSample(id.xy,delta*b*settings.geometry.w*tilt,size);
    rim=1-smoothstep(a*0.2,a*0.2+aa,edge);
    light=select(rim,rim*(0.45+betaHash(cc,seed,2u)*0.55),mode==5u);warped=true;
  } else if (mode==4u) {
    var radius=length(rotated);
    if (variant==1) { radius=max(abs(rotated.x),abs(rotated.y)); }
    if (variant==2) { radius=max(abs(rotated.x),abs(rotated.x)*0.5+abs(rotated.y)*0.8660254); }
    radius=max(radius*settings.geometry.z*0.5,0.0001);
    let depth=log2(radius)*a+settings.motion.x/(2*PI)+settings.motion.w;
    var polarAngle=0.0;
    if(length(rotated)>0.000001){polarAngle=atan2(rotated.y,rotated.x);}
    let turn=polarAngle+log2(radius)*b*2;
    let targetRadius=0.06+fract(depth)*0.48;
    color=betaSample(id.xy,(vec2f(cos(turn),sin(turn))*targetRadius-rotated)*(settings.geometry.w/0.15),size);
    rim=1-smoothstep(0.0,min(0.2,aa*a),fract(depth));light=rim*0.3;warped=true;
  } else if (mode==3u) {
    let rays=u32(round(a)); var total=vec3f(0);
    for (var ray=0u;ray<rays;ray++) {
      let direction=select(f32(ray)/f32(rays)*2*PI,f32(ray%4u)*PI/2+f32(ray/4u)*0.04,variant==1);
      let theta=direction+settings.motion.w*0.05+sin(settings.motion.x)*0.25;
      for (var step=1u;step<=6u;step++) {
        let distance=b*0.16*(f32(step)/6)/settings.geometry.z;
        let sampled=betaSample(id.xy,vec2f(cos(theta),sin(theta))*distance,size);
        let luma=sampled.r*0.2126+sampled.g*0.7152+sampled.b*0.0722;
        let bright=max(0.0,luma-settings.options.z)/max(0.001,1-settings.options.z);
        let weight=bright*sampled.a*(1-f32(step)/8)/f32(rays);
        let spectral=select(vec3f(1),0.5+0.5*cos(vec3f(theta)+vec3f(0,2*PI/3,4*PI/3)),variant==2);
        total=total+sampled.rgb*weight*spectral;
      }
    }
    let envelope=1/(1+length(rotated)*0.5);
    let brightness=clamp(total.r+total.g+total.b,0.0,1.0);
    color=vec4f(clamp(incoming.rgb+total*settings.geometry.w*envelope*mix(vec3f(1),betaPalette(brightness),settings.options.w),vec3f(0),vec3f(1)),incoming.a);warped=true;
  } else if (mode==1u) {
    let theta=a*PI/2;
    var one=q.x*2*PI;var two=(q.x*cos(theta)-q.y*sin(theta))*2*PI;
    if (variant==1) { one=length(q)*2*PI;two=length(q+vec2f(a,0))*2*PI; }
    if (variant==2) { one=one+sin(q.y*2*PI)*1.5;two=two+cos(q.y*2*PI)*1.5; }
    field=clamp(0.5+sin(one+settings.motion.w)*sin(two+settings.motion.x)*(0.5+b*3),0.0,1.0);
  } else if (mode==6u) {
    let hh=vec2f(betaHash(cell,seed,0u),betaHash(cell,seed,1u));
    let lines=select(vec2f(0.75),vec2f(0.25),hh<vec2f(0.5));
    var distance=min(abs(local.x-lines.x),abs(local.y-lines.y));
    if (variant==1) { distance=min(distance,abs(local.x+local.y-1)*0.70710678); }
    if (variant==2) { distance=abs(length(local-0.5)-0.32); }
    let trace=1-smoothstep(a*0.18,a*0.18+aa,distance);
    let junction=1-smoothstep(0.03,0.04+b*0.25,length(local-lines));
    field=clamp(trace+junction*b,0.0,1.0);
  } else if (mode==7u) {
    let row=i32(floor(q.y));let shift=(betaHash(vec2i(0,row),seed,2u)-0.5)*b*2;
    let xx=q.x+shift+select(0.0,f32(row%2)*0.5,variant==1);
    let cc=vec2i(i32(floor(xx)),select(row,i32(floor(q.y*0.2)),variant==2));
    let occupied=select(0.0,1.0,betaHash(cc,seed,0u)<a);
    let edgeX=min(fract(xx),1-fract(xx));let edgeY=select(min(local.y,1-local.y),0.5,variant==2);
    let cut=select(1.0,0.0,betaHash(cc,seed,1u)<b*0.35);
    field=occupied*cut*smoothstep(0.08,0.08+aa,min(edgeX,edgeY));
  } else if (mode==8u) {
    let xx=q.x+sin(q.y*1.7+settings.motion.w)*a*1.5;
    let yy=q.y+cos(q.x+settings.motion.x)*a*1.5;
    var wave=sin(xx*2*PI)*sin(yy*2*PI);
    if (variant==1) { wave=sin(xx*2*PI); }
    if (variant==2) { wave=sin(length(vec2f(xx,yy))*2*PI+settings.motion.w); }
    field=smoothstep(-max(0.02,1-b),max(0.02,1-b),wave);
  } else {
    let radius=length(q);let theta=atan2(q.y,q.x);
    let spiral=select(0.0,radius*0.75,variant==1);
    let spokes=abs(sin((theta+spiral)*(a*0.5)+settings.motion.w));
    let rings=abs(sin(radius*2*PI+settings.motion.x));
    field=1-smoothstep(b*0.8,b*0.8+min(0.4,aa*3),min(spokes,rings));
    if (variant==2) { field=field*(0.25+0.75*(0.5+0.5*cos(theta-settings.motion.x-settings.motion.w))); }
  }
  if (!warped) {
    let treatment=mix(vec3f(field),betaPalette(field),settings.options.w);
    color=vec4f(mix(incoming.rgb,treatment,settings.geometry.w),incoming.a);
  } else if (light>0) {
    color=vec4f(clamp(color.rgb+light*mix(vec3f(0.4),betaPalette(rim),settings.options.w),vec3f(0),vec3f(1)),color.a);
  }
  textureStore(outputImage,vec2i(id.xy),color);
}
` +
  [
    'membrane',
    'moire',
    'fracture',
    'diffraction',
    'tunnel',
    'crystal',
    'circuit',
    'lattice',
    'opart',
    'polar',
  ]
    .map(
      (name, index) =>
        '@compute @workgroup_size(8,8) fn ' +
        name +
        '(@builtin(global_invocation_id) id: vec3u) { betaKernel(id,' +
        index +
        'u); }',
    )
    .join('\n');
