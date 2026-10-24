import { describe, expect, it, vi } from 'vitest';
import type { UpdateRelease } from '../shared/updates';
import { createTerminalUpdateSession } from './terminal-update-session';

const release: UpdateRelease = {
  version: '0.2.1',
  notes: 'Patch',
  tag: 'v0.2.1',
  url: '',
  downloadUrl: '',
  asset: '',
  bytes: 3,
  sha256: 'a'.repeat(64),
};
function fixture() {
  const engine = {
    check: vi.fn(async () => {}),
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    cancel: vi.fn(),
  };
  const discover = vi.fn(async () => release);
  const saveNotes = vi.fn(async () => {});
  const send = vi.fn();
  const session = createTerminalUpdateSession({
    mode: 'native',
    engine,
    discover,
    saveNotes,
    send,
  });
  return { session, engine, discover, saveNotes, send };
}
describe('terminal installer handoff', () => {
  it('verifies the release and saves notes, but waits for approval AND terminal exit', async () => {
    const f = fixture();
    expect(() => f.session.arm()).toThrow(/verify/);
    await f.session.prepare('0.2.1');
    expect(f.engine.check).toHaveBeenCalledWith(release);
    expect(f.engine.download).toHaveBeenCalledWith(release, expect.any(Function));
    expect(f.saveNotes).toHaveBeenCalledWith(release);
    expect(f.send).toHaveBeenCalledWith({ type: 'ready', mode: 'native', version: '0.2.1' });
    f.session.arm();
    expect(f.engine.install).not.toHaveBeenCalled();
    expect(await f.session.disconnected()).toBe(true);
    expect(f.engine.install).toHaveBeenCalledOnce();
    await f.session.disconnected();
    expect(f.engine.install).toHaveBeenCalledOnce();
  });
  it('never installs on parent loss or cancellation without approval', async () => {
    for (const cancel of [false, true]) {
      const f = fixture();
      await f.session.prepare('0.2.1');
      if (cancel) f.session.cancel();
      expect(await f.session.disconnected()).toBe(false);
      expect(f.engine.install).not.toHaveBeenCalled();
    }
  });
  it('never installs after a failed digest/manifest verification', async () => {
    const f = fixture();
    f.engine.download.mockRejectedValue(new Error('Integrity check failed'));
    await expect(f.session.prepare('0.2.1')).rejects.toThrow('Integrity');
    expect(() => f.session.arm()).toThrow();
    await f.session.disconnected();
    expect(f.saveNotes).not.toHaveBeenCalled();
    expect(f.engine.install).not.toHaveBeenCalled();
  });
  it('does not substitute a newer release after the user confirms a specific version', async () => {
    const f = fixture();
    await expect(f.session.prepare('0.2.2')).rejects.toThrow(/release changed/);
    expect(f.engine.check).not.toHaveBeenCalled();
    expect(() => f.session.arm()).toThrow();
  });
  it('ignores a late download completion after cancellation', async () => {
    const f = fixture();
    let finish = () => {};
    f.engine.download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const preparing = f.session.prepare('0.2.1');
    await vi.waitFor(() => expect(f.engine.download).toHaveBeenCalledOnce());
    f.session.cancel();
    finish();
    await preparing;
    expect(f.saveNotes).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
  });
});
