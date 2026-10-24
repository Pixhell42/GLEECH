import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { Result } from '../shared/image-api';
import { openFileFilters, type SelectedFile } from '../shared/open-file';
import { OpenFileAccess } from './open-file-access';

export function registerOpenFileHandlers(window: BrowserWindow): OpenFileAccess {
  const access = new OpenFileAccess();
  for (const channel of ['file:choose', 'file:drop']) {
    ipcMain.handle(channel, async (event, path: unknown): Promise<Result<SelectedFile | null>> => {
      try {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('Invalid file request.');
        if (channel === 'file:drop') return { ok: true, value: access.select(path) };
        const selected = await dialog.showOpenDialog(window, {
          title: 'Open File',
          properties: ['openFile'],
          filters: openFileFilters(),
        });
        return {
          ok: true,
          value:
            selected.canceled || !selected.filePaths[0]
              ? null
              : access.select(selected.filePaths[0]),
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Could not open the file.',
        };
      }
    });
  }
  window.once('closed', () => {
    ipcMain.removeHandler('file:choose');
    ipcMain.removeHandler('file:drop');
    access.clear();
  });
  return access;
}
