import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { APP_VERSION } from '../shared/branding';
import { terminalUpdateText } from '../shared/terminal-updates';
import type { UpdateRelease } from '../shared/updates';
import { UsageError } from './errors';
import { checkTerminalUpdate } from './updates';
import { prepareTerminalUpdate } from './update-install';

export const UPDATE_HELP = `gleech update [--check] [--yes]

Check, download, verify and install a GLEECH release, including its CLI and TUI.
Save and close other GLEECH sessions before installing. macOS reveals the verified
ZIP in Finder for manual app replacement; Windows and Linux use the desktop installer.

  --check       check only; do not download or install
  --json        machine-readable check result (requires --check)
  -y, --yes     approve installation without an interactive prompt
  -h, --help    show this help

Automatic CLI notices use the TUI's notification preference. Set
GLEECH_NO_UPDATE_NOTIFIER=1 to disable notices for terminal commands.`;

export async function runUpdateCommand(
  args: string[],
  options: {
    discover?: () => Promise<UpdateRelease | null>;
    prepare?: typeof prepareTerminalUpdate;
    confirm?: (question: string) => Promise<boolean>;
    interactive?: boolean;
    write?: (text: string) => void;
    report?: (text: string) => void;
  } = {},
): Promise<number> {
  let values;
  try {
    values = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        check: { type: 'boolean' },
        json: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
    }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const write = options.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  const report = options.report ?? ((text: string) => process.stderr.write(`${text}\n`));
  if (values.help) {
    write(UPDATE_HELP);
    return 0;
  }
  if (values.json && !values.check) throw new UsageError('--json requires --check.');
  if (!values.json) report('Checking for GLEECH updates…');
  const release = await (options.discover ?? checkTerminalUpdate)();
  if (values.check) {
    write(
      values.json
        ? JSON.stringify({
            currentVersion: APP_VERSION,
            available: !!release,
            version: release?.version ?? null,
            url: release?.url ?? null,
          })
        : release
          ? `GLEECH ${release.version} is available. Run gleech update to install.`
          : `GLEECH ${APP_VERSION} is up to date.`,
    );
    return 0;
  }
  if (!release) {
    write(`GLEECH ${APP_VERSION} is up to date.`);
    return 0;
  }
  if (!values.yes) {
    if (!(options.interactive ?? (process.stdin.isTTY && process.stderr.isTTY)))
      throw new UsageError(
        'Run gleech update in an interactive terminal, or use --yes to approve installation. Use --check to check only.',
      );
    const question = `Save and close other GLEECH sessions. Download and install GLEECH ${release.version}? [y/N] `;
    const confirm =
      options.confirm ??
      (async (text: string) => {
        const readline = createInterface({ input: process.stdin, output: process.stderr });
        try {
          return /^y(es)?$/i.test((await readline.question(text)).trim());
        } finally {
          readline.close();
        }
      });
    if (!(await confirm(question))) {
      write('Update cancelled.');
      return 0;
    }
  }
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  let prepared: Awaited<ReturnType<typeof prepareTerminalUpdate>> | undefined;
  let lastPercent = -1;
  try {
    report(`Downloading and verifying GLEECH ${release.version}…`);
    prepared = await (options.prepare ?? prepareTerminalUpdate)(
      release.version,
      abort.signal,
      (progress) => {
        const percent = Math.floor(progress.percent / 10) * 10;
        if (percent > lastPercent) {
          lastPercent = percent;
          report(`Download ${percent}%`);
        }
      },
    );
    await prepared.installOnExit();
    write(
      prepared.mode === 'finder'
        ? 'Download verified. The ZIP will open in Finder after this command exits. Replace GLEECH.app at its existing location, then reopen GLEECH.'
        : 'Download verified. Installation starts after this command exits. Run gleech again when installation finishes.',
    );
    return 0;
  } catch (error) {
    prepared?.cancel();
    if (abort.signal.aborted) {
      report('Update cancelled.');
      return 130;
    }
    throw new Error(terminalUpdateText(error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  } finally {
    process.off('SIGINT', cancel);
  }
}
