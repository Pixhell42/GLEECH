import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { RenderCancelledError } from '@gleech/effects';
import {
  assertEffect,
  withoutImageData,
  type SubjectMask,
  type EffectInstance,
} from '@gleech/project-model';
import type {
  GpuCapabilities,
  GpuChildMessage,
  GpuManifest,
  ImageFile,
} from '../shared/cli-gpu-api';
import type { RgbaImage } from './png';
import { gpuLaunch } from './runtime';

export type RendererMode = 'auto' | 'gpu' | 'cpu';
export interface RenderingSettings {
  renderer: RendererMode;
  skipUnsupportedShaders: boolean;
}
let settings: RenderingSettings = { renderer: 'auto', skipUnsupportedShaders: false };
export function configureRendering(next: Partial<RenderingSettings>): void {
  settings = { ...settings, ...next };
}
export function renderingSettings(): Readonly<RenderingSettings> {
  return settings;
}
export interface GpuRenderRequest {
  source: RgbaImage;
  effects: readonly EffectInstance[];
  masterSeed: number;
  layers: ReadonlyMap<string, RgbaImage>;
  subjectMask?: SubjectMask;
  previewMaxDimension?: number;
  isCancelled?: () => boolean;
}
export interface GpuRenderResult {
  image: RgbaImage;
  backend: string;
}

