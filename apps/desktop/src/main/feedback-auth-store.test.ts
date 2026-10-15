import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeedbackAuthStore } from './feedback-auth-store';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'gleech-auth-'));
  folders.push(folder);
  const path = join(folder, 'auth.bin');
  // Simulated encryption tests storage behavior; native tests exercise Electron safeStorage.
  const encryption = {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map((byte) => byte ^ 0xa5)),
    decryptString: (bytes: Buffer) =>
      Buffer.from(bytes)
        .map((byte) => byte ^ 0xa5)
        .toString(),
  };
  return { folder, path, encryption, store: createFeedbackAuthStore(path, encryption) };
}
const auth = { token: 'fixture-private-token', login: 'Tester', expiresAt: 123456789 };
describe('encrypted feedback credentials', () => {
  it('loads missing files safely and atomically persists encrypted data', async () => {
    const f = await fixture();
    expect(await f.store.load()).toBeNull();
    await f.store.save(auth);
    expect(await f.store.load()).toEqual(auth);
    expect((await readFile(f.path)).toString()).not.toContain(auth.token);
    await f.store.save({ ...auth, token: 'updated-token' });
    expect((await f.store.load())?.token).toBe('updated-token');
    expect(await readdir(f.folder)).toEqual(['auth.bin']);
    await f.store.clear();
    await f.store.clear();
    expect(await f.store.load()).toBeNull();
  });
  it('rejects corrupt, oversized and invalid credentials', async () => {
    const f = await fixture();
    for (const value of [
      'not JSON',
      JSON.stringify({ ...auth, login: '../wrong' }),
      JSON.stringify({ ...auth, token: '' }),
      JSON.stringify({ ...auth, expiresAt: 'bad' }),
    ]) {
      await writeFile(f.path, f.encryption.encryptString(value));
      expect(await f.store.load()).toBeNull();
    }
    await writeFile(f.path, Buffer.alloc(17000));
    expect(await f.store.load()).toBeNull();
  });
  it('never falls back to plaintext when native encryption is unavailable', async () => {
    const f = await fixture();
    f.encryption.isEncryptionAvailable.mockReturnValue(false);
    await expect(f.store.save(auth)).rejects.toThrow('encryption is unavailable');
    expect(await readdir(f.folder)).toEqual([]);
    expect(await f.store.load()).toBeNull();
  });
  it.each(['basic_text', 'unknown', ''])(
    'does not read or persist GitHub credentials through the Linux %s backend',
    async (backend) => {
      const f = await fixture();
      f.encryption.getSelectedStorageBackend.mockReturnValue(backend);
      const store = createFeedbackAuthStore(f.path, f.encryption, 'linux');
      await expect(store.save(auth)).rejects.toThrow('Enable a desktop keyring');
      expect(await readdir(f.folder)).toEqual([]);
      expect(await store.load()).toBeNull();
    },
  );
  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])(
    'persists credentials with the Linux %s keyring',
    async (backend) => {
      const f = await fixture();
      f.encryption.getSelectedStorageBackend.mockReturnValue(backend);
      const store = createFeedbackAuthStore(f.path, f.encryption, 'linux');
      await store.save(auth);
      expect(await store.load()).toEqual(auth);
    },
  );
  it('keeps Windows and Mac encryption independent of Linux backend selection', async () => {
    const f = await fixture();
    f.encryption.getSelectedStorageBackend.mockImplementation(() => {
      throw new Error('Linux-only backend API');
    });
    for (const platform of ['win32', 'darwin'] as const) {
      const store = createFeedbackAuthStore(f.path, f.encryption, platform);
      await store.save(auth);
      expect(await store.load()).toEqual(auth);
    }
  });
});
