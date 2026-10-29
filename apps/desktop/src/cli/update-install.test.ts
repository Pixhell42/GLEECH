import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./runtime', () => ({
  gpuLaunch: () => ({
    executable: '/runtime/electron',
    args: ['/app/main.js', '--gleech-cli-gpu'],
  }),
}));
import { prepareTerminalUpdate } from './update-install';

const originalExit = new Set(process.listeners('exit'));
afterEach(() => {
  for (const listener of process.listeners('exit'))
    if (!originalExit.has(listener)) process.removeListener('exit', listener);
});
function childFixture() {
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn((request: { type: string }, callback: (error: Error | null) => void) => {
      callback(null);
      if (request.type === 'cancel') queueMicrotask(() => child.emit('exit', 0));
    }),
    kill: vi.fn(),
    disconnect: vi.fn(),
    unref: vi.fn(),
    channel: { unref: vi.fn() },
  });
  mocks.spawn.mockReturnValue(child);
  return child;
}
describe('terminal updater client', () => {
  it('waits for the helper handshake and installs only after the terminal process exits', async () => {
    const child = childFixture();
    const abort = new AbortController();
    const progress = vi.fn();
    const pending = prepareTerminalUpdate('0.2.1', abort.signal, progress);
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/runtime/electron',
      ['/app/main.js', '--gleech-terminal-update'],
      expect.objectContaining({
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      }),
    );
    expect(child.send).not.toHaveBeenCalled();
    child.emit('message', { type: 'listening' });
    expect(child.send).toHaveBeenCalledWith(
      { type: 'start', version: '0.2.1' },
      expect.any(Function),
    );
    child.emit('message', { type: 'progress', progress: { percent: 50 } });
    expect(progress).toHaveBeenCalledWith({ percent: 50 });
    child.emit('message', { type: 'ready', version: '0.2.1', mode: 'native' });
    const prepared = await pending;
    const arming = prepared.installOnExit();
    expect(child.disconnect).not.toHaveBeenCalled();
    child.emit('message', { type: 'armed' });
    await arming;
    expect(child.channel.unref).toHaveBeenCalledOnce();
    expect(child.disconnect).not.toHaveBeenCalled();
    // Invoke only our exit hook, without emitting process exit to the test runner.
    const exit = process.listeners('exit').find((listener) => !originalExit.has(listener))!;
    exit(0);
    expect(child.disconnect).toHaveBeenCalledOnce();
    child.emit('exit', 0);
  });
  it('cancels downloads when the terminal aborts, without arming an install', async () => {
    const child = childFixture();
    const abort = new AbortController();
    const pending = prepareTerminalUpdate('0.2.1', abort.signal, () => {});
    abort.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(child.send).toHaveBeenCalledWith({ type: 'cancel' }, expect.any(Function));
    expect(child.send).not.toHaveBeenCalledWith({ type: 'install' }, expect.any(Function));
  });
  it('surfaces helper errors safely and cleans up the helper', async () => {
    const child = childFixture();
    const pending = prepareTerminalUpdate('0.2.1', new AbortController().signal, () => {});
    child.emit('message', { type: 'error', error: '\x1b[31mClose the desktop first' });
    await expect(pending).rejects.toThrow('Close the desktop first');
    expect(child.send).toHaveBeenCalledWith({ type: 'cancel' }, expect.any(Function));
  });
  it('rejects a failed install acknowledgment instead of reporting success', async () => {
    const child = childFixture();
    const pending = prepareTerminalUpdate('0.2.1', new AbortController().signal, () => {});
    child.emit('message', { type: 'ready', version: '0.2.1', mode: 'finder' });
    const prepared = await pending;
    const arming = prepared.installOnExit();
    child.emit('exit', 1);
    await expect(arming).rejects.toThrow(/updater closed/);
    expect(child.channel.unref).not.toHaveBeenCalled();
  });
});
