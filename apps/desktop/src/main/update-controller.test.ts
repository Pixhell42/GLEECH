import { describe, expect, it, vi } from 'vitest';
import { createUpdateController } from './update-controller';
import type { UpdateEngine } from './update-controller';
import type { UpdatePreferences, UpdateRelease, UpdateState } from '../shared/updates';

const release: UpdateRelease = {
  version: '0.2.1',
  notes: 'Patch notes',
  url: 'https://github.com/Pixhell42/GLEECH/releases/tag/v0.2.1',
  tag: 'v0.2.1',
  asset: 'GLEECH-0.2.1-x64-setup.exe',
  downloadUrl:
    'https://github.com/Pixhell42/GLEECH/releases/download/v0.2.1/GLEECH-0.2.1-x64-setup.exe',
  bytes: 100,
  sha256: 'a'.repeat(64),
};
function fixture(
  patch: Partial<UpdatePreferences> = {},
  mode: UpdateState['installMode'] = 'native',
) {
  let preferences: UpdatePreferences = {
    automatic: true,
    dismissedVersion: null,
    lastSeenVersion: '0.2.0',
    pendingNotes: null,
    ...patch,
  };
  const engine: UpdateEngine = {
    check: vi.fn(async () => {}),
    download: vi.fn(async (_release, progress) => {
      progress({ percent: 50, total: 100, transferred: 50, bytesPerSecond: 10 });
    }),
    cancel: vi.fn(),
    install: vi.fn(async () => {}),
  };
  const store = {
    load: vi.fn(async () => structuredClone(preferences)),
    save: vi.fn(async (value: UpdatePreferences) => {
      preferences = structuredClone(value);
    }),
  };
  const discover = vi.fn(async (): Promise<UpdateRelease | null> => release);
  const publish = vi.fn();
  const beforeInstall = vi.fn(async () => {}),
    installFailed = vi.fn();
  const controller = createUpdateController({
    version: '0.2.0',
    mode,
    unavailableReason: mode === 'unavailable' ? 'Development build' : null,
    engine,
    store,
    discover,
    publish,
    beforeInstall,
    installFailed,
  });
  return {
    controller,
    engine,
    store,
    discover,
    publish,
    beforeInstall,
    installFailed,
    preferences: () => preferences,
  };
}

describe('update lifecycle', () => {
  it('checks and downloads automatically, but never installs without a prepared session', async () => {
    const h = fixture();
    await h.controller.check(false);
    await h.controller.download();
    expect((await h.controller.getState()).phase).toBe('ready');
    expect(h.engine.download).toHaveBeenCalledTimes(1);
    expect(h.engine.install).not.toHaveBeenCalled();
    await h.controller.install('checkpoint');
    expect(h.beforeInstall).toHaveBeenCalledWith('checkpoint');
    expect(h.engine.install).toHaveBeenCalledOnce();
    expect(h.preferences().pendingNotes?.notes).toBe('Patch notes');
  });
  it('keeps manual checks and download available when automatic updates are off', async () => {
    const h = fixture({ automatic: false });
    await h.controller.check(false);
    expect(h.discover).not.toHaveBeenCalled();
    await h.controller.check();
    expect(h.engine.download).not.toHaveBeenCalled();
    await h.controller.download();
    expect((await h.controller.getState()).phase).toBe('ready');
  });
  it('deduplicates concurrent checks and downloads', async () => {
    const h = fixture({ automatic: false });
    await Promise.all([h.controller.check(), h.controller.check()]);
    await Promise.all([h.controller.download(), h.controller.download()]);
    expect(h.discover).toHaveBeenCalledOnce();
    expect(h.engine.download).toHaveBeenCalledOnce();
  });
  it('never installs after download verification or recovery-checkpoint failures', async () => {
    const h = fixture({ automatic: false });
    await h.controller.check();
    vi.mocked(h.engine.download).mockRejectedValueOnce(new Error('Bad checksum'));
    expect((await h.controller.download()).phase).toBe('error');
    await expect(h.controller.install('checkpoint')).rejects.toThrow('Download and verify');
    await h.controller.download();
    h.beforeInstall.mockRejectedValueOnce(new Error('Disk full'));
    await expect(h.controller.install('checkpoint')).rejects.toThrow('Disk full');
    expect(h.engine.install).not.toHaveBeenCalled();
    expect(h.installFailed).toHaveBeenCalledOnce();
  });
  it('persists dismissal while keeping the update accessible through settings', async () => {
    const h = fixture({ automatic: false });
    await h.controller.check();
    await h.controller.dismiss();
    expect(h.preferences().dismissedVersion).toBe('0.2.1');
    expect((await h.controller.getState()).release?.version).toBe('0.2.1');
  });
  it('does not lose automatic-update preferences while writing downloaded notes', async () => {
    const h = fixture({ automatic: false });
    await h.controller.check();
    await Promise.all([h.controller.download(), h.controller.setAutomatic(false)]);
    expect(h.preferences().automatic).toBe(false);
    expect(h.preferences().pendingNotes?.version).toBe('0.2.1');
  });
  it('shows release notes once per installed patch, after acknowledgement', async () => {
    const h = fixture({
      lastSeenVersion: '0.1.2',
      pendingNotes: { version: '0.2.0', notes: 'Actual release notes' },
    });
    expect((await h.controller.getState()).whatsNew?.notes).toBe('Actual release notes');
    await h.controller.acknowledgeNotes('0.2.0');
    expect((await h.controller.getState()).whatsNew).toBeNull();
    expect(h.preferences().lastSeenVersion).toBe('0.2.0');
    await expect(h.controller.acknowledgeNotes('9.9.9')).rejects.toThrow();
  });
  it('never contacts the release server in development or unpacked mode', async () => {
    const h = fixture({}, 'unavailable');
    await h.controller.check();
    expect(h.discover).not.toHaveBeenCalled();
    await expect(h.controller.download()).rejects.toThrow('Development build');
  });
  it('retains notes for a future downloaded update when dismissing this version’s notes', async () => {
    const h = fixture({
      lastSeenVersion: '0.1.2',
      pendingNotes: { version: '0.2.1', notes: 'Future patch notes' },
    });
    await h.controller.acknowledgeNotes('0.2.0');
    expect(h.preferences().pendingNotes?.version).toBe('0.2.1');
  });
  it('surfaces install failures without losing the checkpoint or installing on ordinary quit', async () => {
    const h = fixture({ automatic: false });
    await h.controller.check();
    await h.controller.download();
    vi.mocked(h.engine.install).mockRejectedValueOnce(new Error('Installer could not start'));
    await expect(h.controller.install('retained-checkpoint')).rejects.toThrow(
      'Installer could not start',
    );
    expect((await h.controller.getState()).phase).toBe('error');
    await h.controller.download();
    await h.controller.install('retained-checkpoint');
    expect(h.engine.install).toHaveBeenCalledTimes(2);
  });
});