async function removeGpuDirectory(directory: string): Promise<void> {
  const target = resolve(directory);
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !/^gleech-cli-gpu-[A-Za-z0-9]+$/.test(basename(target))
  )
    throw new Error('Unexpected GPU temporary directory.');
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
class GpuClient {
  private sequence = 0;
  private assetSequence = 0;
  private files = new Set<string>();
  private assets = new WeakMap<ArrayBuffer, string>();
  private pending = new Map<
    number,
    { resolve(value: GpuChildMessage): void; reject(error: Error): void }
  >();
  private child: ChildProcess;
  private closed = false;
  get available(): boolean {
    return !this.closed;
  }
  private emergencyKill = () => {
    this.child.kill();
  };
  private stderr = '';
  private tail: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<GpuCapabilities>;
  private constructor(private directory: string) {
    const { executable, args } = gpuLaunch();
    const env: NodeJS.ProcessEnv = { ...process.env, GLEECH_CLI_GPU_DIRECTORY: directory };
    delete env['ELECTRON_RUN_AS_NODE'];
    delete env['ELECTRON_RENDERER_URL'];
    this.child = spawn(executable, args, {
      env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'json',
    });
    process.once('exit', this.emergencyKill);
    // Only small control messages use Node IPC. Raw files avoid incompatible
    // V8 binary-serialization versions between system Node and Electron.
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000);
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('GPU helper startup timed out. ' + this.stderr));
        void this.close();
      }, 30000);
      const failed = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.child.once('error', failed);
      this.child.once('exit', () => failed(new Error('GPU helper exited. ' + this.stderr)));
      this.child.on('message', (message: GpuChildMessage) => {
        if (message.kind === 'ready') {
          clearTimeout(timer);
          resolve(message.capabilities);
          return;
        }
        if (message.id === undefined) {
          if (message.kind === 'error') {
            failed(new Error(message.error));
            this.fail(new Error(message.error));
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.kind === 'error') pending.reject(new Error(message.error));
        else if (message.kind === 'cancelled') pending.reject(new RenderCancelledError());
        else pending.resolve(message);
      });
    });
    this.child.on('exit', () => {
      this.fail(new Error('GPU helper disconnected. ' + this.stderr));
      void this.close();
    });
    this.child.on('error', (error) => this.fail(error));
  }
  static async create(): Promise<GpuClient> {
    const directory = await mkdtemp(join(tmpdir(), 'gleech-cli-gpu-'));
    let client: GpuClient | undefined;
    try {
      client = new GpuClient(directory);
      await client.ready;
      return client;
    } catch (error) {
      if (client) await client.close();
      else await removeGpuDirectory(directory);
      throw error;
    }
  }
  private fail(error: Error): void {
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
  }
  private async imageFile(
    image: RgbaImage,
    keep: Set<string>,
    subject = false,
  ): Promise<ImageFile> {
    let file = this.assets.get(image.pixels);
    if (!file || !this.files.has(file)) {
      file = 'asset-' + ++this.assetSequence + '.bin';
      await writeFile(join(this.directory, file), Buffer.from(image.pixels));
      this.assets.set(image.pixels, file);
      this.files.add(file);
    }
    if (image.pixels.byteLength !== image.width * image.height * (subject ? 1 : 4))
      throw new Error('Invalid GPU image bytes.');
    keep.add(file);
    return { file, width: image.width, height: image.height };
  }
  render(request: GpuRenderRequest): Promise<GpuRenderResult> {
    const task = this.tail.catch(() => {}).then(() => this.renderOne(request));
    this.tail = task;
    return task;
  }
  private async renderOne(request: GpuRenderRequest): Promise<GpuRenderResult> {
    if (request.isCancelled?.()) throw new RenderCancelledError();
    if (this.closed || !this.child.connected)
      throw new Error('GPU helper disconnected. Retry the render.');
    const id = ++this.sequence;
    const keep = new Set<string>();
    const source = await this.imageFile(request.source, keep);
    const layers = await Promise.all(
      [...request.layers].map(async ([id, image]) => ({
        id,
        image: await this.imageFile(image, keep),
      })),
    );
    const subject = request.subjectMask
      ? await this.imageFile(
          {
            width: request.subjectMask.width,
            height: request.subjectMask.height,
            pixels: request.subjectMask.values,
          },
          keep,
          true,
        )
      : undefined;
    for (const file of this.files)
      if (!keep.has(file)) {
        await rm(join(this.directory, file), { force: true });
        this.files.delete(file);
      }
    if (request.isCancelled?.()) throw new RenderCancelledError();
    const manifest: GpuManifest = {
      source,
      layers,
      ...(subject ? { subject } : {}),
      request: {
        kind: 'render',
        id,
        effects: request.effects.map((effect) => {
          assertEffect(effect);
          return withoutImageData(effect);
        }),
        masterSeed: request.masterSeed,
        reference: { width: source.width, height: source.height },
        purpose: request.previewMaxDimension ? 'preview' : 'export',
        shaderMode: settings.renderer === 'gpu' ? 'gpu' : 'auto',
        ...(request.previewMaxDimension
          ? { previewMaxDimension: request.previewMaxDimension }
          : {}),
      },
    };
    const input = join(this.directory, 'request-' + id + '.json');
    const output = join(this.directory, 'result-' + id + '.bin');
    await writeFile(input, JSON.stringify(manifest));
    let cancelledAt = 0;
    const checkCancellation = () => {
      if (!request.isCancelled?.()) return;
      if (!cancelledAt) {
        cancelledAt = Date.now();
        this.child.send?.({ kind: 'cancel', id });
      } else if (Date.now() - cancelledAt > 3000) {
        this.fail(new RenderCancelledError());
        void this.close();
      }
    };
    const poll = setInterval(checkCancellation, 25);
    const timeout = setTimeout(() => {
      this.fail(new Error('GPU render timed out.'));
      void this.close();
    }, 300000);
    try {
      const reply = await new Promise<GpuChildMessage>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.child.send({ kind: 'render', id }, (error) => {
          if (error) {
            this.pending.delete(id);
            reject(error);
          }
        });
        checkCancellation();
      });
      if (request.isCancelled?.()) throw new RenderCancelledError();
      if (reply.kind !== 'success') throw new Error('Invalid GPU result.');
      if (
        !Number.isSafeInteger(reply.width) ||
        !Number.isSafeInteger(reply.height) ||
        reply.width < 1 ||
        reply.height < 1 ||
        reply.width * reply.height > 64 * 1024 * 1024
      )
        throw new Error('Invalid GPU result dimensions.');
      const bytes = await readFile(output);
      if (bytes.length !== reply.width * reply.height * 4)
        throw new Error('Incomplete GPU result.');
      return {
        image: { width: reply.width, height: reply.height, pixels: Uint8Array.from(bytes).buffer },
        backend: reply.backend,
      };
    } finally {
      clearInterval(poll);
      clearTimeout(timeout);
      this.pending.delete(id);
      await Promise.all([input, output].map((path) => rm(path, { force: true }).catch(() => {})));
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    process.off('exit', this.emergencyKill);
    this.fail(new Error('GPU renderer closed.'));
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.child.kill();
          resolve();
        }, 2000);
        this.child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        if (this.child.connected) this.child.send({ kind: 'shutdown' }, () => {});
        else this.child.kill();
      });
    }
    await removeGpuDirectory(this.directory).catch(() => {});
  }
}
let client: Promise<GpuClient> | undefined;
async function getClient(): Promise<GpuClient> {
  client ??= GpuClient.create().catch((error) => {
    client = undefined;
    throw error;
  });
  const value = await client;
  if (!value.available) {
    client = undefined;
    return getClient();
  }
  return value;
}
export async function gpuCapabilities(): Promise<GpuCapabilities> {
  return (await getClient()).ready;
}
export async function renderOnGpu(request: GpuRenderRequest): Promise<GpuRenderResult> {
  return (await getClient()).render(request);
}
export async function closeGpu(): Promise<void> {
  const pending = client;
  client = undefined;
  if (pending)
    await pending.then(
      (value) => value.close(),
      () => {},
    );
}
