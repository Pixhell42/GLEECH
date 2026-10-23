import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdatePreferenceStore, createUpdateSessionStore } from './update-storage';
import { downloadVerifiedUpdate } from './update-download';
import { replaceAppImage } from './replace-appimage';
import type { UpdateRelease } from '../shared/updates';

const folders: string[] = [];
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'gleech-update-test-'));
  folders.push(path);
  return path;
}
afterEach(async () => {
  for (const path of folders.splice(0)) {
    expect(path.startsWith(join(tmpdir(), 'gleech-update-test-'))).toBe(true);
    await rm(path, { recursive: true, force: true });
  }
});

describe('update data retention', () => {
  it('defaults to enabled and only updates its own settings file', async () => {
    const root = await folder();
    await writeFile(join(root, 'presets.json'), 'presets');
    await writeFile(join(root, 'shaders.json'), 'shaders');
    const store = createUpdatePreferenceStore(join(root, 'updates.json'), '0.2.0');
    const initial = await store.load();
    expect(initial.automatic).toBe(true);
    await store.save({ ...initial, automatic: false });
    expect((await store.load()).automatic).toBe(false);
    expect(await readFile(join(root, 'presets.json'), 'utf8')).toBe('presets');
    expect(await readFile(join(root, 'shaders.json'), 'utf8')).toBe('shaders');
  });
  it('retains project bytes, original document binding, unsaved status and timeline position until acknowledged', async () => {
    const root = await folder();
    const store = createUpdateSessionStore(root);
    const original = join(root, 'original.gleech');
    await writeFile(original, 'untouched original');
    const id = await store.save(Buffer.from('embedded current project'), original, {
      dirty: true,
      mode: 'timeline',
      playhead: 42,
    });
    const session = await store.read();
    expect(session).toMatchObject({
      id,
      documentPath: original,
      dirty: true,
      mode: 'timeline',
      playhead: 42,
    });
    expect(await readFile(session!.path!, 'utf8')).toBe('embedded current project');
    await expect(store.validate('not-the-session')).rejects.toThrow();
    await store.validate(id);
    await store.acknowledge(id);
    expect(await store.read()).toBeNull();
    expect(await readFile(original, 'utf8')).toBe('untouched original');
  });
  it('supports an unsaved document and a session without an image', async () => {
    const store = createUpdateSessionStore(await folder());
    const id = await store.save(null, null, { dirty: false, mode: 'image', playhead: 0 });
    expect((await store.read())?.path).toBeNull();
    await store.validate(id);
  });
  it('rejects recovery metadata that could escape the update directory', async () => {
    const root = await folder();
    await writeFile(
      join(root, 'session.json'),
      JSON.stringify({
        id: '../outside',
        documentPath: null,
        hasProject: true,
        dirty: true,
        mode: 'image',
        playhead: 0,
      }),
    );
    await expect(createUpdateSessionStore(root).read()).rejects.toThrow();
  });
});

describe('stable AppImage installation paths', () => {
  it('replaces the original versioned filename without moving the launcher target', async () => {
    const root = await folder();
    const current = join(root, 'GLEECH-0.2.0-linux-x86_64.AppImage');
    const update = join(root, 'GLEECH-0.2.1-linux-x86_64.AppImage');
    await writeFile(current, 'old application');
    await writeFile(update, 'verified new application');
    replaceAppImage(current, update);
    expect(await readFile(current, 'utf8')).toBe('verified new application');
    expect((await readdir(root)).filter((name) => name.startsWith('.gleech-update'))).toEqual([]);
  });
  it('keeps the original application if staging the new file fails', async () => {
    const root = await folder();
    const current = join(root, 'GLEECH.AppImage');
    await writeFile(current, 'old application');
    expect(() => replaceAppImage(current, join(root, 'missing.AppImage'))).toThrow();
    expect(await readFile(current, 'utf8')).toBe('old application');
  });
});

describe('verified Mac downloads', () => {
  const data = Buffer.from('PK test ZIP bytes');
  const release: UpdateRelease = {
    version: '0.2.1',
    notes: '',
    url: '',
    tag: 'macos-alpha-0.2.1',
    asset: 'GLEECH-0.2.1-mac-arm64.zip',
    downloadUrl:
      'https://github.com/Pixhell42/GLEECH/releases/download/macos-alpha-0.2.1/GLEECH-0.2.1-mac-arm64.zip',
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
  const request = (bytes: Buffer) =>
    (async () => new Response(Uint8Array.from(bytes).buffer)) as typeof fetch;
  it('stages a verified ZIP and removes incomplete files', async () => {
    const root = await folder();
    const path = await downloadVerifiedUpdate(
      release,
      root,
      () => {},
      new AbortController().signal,
      request(data),
    );
    expect(await readFile(path)).toEqual(data);
    expect(await readdir(root)).toEqual([release.asset]);
  });
  it.each(['hash', 'oversize', 'truncated'])(
    'refuses a %s mismatch without replacing a known-good download',
    async (kind) => {
      const root = await folder();
      await writeFile(join(root, release.asset), 'previous verified package');
      const bytes =
        kind === 'oversize'
          ? Buffer.concat([data, data])
          : kind === 'truncated'
            ? data.subarray(0, 2)
            : Buffer.from('XK test ZIP bytes');
      await expect(
        downloadVerifiedUpdate(
          release,
          root,
          () => {},
          new AbortController().signal,
          request(bytes),
        ),
      ).rejects.toThrow();
      expect(await readFile(join(root, release.asset), 'utf8')).toBe('previous verified package');
      expect(await readdir(root)).toEqual([release.asset]);
    },
  );
  it('honors cancellation before downloading and rejects path-like asset names', async () => {
    const root = await folder();
    const abort = new AbortController();
    abort.abort();
    await expect(
      downloadVerifiedUpdate(release, root, () => {}, abort.signal, request(data)),
    ).rejects.toThrow();
    await expect(
      downloadVerifiedUpdate(
        { ...release, asset: '../outside.zip' },
        root,
        () => {},
        new AbortController().signal,
        request(data),
      ),
    ).rejects.toThrow();
  });
});
