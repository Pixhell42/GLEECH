import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createTuiSettings, terminalSettingsText } from './settings';
import type { UpdateRelease } from '../../shared/updates';

const folders: string[] = [];
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'gleech-tui-settings-'));
  folders.push(path);
  return path;
}
afterEach(async () => {
  for (const path of folders.splice(0)) {
    expect(dirname(resolve(path))).toBe(resolve(tmpdir()));
    await rm(path, { recursive: true, force: true });
  }
});
const release: UpdateRelease = {
  version: '0.2.1',
  tag: 'v0.2.1',
  asset: 'GLEECH-0.2.1-x64-setup.exe',
  url: 'https://github.com/Pixhell42/GLEECH/releases/tag/v0.2.1',
  downloadUrl: '',
  bytes: 100,
  sha256: 'a'.repeat(64),
  notes: 'A newer release',
};

describe('terminal Settings', () => {
  it('opens bundled licenses from a configured resource folder with spaces and Unicode', async () => {
    const root = await folder();
    const resources = join(root, 'portable resources ü #1');
    await mkdir(resources);
    await writeFile(join(resources, 'LICENSE.GLEECH.txt'), 'bundled license');
    const open = vi.fn<(destination: string) => Promise<void>>(async () => {});
    const settings = createTuiSettings({ folder: root, resources, open });
    await settings.ready;
    for (const action of settings.actions('About').slice(1)) await action.run();
    expect(open.mock.calls.map((call) => call[0])).toEqual([
      join(resources, 'LICENSE.GLEECH.txt'),
      join(resources, 'THIRD_PARTY_NOTICES.md'),
      join(resources, 'licenses'),
    ]);
    expect(await readFile(join(resources, 'LICENSE.GLEECH.txt'), 'utf8')).toBe('bundled license');
    settings.dispose();
  });
  it('persists opt-out and dismissal without altering desktop settings or user libraries', async () => {
    const root = await folder();
    for (const name of ['updates.json', 'presets.json', 'shaders.json', 'recent-projects.json'])
      await writeFile(join(root, name), name);
    const discover = vi.fn(async () => release);
    const settings = createTuiSettings({ folder: root, version: '0.2.0', discover });
    await settings.ready;
    expect(settings.snapshot().automatic).toBe(true);
    await settings.setAutomatic(false);
    await settings.check(false);
    expect(discover).not.toHaveBeenCalled();
    await settings.check();
    expect(settings.snapshot().release?.version).toBe('0.2.1');
    await settings.dismiss();
    settings.dispose();
    const reopened = createTuiSettings({ folder: root, version: '0.2.0', discover });
    await reopened.ready;
    expect(reopened.snapshot()).toMatchObject({ automatic: false, dismissedVersion: '0.2.1' });
    for (const name of ['updates.json', 'presets.json', 'shaders.json', 'recent-projects.json'])
      expect(await readFile(join(root, name), 'utf8')).toBe(name);
    reopened.dispose();
  });
  it('acknowledges each installed patch once and retains future release notes', async () => {
    const root = await folder();
    await writeFile(
      join(root, 'tui-updates.json'),
      JSON.stringify({
        automatic: true,
        dismissedVersion: null,
        lastSeenVersion: '0.1.2',
        pendingNotes: { version: '0.2.1', notes: 'future notes' },
      }),
    );
    const settings = createTuiSettings({ folder: root, version: '0.2.0' });
    await settings.ready;
    expect(settings.snapshot().whatsNew).toContain('Timeline');
    await settings.acknowledgeNotes();
    settings.dispose();
    const reopened = createTuiSettings({ folder: root, version: '0.2.0' });
    await reopened.ready;
    expect(reopened.snapshot().whatsNew).toBeNull();
    expect(
      JSON.parse(await readFile(join(root, 'tui-updates.json'), 'utf8')).pendingNotes.version,
    ).toBe('0.2.1');
    reopened.dispose();
  });
  it('aborts an in-flight check on exit and does not publish after disposal', async () => {
    let signal: AbortSignal | undefined;
    const settings = createTuiSettings({
      folder: await folder(),
      discover: async (input) => {
        signal = input;
        return new Promise((_done, reject) =>
          input.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
        );
      },
    });
    await settings.ready;
    const changed = vi.fn();
    settings.subscribe(changed);
    const check = settings.check();
    await vi.waitFor(() => expect(signal).toBeDefined());
    settings.dispose();
    await check;
    expect(signal!.aborted).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('uses fixed browser destinations and strips terminal control characters', async () => {
    const open = vi.fn<(destination: string) => Promise<void>>(async () => {});
    const settings = createTuiSettings({ folder: await folder(), open });
    await settings.ready;
    await settings.actions('Feedback')[0]!.run();
    await settings.actions('Community')[0]!.run();
    expect(open.mock.calls.map((call) => call[0])).toEqual([
      'https://github.com/Pixhell42/GLEECH/issues/new?template=bug.yml',
      'https://discord.gg/b7Mq8fjvk',
    ]);
    expect(terminalSettingsText('notes\x1b]52;c;secret\x07\nmore')).toBe('notes]52;c;secret\nmore');
    settings.dispose();
  });
});
