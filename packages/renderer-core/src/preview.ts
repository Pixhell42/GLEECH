export interface PixelImage {
  width: number;
  height: number;
  pixels: ArrayBuffer;
  shaderBackend?: 'webgpu' | 'webgl2' | 'mixed-gpu' | 'cpu';
  shaderReason?: string;
}
export interface RenderInfo {
  shaderBackend?: 'webgpu' | 'webgl2' | 'mixed-gpu' | 'cpu' | null;
  shaderReason?: string | null;
  backend: 'webgpu' | 'cpu';
  adapter: string;
  maxTextureSize: number;
  previewMs: number;
  reason: string | null;
}
export interface ExportPixels {
  pixels: ArrayBuffer;
  backend: 'webgpu' | 'cpu';
}

interface GpuSurface {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  adapter: string;
  draw(image: PixelImage): Promise<void>;
  readPixels(image: PixelImage): Promise<ArrayBuffer>;
  dispose(): void;
}

const shader = `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  let position = positions[index];
  var output: VertexOutput;
  output.position = vec4(position, 0.0, 1.0);
  output.uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  return output;
}
@fragment fn fragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let color = textureSample(image, imageSampler, input.uv);
  // Display is premultiplied; the source/export textures remain straight RGBA.
  return vec4(color.rgb * color.a, color.a);
}`;

function validatePixels(image: PixelImage): void {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.pixels.byteLength !== image.width * image.height * 4
  ) {
    throw new Error('Invalid RGBA image.');
  }
}

async function createGpuSurface(): Promise<GpuSurface | null> {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice({
    requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
  });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgpu');
    if (!context) {
      device.destroy();
      return null;
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });
    const module = device.createShaderModule({ code: shader });
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    let previewTexture: GPUTexture | null = null;
    let operations: Promise<void> = Promise.resolve();
    function checked<T>(work: () => Promise<T>): Promise<T> {
      const result = operations.then(async () => {
        device.pushErrorScope('out-of-memory');
        device.pushErrorScope('validation');
        const outcome = await work().then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        const validation = await device.popErrorScope();
        const memory = await device.popErrorScope();
        if (!outcome.ok) throw outcome.error;
        if (validation || memory) throw new Error((validation ?? memory)!.message);
        return outcome.value;
      });
      operations = result.then(
        () => {},
        () => {},
      );
      return result;
    }

    function upload(image: PixelImage): GPUTexture {
      const texture = device.createTexture({
        size: [image.width, image.height],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      device.queue.writeTexture(
        { texture },
        image.pixels,
        { bytesPerRow: image.width * 4, rowsPerImage: image.height },
        [image.width, image.height],
      );
      return texture;
    }

    return {
      canvas,
      device,
      adapter:
        adapter.info.description ||
        `${adapter.info.vendor} ${adapter.info.architecture}`.trim() ||
        'WebGPU adapter',
      async draw(image) {
        return checked(async () => {
          if (Math.max(image.width, image.height) > device.limits.maxTextureDimension2D)
            throw new Error('Preview exceeds GPU texture limits.');
          canvas.width = image.width;
          canvas.height = image.height;
          const texture = upload(image);
          const group = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: texture.createView() },
              { binding: 1, resource: sampler },
            ],
          });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: context.getCurrentTexture().createView(),
                clearValue: [0, 0, 0, 0],
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.draw(3);
          pass.end();
          device.queue.submit([encoder.finish()]);
          await device.queue.onSubmittedWorkDone();
          previewTexture?.destroy();
          previewTexture = texture;
        });
      },
      async readPixels(image) {
        return checked(async () => {
          const texture = upload(image);
          const rowBytes = image.width * 4;
          const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
          const chunkRows = Math.max(
            1,
            Math.floor(Math.min(32 * 1024 * 1024, device.limits.maxBufferSize) / bytesPerRow),
          );
          const output = new Uint8Array(rowBytes * image.height);
          try {
            for (let y = 0; y < image.height; y += chunkRows) {
              const rows = Math.min(chunkRows, image.height - y);
              const buffer = device.createBuffer({
                size: bytesPerRow * rows,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
              });
              try {
                const encoder = device.createCommandEncoder();
                encoder.copyTextureToBuffer(
                  { texture, origin: [0, y] },
                  { buffer, bytesPerRow, rowsPerImage: rows },
                  [image.width, rows],
                );
                device.queue.submit([encoder.finish()]);
                await buffer.mapAsync(GPUMapMode.READ);
                const padded = new Uint8Array(buffer.getMappedRange());
                for (let row = 0; row < rows; row++)
                  output.set(
                    padded.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes),
                    (y + row) * rowBytes,
                  );
                buffer.unmap();
              } finally {
                buffer.destroy();
              }
            }
            return output.buffer;
          } finally {
            texture.destroy();
          }
        });
      },
      dispose() {
        previewTexture?.destroy();
        context.unconfigure();
        device.destroy();
      },
    };
  } catch (error) {
    device.destroy();
    throw error;
  }
}

