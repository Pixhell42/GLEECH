import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP_IS_BETA, APP_VERSION } from '../../shared/branding';
import { BUNDLED_RELEASE_NOTES } from '../../shared/release-notes';
import { BITCOIN_ADDRESS, SUPPORT_LINKS } from '../../shared/support';
import type { UpdatePreferences, UpdateRelease } from '../../shared/updates';
import { discoverUpdate } from '../../main/update-releases';
import { createUpdatePreferenceStore } from '../../main/update-storage';
import { updateChildPath } from '../../main/update-path';
import { userDataCandidates } from '../library';
import { resourcesDir } from '../runtime';

export const SETTINGS_SECTIONS = ['Updates', 'Donate', 'Feedback', 'Community', 'About'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export interface SettingsAction {
  label: string;
  run(): Promise<void>;
}
export interface TuiSettingsState {
  version: string;
  automatic: boolean;
  phase: 'idle' | 'checking' | 'available' | 'error';
  checkedAt: string | null;
  release: UpdateRelease | null;
  dismissedVersion: string | null;
  whatsNew: string | null;
  error: string | null;
}

/** Release notes and errors must remain terminal text, never terminal commands. */
export function terminalSettingsText(value: string): string {
  // eslint-disable-next-line no-control-regex -- strip untrusted ANSI/OSC control characters
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replaceAll('\t', ' ');
}

/** Open a fixed destination as one argument, without passing it through a shell. */
export function openSettingsDestination(destination: string): Promise<void> {
  const command =
    process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  return new Promise((done, reject) => {
    const child = spawn(command, [destination], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      done();
    });
  });
}

