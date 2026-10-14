import type { PixelImage } from './preview';
import { builtinShaderSource } from './shader-source';
import { importedShaderCode } from './imported-shader';
import { ADVANCED_PROGRAMS } from './set2-advanced-programs';

type BuiltinProgram =
  | (typeof ADVANCED_PROGRAMS)[number]
  | 'marbling'
  | 'truchet'
  | 'microculture'
  | 'prismpanels'
  | 'signalcollapse'
  | 'paintflow'
  | 'billowingsmoke'
  | 'radialextrusion'
  | 'cellularmesh'
  | 'particleburst'
  | 'spectralterrain'
  | 'neonedges'
  | 'wireghost'
  | 'prismaticshatter'
  | 'bloomfield'
  | 'chromaticerosion'
  | 'ripple'
  | 'plasma'
  | 'glass'
  | 'flow'
  | 'iridescence'
  | 'hologram'
  | 'caustics'
  | 'chrome'
  | 'mirage'
  | 'nebula'
  | 'membrane'
  | 'moire'
  | 'fracture'
  | 'diffraction'
  | 'tunnel'
  | 'crystal'
  | 'circuit'
  | 'lattice'
  | 'opart'
  | 'polar';
const heightPrograms: readonly string[] = [
  'spectralterrain',
  'marbling',
  'truchet',
  'microculture',
  'prismpanels',
  ...ADVANCED_PROGRAMS,
];

export type ShaderInvocation =
  | {
      program: BuiltinProgram;
      uniforms: Float32Array;
      heightField?: { width: number; height: number; values: Float32Array };
      extra?: Float32Array;
    }
  | {
      program: 'imported';
      source: string;
      uniforms: Float32Array;
      controls: Float32Array;
    };

// Worker-side GPU execution is independent of the display canvas. A serialized
// queue keeps error scopes and device resources paired across overlapping jobs.
export class ShaderRenderer {
  private queue: Promise<unknown> = Promise.resolve();
  private lost = false;
  private imported = new Map<string, GPUComputePipeline>();
  private pipelines = new Map<BuiltinProgram, GPUComputePipeline>();
  get isLost(): boolean {
    return this.lost;
  }
  private constructor(private device: GPUDevice) {
    void device.lost.then(() => {
      this.lost = true;
    });
  }

  static async create(): Promise<ShaderRenderer | null> {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice({
      requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
    });
    return new ShaderRenderer(device);
  }

