import type {
  UpdatePreferences,
  UpdateProgress,
  UpdateRelease,
  UpdateState,
} from '../shared/updates';
import { BUNDLED_RELEASE_NOTES } from '../shared/release-notes';

export interface UpdateEngine {
  check(release: UpdateRelease): Promise<void>;
  download(release: UpdateRelease, progress: (value: UpdateProgress) => void): Promise<void>;
  cancel(): void;
  install(): Promise<void>;
}

export function createUpdateController(options: {
  version: string;
  mode: UpdateState['installMode'];
  unavailableReason: string | null;
  store: { load(): Promise<UpdatePreferences>; save(value: UpdatePreferences): Promise<void> };
  engine: UpdateEngine;
  discover(): Promise<UpdateRelease | null>;
  publish(state: UpdateState): void;
  beforeInstall(sessionId: string): Promise<void>;
  installFailed(): void;
}) {
  let preferences: UpdatePreferences;
  let state: UpdateState = {
    revision: 0,
    currentVersion: options.version,
    automatic: true,
    phase: 'idle',
    release: null,
    progress: null,
    checkedAt: null,
    error: null,
    dismissedVersion: null,
    installMode: options.mode,
    unavailableReason: options.unavailableReason,
    whatsNew: null,
  };
  const snapshot = () => structuredClone(state);
  const publish = (next: Partial<UpdateState>) => {
    state = { ...state, ...next, revision: state.revision + 1 };
    options.publish(snapshot());
  };
  const initialized = (async () => {
    preferences = await options.store.load();
    state.automatic = preferences.automatic;
    state.dismissedVersion = preferences.dismissedVersion;
    if (preferences.lastSeenVersion !== options.version)
      state.whatsNew = {
        version: options.version,
        notes:
          preferences.pendingNotes?.version === options.version
            ? preferences.pendingNotes.notes
            : BUNDLED_RELEASE_NOTES,
      };
    await options.store.save(preferences);
  })();
  // Surface initialization failures through getState without an unhandled rejection at startup.
  void initialized.catch(() => {});
  let preferenceWrites = Promise.resolve();
  const persist = (
    patch: Partial<UpdatePreferences> | ((value: UpdatePreferences) => Partial<UpdatePreferences>),
  ) => {
    const next = preferenceWrites
      .catch(() => {})
      .then(async () => {
        const value = {
          ...preferences,
          ...(typeof patch === 'function' ? patch(preferences) : patch),
        };
        await options.store.save(value);
        preferences = value;
      });
    preferenceWrites = next;
    return next;
  };
  let checkPromise: Promise<UpdateState> | null = null;
  let downloadPromise: Promise<UpdateState> | null = null;
  let automaticDownload = false;
  let disposed = false;
  const fail = (error: unknown) =>
    publish({
      phase: 'error',
      error: error instanceof Error ? error.message : 'The update could not be completed.',
    });
  const controller = {
    reportInstallError(error: Error) {
      options.installFailed();
      fail(error);
    },
    async getState() {
      await initialized;
      return snapshot();
    },
    async setAutomatic(value: unknown) {
      await initialized;
      if (typeof value !== 'boolean') throw new Error('Invalid update preference.');
      await persist({ automatic: value });
      publish({ automatic: value });
      if (!value && automaticDownload) options.engine.cancel();
      if (value) void controller.check(false).catch(fail);
      return snapshot();
    },
    async dismiss() {
      await initialized;
      if (state.release) {
        const version = state.release.version;
        await persist({ dismissedVersion: version });
        publish({ dismissedVersion: version });
      }
      return snapshot();
    },
    async acknowledgeNotes(version: unknown) {
      await initialized;
      if (version !== options.version) throw new Error('Invalid release notes acknowledgement.');
      await persist((current) => ({
        lastSeenVersion: options.version,
        ...(current.pendingNotes?.version === options.version ? { pendingNotes: null } : {}),
      }));
      publish({ whatsNew: null });
      return snapshot();
    },
    async check(manual = true): Promise<UpdateState> {
      await initialized;
      if (
        disposed ||
        (!manual && !preferences.automatic) ||
        options.mode === 'unavailable' ||
        ['downloading', 'installing'].includes(state.phase) ||
        (!manual && state.phase === 'ready')
      )
        return snapshot();
      if (checkPromise) return checkPromise;
      checkPromise = (async () => {
        publish({ phase: 'checking', error: null });
        try {
          const release = await options.discover();
          if (disposed) return snapshot();
          if (release) await options.engine.check(release);
          publish({
            phase: release ? 'available' : 'idle',
            release,
            progress: null,
            checkedAt: new Date().toISOString(),
            error: null,
          });
          if (release && preferences.automatic) void controller.download(true).catch(fail);
        } catch (error) {
          fail(error);
        }
        return snapshot();
      })().finally(() => {
        checkPromise = null;
      });
      return checkPromise;
    },
    async download(automatic = false): Promise<UpdateState> {
      await initialized;
      if (disposed || options.mode === 'unavailable')
        throw new Error(options.unavailableReason ?? 'Updates are unavailable in this build.');
      if (downloadPromise) return downloadPromise;
      if (state.phase === 'ready') return snapshot();
      const release = state.release;
      if (!release) throw new Error('Check for an update before downloading.');
      if (automatic && !preferences.automatic) return snapshot();
      automaticDownload = automatic;
      downloadPromise = (async () => {
        publish({
          phase: 'downloading',
          progress: { percent: 0, transferred: 0, total: release.bytes, bytesPerSecond: 0 },
          error: null,
        });
        try {
          await options.engine.download(release, (progress) => {
            if (!disposed)
              publish({
                progress: { ...progress, percent: Math.max(0, Math.min(100, progress.percent)) },
              });
          });
          if (disposed) return snapshot();
          const pendingNotes = { version: release.version, notes: release.notes };
          await persist({ pendingNotes });
          publish({
            phase: 'ready',
            progress: {
              percent: 100,
              transferred: release.bytes,
              total: release.bytes,
              bytesPerSecond: 0,
            },
          });
        } catch (error) {
          if (automatic && !preferences.automatic)
            publish({ phase: 'available', progress: null, error: null });
          else fail(error);
        }
        return snapshot();
      })().finally(() => {
        downloadPromise = null;
        automaticDownload = false;
      });
      return downloadPromise;
    },
    async install(sessionId: unknown) {
      await initialized;
      if (state.phase !== 'ready' || !state.release || typeof sessionId !== 'string')
        throw new Error('Download and verify the update before installing.');
      publish({ phase: 'installing', error: null });
      try {
        await options.beforeInstall(sessionId);
        await options.engine.install();
      } catch (error) {
        options.installFailed();
        fail(error);
        throw error;
      }
    },
    dispose() {
      disposed = true;
      options.engine.cancel();
    },
  };
  return controller;
}