export class PreviewRenderer {
  private gpu: GpuSurface | null = null;
  private canvas = document.createElement('canvas');
  private image: PixelImage | null = null;
  private disposed = false;
  private info: RenderInfo = {
    backend: 'cpu',
    adapter: 'Canvas 2D',
    maxTextureSize: 32768,
    previewMs: 0,
    reason: null,
  };

  private constructor(
    private host: HTMLElement,
    private onChange: (info: RenderInfo) => void,
  ) {}

  static async create(
    host: HTMLElement,
    onChange: (info: RenderInfo) => void,
  ): Promise<PreviewRenderer> {
    const renderer = new PreviewRenderer(host, onChange);
    try {
      renderer.gpu = await createGpuSurface();
      if (renderer.gpu) {
        renderer.canvas = renderer.gpu.canvas;
        renderer.info = {
          backend: 'webgpu',
          adapter: renderer.gpu.adapter,
          maxTextureSize: renderer.gpu.device.limits.maxTextureDimension2D,
          previewMs: 0,
          reason: null,
        };
        const surface = renderer.gpu;
        void surface.device.lost.then(() => {
          if (!renderer.disposed && renderer.gpu === surface)
            renderer.useCpu('GPU connection lost.');
        });
      } else renderer.info.reason = 'WebGPU is unavailable on this system.';
    } catch {
      renderer.info.reason = 'WebGPU could not be initialized.';
    }
    host.replaceChildren(renderer.canvas);
    return renderer;
  }

  private useCpu(reason: string): void {
    this.gpu?.dispose();
    this.gpu = null;
    this.canvas = document.createElement('canvas');
    this.host.replaceChildren(this.canvas);
    this.info = {
      backend: 'cpu',
      shaderBackend: this.image?.shaderBackend ?? null,
      shaderReason: this.image?.shaderReason ?? null,
      adapter: 'Canvas 2D',
      maxTextureSize: 32768,
      previewMs: 0,
      reason,
    };
    if (this.image) this.drawCpu(this.image);
    this.onChange({ ...this.info });
  }

  private drawCpu(image: PixelImage): void {
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Could not create an image preview.');
    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
      0,
      0,
    );
  }

  async show(image: PixelImage): Promise<RenderInfo> {
    validatePixels(image);
    if (this.disposed) throw new Error('The viewport closed.');
    const start = performance.now();
    this.image = image;
    if (this.gpu) {
      try {
        await this.gpu.draw(image);
      } catch {
        this.useCpu('GPU preview failed; using compatibility preview.');
      }
    } else this.drawCpu(image);
    this.info.previewMs = performance.now() - start;
    this.info.shaderBackend = image.shaderBackend ?? null;
    this.info.shaderReason = image.shaderReason ?? null;
    this.onChange({ ...this.info });
    return { ...this.info };
  }

  async exportPixels(image: PixelImage): Promise<ExportPixels> {
    validatePixels(image);
    if (
      this.gpu &&
      Math.max(image.width, image.height) <= this.gpu.device.limits.maxTextureDimension2D
    ) {
      try {
        return { pixels: await this.gpu.readPixels(image), backend: 'webgpu' };
      } catch {
        /* Device loss or memory pressure can still export the unmodified CPU source. */
      }
    }
    return { pixels: image.pixels, backend: 'cpu' };
  }

  dispose(): void {
    this.disposed = true;
    this.gpu?.dispose();
    this.gpu = null;
    this.image = null;
    this.canvas.remove();
  }
}
