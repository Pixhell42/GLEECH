import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { UpdateProgress } from '../shared/updates';
import type { TerminalUpdateEvent, TerminalUpdateRequest } from '../shared/terminal-updates';
import { terminalUpdateText } from '../shared/terminal-updates';
import { gpuLaunch } from './runtime';

export interface PreparedTerminalUpdate {
  version: string;
  mode: 'native' | 'finder';
  /** Arms installation after this CLI/TUI process exits and releases its binaries. */
  installOnExit(): Promise<void>;
  cancel(): void;
}

export function terminalUpdaterLaunch() {
  if (process.platform === 'linux' && process.env.APPIMAGE && isAbsolute(process.env.APPIMAGE))
    // APPIMAGE is the local AppImage runtime's original install path, not release
    // metadata, project content or an MCP request. Execute it directly with one
    // fixed argument and no shell so the updater owns its mount after CLI exit.
    return { executable: process.env.APPIMAGE, args: ['--gleech-terminal-update'] };
  const launch = gpuLaunch();
  return {
    ...launch,
    args: launch.args.map((arg) => (arg === '--gleech-cli-gpu' ? '--gleech-terminal-update' : arg)),
  };
}

export function terminalUpdaterEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'GLEECH_SMOKE_USER_DATA'].includes(
          key.toUpperCase(),
        ),
    ),
  );
}

export async function prepareTerminalUpdate(
  version: string,
  signal: AbortSignal,
  progress: (value: UpdateProgress) => void,
): Promise<PreparedTerminalUpdate> {
  signal.throwIfAborted();
  const launch = terminalUpdaterLaunch();
  const child = spawn(launch.executable, launch.args, {
    env: terminalUpdaterEnvironment(process.env),
    // On Windows unref() alone does not let the helper outlive this terminal.
    // IPC still gates installation until the parent exits and releases its files.
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let handedOff = false;
  let rejectPending: (error: Error) => void = () => {};
  let ready: (value: PreparedTerminalUpdate) => void = () => {};
  let armed: (() => void) | null = null;
  let prepared = false;
  const pending = new Promise<PreparedTerminalUpdate>((resolve, reject) => {
    ready = resolve;
    rejectPending = reject;
  });
  const send = (request: TerminalUpdateRequest) => {
    if (!child.connected) {
      rejectPending(new Error('The updater closed. Run gleech update to retry.'));
      return;
    }
    try {
      child.send(request, (error) => {
        if (error) rejectPending(error);
      });
    } catch (error) {
      rejectPending(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const cancel = () => {
    if (handedOff) return;
    signal.removeEventListener('abort', abort);
    if (child.connected) send({ type: 'cancel' });
    const timer = setTimeout(() => child.kill(), 2000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  };
  const abort = () => {
    rejectPending(new Error('Update cancelled.'));
    cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => {
      rejectPending(new Error('The update timed out. Run gleech update to retry.'));
      cancel();
    },
    35 * 60 * 1000,
  );
  child.on('error', (error) => rejectPending(error));
  child.on('exit', (code) => {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    if (!handedOff)
      rejectPending(
        new Error(`The updater closed (${code ?? 'interrupted'}). Run gleech update to retry.`),
      );
  });
  child.on('message', (message: TerminalUpdateEvent) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'listening') send({ type: 'start', version });
    else if (message.type === 'error') rejectPending(new Error(terminalUpdateText(message.error)));
    else if (message.type === 'progress') progress(message.progress);
    else if (message.type === 'armed') armed?.();
    else if (message.type === 'ready' && message.version === version && !prepared) {
      prepared = true;
      ready({
        version,
        mode: message.mode,
        cancel,
        async installOnExit() {
          if (handedOff) throw new Error('This update is already scheduled.');
          signal.throwIfAborted();
          const armTimeout = setTimeout(() => {
            rejectPending(
              new Error(
                'The updater did not acknowledge installation. Run gleech update to retry.',
              ),
            );
          }, 10000);
          try {
            await new Promise<void>((resolve, reject) => {
              rejectPending = reject;
              armed = resolve;
              send({ type: 'install' });
            });
            handedOff = true;
            clearTimeout(timeout);
            signal.removeEventListener('abort', abort);
            // Keep IPC connected until natural exit, after the TUI restores the
            // terminal and runCli closes GPU children. No app binary is replaced early.
            process.once('exit', () => {
              if (child.connected) child.disconnect();
            });
            child.channel?.unref();
            child.unref();
          } catch (error) {
            cancel();
            throw error;
          } finally {
            clearTimeout(armTimeout);
          }
        },
      });
    }
  });
  try {
    return await pending;
  } catch (error) {
    cancel();
    throw error;
  }
}
