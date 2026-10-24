import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createUpdatePreferenceStore } from '../main/update-storage';
import type { UpdateRelease } from '../shared/updates';
import { notifyCliUpdate, shouldNotifyCli } from './updates';
import { runUpdateCommand } from './update-command';
import { terminalUpdaterEnvironment } from './update-install';

const folders: string[] = [];
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'gleech-cli-updates-'));
  folders.push(folder);
  return folder;
}
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    expect(dirname(resolve(folder))).toBe(resolve(tmpdir()));
    await rm(folder, { force: true, recursive: true });
  }
});
const release: UpdateRelease = {
  version: '0.2.1',
  notes: 'Notes',
  tag: 'v0.2.1',
  url: 'https://github.com/Pixhell42/GLEECH/releases/tag/v0.2.1',
  downloadUrl: '',
  asset: '',
  bytes: 3,
  sha256: 'a'.repeat(64),
};

describe('CLI update notices', () => {
  const tty = { stdout: true, stderr: true, env: {} };
  it('keeps pipes, JSON, CI, help, version and TUI launches quiet', () => {
    expect(shouldNotifyCli(['effects'], tty)).toBe(true);
    for (const args of [
      ['effects', '--json'],
      ['render', '--help'],
      ['--version'],
      ['help'],
      ['update'],
      ['tui'],
      ['sample'],
      [],
    ])
      expect(shouldNotifyCli(args, tty)).toBe(false);
    for (const input of [
      { ...tty, stdout: false },
      { ...tty, stderr: false },
      { ...tty, env: { CI: '1' } },
      { ...tty, env: { GLEECH_NO_UPDATE_NOTIFIER: '1' } },
    ])
      expect(shouldNotifyCli(['effects'], input)).toBe(false);
  });
  it('caches checks for six hours without modifying preferences or user assets', async () => {
    const folder = await fixture();
    await writeFile(join(folder, 'presets.json'), 'preserved');
    const discover = vi.fn(async () => release);
    const write = vi.fn();
    const options = { folder, version: '0.2.0', discover, write, now: 100000 };
    await notifyCliUpdate(options);
    await notifyCliUpdate({ ...options, now: 100001 });
    expect(discover).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('gleech update'));
    await notifyCliUpdate({ ...options, now: 100000 + 6 * 3600000 });
    expect(discover).toHaveBeenCalledTimes(2);
    expect(await readFile(join(folder, 'presets.json'), 'utf8')).toBe('preserved');
    await expect(readFile(join(folder, 'tui-updates.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('honors the terminal opt-out and dismissed version while manual checks remain independent', async () => {
    const folder = await fixture();
    const store = createUpdatePreferenceStore(join(folder, 'tui-updates.json'), '0.2.0', false);
    const preferences = await store.load();
    await store.save({ ...preferences, automatic: false });
    const discover = vi.fn(async () => release),
      write = vi.fn();
    await notifyCliUpdate({ folder, discover, write });
    expect(discover).not.toHaveBeenCalled();
    await store.save({ ...preferences, dismissedVersion: release.version });
    await notifyCliUpdate({ folder, discover, write });
    expect(discover).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });
  it('ignores offline checks and rejects control text in a forged cache', async () => {
    const folder = await fixture();
    const write = vi.fn();
    const discover = vi.fn(async () => {
      throw new Error('offline');
    });
    await writeFile(
      join(folder, 'cli-update-cache.json'),
      JSON.stringify({
        currentVersion: '0.2.0',
        availableVersion: '\x1b]52;secret',
        checkedAt: Date.now(),
      }),
    );
    await expect(
      notifyCliUpdate({ folder, version: '0.2.0', discover, write }),
    ).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    expect(discover).toHaveBeenCalledOnce();
  });
  it('backs off after offline checks and retains a previously discovered notice', async () => {
    const folder = await fixture();
    const discover = vi.fn(async () => release),
      write = vi.fn();
    const options = { folder, version: '0.2.0', discover, write, now: 100000 };
    await notifyCliUpdate(options);
    discover.mockRejectedValue(new Error('offline'));
    await notifyCliUpdate({ ...options, now: options.now + 6 * 3600000 });
    await notifyCliUpdate({ ...options, now: options.now + 6 * 3600000 + 1 });
    expect(discover).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(3);
  });
});

describe('gleech update', () => {
  function options() {
    const prepared = {
      version: release.version,
      mode: 'native' as const,
      installOnExit: vi.fn(async () => {}),
      cancel: vi.fn(),
    };
    return {
      discover: vi.fn(async () => release),
      prepare: vi.fn(async () => prepared),
      prepared,
      interactive: true,
      confirm: vi.fn(async () => true),
      write: vi.fn(),
      report: vi.fn(),
    };
  }
  it('checks with JSON without downloading or asking for approval', async () => {
    const f = options();
    expect(await runUpdateCommand(['--check', '--json'], f)).toBe(0);
    expect(JSON.parse(f.write.mock.calls[0]![0])).toMatchObject({
      available: true,
      version: release.version,
    });
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it('requires explicit approval and arms only a successfully prepared update', async () => {
    const f = options();
    expect(await runUpdateCommand([], f)).toBe(0);
    expect(f.confirm).toHaveBeenCalledOnce();
    expect(f.prepare).toHaveBeenCalledWith(
      release.version,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(f.prepared.installOnExit).toHaveBeenCalledOnce();
    const cancelled = options();
    cancelled.confirm.mockResolvedValue(false);
    await runUpdateCommand([], cancelled);
    expect(cancelled.prepare).not.toHaveBeenCalled();
  });
  it('supports --yes and Finder instructions, but never silently approves noninteractive installation', async () => {
    const f = options();
    await expect(runUpdateCommand([], { ...f, interactive: false })).rejects.toThrow(/--yes/);
    await runUpdateCommand(['--yes'], {
      ...f,
      interactive: false,
      prepare: async () => ({ ...f.prepared, mode: 'finder' }),
    });
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.write).toHaveBeenCalledWith(expect.stringContaining('Finder'));
  });
  it('cleans up a failed installation handoff and does not mask the failure', async () => {
    const f = options();
    f.prepared.installOnExit.mockRejectedValue(new Error('closed'));
    await expect(runUpdateCommand(['-y'], f)).rejects.toThrow('closed');
    expect(f.prepared.cancel).toHaveBeenCalledOnce();
  });
  it('shows help without network activity and rejects invalid flags', async () => {
    const f = options();
    await runUpdateCommand(['--help'], f);
    expect(f.discover).not.toHaveBeenCalled();
    for (const args of [['--json'], ['--install-url', 'https://evil.invalid'], ['unexpected']])
      await expect(runUpdateCommand(args, f)).rejects.toThrow();
  });
  it('removes Node-only Electron flags regardless of environment variable casing', () => {
    expect(
      terminalUpdaterEnvironment({
        Electron_Run_As_Node: '1',
        ELECTRON_RENDERER_URL: 'url',
        GLEECH_SMOKE_USER_DATA: 'smoke',
        GLEECH_USER_DATA: 'profile',
        APPIMAGE: '/apps/GLEECH.AppImage',
      }),
    ).toEqual({ GLEECH_USER_DATA: 'profile', APPIMAGE: '/apps/GLEECH.AppImage' });
  });
});
