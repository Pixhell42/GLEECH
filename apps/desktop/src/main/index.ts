import { startCliGpu } from './cli-gpu-main';
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { join } from 'node:path';
import { registerImageHandlers } from './images';
import { APP_ICON_FILE } from '../shared/branding';
import { registerWindowControls } from './window-controls';
import { registerMcp } from './mcp';
import { createMcpAccess } from './mcp-access';
import { bundledFfmpegCandidates, createFfmpegLocator } from './ffmpeg';
import { registerRenderHandlers } from './render-service';
import { registerMediaHandlers, registerMediaScheme } from './media-service';

const smokeTest = process.argv.includes('--smoke-test');
const smokeUserData = process.env['GLEECH_SMOKE_USER_DATA'];
if (smokeTest && smokeUserData) app.setPath('userData', smokeUserData);
if (!process.argv.includes('--gleech-cli-gpu')) registerMediaScheme();

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    title: 'GLEECH',
    frame: process.platform !== 'win32',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'branding', APP_ICON_FILE)
      : join(__dirname, '../../resources/branding', APP_ICON_FILE),
    backgroundColor: '#111314',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const mcpAccess = createMcpAccess();
  const disposeImages = registerImageHandlers(window, mcpAccess);
  window.once('closed', disposeImages);
  window.once('closed', registerWindowControls(window));
  window.once('closed', registerMcp(window, mcpAccess));
  const ffmpeg = createFfmpegLocator({
    configFile: join(app.getPath('userData'), 'ffmpeg.json'),
    bundled: bundledFfmpegCandidates(process.resourcesPath, app.getAppPath(), app.isPackaged),
  });
  window.once(
    'closed',
    registerRenderHandlers(window, ffmpeg, () =>
      mcpAccess
        .folders()
        .filter((folder) => folder.kind === 'exports')
        .map((folder) => folder.path),
    ),
  );
  window.once('closed', registerMediaHandlers(window, ffmpeg));
  let allowClose = false;
  let closePending = false;
  let rendererReady = false;
  const documentReady = (event: Electron.IpcMainEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      return;
    // React may re-subscribe after a save. Only the initial readiness signal may
    // replay a close requested before loading finished.
    if (rendererReady) return;
    rendererReady = true;
    if (closePending) window.webContents.send('document:close-requested');
  };
  ipcMain.on('document:ready', documentReady);
  ipcMain.handle('document:request-close', (event) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Invalid close request.');
    window.close();
  });
  window.on('close', (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    if (rendererReady) window.webContents.send('document:close-requested');
  });
  ipcMain.handle('document:resolve-close', (event, allow: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      typeof allow !== 'boolean'
    )
      throw new Error('Invalid close request.');
    if (!closePending) return;
    closePending = false;
    if (allow) {
      allowClose = true;
      setImmediate(() => window.close());
    }
  });
  window.once('closed', () => {
    ipcMain.removeHandler('document:resolve-close');
    ipcMain.removeHandler('document:request-close');
    ipcMain.removeListener('document:ready', documentReady);
  });

  window.once('ready-to-show', () => {
    if (!smokeTest) window.show();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const developmentUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

if (process.argv.includes('--gleech-cli-gpu')) {
  void startCliGpu().catch((error) => {
    process.stderr.write(String(error) + '\n');
    app.exit(1);
  });
} else {
  void app.whenReady().then(() => {
    app.setAppUserModelId('com.gleech.desktop');
    Menu.setApplicationMenu(null);
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
