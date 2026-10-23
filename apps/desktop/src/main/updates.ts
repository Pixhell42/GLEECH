import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { APP_IS_BETA } from '../shared/branding';
import type { Result } from '../shared/image-api';
import { createUpdateController } from './update-controller';
import { createUpdateEngine } from './update-engine';
import { discoverUpdate } from './update-releases';
import { updateInstallMode } from './update-mode';
import { createUpdatePreferenceStore, createUpdateSessionStore } from './update-storage';

export function registerUpdates(
  window: BrowserWindow,
  authorizeClose: (allow: boolean) => void,
): () => void {
  const folder = app.getPath('userData');
  const sessions = createUpdateSessionStore(join(folder, 'update-recovery'));
  const mode = updateInstallMode({
    packaged: app.isPackaged,
    smoke: process.argv.includes('--smoke-test'),
    platform: process.platform,
    windowsInstalled:
      process.platform === 'win32' &&
      existsSync(join(dirname(process.execPath), 'Uninstall GLEECH.exe')),
    appImage: process.env.APPIMAGE,
  });
  const engine = createUpdateEngine(join(folder, 'update-downloads'), (error) =>
    controller.reportInstallError(error),
  );
  const controller = createUpdateController({
    version: app.getVersion(),
    mode,
    unavailableReason:
      mode !== 'unavailable'
        ? null
        : !app.isPackaged || process.argv.includes('--smoke-test')
          ? 'Automatic updates are available in installed release builds.'
          : process.platform === 'win32'
            ? 'Automatic installation is available in the installed NSIS version. Unpacked test builds stay separate from your installed app.'
            : 'Run the original AppImage to install updates. Extracted or package-managed copies need a manual update.',
    store: createUpdatePreferenceStore(
      join(folder, 'updates.json'),
      app.getVersion(),
      !process.argv.includes('--smoke-test'),
    ),
    engine,
    discover: () => discoverUpdate(app.getVersion(), process.platform, process.arch, APP_IS_BETA),
    publish: (state) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send('updates:changed', state);
    },
    beforeInstall: async (id) => {
      await sessions.validate(id);
      authorizeClose(true);
    },
    installFailed: () => authorizeClose(false),
  });
  const channels: string[] = [];
  function handle<T>(channel: string, operation: (...args: unknown[]) => T | Promise<T>) {
    channels.push(channel);
    ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
      try {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('Invalid update request.');
        return { ok: true, value: await operation(...args) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Update operation failed.',
        };
      }
    });
  }
  handle('updates:state', () => controller.getState());
  handle('updates:check', () => controller.check());
  handle('updates:automatic', (value) => controller.setAutomatic(value));
  handle('updates:dismiss', () => controller.dismiss());
  handle('updates:download', () => controller.download());
  handle('updates:install', (id) => controller.install(id));
  handle('updates:acknowledge-notes', (version) => controller.acknowledgeNotes(version));
  handle('updates:licenses', async (kind) => {
    if (!['gleech', 'notices', 'licenses'].includes(String(kind)))
      throw new Error('Unknown license document.');
    const root = app.isPackaged ? process.resourcesPath : resolve(app.getAppPath(), '../..');
    const name =
      kind === 'gleech'
        ? app.isPackaged
          ? 'LICENSE.GLEECH.txt'
          : 'LICENSE'
        : kind === 'notices'
          ? 'THIRD_PARTY_NOTICES.md'
          : app.isPackaged
            ? 'licenses'
            : 'LICENSES';
    const error = await shell.openPath(join(root, name));
    if (error) throw new Error(error);
  });
  const check = () => {
    void controller.check(false).catch(() => {});
  };
  const initial = setTimeout(check, 15000);
  const interval = setInterval(check, 6 * 60 * 60 * 1000);
  initial.unref();
  interval.unref();
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
    controller.dispose();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
