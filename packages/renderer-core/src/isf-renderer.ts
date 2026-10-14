import type { PixelImage } from './preview';

export interface IsfInvocation {
  program: 'isf';
  source: string;
  uniforms: Float32Array;
  controls: Float32Array;
  bindings: readonly {
    name: string;
    type: 'image' | 'float' | 'bool' | 'long' | 'point2D' | 'color';
    slots: readonly number[];
  }[];
}
const vertex = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;

/** Single-pass still-image ISF. The engine owns textures, input uniforms and readback. */
export class IsfRenderer {
  private queue: Promise<unknown> = Promise.resolve();
  private programs = new Map<string, WebGLProgram>();
  private constructor(private gl: WebGL2RenderingContext) {}
  static create(): IsfRenderer | null {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    return gl ? new IsfRenderer(gl) : null;
  }
  render(
    image: PixelImage,
    invocation: IsfInvocation,
    cancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<ArrayBuffer> {
    const job = this.queue.then(() => this.execute(image, invocation, cancelled, yieldControl));
    this.queue = job.catch(() => {});
    return job;
  }
  private shader(type: number, source: string): WebGLShader {
    const gl = this.gl,
      shader = gl.createShader(type);
    if (!shader) throw new Error('Could not allocate ISF shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('ISF compilation failed: ' + error);
    }
    return shader;
  }
  private program(invocation: IsfInvocation): WebGLProgram {
    const key = invocation.source + JSON.stringify(invocation.bindings);
    const cached = this.programs.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const declarations = invocation.bindings
      .map(
        (input) =>
          `uniform ${{ image: 'sampler2D', float: 'float', bool: 'bool', long: 'int', point2D: 'vec2', color: 'vec4' }[input.type]} ${input.name};`,
      )
      .join('\n');
    const code = invocation.source
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
      .replace(/^\s*#version[^\n]*$/gm, '')
      .replace(/\bvoid\s+main\s*\(\s*(?:void\s*)?\)/, 'void gleechUserMain()');
    const fragment = `#version 300 es
precision highp float; precision highp int;
uniform vec2 RENDERSIZE; uniform vec2 gleechTextureSize;
uniform float TIME; const float TIMEDELTA=0.0; const int FRAMEINDEX=0; const int PASSINDEX=0;
const vec4 DATE=vec4(1970.0,1.0,1.0,0.0);
uniform vec3 gleechPatternX; uniform vec3 gleechPatternY;
${declarations}
out vec4 gleechOutput; vec4 gleechColor=vec4(0.0);
vec2 gleechStageUv(){return vec2(gl_FragCoord.x/gleechTextureSize.x,1.0-gl_FragCoord.y/gleechTextureSize.y);}
vec2 gleechPatternUv(){vec2 p=gleechStageUv();return vec2(dot(gleechPatternX.xy,p)+gleechPatternX.z,dot(gleechPatternY.xy,p)+gleechPatternY.z);}
vec2 gleechIsfUv(){vec2 p=gleechPatternUv();return vec2(p.x,1.0-p.y);}
vec4 gleechCoord(){return vec4(gleechIsfUv()*RENDERSIZE,0.0,1.0);}
vec2 gleechCanvasUv(vec2 p){vec2 q=vec2(p.x,1.0-p.y)-vec2(gleechPatternX.z,gleechPatternY.z);float a=gleechPatternX.x,c=gleechPatternX.y,b=gleechPatternY.x,d=gleechPatternY.y;return vec2(d*q.x-c*q.y,-b*q.x+a*q.y)/(a*d-b*c);}
vec4 gleechSample(sampler2D image,vec2 uv){
  ivec2 size=textureSize(image,0);vec2 q=clamp(gleechCanvasUv(uv)*vec2(size)-0.5,vec2(0.0),vec2(size-1));
  ivec2 base=ivec2(floor(q));vec2 f=fract(q);
  vec4 a=texelFetch(image,base,0),b=texelFetch(image,min(base+ivec2(1,0),size-1),0),c=texelFetch(image,min(base+ivec2(0,1),size-1),0),d=texelFetch(image,min(base+ivec2(1,1),size-1),0);
  vec4 weights=vec4((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);vec4 aw=weights*vec4(a.a,b.a,c.a,d.a);float alpha=dot(aw,vec4(1.0));
  if(alpha>0.0)return vec4((a.rgb*aw.x+b.rgb*aw.y+c.rgb*aw.z+d.rgb*aw.w)/alpha,alpha);
  return vec4(a.rgb*weights.x+b.rgb*weights.y+c.rgb*weights.z+d.rgb*weights.w,0.0);
}
#define isf_FragNormCoord gleechIsfUv()
#define gl_FragCoord gleechCoord()
#define gl_FragColor gleechColor
#define IMG_SIZE(image) RENDERSIZE
#define IMG_NORM_PIXEL(image,uv) gleechSample(image,uv)
#define IMG_PIXEL(image,p) gleechSample(image,(p)/RENDERSIZE)
#define IMG_THIS_PIXEL(image) texelFetch(image,ivec2(gleechStageUv()*gleechTextureSize),0)
#define IMG_THIS_NORM_PIXEL(image) IMG_THIS_PIXEL(image)
#define texture2D(image,uv) gleechSample(image,uv)
${code}
void main(){gleechUserMain();gleechOutput=clamp(gleechColor,vec4(0.0),vec4(1.0));if(any(isnan(gleechOutput))||any(isinf(gleechOutput)))gleechOutput=vec4(0.0);}`;
    let vs: WebGLShader | null = null,
      fs: WebGLShader | null = null,
      program: WebGLProgram | null = null;
    try {
      vs = this.shader(gl.VERTEX_SHADER, vertex);
      fs = this.shader(gl.FRAGMENT_SHADER, fragment);
      program = gl.createProgram();
      if (!program) throw new Error('Could not allocate ISF program.');
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error('ISF linking failed: ' + gl.getProgramInfoLog(program));
      if (this.programs.size >= 16) {
        const oldest = this.programs.entries().next().value!;
        this.programs.delete(oldest[0]);
        gl.deleteProgram(oldest[1]);
      }
      this.programs.set(key, program);
      return program;
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
    }
  }
  private async execute(
    image: PixelImage,
    invocation: IsfInvocation,
    cancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<ArrayBuffer> {
    const gl = this.gl;
    const check = () => {
      if (cancelled()) throw new Error('ISF render cancelled.');
      if (gl.isContextLost()) throw new Error('ISF WebGL2 context was lost.');
    };
    check();
    const maximum = Math.min(
      Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
      Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
    );
    if (
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.width < 1 ||
      image.height < 1 ||
      Math.max(image.width, image.height) > maximum ||
      image.pixels.byteLength !== image.width * image.height * 4 ||
      invocation.uniforms.length !== 20
    )
      throw new Error('ISF image exceeds supported limits.');
    const program = this.program(invocation),
      input = gl.createTexture(),
      target = gl.createTexture(),
      framebuffer = gl.createFramebuffer(),
      buffer = gl.createBuffer();
    let sync: WebGLSync | null = null;
    try {
      if (!input || !target || !framebuffer || !buffer)
        throw new Error('Could not allocate ISF GPU resources.');
      gl.disable(gl.BLEND);
      gl.disable(gl.DITHER);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        image.width,
        image.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(image.pixels),
      );
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        image.width,
        image.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('ISF framebuffer is incomplete.');
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.viewport(0, 0, image.width, image.height);
      const uniform = (name: string) => gl.getUniformLocation(program, name),
        u = invocation.uniforms;
      gl.uniform2f(uniform('RENDERSIZE'), u[0]!, u[1]!);
      gl.uniform2f(uniform('gleechTextureSize'), image.width, image.height);
      gl.uniform1f(uniform('TIME'), u[4]! * Math.PI * 2);
      gl.uniform3f(uniform('gleechPatternX'), u[12]!, u[13]!, u[14]!);
      gl.uniform3f(uniform('gleechPatternY'), u[16]!, u[17]!, u[18]!);
      for (const binding of invocation.bindings) {
        const slots = binding.slots,
          at = (slot: number, component = 0) => invocation.controls[slot * 4 + component]!;
        const location = uniform(binding.name);
        if (binding.type === 'image') gl.uniform1i(location, 0);
        else if (binding.type === 'float') gl.uniform1f(location, at(slots[0]!));
        else if (binding.type === 'bool' || binding.type === 'long')
          gl.uniform1i(location, Math.round(at(slots[0]!)));
        else if (binding.type === 'point2D') gl.uniform2f(location, at(slots[0]!), at(slots[1]!));
        else
          gl.uniform4f(location, at(slots[0]!), at(slots[0]!, 1), at(slots[0]!, 2), at(slots[1]!));
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, image.pixels.byteLength, gl.STREAM_READ);
      gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      if (!sync) throw new Error('ISF readback synchronization failed.');
      while (true) {
        check();
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
        if (status === gl.WAIT_FAILED) throw new Error('ISF GPU readback failed.');
        await yieldControl();
      }
      const raw = new Uint8Array(image.pixels.byteLength);
      const chunk = 4 * 1024 * 1024;
      for (let offset = 0; offset < raw.length; offset += chunk) {
        check();
        gl.getBufferSubData(
          gl.PIXEL_PACK_BUFFER,
          offset,
          raw.subarray(offset, Math.min(raw.length, offset + chunk)),
        );
        await yieldControl();
      }
      const output = new Uint8Array(raw.length),
        row = image.width * 4;
      for (let y = 0; y < image.height; y++) {
        check();
        output.set(raw.subarray((image.height - 1 - y) * row, (image.height - y) * row), y * row);
        if (y % 64 === 63) await yieldControl();
      }
      if (gl.getError() !== gl.NO_ERROR) throw new Error('ISF GPU rendering failed.');
      return output.buffer;
    } finally {
      if (sync) gl.deleteSync(sync);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteBuffer(buffer);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(input);
      gl.deleteTexture(target);
    }
  }
}
