// Original implementations of the agreed dot-flower and ribbon treatments.
// Uniform slots match effects/reference-shaders.ts; loops are bounded by metadata.
export const REFERENCE_SHADER_WGSL = `
fn referenceNoise(p: vec2f, seed: u32) -> f32 {
  let cell=vec2i(floor(p));let f=fract(p);let t=f*f*(3-2*f);
  return mix(mix(betaHash(cell,seed,0u),betaHash(cell+vec2i(1,0),seed,0u),t.x),mix(betaHash(cell+vec2i(0,1),seed,0u),betaHash(cell+vec2i(1,1),seed,0u),t.x),t.y);
}
fn billowNoise(p:vec2f,seed:u32)->f32 {
  return referenceNoise(p,seed)*.58+referenceNoise(p*2.07+11,seed)*.28+referenceNoise(p*4.19+27,seed)*.14;
}
fn eddyPoint(p:vec2f,phase:f32,seed:u32,strength:f32,extent:f32)->vec2f {
  if(strength==0){return p;}
  let cell=vec2i(floor(p/extent));var delta=vec2f(0);var weights=0.0;
  for(var yy=-1;yy<=1;yy++){for(var xx=-1;xx<=1;xx++){
    let neighbor=cell+vec2i(xx,yy);
    let local=p-(vec2f(neighbor)+.25+vec2f(betaHash(neighbor,seed,20u),betaHash(neighbor,seed,21u))*.5)*extent;
    let falloff=clamp(1-dot(local,local)/(extent*extent*1.21),0.0,1.0);let weight=falloff*falloff;
    let angle=phase*select(1.0,-1.0,betaHash(neighbor,seed,22u)<.5)+betaHash(neighbor,seed,23u)*2*PI;
    delta+=(betaRotate(local,angle)-local)*weight;weights+=weight;
  }}
  return p+delta*strength/max(1.0,weights);
}
fn paintDrip(p:vec2f,cell:vec2i,seed:u32,aa:f32)->f32 {
  let viscosity=settings.shadow.w;let run=(1-viscosity)*(1-viscosity);
  if(run==0||betaHash(cell,seed,0u)>=settings.details.x){return 0;}
  let local=p-(vec2f(cell)+.5+(vec2f(betaHash(cell,seed,1u),betaHash(cell,seed,2u))-.5)*.5);
  let gravity=betaRotate(local,-settings.details.z);
  let spin=betaHash(cell,seed,3u)*2*PI+settings.motion.x;let radius=settings.details.y*(.75+.25*cos(spin));
  var coverage=0.0;
  for(var j=0u;j<3u;j++) {
    let start=radius*.25;let reach=run*(1.25+radius*1.5)*(.45+betaHash(cell,seed,30u+j)*.55);
    let end=start+reach;let along=clamp(gravity.y,start,end);let t=clamp((gravity.y-start)/max(reach,.00001),0.0,1.0);
    let offset=radius*(betaHash(cell,seed,33u+j)*1.1-.55);let bend=run*radius*.08*sin(along*3+spin);
    let thickness=radius*(.05+viscosity*.04)*(.6+betaHash(cell,seed,36u+j)*.4);let width=thickness*(1-t*.45);
    let distance=length(vec2f(gravity.x-offset-bend,gravity.y-along));
    coverage=max(coverage,clamp((width-distance)/max(aa,.00001)+.5,0.0,1.0));
    let tip=length(vec2f(gravity.x-offset-bend,gravity.y-end));
    coverage=max(coverage,clamp((thickness*1.5-tip)/max(aa,.00001)+.5,0.0,1.0));
  }
  return coverage;
}
fn referenceKernel(id:vec3u,flowers:bool) {
  let size=textureDimensions(source);if(id.x>=size.x||id.y>=size.y){return;}
  let incoming=textureLoad(source,vec2i(id.xy),0);
  if(settings.geometry.w==0){textureStore(outputImage,vec2i(id.xy),incoming);return;}
  let uv=gleechPatternUv((vec2f(id.xy)+.5)/vec2f(size));
  let q=betaRotate((uv-settings.motion.yz)*settings.geometry.xy,settings.details.z)*settings.geometry.z;
  let seed=u32(floor(settings.motion.w*100000));let phase=settings.motion.x;
  let aa=max(settings.geometry.x/f32(size.x),settings.geometry.y/f32(size.y))*settings.geometry.z;
  var result=vec3f(0);var alpha=incoming.a;
  if(flowers) {
    var coverage=0.0;let row=i32(floor(q.y));let col=i32(floor(q.x-f32(row&1)*.5));
    for(var yy=-1;yy<=1;yy++){for(var xx=-1;xx<=1;xx++){
      let cell=vec2i(col+xx,row+yy);
      let gate=referenceNoise(vec2f(cell)/settings.shadow.w+vec2f(cos(phase),sin(phase)),seed);
      if(gate<1-settings.details.w){continue;}
      let local=q-(vec2f(cell)+vec2f(.5+f32(cell.y&1)*.5,.5));
      let rotation=betaHash(cell,seed,2u)*2*PI+phase;
      let radius=settings.details.y*(.8+.2*cos(rotation+phase));
      for(var j=0u;j<u32(settings.details.x);j++) {
        let theta=rotation+f32(j)*2*PI/settings.details.x;
        let distance=length(local-radius*vec2f(cos(theta),sin(theta)));
        coverage=max(coverage,clamp((settings.accent.w-distance)/max(aa,.00001)+.5,0.0,1.0));
      }
    }}
    let foreground=mix(incoming.rgb,settings.accent.rgb,settings.options.w);
    result=mix(settings.shadow.rgb,foreground,coverage);
    if(settings.options.y>.5){alpha=1;}
  }else {
    let field=referenceNoise(q*vec2f(.7,1.7),seed);
    let wave=sin(q.y*5+field*9+phase);
    let travel=settings.details.x*settings.geometry.w*wave;
    let offset=vec2f(cos(settings.details.z),sin(settings.details.z))*travel/settings.geometry.xy;
    let color=sampleSource(vec2f(id.xy)+gleechPatternOffset(offset)*vec2f(size),vec2i(size));
    alpha=color.a;
    let luma=dot(color.rgb,vec3f(.2126,.7152,.0722));
    let band=floor(luma*settings.details.y+wave*.45);
    let spectral=band/settings.details.y*2*PI+phase;
    var treatment=.5+.5*cos(vec3f(spectral)+vec3f(0,2*PI/3,4*PI/3));
    if(luma<settings.details.w){treatment=select(settings.accent.rgb,settings.shadow.rgb,field>.35);}
    result=mix(color.rgb,treatment,settings.options.w);
  }
  textureStore(outputImage,vec2i(id.xy),clamp(mix(incoming,vec4f(result,alpha),settings.geometry.w),vec4f(0),vec4f(1)));
}
@compute @workgroup_size(8,8)
fn bloomfield(@builtin(global_invocation_id) id:vec3u){referenceKernel(id,true);}
@compute @workgroup_size(8,8)
fn chromaticerosion(@builtin(global_invocation_id) id:vec3u){referenceKernel(id,false);}
fn referenceAt(pixel:vec2f,offset:vec2f,size:vec2i)->vec4f {
  return sampleSource(pixel+gleechPatternOffset(offset)*vec2f(size),size);
}
fn referenceLuma(color:vec4f)->f32 {return dot(color.rgb,vec3f(.2126,.7152,.0722))*color.a;}
fn referenceGradient(pixel:vec2f,offset:vec2f,r:f32,size:vec2i)->f32 {
  let a=referenceAt(pixel,offset-vec2f(r/settings.geometry.x,0),size);
  let b=referenceAt(pixel,offset+vec2f(r/settings.geometry.x,0),size);
  let c=referenceAt(pixel,offset-vec2f(0,r/settings.geometry.y),size);
  let d=referenceAt(pixel,offset+vec2f(0,r/settings.geometry.y),size);
  return length(vec2f(referenceLuma(b)-referenceLuma(a),referenceLuma(d)-referenceLuma(c)));
}
fn referenceMaterialKernel(id:vec3u,kind:u32) {
  let size=textureDimensions(source);if(id.x>=size.x||id.y>=size.y){return;}
  let pixel=vec2f(id.xy);let incoming=textureLoad(source,vec2i(id.xy),0);
  if(settings.geometry.w==0){textureStore(outputImage,vec2i(id.xy),incoming);return;}
  let uv=gleechPatternUv((pixel+.5)/vec2f(size));
  let q=betaRotate((uv-settings.motion.yz)*settings.geometry.xy,settings.details.z)*settings.geometry.z;
  let seed=u32(floor(settings.motion.w*100000));let phase=settings.motion.x;
  let spectral=(q.x+q.y)*.6+phase+referenceNoise(q,seed)*2*PI;
  let palette=mix(.5+.5*cos(vec3f(spectral)+vec3f(0,2*PI/3,4*PI/3)),settings.accent.rgb,.25);
  var result=vec3f(0);var alpha=incoming.a;
  if(kind==6u) {
    let stable=floor(q*4096+.5)/4096;let cell=vec2i(floor(stable));let row=i32(floor(stable.y*3));
    var ribbon=settings.shadow.w*clamp((settings.shadow.w-betaHash(vec2i(0,row),seed,3u))/.25+.5,0.0,1.0);
    if(settings.shadow.w==0){ribbon=0;}else if(settings.shadow.w==1){ribbon=1;}
    let wave=sin(stable.x*2+stable.y*3+phase+betaHash(vec2i(0,row),seed,4u)*2*PI);
    let anchor=floor(stable.x/4)*4+betaHash(vec2i(0,row),seed,8u)*4;
    let compressed=anchor+(stable.x-anchor)/(1+settings.details.y*40);
    let ox=settings.details.x*.22*((betaHash(cell,seed,0u)*2-1)+wave*.45)+ribbon*(compressed-stable.x)/settings.geometry.z;
    let oy=settings.details.x*.16*(betaHash(cell,seed,1u)*2-1);
    let color=referenceAt(pixel,betaRotate(vec2f(ox,oy),-settings.details.z)/settings.geometry.xy,vec2i(size));alpha=color.a;
    let grain=(betaHash(vec2i(floor(stable*24)),seed,6u)-.5)*settings.details.w*(.35+.65*ribbon);
    let luma=clamp(referenceLuma(color)+grain,0.0,1.0);let level=min(4u,u32(floor(floor(luma*4096+.5)/4096*5)));
    var ink=settings.shadow.rgb;
    if(level==1u){ink=vec3f(.1,.05,1);}else if(level==2u){ink=settings.accent.rgb;}else if(level==3u){ink=vec3f(.1,1,.05);}else if(level==4u){ink=vec3f(1);}
    result=mix(clamp(color.rgb+grain,vec3f(0),vec3f(1)),ink,settings.options.w);
    if(betaHash(cell,seed,7u)<settings.accent.w){result=settings.shadow.rgb;}
  }else if(kind==7u) {
    let stable=floor(q*4096+.5)/4096;let drift=vec2f(cos(phase)-1,sin(phase))*.7;
    let nx=billowNoise(stable+drift,seed)-.5;let ny=billowNoise(stable+drift+vec2f(19,7),seed)-.5;
    let run=(1-settings.shadow.w)*(1-settings.shadow.w);
    let offset=betaRotate(vec2f(nx*settings.accent.w,ny*settings.accent.w-select(0.0,run*.12,settings.details.w>.5)),-settings.details.z)/settings.geometry.xy;
    let color=referenceAt(pixel,offset,vec2i(size));let aa=max(settings.geometry.x/f32(size.x),settings.geometry.y/f32(size.y))*settings.geometry.z;
    var coverage=0.0;var inkCell=vec2i(floor(stable));
    if(settings.details.w>.5) {
      let ridge=abs(sin(stable.x*1.3+nx*8+phase));
      if(settings.details.x>0){coverage=clamp((settings.details.x*(.1+settings.details.y*.8)-ridge)/(aa+settings.shadow.w*.15)+.5,0.0,1.0);}
    }else {
      let cell=vec2i(floor(stable));
      for(var yy=-1;yy<=1;yy++){for(var xx=-1;xx<=1;xx++){
        let neighbor=cell+vec2i(xx,yy);if(betaHash(neighbor,seed,0u)>=settings.details.x){continue;}
        let local=stable-(vec2f(neighbor)+.5+(vec2f(betaHash(neighbor,seed,1u),betaHash(neighbor,seed,2u))-.5)*.5);
        let spin=betaHash(neighbor,seed,3u)*2*PI+phase;let theta=atan2(local.y,local.x);
        let lobes=3+floor(betaHash(neighbor,seed,4u)*5);
        let radius=settings.details.y*(.75+.25*cos(spin));let ragged=1+(1-settings.shadow.w)*(.35*sin(theta*lobes+spin)+.22*sin(theta*(lobes+3)+spin*1.31));
        let edge=aa+settings.shadow.w*.08;
        var cluster=clamp((radius*ragged-length(local))/edge+.5,0.0,1.0);
        for(var j=0u;j<3u;j++) {
          let angle=spin+betaHash(neighbor,seed,6u+j)*2*PI;let reach=radius*(1.3+betaHash(neighbor,seed,9u+j)*.6);
          let distance=length(local-vec2f(cos(angle),sin(angle))*reach);
          cluster=max(cluster,clamp((radius*(.07+betaHash(neighbor,seed,12u+j)*.15)-distance)/max(aa,.00001)+.5,0.0,1.0));
        }
        cluster=max(cluster,paintDrip(stable,neighbor,seed,aa));
        cluster=floor(cluster*1024+.5)/1024;
        if(cluster>coverage){coverage=cluster;inkCell=neighbor;}
      }}
      for(var step=1;step<=3;step++){for(var side=-1;side<=1;side++){
        let c=cos(settings.details.z);let s=sin(settings.details.z);
        let origin=vec2f((stable.x+s*f32(step))+c*(f32(side)*.75),(stable.y-c*f32(step))+s*(f32(side)*.75));
        let neighbor=vec2i(floor(origin));let drip=floor(paintDrip(stable,neighbor,seed,aa)*1024+.5)/1024;
        if(drip>coverage){coverage=drip;inkCell=neighbor;}
      }}
    }
    let base=mix(settings.shadow.rgb,incoming.rgb,settings.options.z);
    var hue=betaHash(inkCell,seed,45u)*2*PI;
    if(settings.details.w>.5){hue=billowNoise(stable*.45,seed)*2*PI;}
    let brightness=.6+betaHash(inkCell,seed,46u)*.4;
    let varied=(.15+.85*(.5+.5*cos(vec3f(hue)+vec3f(0,2*PI/3,4*PI/3))))*brightness;
    let paint=mix(mix(color.rgb,settings.accent.rgb,settings.options.w),varied,settings.patternX.w);
    result=mix(base,paint,coverage);
  }else if(kind==8u) {
    let stable=floor(q*4096+.5)/4096;let drift=vec2f(cos(phase)-1,sin(phase))*.12;
    let eddies=eddyPoint(stable,phase,seed,settings.patternX.w,settings.patternY.w);
    let warp=(vec2f(billowNoise(eddies+drift,seed),billowNoise(eddies+drift+vec2f(19,7),seed))-.5)*settings.details.y*3;
    let warped=eddies+drift+warp;var thickness=0.0;var lighting=0.0;
    for(var j=0u;j<u32(settings.options.z);j++) {
      let z=f32(j)/max(1.0,settings.options.z-1);let p=warped+vec2f(z*.7,z*.43);let field=billowNoise(p,seed);
      var cloud=0.0;if(settings.details.x>0){cloud=clamp((field-(1-settings.details.x))/(.08+settings.shadow.w*.35),0.0,1.0);}
      let shade=clamp(.5+(billowNoise(p-vec2f(0,.08),seed)-billowNoise(p+vec2f(0,.08),seed))*5,0.0,1.0);
      thickness+=cloud*settings.details.w*3/settings.options.z;
      lighting+=mix(.85,.25+shade*.85,settings.accent.w)/settings.options.z;
    }
    let coverage=1-exp(-thickness);let smoke=mix(incoming.rgb,settings.accent.rgb,settings.options.w)*lighting;
    result=mix(settings.shadow.rgb,smoke,coverage);if(settings.options.y>.5){alpha=1;}
  }else if(kind==3u) {
    let p=(uv-settings.motion.yz)*settings.geometry.xy;
    let radius=length(p);let rawAngular=(atan2(q.y,q.x)+PI)/(2*PI)*settings.details.x;
    let angular=floor(rawAngular*4096+.5)/4096;
    let sector=i32(floor(angular))%i32(settings.details.x);let local=fract(angular);
    let height=(.25+.75*betaHash(vec2i(sector,0),seed,0u))*(.25+.75*referenceLuma(incoming));
    let rr=settings.details.w+max(0.0,radius-settings.details.w)/(1+settings.details.y*height);
    let theta=(f32(sector)+.5)/settings.details.x*2*PI-PI-settings.details.z;
    let sampleUv=settings.motion.yz+vec2f(cos(theta),sin(theta))*rr/settings.geometry.xy;
    let color=referenceAt(pixel,sampleUv-uv,vec2i(size));
    let step=fract(radius*settings.geometry.z*.8-settings.details.y*height+sin(phase)*.2);
    let shade=mix(1.0,.2+.8*(1-abs(local-.5)*2),settings.shadow.w);
    result=mix(color.rgb,palette,settings.options.w)*shade*(.35+.65*step);
    if(radius<settings.details.w){result=settings.shadow.rgb;}
  }else if(kind==4u) {
    let cell=vec2i(floor(q));var nearest=10000.0;var second=10000.0;var winner=vec2i(0);
    for(var yy=-1;yy<=1;yy++){for(var xx=-1;xx<=1;xx++){
      let neighbor=cell+vec2i(xx,yy);
      let point=vec2f(neighbor)+.1+.8*vec2f(betaHash(neighbor,seed,0u),betaHash(neighbor,seed,1u));
      let d=length(q-point);
      if(d<nearest){second=nearest;nearest=d;winner=neighbor;}else{second=min(second,d);}
    }}
    let aa=max(settings.geometry.x/f32(size.x),settings.geometry.y/f32(size.y))*settings.geometry.z;
    let boundary=second-nearest;
    let hole=clamp((nearest-settings.details.x*.4)/(aa+settings.details.y*.08)+.5,0.0,1.0);
    let rounded=clamp(boundary/(.02+settings.details.y*.15),0.0,1.0);
    let face=select(hole*rounded,0.0,betaHash(winner,seed,2u)<settings.details.w);
    let wire=clamp(1-boundary/(aa+.04),0.0,1.0)*settings.accent.w;
    let material=mix(incoming.rgb,palette,settings.options.w)*(.6+.4*cos(nearest*PI));
    result=mix(settings.shadow.rgb,material,face)+settings.accent.rgb*wire;
  }else if(kind==5u) {
    let cell=vec2i(floor(q));
    let orbit=betaHash(cell,seed,5u)*2*PI;
    let shift=.3*(vec2f(cos(orbit+phase),sin(orbit+phase))-vec2f(cos(orbit),sin(orbit)));
    let center=vec2f(cell)+.5+(vec2f(betaHash(cell,seed,0u),betaHash(cell,seed,1u))-.5)*settings.details.w+shift;
    let local=q-center;
    let sampleUv=settings.motion.yz+betaRotate(center/settings.geometry.z,-settings.details.z)/settings.geometry.xy;
    let color=referenceAt(pixel,sampleUv-uv,vec2i(size));let luma=referenceLuma(color);
    let aa=max(settings.geometry.x/f32(size.x),settings.geometry.y/f32(size.y))*settings.geometry.z;
    let radius=settings.details.y*(.5+luma);
    let dotCoverage=clamp((radius-length(local))/aa+.5,0.0,1.0);
    let theta=betaHash(cell,seed,4u)*2*PI+phase;let branch=vec2f(cos(theta),sin(theta))*settings.accent.w;
    let t=clamp(dot(local,branch)/max(dot(branch,branch),.000001),0.0,1.0);
    let branchCoverage=clamp((radius*.3-length(local-t*branch))/aa+.5,0.0,1.0)*settings.accent.w;
    let coverage=select(0.0,max(dotCoverage,branchCoverage),betaHash(cell,seed,2u)<settings.details.x*(.15+.85*luma));
    let p=(uv-settings.motion.yz)*settings.geometry.xy;let extent=settings.options.z;
    var focal=0.0;
    if(extent>0){focal=(exp(-abs(p.x)*70/(extent+.05))*exp(-abs(p.y)/(extent+.02))+exp(-abs(p.y)*70/(extent+.05))*exp(-abs(p.x)/(extent+.02)))*settings.shadow.w;}
    result=mix(settings.shadow.rgb,mix(color.rgb,settings.accent.rgb,settings.options.w),coverage)+settings.accent.rgb*focal;
  }else if(kind==2u) {
    let cell=vec2i(floor(q));let rx=betaHash(cell,seed,0u);let ry=betaHash(cell,seed,1u);
    let travel=settings.details.x*(.7+.3*sin(phase));
    let offset=betaRotate((vec2f(rx,ry)*2-1)*travel,settings.details.z)/settings.geometry.xy;
    let color=referenceAt(pixel,offset,vec2i(size));
    let contour=clamp(referenceGradient(pixel,vec2f(0),.01,vec2i(size))*2,0.0,1.0);
    alpha=select(color.a,0.0,betaHash(cell,seed,2u)<settings.details.w*contour);
    let stripe=.5+.5*sin((q.x+q.y)*18+phase);
    let light=.45+.55*stripe+settings.accent.w*(rx-.5);
    result=mix(color.rgb,mix(color.rgb,palette*light,settings.options.w),settings.details.y);
  }else if(kind==0u) {
    let sharp=clamp(referenceGradient(pixel,vec2f(0),settings.details.x,vec2i(size))*3,0.0,1.0);
    let wide=clamp(referenceGradient(pixel,vec2f(0),settings.details.x*3,vec2i(size))*1.5,0.0,1.0);
    let light=sharp+wide*settings.details.y*.65;
    result=mix(incoming.rgb,settings.shadow.rgb,settings.details.w)+mix(incoming.rgb,palette,settings.options.w)*light;
  }else {
    result=mix(incoming.rgb,settings.shadow.rgb,.8);
    let row=i32(floor(q.y*4));let jitter=(betaHash(vec2i(row,0),seed,3u)*2-1)*settings.accent.w;
    for(var j=0u;j<u32(settings.details.w);j++) {
      let t=f32(j)/max(1.0,settings.details.w-1);
      let travel=settings.details.y*t*(.75+.25*sin(phase));
      let offset=(betaRotate(vec2f(travel,0),settings.details.z)+vec2f(jitter*.04,0))/settings.geometry.xy;
      let contour=clamp(referenceGradient(pixel,offset,settings.details.x*(1+settings.shadow.w*2),vec2i(size))*3,0.0,1.0);
      let color=referenceAt(pixel,offset,vec2i(size));
      let hue=spectral+t*2*PI;
      let ink=mix(color.rgb,mix(.5+.5*cos(vec3f(hue)+vec3f(0,2*PI/3,4*PI/3)),settings.accent.rgb,.25),settings.options.w);
      result+=ink*contour*((1-t*.65)/settings.details.w)*2;
    }
  }
  textureStore(outputImage,vec2i(id.xy),clamp(mix(incoming,vec4f(result,alpha),settings.geometry.w),vec4f(0),vec4f(1)));
}
@compute @workgroup_size(8,8)
fn neonedges(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,0u);}
@compute @workgroup_size(8,8)
fn wireghost(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,1u);}
@compute @workgroup_size(8,8)
fn prismaticshatter(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,2u);}
@compute @workgroup_size(8,8)
fn radialextrusion(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,3u);}
@compute @workgroup_size(8,8)
fn cellularmesh(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,4u);}
@compute @workgroup_size(8,8)
fn particleburst(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,5u);}
@compute @workgroup_size(8,8)
fn signalcollapse(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,6u);}
@compute @workgroup_size(8,8)
fn paintflow(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,7u);}
@compute @workgroup_size(8,8)
fn billowingsmoke(@builtin(global_invocation_id) id:vec3u){referenceMaterialKernel(id,8u);}
@group(0) @binding(3) var<storage,read> referenceHeights: array<f32>;
fn referenceHeight(uv:vec2f)->f32 {
  let size=vec2i(i32(settings.patternX.w),i32(settings.patternY.w));
  let p=clamp(uv*vec2f(size)-.5,vec2f(0),vec2f(size-1));let base=vec2i(floor(p));
  let other=min(base+1,size-1);let f=fract(p);
  let a=referenceHeights[u32(base.y*size.x+base.x)];let b=referenceHeights[u32(base.y*size.x+other.x)];
  let c=referenceHeights[u32(other.y*size.x+base.x)];let d=referenceHeights[u32(other.y*size.x+other.x)];
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
fn referenceTerrainValue(uv:vec2f)->f32 {
  let rotated=betaRotate((uv-settings.motion.yz)*settings.geometry.xy,settings.details.z)*(settings.geometry.z/4)/settings.geometry.xy;
  return referenceHeight(settings.motion.yz+rotated+vec2f(sin(settings.motion.x),cos(settings.motion.x)-1)*.06);
}
@compute @workgroup_size(8,8)
fn spectralterrain(@builtin(global_invocation_id) id:vec3u) {
  let size=textureDimensions(source);if(id.x>=size.x||id.y>=size.y){return;}
  let incoming=textureLoad(source,vec2i(id.xy),0);
  if(settings.geometry.w==0){textureStore(outputImage,vec2i(id.xy),incoming);return;}
  let uv=gleechPatternUv((vec2f(id.xy)+.5)/vec2f(size));var sampleUv=uv;
  if(settings.details.w>.5){
    let compression=1+settings.shadow.w*(1-uv.y)*2;
    sampleUv.x=settings.motion.y+(uv.x-settings.motion.y)/max(.2,compression);
    for(var j=0u;j<8u;j++){sampleUv.y=uv.y+(referenceTerrainValue(sampleUv)-.5)*settings.details.y*.45;}
  }
  let h=referenceTerrainValue(sampleUv);
  let dx=referenceTerrainValue(sampleUv+vec2f(.005,0))-referenceTerrainValue(sampleUv-vec2f(.005,0));
  let lighting=clamp(.7+dx*settings.details.y*10,0.0,1.0);
  let ridge=.5+.5*cos(h*settings.details.x*2*PI+settings.motion.x);
  let line=pow(ridge,max(1.0,round(1/settings.accent.w)));
  let seed=u32(floor(settings.motion.w*100000));
  let phase=h*2*PI+settings.motion.x+betaHash(vec2i(0),seed,0u)*2*PI;
  let palette=mix(.5+.5*cos(vec3f(phase)+vec3f(0,2*PI/3,4*PI/3)),settings.accent.rgb,.2);
  let ink=mix(incoming.rgb,palette,settings.options.w);
  let treatment=mix(settings.shadow.rgb,ink*lighting,line);
  textureStore(outputImage,vec2i(id.xy),vec4f(clamp(mix(incoming.rgb,treatment,settings.geometry.w),vec3f(0),vec3f(1)),incoming.a));
}
`;
