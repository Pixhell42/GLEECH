import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { FfmpegLocator } from './ffmpeg';
import { createRenderJobs, safeName, validateSpec } from './render-jobs';
import type { Result } from '../shared/image-api';
import type { RenderJobSpec } from '../shared/render';

/** Files a render may write: video, loops, sprite sheets and flip books. */
const OUTPUT_EXTENSIONS = /\.(mp4|mov|mkv|webm|gif|webp|png|apng|pdf)$/i;

/**
 * Registers render:* IPC handlers. Renders may only write inside the default
 * render folder or a location the user picked in a Save/folder dialog this
 * session. Returns a disposer that removes the handlers and cancels jobs.
 */
export function registerRenderHandlers(
  window: BrowserWindow,
  ffmpeg: FfmpegLocator,
  /** Extra folders the user approved elsewhere (MCP Exports grants). */
  extraFolders: () => readonly string[] = () => [],
): () => void {
  const jobs = createRenderJobs({
    ffmpeg,
    upscalerDirs: [
      app.isPackaged
        ? join(process.resourcesPath, 'upscalers')
        : join(app.getAppPath(), 'resources', 'upscalers'),
    ],
  });
  const approvedFolders = new Set<string>();
  const normalize = (path: string) => {
    const full = resolve(path);
    return process.platform === 'win32' ? full.toLowerCase() : full;
  };
  const inside = (path: string, folder: string) => {
    const offset = relative(folder, path);
    return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
  };
  const approved = (folder: string) =>
    [...approvedFolders, ...extraFolders().map(normalize)].some((entry) => inside(folder, entry));
  function assertApproved(spec: RenderJobSpec): void {
    const folderOutput =
      spec.kind === 'video' &&
      spec.video?.output === 'sequence' &&
      spec.video.sequence.kind === 'files';
    const path = normalize(spec.outputPath);
    if (!folderOutput && !OUTPUT_EXTENSIONS.test(path))
      throw new Error('Renders can only be saved as video, GIF, WebP, PNG or PDF files.');
    if (!approved(folderOutput ? path : dirname(path)))
      throw new Error('Choose where to save the render again.');
  }
  async function defaultFolder(): Promise<string> {
    let base: string;
    try {
      base = app.getPath('videos');
    } catch {
      base = app.getPath('documents');
    }
    const folder = join(base, 'GLEECH');
    await mkdir(folder, { recursive: true });
    approvedFolders.add(normalize(folder));
    return folder;
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
            throw new Error('Invalid render request.');
          return { ok: true, value: await operation(...args) };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Render failed.',
          };
        }
      },
    );
  }

  handle('render:ffmpeg-status', (refresh) => ffmpeg.status(refresh === true));
  handle('render:locate-ffmpeg', async () => {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Locate ffmpeg',
      properties: ['openFile'],
      ...(process.platform === 'win32'
        ? { filters: [{ name: 'ffmpeg', extensions: ['exe'] }] }
        : {}),
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return ffmpeg.configure(selection.filePaths[0]);
  });
  handle('render:choose-output', async (kind, defaultName, extension) => {
    if (
      (kind !== 'file' && kind !== 'folder') ||
      typeof defaultName !== 'string' ||
      defaultName.length > 200 ||
      typeof extension !== 'string' ||
      !/^[a-z0-9]{0,5}$/i.test(extension)
    )
      throw new Error('Invalid save location request.');
    const start = await defaultFolder();
    if (kind === 'folder') {
      const selection = await dialog.showOpenDialog(window, {
        title: 'Choose a folder for the frames',
        defaultPath: start,
        properties: ['openDirectory', 'createDirectory'],
      });
      const folder = selection.filePaths[0];
      if (selection.canceled || !folder) return null;
      approvedFolders.add(normalize(folder));
      return folder;
    }
    if (!extension) throw new Error('Invalid save location request.');
    const name = safeName(defaultName);
    const selection = await dialog.showSaveDialog(window, {
      title: 'Save render',
      defaultPath: join(start, `${name}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    let path = selection.filePath;
    if (!path.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) path += `.${extension}`;
    approvedFolders.add(normalize(dirname(path)));
    return path;
  });
  handle('render:default-folder', () => defaultFolder());
  // Lets the Render dialog warn before a render replaces a file. Answers only
  // for output files in folders a render may write to.
  handle('render:output-exists', async (path) => {
    if (typeof path !== 'string' || !isAbsolute(path) || !OUTPUT_EXTENSIONS.test(path))
      return false;
    if (!approved(dirname(normalize(path)))) return false;
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  });
  handle('render:begin', async (value) => {
    const spec = validateSpec(value);
    // The default folder is always allowed, even if the dialog never asked for it.
    await defaultFolder();
    assertApproved(spec);
    return jobs.begin(spec);
  });
  handle('render:frame', (jobId, frame, original) => jobs.frame(jobId, frame, original));
  handle('render:finish', (jobId) => jobs.finish(jobId));
  handle('render:cancel', (jobId) => jobs.cancel(jobId));
  handle('render:reveal', (path) => {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Invalid path.');
    shell.showItemInFolder(path);
  });

  return () => {
    channels.forEach((channel) => ipcMain.removeHandler(channel));
    void jobs.dispose();
  };
}