export function createTuiSettings(
  options: {
    folder?: string;
    version?: string;
    resources?: string;
    discover?: (signal: AbortSignal) => Promise<UpdateRelease | null>;
    open?: (destination: string) => Promise<void>;
  } = {},
) {
  const candidates = userDataCandidates();
  const folder = options.folder ?? candidates.find(existsSync) ?? candidates[0]!;
  const version = options.version ?? APP_VERSION;
  // Separate preferences prevent a running desktop and TUI overwriting one another.
  const store = createUpdatePreferenceStore(join(folder, 'tui-updates.json'), version, false);
  const open = options.open ?? openSettingsDestination;
  const listeners = new Set<() => void>();
  const abort = new AbortController();
  let preferences: UpdatePreferences;
  let disposed = false;
  let state: TuiSettingsState = {
    version,
    automatic: true,
    phase: 'idle',
    checkedAt: null,
    release: null,
    dismissedVersion: null,
    whatsNew: null,
    error: null,
  };
  const emit = (patch: Partial<TuiSettingsState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const ready = (async () => {
    preferences = await store.load();
    await store.save(preferences);
    emit({
      automatic: preferences.automatic,
      dismissedVersion: preferences.dismissedVersion,
      whatsNew: preferences.lastSeenVersion !== version ? BUNDLED_RELEASE_NOTES : null,
    });
  })();
  void ready.catch((error: unknown) =>
    emit({
      phase: 'error',
      error: error instanceof Error ? error.message : 'Could not load terminal update settings.',
    }),
  );
  let writes = Promise.resolve();
  const persist = (patch: Partial<UpdatePreferences>) => {
    const write = writes
      .catch(() => {})
      .then(async () => {
        const value = { ...preferences, ...patch };
        await store.save(value);
        preferences = value;
      });
    writes = write;
    return write;
  };
  let checking: Promise<void> | null = null;
  const controller = {
    ready,
    snapshot: () => structuredClone(state),
    notes: () => state.whatsNew ?? BUNDLED_RELEASE_NOTES,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async setAutomatic(value: boolean) {
      await ready;
      await persist({ automatic: value });
      emit({ automatic: value });
    },
    async dismiss() {
      await ready;
      const dismissedVersion = state.release?.version ?? null;
      await persist({ dismissedVersion });
      emit({ dismissedVersion });
    },
    async acknowledgeNotes() {
      await ready;
      await persist({ lastSeenVersion: version });
      emit({ whatsNew: null });
    },
    async check(manual = true): Promise<void> {
      await ready;
      if (disposed || (!manual && !state.automatic)) return;
      if (checking) return checking;
      checking = (async () => {
        emit({ phase: 'checking', error: null });
        try {
          const release = await (
            options.discover ??
            ((signal) =>
              discoverUpdate(version, process.platform, process.arch, APP_IS_BETA, signal))
          )(abort.signal);
          emit({
            release,
            phase: release ? 'available' : 'idle',
            checkedAt: new Date().toISOString(),
          });
        } catch (error) {
          emit({
            phase: 'error',
            error: error instanceof Error ? error.message : 'Could not check for updates.',
          });
        }
      })().finally(() => {
        checking = null;
      });
      return checking;
    },
    actions(section: SettingsSection): SettingsAction[] {
      const link = (label: string, destination: string): SettingsAction => ({
        label,
        run: () => open(destination),
      });
      if (section === 'Updates')
        return [
          {
            label: `Automatic update notifications: ${state.automatic ? 'On' : 'Off'}`,
            run: () => controller.setAutomatic(!state.automatic),
          },
          {
            label: state.phase === 'checking' ? 'Checking for updates…' : 'Check for updates now',
            run: () => controller.check(),
          },
          link('Open release page', state.release?.url ?? SUPPORT_LINKS.releases),
          { label: 'Dismiss update notification', run: () => controller.dismiss() },
        ];
      if (section === 'Donate')
        return [
          link('Cash App · $Pixhell', SUPPORT_LINKS.cashapp),
          link('Venmo · @pixhell', SUPPORT_LINKS.venmo),
          link('Open Bitcoin wallet', SUPPORT_LINKS.bitcoin),
          link('X · @pixhell', SUPPORT_LINKS.x),
          link('GitHub · Pixhell42', SUPPORT_LINKS.github),
          link('Star GLEECH on GitHub', SUPPORT_LINKS.repository),
          link('X · @mjestichooligan', SUPPORT_LINKS.musicX),
          link('YouTube · @majestichooligan', SUPPORT_LINKS.musicYouTube),
          link('slop.cc · AI music videos', SUPPORT_LINKS.slopcannon),
        ];
      if (section === 'Feedback')
        return [
          link('Report a bug on GitHub', SUPPORT_LINKS.bugReport),
          link('Request a feature on GitHub', SUPPORT_LINKS.featureRequest),
        ];
      if (section === 'Community')
        return [link('Join the Discord community', SUPPORT_LINKS.discord)];
      const resources = options.resources ?? resourcesDir();
      const packaged = existsSync(updateChildPath(resources, 'LICENSE.GLEECH.txt'));
      const root = packaged ? resources : resolve(resources, '../../..');
      return [
        link('View GitHub repository', SUPPORT_LINKS.repository),
        link('GLEECH license', updateChildPath(root, packaged ? 'LICENSE.GLEECH.txt' : 'LICENSE')),
        link('Third-party notices', updateChildPath(root, 'THIRD_PARTY_NOTICES.md')),
        link('Bundled licenses', updateChildPath(root, packaged ? 'licenses' : 'LICENSES')),
      ];
    },
    description(section: SettingsSection): string {
      if (section === 'Updates')
        return [
          `GLEECH v${version}`,
          state.phase === 'checking'
            ? 'Checking GitHub releases…'
            : state.release
              ? `GLEECH ${state.release.version} is available.`
              : state.checkedAt
                ? 'You’re up to date.'
                : 'Check for a newer release.',
          'Terminal notifications are on by default. Downloads and installation use the desktop updater or the release page. Save terminal work before installing.',
          ...(state.error ? [state.error] : []),
        ].join('\n\n');
      if (section === 'Donate')
        return `Help keep GLEECH growing. Open a payment link or wallet, or support the project through follows, music and GitHub stars.\n\nBitcoin address:\n${BITCOIN_ADDRESS}`;
      if (section === 'Feedback')
        return 'Found a bug or have an idea? Open the GitHub report form in your browser. Review and submit it there with your GitHub account.';
      if (section === 'Community')
        return 'Join the GLEECH Discord community to share your work, trade techniques, get help and follow what’s being built next.';
      return `GLEECH v${version}\n\nA creative workstation for procedural glitches, image effects, shaders and animated timelines across desktop, CLI and TUI.\n\nGLEECH is MIT licensed. Its runtime, native libraries, models, shaders and bundled FFmpeg retain their own licenses and notices.`;
    },
    dispose() {
      disposed = true;
      abort.abort();
      listeners.clear();
    },
  };
  return controller;
}

export type TuiSettings = ReturnType<typeof createTuiSettings>;
