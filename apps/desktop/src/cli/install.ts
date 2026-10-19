import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const MARKER = 'GLEECH managed terminal launcher';
const START = '# >>> GLEECH CLI PATH >>>';
const END = '# <<< GLEECH CLI PATH <<<';
const run = promisify(execFile);

export function shellQuote(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Launcher paths must not contain line breaks.');
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
function cmdQuote(value: string): string {
  if (/["\0\r\n]/.test(value)) throw new Error('Unsupported character in Windows launcher path.');
  return '"' + value.replaceAll('%', '%%') + '"';
}
async function contents(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Refusing to modify a link or non-file: ' + path);
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export function updatePathBlock(source: string, block?: string): string {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (
    start < 0 !== end < 0 ||
    (start >= 0 && end < start) ||
    source.indexOf(START, start + START.length) >= 0 ||
    source.indexOf(END, end + END.length) >= 0
  )
    throw new Error('The GLEECH PATH block was edited. Please repair it before continuing.');
  if (start < 0)
    return block ? source + (source && !source.endsWith('\n') ? '\n' : '') + block : source;
  const after =
    end +
    END.length +
    (source[end + END.length] === '\r' ? 1 : 0) +
    (source[end + END.length + (source[end + END.length] === '\r' ? 1 : 0)] === '\n' ? 1 : 0);
  return source.slice(0, start) + (block ?? '') + source.slice(after);
}

export interface InstallOptions {
  home?: string;
  platform?: NodeJS.Platform;
  localAppData?: string;
  shell?: string;
  zdotdir?: string;
  configHome?: string;
  executable?: string;
  entry?: string;
  appImage?: string;
  updateWindowsPath?: (directory: string, install: boolean) => Promise<void>;
}
async function windowsPath(directory: string, install: boolean): Promise<void> {
  // Never use setx: it expands/truncates existing values. Change only this user's entry.
  const script = `
$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  $old = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
  $parts = @($old -split ';')
  $wanted = $env:GLEECH_CLI_PATH_DIRECTORY
  $has = @($parts | Where-Object { $_.TrimEnd('\\') -ieq $wanted.TrimEnd('\\') }).Count -gt 0
  $next = $old
  if ($env:GLEECH_CLI_PATH_INSTALL -eq '1') {
    if (-not $has) { $next = if ($old) { $old + ';' + $wanted } else { $wanted } }
  } else {
    $next = (@($parts | Where-Object { $_.TrimEnd('\\') -ine $wanted.TrimEnd('\\') }) -join ';')
  }
  if ($next -cne $old) { $key.SetValue('Path', $next, $kind) }
} finally { $key.Dispose() }
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class GleechPathChange { [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r); }'
$result = [UIntPtr]::Zero
[void][GleechPathChange]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 2000, [ref]$result)
`;
  await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        GLEECH_CLI_PATH_DIRECTORY: directory,
        GLEECH_CLI_PATH_INSTALL: install ? '1' : '0',
      },
      timeout: 15000,
    },
  );
}

/** Explicit per-user setup; ordinary app launches never edit PATH or shell files. */
export async function installCli(
  install: boolean,
  options: InstallOptions = {},
): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const windows = platform === 'win32';
  const directory = windows
    ? join(
        options.localAppData ?? process.env['LOCALAPPDATA'] ?? join(home, 'AppData/Local'),
        'GLEECH/bin',
      )
    : join(home, '.local/bin');
  const launcher = join(directory, windows ? 'gleech.cmd' : 'gleech');
  const original = await contents(launcher);
  if (original !== undefined && !original.includes(MARKER))
    throw new Error(
      'Another launcher already exists at ' + launcher + '. Move it before installing GLEECH.',
    );
  const profiles: [string, string][] = [];
  if (!windows) {
    const pathBlock =
      START +
      '\ncase ":$PATH:" in\n  *":$HOME/.local/bin:"*) ;;\n  *) export PATH="$HOME/.local/bin:$PATH" ;;\nesac\n' +
      END +
      '\n';
    profiles.push([join(home, '.profile'), pathBlock]);
    const shell = basename(options.shell ?? process.env['SHELL'] ?? '/bin/bash');
    if (shell === 'zsh') {
      const dot = options.zdotdir ?? process.env['ZDOTDIR'] ?? home;
      profiles.push([join(dot, '.zshrc'), pathBlock], [join(dot, '.zprofile'), pathBlock]);
    } else if (shell === 'fish') {
      const config = options.configHome ?? process.env['XDG_CONFIG_HOME'] ?? join(home, '.config');
      profiles.push([
        join(config, 'fish/conf.d/gleech-cli.fish'),
        START +
          '\nif not contains -- "$HOME/.local/bin" $PATH\n  set -gx PATH "$HOME/.local/bin" $PATH\nend\n' +
          END +
          '\n',
      ]);
    } else {
      profiles.push([join(home, '.bashrc'), pathBlock]);
      // Bash login shells skip .profile if either of these exists.
      for (const name of ['.bash_profile', '.bash_login']) {
        const path = join(home, name);
        if ((await contents(path)) !== undefined) {
          profiles.push([path, pathBlock]);
          break;
        }
      }
    }
  }
  // Validate all destinations before writing anything.
  const changes = await Promise.all(
    profiles.map(async ([path, block]) => {
      const before = (await contents(path)) ?? '';
      return { path, before, after: updatePathBlock(before, install ? block : undefined) };
    }),
  );
  if (install) {
    const executable = options.executable ?? process.execPath;
    const entry = resolve(options.entry ?? process.argv[1]!);
    const appImage = options.appImage ?? process.env['APPIMAGE'];
    const text = windows
      ? '@echo off\r\nrem ' +
        MARKER +
        '\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n' +
        cmdQuote(executable) +
        ' ' +
        cmdQuote(entry) +
        ' %*\r\n'
      : '#!/bin/sh\n# ' +
        MARKER +
        '\n' +
        (platform === 'linux' && appImage
          ? 'unset ELECTRON_RUN_AS_NODE\nexec ' + shellQuote(resolve(appImage)) + ' --cli "$@"\n'
          : 'ELECTRON_RUN_AS_NODE=1 exec ' +
            shellQuote(executable) +
            ' ' +
            shellQuote(entry) +
            ' "$@"\n');
    await mkdir(directory, { recursive: true });
    await writeFile(launcher, text, { mode: 0o755, flag: original === undefined ? 'wx' : 'w' });
    if (windows) await (options.updateWindowsPath ?? windowsPath)(directory, true);
  } else if (original !== undefined) {
    if (windows) await (options.updateWindowsPath ?? windowsPath)(directory, false);
    await unlink(launcher);
  }
  for (const { path, before, after } of changes) {
    if (before === after) continue;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, after);
  }
  return install
    ? [
        'Installed ' + launcher,
        'Open a new terminal, then run: gleech --help',
        'Run gleech uninstall-cli before removing or moving the app. Reinstall after moving it.',
      ]
    : ['Removed the GLEECH terminal launcher and its PATH setup. Open a new terminal.'];
}
