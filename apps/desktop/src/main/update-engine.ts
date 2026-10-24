import { app, shell } from 'electron';
import { AppImageUpdater, NsisUpdater } from 'electron-updater';
import type { AppUpdater, UpdateCheckResult } from 'electron-updater';
import type { UpdateEngine } from './update-controller';
import type { UpdateProgress, UpdateRelease } from '../shared/updates';
import { updateChannel } from './update-releases';
import { SUPPORT_REPOSITORY } from '../shared/support';
import { downloadVerifiedUpdate, verifyUpdateDownload } from './update-download';
import { replaceAppImage } from './replace-appimage';

class StablePathAppImageUpdater extends AppImageUpdater {
  protected doInstall(options: { isForceRunAfter?: boolean }): boolean {
    const current = process.env.APPIMAGE;
    const downloaded = this.installerPath;
    if (!current || !downloaded)
      throw new Error('The original AppImage or downloaded update is missing.');
    replaceAppImage(current, downloaded);
    if (options.isForceRunAfter) {
      app.releaseSingleInstanceLock();
      void this.spawnLog(current, [], { ...process.env, APPIMAGE_SILENT_INSTALL: 'true' }).catch(
        (error) => this.dispatchError(error),
      );
    }
    return true;
  }
}

export function createUpdateEngine(
  folder: string,
  onInstallError: (error: Error) => void,
  options: { relaunch?: boolean } = {},
): UpdateEngine {
  let downloaded: { path: string; release: UpdateRelease } | null = null;
  let abort: AbortController | null = null;
  let checkResult: UpdateCheckResult | null = null;
  let installRequested = false;
  let installError: Error | null = null;
  const reportError = (error: Error) => {
    if (installRequested) {
      installError = error;
      onInstallError(error);
    }
  };
  const freshUpdater = (): AppUpdater | null => {
    const updater =
      process.platform === 'linux'
        ? new StablePathAppImageUpdater()
        : process.platform === 'win32'
          ? new NsisUpdater()
          : null;
    if (updater) {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      updater.disableWebInstaller = true;
      updater.on('error', reportError);
    }
    return updater;
  };
  let autoUpdater = freshUpdater();
  return {
    async check(release) {
      if (process.platform === 'darwin') return;
      if (!autoUpdater) throw new Error('This platform requires a manual update.');
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: `${SUPPORT_REPOSITORY}/releases/download/${release.tag}/`,
        channel: updateChannel(process.arch),
        useMultipleRangeRequest: false,
      });
      checkResult = await autoUpdater.checkForUpdates();
      const info = checkResult?.updateInfo;
      if (
        !checkResult?.isUpdateAvailable ||
        !info ||
        info.version !== release.version ||
        info.files.length !== 1 ||
        info.files[0]?.url !== release.asset ||
        !/^[A-Za-z0-9+/]{86}==$/.test(info.files[0].sha512) ||
        info.files[0].size !== release.bytes
      )
        throw new Error('The update manifest does not match this GLEECH release.');
    },
    async download(release, progress) {
      downloaded = null;
      if (process.platform !== 'darwin') {
        // Clear native state after an install error or cancelled download before retrying.
        if (installError || checkResult?.cancellationToken?.cancelled) {
          autoUpdater?.removeListener('error', reportError);
          autoUpdater = freshUpdater();
          installRequested = false;
          installError = null;
          await this.check(release);
        }
        if (!autoUpdater) throw new Error('This platform requires a manual update.');
        const listener = (value: UpdateProgress) => progress(value);
        autoUpdater.on('download-progress', listener);
        try {
          const paths = await autoUpdater.downloadUpdate(checkResult?.cancellationToken);
          const path = paths[0];
          if (!path) throw new Error('The update download did not produce a package.');
          await verifyUpdateDownload(path, release);
          downloaded = { path, release };
        } finally {
          autoUpdater.removeListener('download-progress', listener);
        }
        return;
      }
      const controller = new AbortController();
      abort = controller;
      const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);
      try {
        const path = await downloadVerifiedUpdate(release, folder, progress, controller.signal);
        downloaded = { path, release };
      } finally {
        clearTimeout(timeout);
        abort = null;
      }
    },
    cancel() {
      abort?.abort();
      checkResult?.cancellationToken?.cancel();
    },
    async install() {
      if (!downloaded) throw new Error('Download the update before installing.');
      await verifyUpdateDownload(downloaded.path, downloaded.release);
      installRequested = true;
      if (process.platform === 'darwin') {
        shell.showItemInFolder(downloaded.path);
        app.quit();
      } else {
        if (!autoUpdater) throw new Error('This platform requires a manual update.');
        autoUpdater.quitAndInstall(true, options.relaunch !== false);
        if (installError) throw installError;
      }
    },
  };
}
