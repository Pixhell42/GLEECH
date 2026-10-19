import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCli, shellQuote, updatePathBlock } from './install';

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'gleech-path-test-'));
  return {
    home,
    executable: '/Applications/GLEECH.app/Contents/MacOS/GLEECH',
    entry: '/Applications/GLEECH.app/Contents/Resources/cli/gleech.cjs',
    shell: '/bin/bash',
    zdotdir: home,
    configHome: join(home, '.config'),
  };
}
describe('per-user CLI installation', () => {
  it('quotes spaces, apostrophes and shell expansion literally', () => {
    expect(shellQuote("/tmp/it's $HOME; hi")).toBe("'/tmp/it'\\''s $HOME; hi'");
    expect(() => shellQuote('bad\npath')).toThrow();
  });
  it('installs idempotently and removes only its own shell blocks', async () => {
    const options = {
      ...(await fixture()),
      platform: 'linux' as const,
      appImage: "/home/test/Apps/GLEECH's beta.AppImage",
    };
    const profile = join(options.home, '.profile');
    await writeFile(profile, '# keep my settings\nexport CUSTOM=1\n');
    await installCli(true, options);
    const before = await readFile(profile, 'utf8');
    await installCli(true, options);
    expect(await readFile(profile, 'utf8')).toBe(before);
    const launcher = await readFile(join(options.home, '.local/bin/gleech'), 'utf8');
    expect(launcher).toContain('--cli "$@"');
    expect(launcher).not.toContain('/tmp/.mount');
    await installCli(false, options);
    expect(await readFile(profile, 'utf8')).toBe('# keep my settings\nexport CUSTOM=1\n');
    await expect(lstat(join(options.home, '.local/bin/gleech'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('configures zsh startup files and preserves unrelated settings', async () => {
    const options = { ...(await fixture()), platform: 'darwin' as const, shell: '/bin/zsh' };
    await writeFile(join(options.home, '.zshrc'), '# my zsh\n');
    await installCli(true, options);
    for (const name of ['.zshrc', '.zprofile'])
      expect(await readFile(join(options.home, name), 'utf8')).toContain('GLEECH CLI PATH');
    const wrapper = await readFile(join(options.home, '.local/bin/gleech'), 'utf8');
    expect(wrapper).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(wrapper).toContain('/Applications/GLEECH.app/Contents/MacOS/GLEECH');
    await installCli(false, options);
    expect(await readFile(join(options.home, '.zshrc'), 'utf8')).toBe('# my zsh\n');
  });
  it('uses fish syntax and honors its config directory', async () => {
    const options = { ...(await fixture()), platform: 'linux' as const, shell: '/usr/bin/fish' };
    await installCli(true, options);
    expect(
      await readFile(join(options.configHome, 'fish/conf.d/gleech-cli.fish'), 'utf8'),
    ).toContain('set -gx PATH');
    await installCli(false, options);
  });
  it('configures an existing bash login profile when it overrides .profile', async () => {
    const options = { ...(await fixture()), platform: 'linux' as const };
    await writeFile(join(options.home, '.bash_profile'), '# my login\n');
    await installCli(true, options);
    expect(await readFile(join(options.home, '.bash_profile'), 'utf8')).toContain(
      'GLEECH CLI PATH',
    );
    await installCli(false, options);
    expect(await readFile(join(options.home, '.bash_profile'), 'utf8')).toBe('# my login\n');
  });
  it('refuses to overwrite another terminal command', async () => {
    const options = { ...(await fixture()), platform: 'linux' as const };
    await mkdir(join(options.home, '.local/bin'), { recursive: true });
    await writeFile(join(options.home, '.local/bin/gleech'), '# another program\n');
    await expect(installCli(true, options)).rejects.toThrow('Another launcher');
    await expect(installCli(false, options)).rejects.toThrow('Another launcher');
    expect(await readFile(join(options.home, '.local/bin/gleech'), 'utf8')).toBe(
      '# another program\n',
    );
  });
  it('rejects malformed managed shell blocks without changing the launcher', async () => {
    const options = { ...(await fixture()), platform: 'linux' as const };
    await writeFile(join(options.home, '.profile'), '# >>> GLEECH CLI PATH >>>\nbroken\n');
    await expect(installCli(true, options)).rejects.toThrow('PATH block');
    await expect(lstat(join(options.home, '.local/bin/gleech'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(() => updatePathBlock('# <<< GLEECH CLI PATH <<<\n')).toThrow();
  });
  it('writes a Windows launcher and delegates only its directory to the PATH update', async () => {
    const calls: [string, boolean][] = [];
    const options = {
      ...(await fixture()),
      platform: 'win32' as const,
      localAppData: join((await fixture()).home, 'Local Data'),
      executable: 'C:\\Program Files\\GLEECH\\GLEECH.exe',
      entry: 'C:\\Program Files\\GLEECH\\resources\\cli\\gleech.cjs',
      updateWindowsPath: async (dir: string, install: boolean) => {
        calls.push([dir, install]);
      },
    };
    await installCli(true, options);
    const directory = join(options.localAppData, 'GLEECH/bin');
    expect(await readFile(join(directory, 'gleech.cmd'), 'utf8')).toContain(
      'setlocal DisableDelayedExpansion',
    );
    await installCli(false, options);
    expect(calls).toEqual([
      [directory, true],
      [directory, false],
    ]);
  });
});
