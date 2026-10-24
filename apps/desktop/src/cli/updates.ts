import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_IS_BETA, APP_VERSION } from '../shared/branding';
import type { UpdateRelease } from '../shared/updates';
import { compareReleaseVersions, discoverUpdate } from '../main/update-releases';
import { createTerminalUpdateCache, createUpdatePreferenceStore } from '../main/update-storage';
import { userDataCandidates } from './library';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const NOTICE_COMMANDS = new Set([
  'render',
  'gleech',
  'vary',
  'effects',
  'effect',
  'presets',
  'shaders',
  'inspect',
  'info',
]);

export function terminalUpdateFolder() {
  const candidates = userDataCandidates();
  return candidates.find(existsSync) ?? candidates[0]!;
}

export function checkTerminalUpdate(signal?: AbortSignal): Promise<UpdateRelease | null> {
  return discoverUpdate(APP_VERSION, process.platform, process.arch, APP_IS_BETA, signal);
}

export function shouldNotifyCli(
  argv: string[],
  input: { stdout: boolean; stderr: boolean; env: NodeJS.ProcessEnv },
) {
  return (
    input.stdout &&
    input.stderr &&
    !input.env.CI &&
    !input.env.GLEECH_NO_UPDATE_NOTIFIER &&
    !input.env.NO_UPDATE_NOTIFIER &&
    !argv.includes('--json') &&
    !argv.some((arg) => ['--help', '-h'].includes(arg)) &&
    !!argv[0] &&
    NOTICE_COMMANDS.has(argv[0])
  );
}

/** Interactive-only, bounded checks; failures never change a command's result. */
export async function notifyCliUpdate(
  options: {
    folder?: string;
    version?: string;
    now?: number;
    discover?: (signal: AbortSignal) => Promise<UpdateRelease | null>;
    write?: (text: string) => void;
  } = {},
): Promise<void> {
  try {
    const version = options.version ?? APP_VERSION;
    const folder = options.folder ?? terminalUpdateFolder();
    // Read the terminal preference without rewriting TUI preferences or libraries.
    const preferences = await createUpdatePreferenceStore(
      join(folder, 'tui-updates.json'),
      version,
      false,
    ).load();
    if (!preferences.automatic) return;
    const cache = createTerminalUpdateCache(folder);
    const now = options.now ?? Date.now();
    let stored = await cache.load();
    const age = stored ? now - stored.checkedAt : -1;
    if (
      !stored ||
      stored.currentVersion !== version ||
      age < 0 ||
      age >= SIX_HOURS ||
      (stored.retryAt !== undefined && now >= stored.retryAt)
    ) {
      const signal = AbortSignal.timeout(1500);
      try {
        const release = await (options.discover ?? checkTerminalUpdate)(signal);
        stored = {
          currentVersion: version,
          availableVersion: release?.version ?? null,
          checkedAt: now,
        };
      } catch {
        stored = {
          currentVersion: version,
          availableVersion: stored?.currentVersion === version ? stored.availableVersion : null,
          checkedAt: now,
          retryAt: now + 15 * 60 * 1000,
        };
      }
      await cache.save(stored);
    }
    const available = stored.availableVersion;
    if (
      available &&
      available !== preferences.dismissedVersion &&
      compareReleaseVersions(available, version) > 0
    )
      (options.write ?? ((text) => process.stderr.write(text)))(
        `\nGLEECH ${available} is available. Run gleech update to install.\n`,
      );
  } catch {
    // Offline, read-only and corrupt cache failures must not break rendering or scripts.
  }
}
