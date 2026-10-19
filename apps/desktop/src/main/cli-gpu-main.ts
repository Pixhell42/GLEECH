import { mkdirSync } from 'node:fs';
import { app, BrowserWindow, ipcMain } from 'electron';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { recompressJpeg } from './jpeg-codec';
import type { EffectReply } from '../renderer/src/effect-protocol';
import type {
  GpuCapabilities,
  GpuManifest,
  GpuParentMessage,
  ImageFile,
} from '../shared/cli-gpu-api';

/** Private child process: never opens the editor or reads the user's app profile. */
export async function startCliGpu(): Promise<void> {
  const directory = process.env['GLEECH_CLI_GPU_DIRECTORY'];
  if (!directory || !isAbsolute(directory) || !process.send || !process.connected)
    throw new Error('The GPU helper must be started by the GLEECH CLI.');
  mkdirSync(join(directory, 'profile'), { recursive: true });
  mkdirSync(join(directory, 'session'), { recursive: true });
  app.setPath('userData', join(directory, 'profile'));
  app.setPath('sessionData', join(directory, 'session'));
  const send = (message: object) => {
    if (process.connected) process.send?.(message);
  };
  const fail = (error: unknown, id?: number) =>
    send({ kind: 'error', id, error: error instanceof Error ? error.message : String(error) });
  const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: {
      preload: join(__dirname, '../preload/cli-gpu.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.on('render-process-gone', (_event, details) => {
    fail(new Error('GPU renderer exited: ' + details.reason));
    app.exit(1);
  });
  const trusted = (event: Electron.IpcMainEvent) =>
    event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  let active: number | null = null;
  let sourceFile = '';
  const cancelled = new Set<number>();
  const images = new Map<string, ArrayBuffer>();
  async function pixels(image: ImageFile, subject = false): Promise<ArrayBuffer> {
    if (
      !/^asset-\d+\.bin$/.test(image.file) ||
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.width < 1 ||
      image.height < 1 ||
      image.width > (subject ? 1024 : 32768) ||
      image.height > (subject ? 1024 : 32768) ||
      image.width * image.height > 64 * 1024 * 1024
    )
      throw new Error('Invalid GPU image descriptor.');
    let data = images.get(image.file);
    if (!data) {
      const path = join(directory!, image.file);
      const bytes = image.width * image.height * (subject ? 1 : 4);
      if ((await stat(path)).size !== bytes) throw new Error('Invalid GPU image byte count.');
      data = Uint8Array.from(await readFile(path)).buffer;
      images.set(image.file, data);
    }
    return data;
  }
  ipcMain.on('cli-gpu:ready', (event, capabilities: GpuCapabilities) => {
    if (!trusted(event)) return;
    send({ kind: 'ready', capabilities });
  });
  ipcMain.on('cli-gpu:reply', (event, reply: EffectReply) => {
    if (!trusted(event)) return;
    if (reply.id === -1) {
      fail(new Error('GPU worker crashed.'), active ?? undefined);
      app.exit(1);
      return;
    }
    if (active === null) return;
    if (reply.id !== active) return;
    if (reply.kind === 'jpeg-request') {
      void recompressJpeg(reply.image, reply.options).then(
        (pixels) => {
          if (!window.isDestroyed())
            window.webContents.send('cli-gpu:request', {
              kind: 'jpeg-result',
              id: reply.id,
              codecId: reply.codecId,
              pixels,
            });
        },
        (error) => {
          if (!window.isDestroyed())
            window.webContents.send('cli-gpu:request', {
              kind: 'jpeg-error',
              id: reply.id,
              codecId: reply.codecId,
              error: String(error),
            });
        },
      );
    } else if (reply.kind === 'success') {
      const id = active;
      void writeFile(
        join(directory!, 'result-' + id + '.bin'),
        Buffer.from(reply.image.pixels),
      ).then(
        () => {
          cancelled.delete(id);
          active = null;
          send({
            kind: 'success',
            id,
            width: reply.image.width,
            height: reply.image.height,
            backend: reply.image.shaderBackend ?? 'cpu',
          });
        },
        (error) => {
          active = null;
          fail(error, id);
        },
      );
    } else {
      cancelled.delete(reply.id);
      active = null;
      send(reply);
    }
  });
  process.on('message', (message: GpuParentMessage) => {
    if (message.kind === 'shutdown') {
      app.quit();
      return;
    }
    if (!validId(message.id)) {
      fail(new Error('Invalid GPU request ID.'));
      return;
    }
    if (message.kind === 'cancel') {
      cancelled.add(message.id);
      window.webContents.send('cli-gpu:request', message);
      return;
    }
    if (message.kind !== 'render' || active !== null) {
      fail(new Error('GPU helper is busy.'), message.id);
      return;
    }
    active = message.id;
    void (async () => {
      const path = join(directory!, 'request-' + message.id + '.json');
      if ((await stat(path)).size > 32 * 1024 * 1024) throw new Error('GPU recipe is too large.');
      const manifest = JSON.parse(await readFile(path, 'utf8')) as GpuManifest;
      if (
        manifest.request.id !== message.id ||
        manifest.request.kind !== 'render' ||
        manifest.request.effects.length > 1000
      )
        throw new Error('Invalid GPU recipe.');
      // The parent validates complete model objects before stripping embedded PNG
      // text, exactly like desktop worker requests. Raw attachments are bounded below.
      const all = [manifest.source, ...manifest.layers.map((layer) => layer.image)];
      if (all.reduce((n, image) => n + image.width * image.height, 0) > 192 * 1024 * 1024)
        throw new Error('GPU assets exceed the image budget.');
      const keep = new Set(
        [...all, ...(manifest.subject ? [manifest.subject] : [])].map((image) => image.file),
      );
      for (const key of images.keys()) if (!keep.has(key)) images.delete(key);
      const image = {
        width: manifest.source.width,
        height: manifest.source.height,
        pixels: await pixels(manifest.source),
      };
      const layers = await Promise.all(
        manifest.layers.map(async (layer) => ({
          id: layer.id,
          image: {
            width: layer.image.width,
            height: layer.image.height,
            pixels: await pixels(layer.image),
          },
        })),
      );
      const subjectMask = manifest.subject
        ? {
            width: manifest.subject.width,
            height: manifest.subject.height,
            values: await pixels(manifest.subject, true),
          }
        : undefined;
      if (cancelled.delete(message.id)) {
        active = null;
        send({ kind: 'cancelled', id: message.id });
        return;
      }
      const sourceKey =
        manifest.source.file + ':' + manifest.source.width + 'x' + manifest.source.height;
      const changed = sourceFile !== sourceKey;
      sourceFile = sourceKey;
      window.webContents.send('cli-gpu:request', {
        ...manifest.request,
        ...(changed ? { image } : {}),
        layerImages: layers,
        ...(subjectMask ? { subjectMask } : {}),
      });
    })().catch((error) => {
      active = null;
      fail(error, message.id);
    });
  });
  process.on('disconnect', () => app.quit());
  await window.loadFile(join(__dirname, '../renderer/cli-gpu.html'));
}
