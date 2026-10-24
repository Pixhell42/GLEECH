import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateRelease } from '../shared/updates';

const mocks = vi.hoisted(() => ({
  quitAndInstall: vi.fn(),
  finder: vi.fn(),
  quit: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { quit: mocks.quit },
  shell: { showItemInFolder: mocks.finder },
}));
vi.mock('./update-download', () => ({
  verifyUpdateDownload: vi.fn(async () => {}),
  downloadVerifiedUpdate: vi.fn(async () => '/verified/download.zip'),
}));
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events');
  class Updater extends EventEmitter {
    setFeedURL() {}
    async checkForUpdates() {
      return {
        isUpdateAvailable: true,
        updateInfo: {
          version: '0.2.1',
          files: [{ url: 'GLEECH-0.2.1-x64-setup.exe', sha512: 'a'.repeat(86) + '==', size: 3 }],
        },
      };
    }
    async downloadUpdate() {
      return ['/verified/installer'];
    }
    quitAndInstall = mocks.quitAndInstall;
  }
  return { NsisUpdater: Updater, AppImageUpdater: Updater };
});
import { createUpdateEngine } from './update-engine';

const release: UpdateRelease = {
  version: '0.2.1',
  notes: '',
  tag: 'v0.2.1',
  url: '',
  downloadUrl: '',
  asset: 'GLEECH-0.2.1-x64-setup.exe',
  bytes: 3,
  sha256: 'a'.repeat(64),
};
beforeEach(() => vi.clearAllMocks());
describe('shared desktop and terminal install engine', () => {
  it.each([true, false])(
    'respects relaunch=%s after verification without running a real installer',
    async (relaunch) => {
      const engine = createUpdateEngine('/cache', vi.fn(), { relaunch });
      await engine.check(release);
      await engine.download(release, () => {});
      await engine.install();
      if (process.platform === 'darwin') {
        expect(mocks.finder).toHaveBeenCalledWith('/verified/download.zip');
        expect(mocks.quit).toHaveBeenCalledOnce();
      } else expect(mocks.quitAndInstall).toHaveBeenCalledWith(true, relaunch);
    },
  );
  it('retains automatic desktop relaunch by default', async () => {
    const engine = createUpdateEngine('/cache', vi.fn());
    await engine.check(release);
    await engine.download(release, () => {});
    await engine.install();
    if (process.platform !== 'darwin')
      expect(mocks.quitAndInstall).toHaveBeenCalledWith(true, true);
    else expect(mocks.finder).toHaveBeenCalledOnce();
  });
});
