import { createDepthMapLibrary } from './depth-maps';
import type { McpAccess } from './mcp-access';
import { renderOutputIsFolder } from '@gleech/mcp/protocol';
import { mcpImageData } from './mcp-image-data';
import { supportLink, supportCopyText } from '../shared/support';
import { SUPPORT_REPOSITORY } from '../shared/support';
import { APP_VERSION_LABEL } from '../shared/branding';
import { createFeedbackAuthStore } from './feedback-auth-store';
import { createFeedbackService } from './feedback-service';
import feedbackConfig from '../shared/feedback-github.json';
import { assertJpegRequest } from './jpeg-codec';
import type { JpegPassOptions } from '@gleech/effects';
import { createShaderLibrary } from './shader-library';
import {
  decodeShaderImport,
  assertExecutableShader,
  MAX_SHADER_PACKAGE_BYTES,
} from '@gleech/project-model/shader-package';
import { createVectorMapLibrary } from './vector-maps';
import { fetchShader } from './shader-fetch';
import { createBuiltinPresetLibrary } from './builtin-presets';
import {
  app,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  shell,
  safeStorage,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { release } from 'node:os';
import { open, readFile, writeFile, rename, unlink, lstat, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  assertProject,
  assertPresetRecipe,
  assertPresetName,
  assertLayerImage,
  layerImages,
  projectSources,
  effectsNeedSubject,
  type ImageSource,
  type SubjectMask,
  type PresetRecipe,
  type EffectPreset,
  type LayerImage,
} from '@gleech/project-model';
import type { ImportedImage, PixelImage, Result, ImageExportOptions } from '../shared/image-api';
import type { DecodedImage, ImageJob } from './image-worker';
import { encodeProject, decodeProject, MAX_PROJECT_BYTES, type SavedAsset } from './project-file';
import { createPresetLibrary } from './preset-library';
import { createRecentProjects } from './recent-projects';
import {
  decodePreset,
  encodePreset,
  MAX_PRESET_BYTES,
  presetFileName,
  presetThumbnailBytes,
} from './preset-file';
import { decodeSettings, encodeSettings } from '@gleech/command-service';

interface Asset {
  source: ImageSource;
  fullPixels: ArrayBuffer;
  subject?: Promise<SubjectMask>;
}

export function registerImageHandlers(window: BrowserWindow, mcpAccess: McpAccess): () => void {
  const feedback = createFeedbackService({
    clientId: process.argv.includes('--smoke-test')
      ? (process.env.GLEECH_SMOKE_GITHUB_CLIENT_ID ?? feedbackConfig.clientId)
      : feedbackConfig.clientId,
    environment: {
      version: app.getVersion(),
      platform: `${process.platform} (${release()})`,
      electron: process.versions.electron ?? '',
      chromium: process.versions.chrome ?? '',
    },
    store: createFeedbackAuthStore(
      join(app.getPath('userData'), 'feedback-github.bin'),
      safeStorage,
    ),
  });
  window.once('closed', feedback.cancelSignIn);
  const statuePath = app.isPackaged
    ? join(process.resourcesPath, 'presets', 'statue.png')
    : join(__dirname, '../../resources/presets/statue.png');
  const recents = createRecentProjects(join(app.getPath('userData'), 'recent-projects.json'));
  async function rememberProject(path: string): Promise<{ recentWarning?: string }> {
    try {
      await recents.remember(path);
      return {};
    } catch {
      return { recentWarning: 'Could not update Recents.' };
    }
  }
  const presets = createPresetLibrary(join(app.getPath('userData'), 'presets.json'));
  const shaders = createShaderLibrary(join(app.getPath('userData'), 'shaders.json'));
  const builtins = createBuiltinPresetLibrary(
    app.isPackaged
      ? join(process.resourcesPath, 'presets')
      : join(__dirname, '../../resources/presets'),
  );
  const listPresets = async () => [
    ...(await presets.list()).map((preset) => ({ ...preset, builtIn: false })),
    ...(await builtins.list()),
  ];
  function editablePreset(id: string) {
    if (id.startsWith('builtin-v1:'))
      throw new Error(
        'Built-in presets are read-only. Apply one and save your edited stack as a new preset.',
      );
  }
  const assets = new Map<string, Asset>();
  const documents = new Map<string, string>();
  const batchAssets = new Map<string, Map<number, string>>();
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const worker = new Worker(join(__dirname, 'image-worker.js'));
  let sequence = 0;
  let workerAvailable = true;
  worker.on('message', (reply: Result<unknown> & { id: number }) => {
    const request = pending.get(reply.id);
    pending.delete(reply.id);
    if (reply.ok) request?.resolve(reply.value);
    else request?.reject(new Error(reply.error));
  });
  const failPending = (error: Error) => {
    workerAvailable = false;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.on('error', failPending);
  worker.on('exit', () => {
    failPending(new Error('The image worker stopped. Please restart GLEECH.'));
  });

  function run<T>(
    job:
      | Omit<Extract<ImageJob, { action: 'decode' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'jpeg-recompress' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'encode' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'export' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'preset-preview' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'prepare' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'thumbnail' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'shader-preview-source' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'subject' }>, 'id'>
      | Omit<Extract<ImageJob, { action: 'analyze' }>, 'id'>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!workerAvailable) {
        reject(new Error('The image worker stopped. Please restart GLEECH.'));
        return;
      }
      const id = ++sequence;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      const bytes = job.action === 'decode' ? job.bytes : job.image.pixels;
      try {
        worker.postMessage({ ...job, id }, [bytes]);
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function decode(bytes: ArrayBuffer, name: string): Promise<ImportedImage> {
    const image = await run<DecodedImage>({ action: 'decode', bytes });
    const source: ImageSource = {
      id: randomUUID(),
      name,
      width: image.width,
      height: image.height,
      format: image.format,
      hasAlpha: image.hasAlpha,
    };
    assets.set(source.id, { source, fullPixels: image.fullPixels });
    return { source, preview: image.preview, thumbnail: image.thumbnail };
  }

  async function importPath(path: unknown): Promise<ImportedImage> {
    if (typeof path !== 'string' || !path)
      throw new Error('Drop an image file from your computer.');
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 100 * 1024 * 1024)
        throw new Error('Choose an image file smaller than 100 MB.');
      return await decode(Uint8Array.from(await file.readFile()).buffer, basename(path));
    } finally {
      await file.close();
    }
  }

  function getAsset(id: unknown): Asset {
    if (typeof id !== 'string' || !assets.has(id))
      throw new Error('This image is no longer available. Open it again.');
    return assets.get(id)!;
  }

  const channels: string[] = [];
  function handle<T>(channel: string, operation: (...args: unknown[]) => Promise<T> | T): void {
    channels.push(channel);
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result<T>> => {
        try {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame
          )
            throw new Error('Invalid image request.');
          return { ok: true, value: await operation(...args) };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Image operation failed.',
          };
        }
      },
    );
  }
  handle('image:open', async () => {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Open image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return importPath(selection.filePaths[0]);
  });
  handle('image:open-sample', () => importPath(statuePath));
  handle('image:jpeg-recompress', (value, settings) => {
    const image = value as PixelImage,
      options = settings as JpegPassOptions;
    assertJpegRequest(image, options);
    return run<ArrayBuffer>({ action: 'jpeg-recompress', image, options });
  });
  handle('image:drop', importPath);
  async function decodeLayer(image: LayerImage): Promise<PixelImage> {
    assertLayerImage(image);
    const decoded = await run<DecodedImage>({
      action: 'decode',
      bytes: Uint8Array.from(Buffer.from(image.png.slice(22), 'base64')).buffer,
      projectSource: true,
    });
    if (decoded.width !== image.source.width || decoded.height !== image.source.height)
      throw new Error('The embedded layer image dimensions do not match.');
    return { width: decoded.width, height: decoded.height, pixels: decoded.fullPixels };
  }
  handle('image:layer-from-source', async (id) => {
    const asset = getAsset(id);
    const png = await run<ArrayBuffer>({
      action: 'encode',
      image: {
        width: asset.source.width,
        height: asset.source.height,
        pixels: asset.fullPixels.slice(0),
      },
    });
    const image = {
      source: { ...asset.source, id: randomUUID(), format: 'png' as const },
      png: 'data:image/png;base64,' + Buffer.from(png).toString('base64'),
    };
    assertLayerImage(image);
    return image;
  });
  handle('image:decode-layer', (value) => decodeLayer(value as LayerImage));
  const depthMaps = createDepthMapLibrary(
    app.isPackaged
      ? join(process.resourcesPath, 'depth-maps')
      : join(__dirname, '../../resources/depth-maps'),
  );
  handle('depth-maps:list', () => depthMaps.list());
  handle('depth-maps:choose', (id) => depthMaps.image(id));
  const vectorMaps = createVectorMapLibrary(
    app.isPackaged
      ? join(process.resourcesPath, 'vector-maps')
      : join(__dirname, '../../resources/vector-maps'),
  );
  handle('vector-maps:list', () => vectorMaps.list());
  handle('vector-maps:choose', (id) => vectorMaps.image(id));
  handle('image:open-layer', async (purpose) => {
    const selection = await dialog.showOpenDialog(window, {
      title:
        purpose === 'depth'
          ? 'Choose depth map image'
          : purpose === 'vector'
            ? 'Choose vector or grayscale map'
            : purpose === 'reference'
              ? 'Choose reference image'
              : 'Choose Solid layer image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const imported = await importPath(selection.filePaths[0]);
    try {
      const asset = getAsset(imported.source.id);
      const png = await run<ArrayBuffer>({
        action: 'encode',
        image: {
          width: asset.source.width,
          height: asset.source.height,
          pixels: asset.fullPixels.slice(0),
        },
      });
      const image = {
        source: { ...asset.source, format: 'png' as const },
        png: 'data:image/png;base64,' + Buffer.from(png).toString('base64'),
      };
      assertLayerImage(image);
      return image;
    } finally {
      assets.delete(imported.source.id);
    }
  });
  handle('project:open', async () => {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: 'GLEECH project', extensions: ['gleech'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return openProjectPath(selection.filePaths[0]);
  });
  handle('project:recents', () => recents.list());
  handle('project:clear-recents', () => recents.clear());
  handle('project:open-recent', async (id) => {
    const recent = await recents.get(id);
    try {
      return await openProjectPath(recent.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(
          'This recent project was moved or deleted. Use Open project to locate it.',
          { cause: error },
        );
      throw error;
    }
  });
  async function openProjectPath(path: string) {
    const file = await open(path, 'r');
    let saved;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_PROJECT_BYTES)
        throw new Error('Choose a project smaller than 300 MB.');
      saved = decodeProject(await file.readFile());
    } finally {
      await file.close();
    }
    // Validate embedded layers before publishing a project, including saved branches.
    for (const image of layerImages([
      ...saved.project.effects,
      ...saved.project.snapshots.flatMap((snapshot) => snapshot.effects),
    ])) {
      await decodeLayer(image);
    }
    // Decode every asset before publishing any of them: a broken branch cannot partly replace a project.
    const prepared = new Map<string, { asset: Asset; image: ImportedImage }>();
    for (const original of projectSources(saved.project)) {
      const encoded = saved.assets.get(original.id)!;
      const decoded = await run<DecodedImage>({
        action: 'decode',
        bytes: encoded.png,
        projectSource: true,
      });
      if (decoded.width !== original.width || decoded.height !== original.height)
        throw new Error('The project image dimensions do not match its recipe.');
      const source = { ...original, id: randomUUID() };
      prepared.set(original.id, {
        asset: {
          source,
          fullPixels: decoded.fullPixels,
          ...(encoded.subject ? { subject: Promise.resolve(encoded.subject) } : {}),
        },
        image: { source, preview: decoded.preview, thumbnail: decoded.thumbnail },
      });
    }
    const remap = (source: ImageSource) => prepared.get(source.id)!.asset.source;
    const project = {
      ...saved.project,
      source: remap(saved.project.source!),
      origin: saved.project.origin ? remap(saved.project.origin) : null,
      snapshots: saved.project.snapshots.map((snapshot) => ({
        ...snapshot,
        source: remap(snapshot.source),
        rendered: remap(snapshot.rendered),
      })),
    };
    assertProject(project);
    for (const { asset } of prepared.values()) assets.set(asset.source.id, asset);
    const document = { id: randomUUID(), name: basename(path), ...(await rememberProject(path)) };
    documents.set(document.id, path);
    return {
      project,
      image: prepared.get(saved.project.source!.id)!.image,
      images: [...prepared.values()].map(({ image }) => image),
      document,
    };
  }
  async function projectBytes(value: unknown) {
    assertProject(value);
    if (!value.source) throw new Error('Open an image before saving a project.');
    const encoded = new Map<string, SavedAsset>();
    for (const source of projectSources(value)) {
      const asset = getAsset(source.id);
      if (
        Object.entries(asset.source).some(
          ([key, entry]) => source[key as keyof ImageSource] !== entry,
        )
      )
        throw new Error('The project image does not match its source.');
      const png = await run<ArrayBuffer>({
        action: 'encode',
        image: { width: source.width, height: source.height, pixels: asset.fullPixels.slice(0) },
      });
      encoded.set(source.id, { png, ...(asset.subject ? { subject: await asset.subject } : {}) });
    }
    return encodeProject(value, encoded);
  }
  handle('mcp:read-file', async (dispatchId) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid MCP operation.');
    const request = mcpAccess.request(dispatchId);
    if (request.action === 'open_project') {
      if (extname(request.path).toLowerCase() !== '.gleech')
        throw new Error('Choose a .gleech project file.');
      return {
        kind: 'project' as const,
        ...(await openProjectPath(await mcpAccess.read(dispatchId, 'projects', request.path))),
      };
    }
    if (request.action === 'load_image' || request.action === 'replace_source')
      return {
        kind: 'image' as const,
        image: await importPath(await mcpAccess.read(dispatchId, 'imports', request.path)),
      };
    throw new Error('This MCP operation cannot read a file.');
  });
  handle('mcp:check-access', (dispatchId) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid MCP operation.');
    const request = mcpAccess.request(dispatchId, 'edit');
    if (request.action !== 'load_image_data') mcpAccess.request(dispatchId);
  });
  handle('mcp:read-image-data', async (dispatchId) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid MCP operation.');
    const request = mcpAccess.request(dispatchId, 'edit');
    if (request.action !== 'load_image_data')
      throw new Error('This operation cannot import image data.');
    const payload = mcpImageData({
      data: request.data,
      mimeType: request.mimeType,
      name: request.name,
    });
    const image = await decode(payload.bytes, payload.name);
    try {
      mcpAccess.request(dispatchId, 'edit');
      return { kind: 'image' as const, image };
    } catch (failure) {
      assets.delete(image.source.id);
      throw failure;
    }
  });
  handle('mcp:preset-operation', async (dispatchId, payload) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid MCP preset operation.');
    const request = mcpAccess.request(dispatchId, 'edit');
    const guard = () => {
      mcpAccess.request(
        dispatchId,
        ['import_preset', 'export_preset'].includes(request.action) ? 'full' : 'edit',
      );
    };
    const data = payload as { recipe?: unknown; thumbnail?: unknown } | undefined;
    if (request.action === 'save_preset') {
      const recipe = data?.recipe;
      assertPresetRecipe(recipe);
      const thumbnail = await validateThumbnail(data?.thumbnail, request.thumbnail);
      guard();
      return {
        preset: await presets.save(request.name, recipe, thumbnail, request.thumbnail, guard),
      };
    }
    if (request.action === 'duplicate_preset') {
      const original = (await listPresets()).find((preset) => preset.id === request.presetId);
      if (!original) throw new Error('This preset no longer exists.');
      guard();
      return {
        preset: await presets.save(
          request.name,
          original,
          original.thumbnail,
          original.thumbnailSource,
          guard,
        ),
      };
    }
    if (request.action === 'import_preset') {
      if (extname(request.path).toLowerCase() !== '.gleechpreset')
        throw new Error('Choose a .gleechpreset file.');
      const path = await mcpAccess.read(dispatchId, 'imports', request.path);
      const preset = await readPresetPath(path);
      guard();
      return { preset: await presets.importPreset(preset, guard) };
    }
    if (request.action === 'export_preset') {
      if (extname(request.path).toLowerCase() !== '.gleechpreset')
        throw new Error('Use the .gleechpreset extension.');
      const preset = (await listPresets()).find((preset) => preset.id === request.presetId);
      if (!preset) throw new Error('This preset no longer exists.');
      const path = await mcpAccess.write(
        dispatchId,
        'exports',
        request.path,
        encodePreset(preset),
        request.overwrite,
      );
      return { path };
    }
    throw new Error('This MCP operation cannot modify the preset library.');
  });
  handle('mcp:validate-recipes', async (dispatchId) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid MCP recipe operation.');
    const request = mcpAccess.request(dispatchId, 'edit');
    if (request.action !== 'apply_operations')
      throw new Error('This operation cannot apply a recipe.');
    for (const operation of request.operations) {
      if (operation.action !== 'apply_style_recipe') continue;
      assertPresetRecipe(operation.recipe);
      for (const image of layerImages(operation.recipe.effects)) await decodeLayer(image);
    }
    mcpAccess.request(dispatchId, 'edit');
  });
  handle('mcp:write-file', async (dispatchId, payload) => {
    if (typeof dispatchId !== 'string' || !payload || typeof payload !== 'object')
      throw new Error('Invalid MCP operation.');
    const request = mcpAccess.request(dispatchId);
    const data = payload as { project?: unknown; sourceId?: unknown; pixels?: unknown };
    if (request.action === 'save_project') {
      if (extname(request.path).toLowerCase() !== '.gleech')
        throw new Error('Save projects with the .gleech extension.');
      const path = await mcpAccess.write(
        dispatchId,
        'projects',
        request.path,
        await projectBytes(data.project),
        request.overwrite,
      );
      const document = { id: randomUUID(), name: basename(path), ...(await rememberProject(path)) };
      documents.set(document.id, path);
      return { path, document };
    }
    if (request.action !== 'export_image' && request.action !== 'render_full')
      throw new Error('This MCP operation cannot write a file.');
    const format = request.action === 'render_full' ? 'png' : request.format;
    const extensions = {
      png: ['.png'],
      jpeg: ['.jpg', '.jpeg'],
      webp: ['.webp'],
      tiff: ['.tif', '.tiff'],
    };
    if (!extensions[format].includes(extname(request.path).toLowerCase()))
      throw new Error('Output file extension must match the export format.');
    const asset = getAsset(data.sourceId);
    if (
      !(data.pixels instanceof ArrayBuffer) ||
      data.pixels.byteLength !== asset.source.width * asset.source.height * 4
    )
      throw new Error('Invalid MCP export pixels.');
    const output = await run<ArrayBuffer>({
      action: 'export',
      options: {
        format,
        ...(request.action === 'export_image' && request.quality !== undefined
          ? { quality: request.quality }
          : {}),
      },
      image: { width: asset.source.width, height: asset.source.height, pixels: data.pixels },
    });
    const path = await mcpAccess.write(
      dispatchId,
      'exports',
      request.path,
      new Uint8Array(output),
      request.overwrite,
    );
    return { path, format, width: asset.source.width, height: asset.source.height };
  });
  handle('mcp:batch-preflight', async (dispatchId) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid batch request.');
    const request = mcpAccess.request(dispatchId);
    if (request.action !== 'export_batch' && request.action !== 'batch')
      throw new Error('This operation cannot process a batch.');
    const inputs: string[] = [],
      outputs: string[] = [];
    const extensions = {
      png: ['.png'],
      jpeg: ['.jpg', '.jpeg'],
      webp: ['.webp'],
      tiff: ['.tif', '.tiff'],
    };
    for (const item of request.items) {
      if (!extensions[request.format].includes(extname(item.outputPath).toLowerCase()))
        throw new Error('Batch output extensions must match its format.');
      inputs.push((await mcpAccess.read(dispatchId, 'imports', item.inputPath)).toLowerCase());
      outputs.push(
        (
          await mcpAccess.output(dispatchId, 'exports', item.outputPath, request.overwrite)
        ).toLowerCase(),
      );
    }
    if (new Set(outputs).size !== outputs.length || outputs.some((path) => inputs.includes(path)))
      throw new Error('Batch outputs must be unique and must not replace any input image.');
  });
  handle('mcp:batch-read', async (dispatchId, index) => {
    if (typeof dispatchId !== 'string' || !Number.isInteger(index))
      throw new Error('Invalid batch input.');
    const request = mcpAccess.request(dispatchId);
    if (request.action !== 'export_batch' && request.action !== 'batch')
      throw new Error('This operation cannot process a batch.');
    const item = request.items[index as number];
    if (!item) throw new Error('Batch input does not exist.');
    const image = await importPath(await mcpAccess.read(dispatchId, 'imports', item.inputPath));
    const owned = batchAssets.get(dispatchId) ?? new Map<number, string>();
    const previous = owned.get(index as number);
    if (previous) assets.delete(previous);
    owned.set(index as number, image.source.id);
    batchAssets.set(dispatchId, owned);
    return image;
  });
  handle('mcp:batch-write', async (dispatchId, index, pixels) => {
    if (typeof dispatchId !== 'string' || !Number.isInteger(index))
      throw new Error('Invalid batch output.');
    const request = mcpAccess.request(dispatchId);
    if (request.action !== 'export_batch' && request.action !== 'batch')
      throw new Error('This operation cannot process a batch.');
    const item = request.items[index as number];
    const sourceId = batchAssets.get(dispatchId)?.get(index as number);
    if (!item || !sourceId) throw new Error('Load this batch input before exporting it.');
    const asset = getAsset(sourceId);
    if (
      !(pixels instanceof ArrayBuffer) ||
      pixels.byteLength !== asset.source.width * asset.source.height * 4
    )
      throw new Error('Invalid batch pixels.');
    const output = await run<ArrayBuffer>({
      action: 'export',
      options: {
        format: request.format,
        ...(request.quality === undefined ? {} : { quality: request.quality }),
      },
      image: { width: asset.source.width, height: asset.source.height, pixels },
    });
    const path = await mcpAccess.write(
      dispatchId,
      'exports',
      item.outputPath,
      new Uint8Array(output),
      request.overwrite,
    );
    return { path, width: asset.source.width, height: asset.source.height, format: request.format };
  });
  handle('mcp:batch-cleanup', (dispatchId) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid batch cleanup.');
    for (const id of batchAssets.get(dispatchId)?.values() ?? []) assets.delete(id);
    batchAssets.delete(dispatchId);
  });
  // render_video output: the exact file, or the folder a PNG sequence fills,
  // checked against approved Exports folders. Renders replace existing files,
  // so they are refused here unless the client allowed overwrite.
  handle('mcp:render-target', async (dispatchId) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid MCP operation.');
    const request = mcpAccess.request(dispatchId);
    if (request.action !== 'render_video')
      throw new Error('This MCP operation cannot render a video.');
    const missingParent = (error: unknown): never => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(
          'The output’s parent folder does not exist. Choose a location inside an approved Exports folder.',
        );
      throw error;
    };
    if (!renderOutputIsFolder(request)) {
      if (!/^\.(mp4|mov|mkv|webm|gif|webp|png|pdf)$/i.test(extname(request.path)))
        throw new Error(
          'Render to a .mp4, .mov, .mkv, .webm, .gif, .webp, .png or .pdf file. Separate-file PNG sequences take a folder path.',
        );
      const path = await mcpAccess
        .output(dispatchId, 'exports', request.path, request.overwrite)
        .catch(missingParent);
      mcpAccess.request(dispatchId);
      return path;
    }
    let folder: string;
    try {
      folder = await mcpAccess.read(dispatchId, 'exports', request.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // A new folder; the encoder creates it inside its approved parent.
      folder = await mcpAccess
        .output(dispatchId, 'exports', request.path, false)
        .catch(missingParent);
      mcpAccess.request(dispatchId);
      return folder;
    }
    if (!(await lstat(folder)).isDirectory())
      throw new Error('A separate-file PNG sequence needs a folder path, not a file.');
    if (!request.overwrite && (await readdir(folder)).length)
      throw new Error(
        'The output folder is not empty. Use a new or empty folder, or explicitly allow overwrite.',
      );
    mcpAccess.request(dispatchId);
    return folder;
  });
  handle('project:save', async (value, documentId, saveAs) => {
    assertProject(value);
    if (!value.source) throw new Error('Open an image before saving a project.');
    const references = projectSources(value);
    for (const source of references) {
      const asset = getAsset(source.id);
      if (
        Object.entries(asset.source).some(
          ([key, entry]) => source[key as keyof ImageSource] !== entry,
        )
      )
        throw new Error('The project image does not match its source.');
    }
    if (
      typeof saveAs !== 'boolean' ||
      (documentId !== null && (typeof documentId !== 'string' || !documents.has(documentId)))
    )
      throw new Error('Invalid project save request.');
    let path = documentId === null ? undefined : documents.get(documentId as string);
    if (saveAs || !path) {
      const selection = await dialog.showSaveDialog(window, {
        title: 'Save project',
        defaultPath: saveAs ? projectFileName(value.name) : (path ?? projectFileName(value.name)),
        filters: [{ name: 'GLEECH project', extensions: ['gleech'] }],
      });
      if (selection.canceled || !selection.filePath) return null;
      path = selection.filePath;
      if (extname(path).toLowerCase() !== '.gleech') path += '.gleech';
    }
    const output = await projectBytes(value);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, output, { flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    const id = documentId === null || saveAs ? randomUUID() : (documentId as string);
    documents.set(id, path);
    return { id, name: basename(path), ...(await rememberProject(path)) };
  });
  async function copyImage(id: unknown, pixels: unknown, guard?: () => void) {
    guard?.();
    const asset = getAsset(id);
    if (
      !(pixels instanceof ArrayBuffer) ||
      pixels.byteLength !== asset.source.width * asset.source.height * 4
    )
      throw new Error('Invalid clipboard image pixels.');
    const png = await run<ArrayBuffer>({
      action: 'encode',
      image: {
        width: asset.source.width,
        height: asset.source.height,
        pixels,
      },
    });
    guard?.();
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) }),
    ]);
  }
  handle('image:copy', (id, pixels) => copyImage(id, pixels));
  handle('mcp:copy-image', async (dispatchId, id, pixels) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid MCP clipboard request.');
    await copyImage(id, pixels, () => mcpAccess.clipboard(dispatchId));
  });
  handle('image:paste', async () => {
    for (const item of await clipboard.read()) {
      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        if (!item.types.includes(type)) continue;
        const blob = await item.getType(type);
        if (!(blob instanceof Blob)) continue;
        return decode(
          await blob.arrayBuffer(),
          `Pasted image.${type === 'image/jpeg' ? 'jpg' : type.slice(6)}`,
        );
      }
    }
    throw new Error('The clipboard does not contain an image. Copy an image and try again.');
  });
  handle('settings:read', async () => decodeSettings(await clipboard.readText()));
  handle('settings:write', async (data) => {
    const canonical = decodeSettings(JSON.stringify(data));
    if (!canonical) throw new Error('Invalid GLEECH clipboard settings.');
    await clipboard.writeText(encodeSettings(canonical));
  });
  handle('image:original', (id) => {
    const asset = getAsset(id);
    return {
      width: asset.source.width,
      height: asset.source.height,
      pixels: asset.fullPixels,
    } satisfies PixelImage;
  });
  function subjectFor(asset: Asset): Promise<SubjectMask> {
    if (!asset.subject) {
      asset.subject = run<SubjectMask>({
        action: 'subject',
        image: {
          width: asset.source.width,
          height: asset.source.height,
          pixels: asset.fullPixels.slice(0),
        },
        modelPath: app.isPackaged
          ? join(process.resourcesPath, 'models', 'u2netp.onnx')
          : join(__dirname, '../../resources/models/u2netp.onnx'),
      });
      void asset.subject.catch(() => {
        delete asset.subject;
      });
    }
    return asset.subject;
  }
  handle('image:subject', (id) => subjectFor(getAsset(id)));
  handle('mcp:analyze', async (dispatchId, sourceId) => {
    if (typeof dispatchId !== 'string') throw new Error('Invalid analysis request.');
    const request = mcpAccess.request(dispatchId, 'observe');
    if (request.action !== 'analyze_image')
      throw new Error('This operation cannot analyze an image.');
    const asset = getAsset(sourceId);
    const subjectMask = request.includeSubject ? await subjectFor(asset) : undefined;
    const value = await run<Record<string, unknown>>({
      action: 'analyze',
      image: {
        width: asset.source.width,
        height: asset.source.height,
        pixels: asset.fullPixels.slice(0),
      },
      ...(subjectMask ? { subjectMask } : {}),
    });
    mcpAccess.request(dispatchId, 'observe');
    return value;
  });
  function projectFileName(name: string): string {
    return presetFileName(name.replace(/\.(png|jpe?g|webp|tiff?|gleech)$/i, '')).replace(
      /\.gleechpreset$/,
      '.gleech',
    );
  }
  handle('image:save', async (id, pixels, value, name) => {
    const asset = getAsset(id);
    const options = value as ImageExportOptions | null;
    if (
      !(pixels instanceof ArrayBuffer) ||
      pixels.byteLength !== asset.source.width * asset.source.height * 4 ||
      !options ||
      !['png', 'jpeg', 'webp', 'tiff'].includes(options.format) ||
      (options.quality !== undefined &&
        (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100)) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 1024
    )
      throw new Error('Invalid image export request.');
    const extension = options.format === 'jpeg' ? 'jpg' : options.format;
    const selection = await dialog.showSaveDialog(window, {
      title: 'Export ' + options.format.toUpperCase(),
      defaultPath: projectFileName(name).replace(/\.gleech$/, '.' + extension),
      filters: [
        {
          name: options.format.toUpperCase() + ' image',
          extensions:
            options.format === 'jpeg'
              ? ['jpg', 'jpeg']
              : options.format === 'tiff'
                ? ['tiff', 'tif']
                : [extension],
        },
      ],
    });
    if (selection.canceled || !selection.filePath) return null;
    const output = await run<ArrayBuffer>({
      action: 'export',
      options,
      image: { width: asset.source.width, height: asset.source.height, pixels },
    });
    const allowed =
      options.format === 'jpeg'
        ? ['.jpg', '.jpeg']
        : options.format === 'tiff'
          ? ['.tif', '.tiff']
          : ['.' + extension];
    const path = allowed.includes(extname(selection.filePath).toLowerCase())
      ? selection.filePath
      : selection.filePath.replace(/\.(png|jpe?g|webp|tiff?)$/i, '') + '.' + extension;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, Buffer.from(output), { flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return basename(path);
  });
  handle('image:save-png', async (id, pixels) => {
    const asset = getAsset(id);
    if (
      !(pixels instanceof ArrayBuffer) ||
      pixels.byteLength !== asset.source.width * asset.source.height * 4
    )
      throw new Error('Invalid export pixels.');
    const selection = await dialog.showSaveDialog(window, {
      title: 'Export PNG',
      defaultPath: `${basename(asset.source.name, extname(asset.source.name))}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    const output = await run<ArrayBuffer>({
      action: 'export',
      options: { format: 'png' },
      image: { width: asset.source.width, height: asset.source.height, pixels },
    });
    const path =
      extname(selection.filePath).toLowerCase() === '.png'
        ? selection.filePath
        : `${selection.filePath}.png`;
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, Buffer.from(output), { flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return basename(path);
  });
  handle('image:capture', async (id, pixels, name) => {
    const input = getAsset(id);
    if (
      !(pixels instanceof ArrayBuffer) ||
      pixels.byteLength !== input.source.width * input.source.height * 4 ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 120
    )
      throw new Error('Invalid snapshot image.');
    const image = await run<DecodedImage>({
      action: 'prepare',
      image: {
        width: input.source.width,
        height: input.source.height,
        pixels,
      },
    });
    const source: ImageSource = {
      id: randomUUID(),
      name: name.trim() + '.png',
      width: image.width,
      height: image.height,
      format: 'png',
      hasAlpha: image.hasAlpha,
    };
    assets.set(source.id, { source, fullPixels: image.fullPixels });
    return { source, preview: image.preview, thumbnail: image.thumbnail };
  });
  // A decoded video frame (the clip's poster) becomes the project's source image.
  handle('image:from-pixels', async (width, height, pixels, name) => {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      (width as number) < 1 ||
      (height as number) < 1 ||
      (width as number) > 16384 ||
      (height as number) > 16384 ||
      !(pixels instanceof ArrayBuffer) ||
      pixels.byteLength !== (width as number) * (height as number) * 4 ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 120
    )
      throw new Error('Invalid video frame.');
    const image = await run<DecodedImage>({
      action: 'prepare',
      image: { width: width as number, height: height as number, pixels },
    });
    const source: ImageSource = {
      id: randomUUID(),
      name: name.trim() + '.png',
      width: image.width,
      height: image.height,
      format: 'png',
      hasAlpha: image.hasAlpha,
    };
    assets.set(source.id, { source, fullPixels: image.fullPixels });
    return { source, preview: image.preview, thumbnail: image.thumbnail };
  });
  handle('shader:list', () => shaders.list());
  handle('shader:open', async () => {
    const selected = await dialog.showOpenDialog(window, {
      title: 'Add Shader',
      defaultPath: app.isPackaged
        ? join(process.resourcesPath, 'shaders')
        : join(__dirname, '../../resources/shaders'),
      properties: ['openFile'],
      filters: [
        {
          name: 'Shader files',
          extensions: ['gleech-shader', 'json', 'wgsl', 'fs', 'isf', 'frag', 'glsl'],
        },
      ],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const file = await open(selected.filePaths[0], 'r');
    try {
      if ((await file.stat()).size > MAX_SHADER_PACKAGE_BYTES)
        throw new Error('Shader package exceeds 256 KiB.');
      const pkg = decodeShaderImport(await file.readFile('utf8'), basename(selected.filePaths[0]));
      assertExecutableShader(pkg);
      return pkg;
    } finally {
      await file.close();
    }
  });
  handle('shader:fetch', async (value) => {
    if (typeof value !== 'string') throw new Error('Enter a direct HTTPS shader URL.');
    return fetchShader(value);
  });
  handle('shader:store', async (pkg, thumbnail) => {
    assertExecutableShader(pkg);
    return shaders.store(pkg, await validateThumbnail(thumbnail, 'statue'));
  });
  handle('shader:delete', (id) => {
    if (typeof id !== 'string') throw new Error('Invalid shader ID.');
    return shaders.delete(id);
  });
  handle('support:open', async (id) => {
    await shell.openExternal(supportLink(id));
  });
  handle('app:copy-version', () => clipboard.writeText(APP_VERSION_LABEL));
  handle('feedback:status', feedback.status);
  handle('feedback:sign-in', feedback.startSignIn);
  handle('feedback:poll', feedback.pollSignIn);
  handle('feedback:cancel-sign-in', feedback.cancelSignIn);
  handle('feedback:sign-out', feedback.signOut);
  handle('feedback:submit', feedback.submit);
  handle('feedback:copy-code', async () => {
    await clipboard.writeText(await feedback.copySignInCode());
  });
  handle('feedback:open-sign-in', async () => {
    if (!feedback.canOpenSignIn()) throw new Error('Start GitHub sign-in first.');
    await shell.openExternal('https://github.com/login/device');
  });
  handle('feedback:open-issue', async (number) => {
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1)
      throw new Error('Invalid GitHub issue number.');
    await shell.openExternal(`${SUPPORT_REPOSITORY}/issues/${number}`);
  });
  handle('support:copy', async (id) => {
    await clipboard.writeText(supportCopyText(id));
  });
  handle('shader:credit', async (value) => {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid credit link.');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname)
      throw new Error('Credit links must use HTTPS.');
    await shell.openExternal(url.href);
  });
  handle('preset:list', listPresets);
  let statue: Promise<Asset> | undefined;
  function statueAsset(): Promise<Asset> {
    if (!statue) {
      statue = (async () => {
        const decoded = await run<DecodedImage>({
          action: 'decode',
          bytes: Uint8Array.from(await readFile(statuePath)).buffer,
        });
        return {
          source: {
            id: 'statue',
            name: 'Statue',
            width: decoded.width,
            height: decoded.height,
            format: 'png',
            hasAlpha: false,
          },
          fullPixels: decoded.fullPixels,
        };
      })();
      void statue.catch(() => {
        statue = undefined;
      });
    }
    return statue;
  }
  async function preview(asset: Asset, recipe: PresetRecipe): Promise<string> {
    const needsSubject = effectsNeedSubject(recipe.effects, asset.fullPixels);
    const subjectMask = needsSubject ? await subjectFor(asset) : undefined;
    return run<string>({
      action: 'preset-preview',
      image: {
        width: asset.source.width,
        height: asset.source.height,
        pixels: asset.fullPixels.slice(0),
      },
      recipe,
      ...(subjectMask ? { subjectMask } : {}),
    });
  }
  handle('shader:preview-source', async (id, recipe) => {
    assertPresetRecipe(recipe);
    const asset = id === null ? await statueAsset() : getAsset(id);
    const subjectMask = effectsNeedSubject(recipe.effects, asset.fullPixels)
      ? await subjectFor(asset)
      : undefined;
    const image = await run<PixelImage>({
      action: 'shader-preview-source',
      image: {
        width: asset.source.width,
        height: asset.source.height,
        pixels: asset.fullPixels.slice(0),
      },
    });
    return {
      image,
      reference: { width: asset.source.width, height: asset.source.height },
      ...(subjectMask ? { subjectMask } : {}),
    };
  });
  handle('preset:thumbnails', async (id, recipe) => {
    assertPresetRecipe(recipe);
    const image = id === null ? null : await preview(getAsset(id), recipe);
    return { image, statue: await preview(await statueAsset(), recipe) };
  });
  async function validateThumbnail(thumbnail: unknown, choice: unknown): Promise<string> {
    if (
      typeof thumbnail !== 'string' ||
      thumbnail.length > 1024 * 1024 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(thumbnail) ||
      !['image', 'statue'].includes(choice as string)
    )
      throw new Error('Choose a valid preset thumbnail.');
    await run<DecodedImage>({
      action: 'decode',
      bytes: presetThumbnailBytes({ thumbnail } as EffectPreset),
    });
    return thumbnail;
  }
  handle('preset:store', async (recipe, name, thumbnail, choice) => {
    assertPresetRecipe(recipe);
    assertPresetName(name);
    return presets.save(
      name,
      recipe,
      await validateThumbnail(thumbnail, choice),
      choice as 'image' | 'statue',
    );
  });
  handle('preset:edit', async (id, name, thumbnail, choice) => {
    if (typeof id !== 'string') throw new Error('Invalid preset ID.');
    editablePreset(id);
    assertPresetName(name);
    return presets.edit(
      id,
      name,
      await validateThumbnail(thumbnail, choice),
      choice as 'image' | 'statue',
    );
  });
  handle('preset:import', async () => {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Import preset',
      properties: ['openFile'],
      filters: [{ name: 'GLEECH preset', extensions: ['gleechpreset'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return presets.importPreset(await readPresetPath(selection.filePaths[0]));
  });
  async function readPresetPath(path: string) {
    const file = await open(path, 'r');
    let preset;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_PRESET_BYTES)
        throw new Error('Choose a preset file smaller than 16 MB.');
      preset = decodePreset(await file.readFile());
    } finally {
      await file.close();
    }
    // Verify the bounded PNG in the worker before publishing an imported library entry.
    await run<DecodedImage>({ action: 'decode', bytes: presetThumbnailBytes(preset) });
    for (const image of layerImages(preset.effects)) {
      await decodeLayer(image);
    }
    return preset;
  }
  handle('preset:export', async (id) => {
    if (typeof id !== 'string') throw new Error('Invalid preset ID.');
    const preset = (await listPresets()).find((entry) => entry.id === id);
    if (!preset) throw new Error('This preset no longer exists.');
    const output = encodePreset(preset);
    const selection = await dialog.showSaveDialog(window, {
      title: 'Export preset',
      defaultPath: presetFileName(preset.name),
      filters: [{ name: 'GLEECH preset', extensions: ['gleechpreset'] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    let path = selection.filePath;
    if (extname(path).toLowerCase() !== '.gleechpreset') path += '.gleechpreset';
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, output, { flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return basename(path);
  });
  handle('preset:save', async (id, pixels, recipe, name) => {
    const { source } = getAsset(id);
    assertPresetRecipe(recipe);
    assertPresetName(name);
    if (!(pixels instanceof ArrayBuffer) || pixels.byteLength !== source.width * source.height * 4)
      throw new Error('Invalid preset thumbnail pixels.');
    const thumbnail = await run<string>({
      action: 'thumbnail',
      image: { width: source.width, height: source.height, pixels },
    });
    return presets.save(name, recipe, thumbnail);
  });
  handle('preset:rename', (id, name) => {
    if (typeof id !== 'string') throw new Error('Invalid preset ID.');
    editablePreset(id);
    assertPresetName(name);
    return presets.rename(id, name);
  });
  handle('preset:delete', (id) => {
    if (typeof id !== 'string') throw new Error('Invalid preset ID.');
    editablePreset(id);
    return presets.delete(id);
  });
  handle('document:confirm-discard', async (name) => {
    if (typeof name !== 'string' || name.length > 1024) throw new Error('Invalid document name.');
    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      title: 'Unsaved changes',
      message: 'Save changes to ' + name + '?',
      detail: 'Your unsaved edits will be lost if you discard them.',
      buttons: ['Save', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return (['save', 'discard', 'cancel'] as const)[answer.response] ?? 'cancel';
  });
  // A warning before an edit that replaces work, such as restoring an audio link.
  handle('document:confirm-action', async (title, message, detail, action) => {
    for (const value of [title, message, detail, action])
      if (typeof value !== 'string' || value.length > 1024)
        throw new Error('Invalid confirmation.');
    const answer = await dialog.showMessageBox(window, {
      type: 'warning',
      title: title as string,
      message: message as string,
      detail: detail as string,
      buttons: [action as string, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    return answer.response === 0;
  });
  handle('image:release', (id) => {
    if (typeof id === 'string') assets.delete(id);
  });

  return () => {
    channels.forEach((channel) => ipcMain.removeHandler(channel));
    failPending(new Error('The workspace closed.'));
    void worker.terminate();
    assets.clear();
    batchAssets.clear();
    documents.clear();
  };
}
