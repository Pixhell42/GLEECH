import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { WindowState } from '../shared/image-api';

export function registerWindowControls(window: BrowserWindow): () => void {
  const validate = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Invalid window request.');
  };
  const state = (): WindowState => ({ maximized: window.isMaximized() });
  const publish = () => window.webContents.send('window:state-changed', state());

  ipcMain.handle('window:state', (event) => {
    validate(event);
    return state();
  });
  ipcMain.handle('window:minimize', (event) => {
    validate(event);
    window.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (event) => {
    validate(event);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  window.on('maximize', publish);
  window.on('unmaximize', publish);

  return () => {
    ipcMain.removeHandler('window:state');
    ipcMain.removeHandler('window:minimize');
    ipcMain.removeHandler('window:toggle-maximize');
    window.removeListener('maximize', publish);
    window.removeListener('unmaximize', publish);
  };
}
