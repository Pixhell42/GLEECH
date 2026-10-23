import { describe, expect, it } from 'vitest';
import { compareReleaseVersions, selectUpdateRelease } from './update-releases';
import { SUPPORT_REPOSITORY } from '../shared/support';

function release(version = '0.2.1', platform = 'win32', arch = 'x64') {
  const suffix =
    platform === 'win32'
      ? `${arch}-setup.exe`
      : platform === 'darwin'
        ? `mac-${arch}.zip`
        : `linux-x86_64.AppImage`;
  const tag = platform === 'darwin' ? `macos-alpha-${version}` : `v${version}`;
  const asset = `GLEECH-${version}-${suffix}`;
  const manifest = `latest-${arch}${platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux' : ''}.yml`;
  return {
    draft: false,
    prerelease: false,
    tag_name: tag,
    body: '# Changes\nNew things.',
    assets: [
      {
        name: asset,
        size: 100,
        digest: `sha256:${'a'.repeat(64)}`,
        browser_download_url: `${SUPPORT_REPOSITORY}/releases/download/${tag}/${asset}`,
      },
      { name: manifest },
    ],
  };
}

describe('platform-specific GitHub updates', () => {
  it.each([
    ['win32', 'x64'],
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'x64'],
  ])('selects the matching %s/%s asset', (platform, arch) => {
    const found = selectUpdateRelease(
      [release('0.2.1', platform, arch)],
      '0.2.0',
      platform,
      arch,
      true,
    );
    expect(found?.version).toBe('0.2.1');
    expect(found?.sha256).toBe('a'.repeat(64));
  });
  it('compares numeric versions, refuses equal versions and downgrades', () => {
    expect(compareReleaseVersions('0.2.10', '0.2.9')).toBeGreaterThan(0);
    expect(
      selectUpdateRelease([release('0.1.9'), release('0.2.0')], '0.2.0', 'win32', 'x64', true),
    ).toBeNull();
    expect(
      selectUpdateRelease([release('0.2.9'), release('0.2.10')], '0.2.0', 'win32', 'x64', true)
        ?.version,
    ).toBe('0.2.10');
  });
  it('ignores drafts, disallowed prereleases, foreign assets, missing manifests and missing hashes', () => {
    const draft = release();
    draft.draft = true;
    const prerelease = release();
    prerelease.prerelease = true;
    const foreign = release();
    foreign.assets[0]!.browser_download_url = 'https://example.com/setup.exe';
    const missing = release();
    missing.assets.pop();
    const unhashed = release();
    unhashed.assets[0]!.digest = '';
    for (const item of [draft, prerelease, foreign, missing, unhashed])
      expect(selectUpdateRelease([item], '0.2.0', 'win32', 'x64', false)).toBeNull();
  });
  it('does not mix platforms or architectures from separate port releases', () => {
    expect(
      selectUpdateRelease([release('0.2.1', 'darwin', 'arm64')], '0.2.0', 'darwin', 'x64', true),
    ).toBeNull();
    expect(
      selectUpdateRelease([release('0.2.1', 'linux')], '0.2.0', 'win32', 'x64', true),
    ).toBeNull();
  });
  it('rejects invalid input and preserves notes as plain text', () => {
    expect(() => selectUpdateRelease({}, '0.2.0', 'win32', 'x64', false)).toThrow();
    expect(() => compareReleaseVersions('1.0.0-rc.1', '1.0.0')).toThrow();
    const item = release();
    item.body = '<script>alert(1)</script>';
    expect(selectUpdateRelease([item], '0.2.0', 'win32', 'x64', true)?.notes).toBe(item.body);
  });
});
