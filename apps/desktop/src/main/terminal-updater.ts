import { app } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APP_IS_BETA } from '../shared/branding';
import type { TerminalUpdateEvent } from '../shared/terminal-updates';
import { terminalUpdateText } from '../shared/terminal-updates';
import { createUpdateEngine } from './update-engine';
import { updateInstallMode } from './update-mode';
import { discoverUpdate } from './update-releases';
import { createUpdatePreferenceStore } from './update-storage';
import { createTerminalUpdateSession } from './terminal-update-session';

/** A normal Electron main process, using exactly the desktop download/install engine. */
export async function startTerminalUpdater(): Promise<void> {
  if (!process.send) throw new Error('Start terminal updates with gleech update.');
  // Installation locks the desktop profile even when terminal preferences use
  // GLEECH_USER_DATA. A separate terminal profile must not bypass an open desktop.
  const send = (event: TerminalUpdateEvent) => {
    if (process.connected) process.send?.(event, () => {});
  };
  const fail = (error: unknown) => {
    const message = terminalUpdateText(error instanceof Error ? error.message : String(error));
    send({ type: 'error', error: message });
    process.stderr.write(`${message}\n`);
    // Allow the final IPC reply to reach the terminal before exiting.
    setTimeout(() => app.exit(1), 50);
  };
  if (!app.requestSingleInstanceLock()) {
    fail(
      new Error(
        'Save and close the GLEECH desktop app or other updater, then run gleech update again.',
      ),
    );
    return;
  }
  await app.whenReady();
  if (!process.connected) {
    app.exit(0);
    return;
  }
  const mode = updateInstallMode({
    packaged: app.isPackaged,
    smoke: process.argv.includes('--smoke-test'),
    platform: process.platform,
    windowsInstalled: existsSync(join(dirname(process.execPath), 'Uninstall GLEECH.exe')),
    appImage: process.env.APPIMAGE,
  });
  if (mode === 'unavailable') {
    fail(
      new Error(
        'Install updates from an installed GLEECH release (Windows installer, macOS app or original Linux AppImage). Development and unpacked test builds cannot replace an installation.',
      ),
    );
    return;
  }
  const store = createUpdatePreferenceStore(
    join(app.getPath('userData'), 'updates.json'),
    app.getVersion(),
    false,
  );
  const engine = createUpdateEngine(join(app.getPath('userData'), 'update-downloads'), fail, {
    relaunch: false,
  });
  const session = createTerminalUpdateSession({
    mode,
    engine,
    discover: () => discoverUpdate(app.getVersion(), process.platform, process.arch, APP_IS_BETA),
    async saveNotes(release) {
      const preferences = await store.load();
      await store.save({
        ...preferences,
        pendingNotes: { version: release.version, notes: release.notes },
      });
    },
    send,
  });
  const timeout = setTimeout(
    () => {
      session.cancel();
      fail(new Error('The terminal update timed out. Run gleech update to retry.'));
    },
    35 * 60 * 1000,
  );
  process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const request = message as { type?: string; version?: unknown };
    if (request.type === 'cancel') {
      session.cancel();
      app.exit(0);
    } else if (request.type === 'start' && typeof request.version === 'string') {
      void session.prepare(request.version).catch(fail);
    } else if (request.type === 'install') {
      try {
        session.arm();
      } catch (error) {
        fail(error);
      }
    }
  });
  process.once('disconnect', () => {
    clearTimeout(timeout);
    void session
      .disconnected()
      .then((install) => {
        if (!install) app.exit(0);
      })
      .catch(fail);
  });
  send({ type: 'listening' });
}
