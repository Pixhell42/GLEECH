// Original Set 2 materials. Uniform slots mirror effects/set2-shaders.ts.
export const SET2_SHADER_WGSL = `
fn set2Boundary(index:i32, seed:u32)->f32 {
  return f32(index)+(betaHash(vec2i(index,0),seed,9u)-.5)*settings.details.x*.75;
}
fn set2Kernel(id:vec3u,kind:u32) {
  let size=textureDimensions(source);if(id.x>=size.x||id.y>=size.y){return;}
  let incoming=textureLoad(source,vec2i(id.xy),0);
  if(settings.geometry.w==0){textureStore(outputImage,vec2i(id.xy),incoming);return;}
  let uv=gleechPatternUv((vec2f(id.xy)+.5)/vec2f(size));
  var q=betaRotate((uv-settings.motion.yz)*settings.geometry.xy,settings.details.z)*settings.geometry.z;
  let phase=settings.motion.x;let seed=u32(floor(settings.motion.w*100000));
  let aa=max(settings.geometry.x/f32(size.x),settings.geometry.y/f32(size.y))*settings.geometry.z;
  var result=vec3f(0);
  if(kind==0u) {
    var warped=q;
    for(var j=0;j<3;j++) {
      let n=referenceNoise(warped*.7+vec2f(sin(phase),cos(phase))*.2,seed);
      let turn=settings.details.x*.55/f32(j+1);
      warped.x+=turn*sin(warped.y*2+n*6+phase);
      warped.y+=turn*cos(warped.x*2-n*5+phase);
    }
    let h=referenceHeight(uv);
    let line=(warped.x+h*4*settings.options.w)*settings.details.y+phase+settings.motion.w;
    let wave=sin(select(line,line+sin(warped.y)*2,settings.options.z>.5));
    let tone=clamp(wave*.5/max(.05,1-settings.details.w*.92)+.5,0.0,1.0);
    let delta=betaRotate((warped-q)*settings.accent.w/settings.geometry.z,-settings.details.z)/settings.geometry.xy;
    let color=sampleSource(vec2f(id.xy)+gleechPatternOffset(delta)*vec2f(size),vec2i(size));
    result=mix(mix(settings.shadow.rgb,settings.accent.rgb,tone),color.rgb,settings.shadow.w);
  } else if(kind==1u) {
    q+=vec2f(sin(phase),cos(phase)-1)*.22+vec2f(betaHash(vec2i(0),seed,6u),betaHash(vec2i(0),seed,7u));
    let cell=vec2i(floor(q));let local=fract(q);
    let dots=settings.options.z==1|| (settings.options.z==2&&betaHash(cell,seed,1u)<settings.details.w);
    var distance=0.0;var radius=0.0;
    if(dots) {
      distance=length(local-.5);
      radius=settings.details.y*(.85+sin(phase+betaHash(cell,seed,2u)*2*PI)*.15);
      if(settings.options.z==1&&betaHash(cell,seed,1u)>=settings.details.w){radius=-1;}
    } else {
      let xx=select(1-local.x,local.x,betaHash(cell,seed,0u)<.5);
      distance=min(abs(length(vec2f(xx,local.y))-.5),abs(length(vec2f(1-xx,1-local.y))-.5));
      radius=settings.details.x*.5;
    }
    let coverage=select(0.0,clamp((radius-distance)/max(aa,.00001)+.5,0.0,1.0),radius>0);
    let boundary=min(min(local.x,local.y),min(1-local.x,1-local.y));
    let grid=clamp((.012-boundary)/max(aa,.00001),0.0,1.0)*settings.accent.w;
    let ink=mix(incoming.rgb,settings.accent.rgb,settings.options.w);
    let base=mix(settings.shadow.rgb,incoming.rgb,settings.shadow.w);
    result=mix(mix(base,ink,coverage),ink,grid);
  } else if(kind==2u) {
    let cell=vec2i(floor(q));
    let clump=referenceNoise(q*.3+vec2f(sin(phase),cos(phase))*.08,seed);
    result=mix(settings.shadow.rgb,incoming.rgb,settings.shadow.w);
    for(var yy=-1;yy<=1;yy++){for(var xx=-1;xx<=1;xx++){
      let neighbor=cell+vec2i(xx,yy);let spin=betaHash(neighbor,seed,3u)*2*PI;
      let center=vec2f(neighbor)+.25+vec2f(betaHash(neighbor,seed,1u),betaHash(neighbor,seed,2u))*.5+vec2f(sin(phase+spin),cos(phase+spin))*.07;
      let local=q-center;let angle=atan2(local.y,local.x);
      let irregularity=1+sin(angle*3+spin)*settings.accent.w*.22;
      let radius=min(1.0,settings.details.x*mix(.7,.3+clump*1.4,settings.accent.w)*irregularity);let distance=length(local);
      let body=select(0.0,clamp((radius-distance)/max(aa,.00001)+.5,0.0,1.0),radius>0);
      let ring=select(0.0,clamp((radius*settings.details.y-abs(distance-radius))/max(aa,.00001)+.5,0.0,1.0),radius>0&&settings.details.y>0);
      let flecks=referenceNoise(q*121.37+vec2f(neighbor)*3+.37,seed);
      let nucleusDistance=length(local-radius*.18*vec2f(cos(spin),sin(spin)));
      let nucleus=select(0.0,clamp((radius*.2-nucleusDistance)/max(aa,.00001)+.5,0.0,1.0),radius>0);
      let pigment=clamp(body*select(.4,.65,settings.options.z>.5)+ring*.5+nucleus*.3+(flecks-.5)*settings.details.w*body*.5,0.0,1.0);
      let alternate=betaHash(neighbor,seed,5u)>.5&&settings.options.z<.5;
      let ink=select(settings.accent.rgb,settings.accent.brg,alternate)*(1-nucleus*.35);
      result=mix(result,mix(incoming.rgb,ink,settings.options.w),pigment);
    }}
  } else {
    var cell=i32(floor(q.x));var left=set2Boundary(cell,seed);var right=set2Boundary(cell+1,seed);
    if(q.x<left){cell-=1;right=left;left=set2Boundary(cell,seed);}else if(q.x>right){cell+=1;left=right;right=set2Boundary(cell+1,seed);}
    let t=clamp((q.x-left)/(right-left),0.0,1.0);
    let eased=mix(t,.5-cos(t*PI)*.5,settings.shadow.w);
    let bend=.5-eased+sin(phase+betaHash(vec2i(cell,0),seed,3u)*2*PI)*.16;
    let delta=betaRotate(vec2f(bend*settings.details.y,0),-settings.details.z)/settings.geometry.xy;
    let color=sampleSource(vec2f(id.xy)+gleechPatternOffset(delta)*vec2f(size),vec2i(size));
    let edge=clamp((settings.details.w-min(t,1-t))/max(settings.details.w,aa),0.0,1.0);
    let hue=betaHash(vec2i(cell,0),seed,4u)*2*PI+phase+t*4;
    let light=.78+sin(t*PI)*.22;
    let face=mix(settings.accent.rgb,settings.shadow.rgb,mix(betaHash(vec2i(cell,0),seed,6u),eased,.35))*light;
    let material=mix(face,color.rgb,settings.options.w*select(1.0,.3,settings.options.z>.5));
    let spectral=.5+.5*cos(vec3f(hue)+vec3f(0,2*PI/3,4*PI/3));
    result=mix(material,mix(vec3f(1),spectral,settings.accent.w),edge);
  }
  if(kind==2u){let lens=fract(settings.options.z)/.49;let distance=length((uv-.5)*settings.geometry.xy);result=mix(result,settings.shadow.rgb,lens*clamp((distance-.42)/.08,0.0,1.0));}
  let alpha=select(incoming.a,1.0,settings.options.y>.5);
  textureStore(outputImage,vec2i(id.xy),clamp(mix(incoming,vec4f(result,alpha),settings.geometry.w),vec4f(0),vec4f(1)));
}
@compute @workgroup_size(8,8)
fn marbling(@builtin(global_invocation_id) id:vec3u){set2Kernel(id,0u);}
@compute @workgroup_size(8,8)
fn truchet(@builtin(global_invocation_id) id:vec3u){set2Kernel(id,1u);}
@compute @workgroup_size(8,8)
fn microculture(@builtin(global_invocation_id) id:vec3u){set2Kernel(id,2u);}
@compute @workgroup_size(8,8)
fn prismpanels(@builtin(global_invocation_id) id:vec3u){set2Kernel(id,3u);}
`;
