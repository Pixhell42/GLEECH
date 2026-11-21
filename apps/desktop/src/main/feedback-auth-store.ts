import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface FeedbackAuth {
  token: string;
  expiresAt: number;
  login: string;
}
export interface FeedbackAuthStore {
  load(): Promise<FeedbackAuth | null>;
  save(value: FeedbackAuth): Promise<void>;
  clear(): Promise<void>;
}

export function createFeedbackAuthStore(
  path: string,
  encryption: {
    isAsyncEncryptionAvailable(): Promise<boolean>;
    encryptStringAsync(value: string): Promise<Buffer>;
    decryptStringAsync(value: Buffer): Promise<{ result: string }>;
    getSelectedStorageBackend?(): string;
  },
  platform: NodeJS.Platform = process.platform,
): FeedbackAuthStore {
  const secureEncryptionAvailable = async () =>
    (await encryption.isAsyncEncryptionAvailable()) &&
    (platform !== 'linux' ||
      ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
        encryption.getSelectedStorageBackend?.() ?? '',
      ));
  return {
    async load() {
      try {
        if (!(await secureEncryptionAvailable())) return null;
        const bytes = await readFile(path);
        if (bytes.length > 16384) return null;
        const { result } = await encryption.decryptStringAsync(bytes);
        const data = JSON.parse(result) as Partial<FeedbackAuth>;
        if (
          typeof data.token !== 'string' ||
          !data.token ||
          data.token.length > 2048 ||
          typeof data.login !== 'string' ||
          !/^[a-zA-Z0-9-]{1,39}$/.test(data.login) ||
          typeof data.expiresAt !== 'number' ||
          !Number.isFinite(data.expiresAt)
        )
          return null;
        return data as FeedbackAuth;
      } catch {
        return null;
      }
    },
    async save(value) {
      if (!(await secureEncryptionAvailable()))
        throw new Error(
          platform === 'linux'
            ? 'Secure credential encryption is unavailable. Enable a desktop keyring before signing in to GitHub.'
            : 'Credential encryption is unavailable.',
        );
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, await encryption.encryptStringAsync(JSON.stringify(value)), {
          mode: 0o600,
        });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    },
    async clear() {
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    },
  };
}