  private async builtinPipeline(entryPoint: BuiltinProgram): Promise<GPUComputePipeline> {
    const cached = this.pipelines.get(entryPoint);
    if (cached) return cached;
    const module = this.device.createShaderModule({ code: builtinShaderSource(entryPoint) });
    const diagnostics = (await module.getCompilationInfo()).messages.filter(
      (message) => message.type === 'error',
    );
    if (diagnostics.length)
      throw new Error(
        diagnostics
          .map((message) => `Shader line ${message.lineNum}: ${message.message}`)
          .join('\n'),
      );
    const entries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba8unorm' },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ];
    if (heightPrograms.includes(entryPoint))
      entries.push({
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      });
    if ((ADVANCED_PROGRAMS as readonly string[]).includes(entryPoint))
      entries.push({
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      });
    const pipeline = await this.device.createComputePipelineAsync({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.device.createBindGroupLayout({ entries })],
      }),
      compute: { module, entryPoint },
    });
    this.pipelines.set(entryPoint, pipeline);
    return pipeline;
  }

  render(
    image: PixelImage,
    invocation: ShaderInvocation,
    cancelled: () => boolean,
  ): Promise<ArrayBuffer> {
    const work = this.queue.then(() => this.execute(image, invocation, cancelled));
    this.queue = work.catch(() => {});
    return work;
  }

  private async execute(
    image: PixelImage,
    invocation: ShaderInvocation,
    cancelled: () => boolean,
  ): Promise<ArrayBuffer> {
    if (cancelled()) throw new Error('Shader render cancelled.');
    if (this.lost) throw new Error('Shader GPU device was lost.');
    if (
      image.width < 1 ||
      image.height < 1 ||
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.pixels.byteLength !== image.width * image.height * 4 ||
      Math.max(image.width, image.height) > this.device.limits.maxTextureDimension2D ||
      invocation.uniforms.length !== (invocation.program === 'imported' ? 20 : 32) ||
      ![...invocation.uniforms].every(Number.isFinite)
    )
      throw new Error('Shader input exceeds supported limits.');
    const device = this.device;
    const resources: { destroy(): void }[] = [];
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    const outcome = await (async () => {
      const source = device.createTexture({
        size: [image.width, image.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      resources.push(source);
      const target = device.createTexture({
        size: [image.width, image.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      resources.push(target);
      const uniforms = device.createBuffer({
        size: invocation.uniforms.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      resources.push(uniforms);
      device.queue.writeTexture(
        { texture: source },
        image.pixels,
        { bytesPerRow: image.width * 4 },
        [image.width, image.height],
      );
      device.queue.writeBuffer(uniforms, 0, new Float32Array(invocation.uniforms));
      let pipeline: GPUComputePipeline;
      let controls: GPUBuffer | undefined;
      if (invocation.program === 'imported') {
        if (invocation.controls.length > 128 || ![...invocation.controls].every(Number.isFinite))
          throw new Error('Invalid shader controls.');
        let cached = this.imported.get(invocation.source);
        if (!cached) {
          const module = device.createShaderModule({ code: importedShaderCode(invocation.source) });
          const diagnostics = (await module.getCompilationInfo()).messages.filter(
            (message) => message.type === 'error',
          );
          if (diagnostics.length)
            throw new Error(
              diagnostics
                .map((message) => `Shader line ${message.lineNum}: ${message.message}`)
                .join('\n'),
            );
          const bindings = device.createBindGroupLayout({
            entries: [
              {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                texture: { sampleType: 'unfilterable-float' },
              },
              {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                storageTexture: { access: 'write-only', format: 'rgba8unorm' },
              },
              { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
              { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
          });
          cached = await device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindings] }),
            compute: { module, entryPoint: 'gleechKernel' },
          });
          if (this.imported.size >= 32) this.imported.delete(this.imported.keys().next().value!);
          this.imported.set(invocation.source, cached);
        }
        pipeline = cached;
        const values = new Float32Array(128);
        values.set(invocation.controls);
        controls = device.createBuffer({
          size: 512,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        resources.push(controls);
        device.queue.writeBuffer(controls, 0, values);
      } else pipeline = await this.builtinPipeline(invocation.program);
      if (cancelled()) throw new Error('Shader render cancelled.');
      let heightBuffer: GPUBuffer | undefined;
      if (invocation.program !== 'imported' && heightPrograms.includes(invocation.program)) {
        const field = invocation.heightField;
        if (
          !field ||
          !Number.isSafeInteger(field.width) ||
          !Number.isSafeInteger(field.height) ||
          field.width < 1 ||
          field.height < 1 ||
          field.values.length !== field.width * field.height ||
          field.values.byteLength > device.limits.maxStorageBufferBindingSize ||
          invocation.uniforms[15] !== field.width ||
          invocation.uniforms[19] !== field.height ||
          !field.values.every(Number.isFinite)
        )
          throw new Error('Invalid shader height field.');
        heightBuffer = device.createBuffer({
          size: field.values.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        resources.push(heightBuffer);
        device.queue.writeBuffer(heightBuffer, 0, new Float32Array(field.values));
      }
      let extraBuffer: GPUBuffer | undefined;
      if (
        invocation.program !== 'imported' &&
        (ADVANCED_PROGRAMS as readonly string[]).includes(invocation.program)
      ) {
        const extra = invocation.extra;
        if (
          !extra ||
          extra.length < 68 ||
          extra.byteLength > device.limits.maxStorageBufferBindingSize ||
          !extra.every(Number.isFinite) ||
          extra[64]! < 1 ||
          extra[65]! < 1 ||
          !Number.isSafeInteger(extra[64]) ||
          !Number.isSafeInteger(extra[65]) ||
          extra.length !== 66 + extra[64]! * extra[65]! * 2
        )
          throw new Error('Invalid material control or direction buffer.');
        extraBuffer = device.createBuffer({
          size: extra.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        resources.push(extraBuffer);
        device.queue.writeBuffer(extraBuffer, 0, new Float32Array(extra));
      }
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: target.createView() },
          { binding: 2, resource: { buffer: uniforms } },
          ...(controls ? [{ binding: 3, resource: { buffer: controls } }] : []),
          ...(heightBuffer ? [{ binding: 3, resource: { buffer: heightBuffer } }] : []),
          ...(extraBuffer ? [{ binding: 4, resource: { buffer: extraBuffer } }] : []),
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(image.width / 8), Math.ceil(image.height / 8));
      pass.end();
      device.queue.submit([encoder.finish()]);
      const rowBytes = image.width * 4,
        paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
      const chunkRows = Math.max(
        1,
        Math.floor(Math.min(16 * 1024 * 1024, device.limits.maxBufferSize) / paddedRowBytes),
      );
      const output = new Uint8Array(image.pixels.byteLength);
      for (let y = 0; y < image.height; y += chunkRows) {
        if (cancelled()) throw new Error('Shader render cancelled.');
        const rows = Math.min(chunkRows, image.height - y);
        const buffer = device.createBuffer({
          size: paddedRowBytes * rows,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        try {
          const copy = device.createCommandEncoder();
          copy.copyTextureToBuffer(
            { texture: target, origin: [0, y] },
            { buffer, bytesPerRow: paddedRowBytes, rowsPerImage: rows },
            [image.width, rows],
          );
          device.queue.submit([copy.finish()]);
          await buffer.mapAsync(GPUMapMode.READ);
          const data = new Uint8Array(buffer.getMappedRange());
          for (let row = 0; row < rows; row++)
            output.set(
              data.subarray(row * paddedRowBytes, row * paddedRowBytes + rowBytes),
              (y + row) * rowBytes,
            );
          buffer.unmap();
        } finally {
          buffer.destroy();
        }
      }
      return output.buffer;
    })().then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    try {
      const validation = await device.popErrorScope();
      const memory = await device.popErrorScope();
      if (outcome.error) throw outcome.error;
      if (validation || memory) throw new Error((validation ?? memory)!.message);
      return outcome.value!;
    } finally {
      for (const resource of resources) resource.destroy();
    }
  }

  dispose(): void {
    this.lost = true;
    this.device.destroy();
  }
}
