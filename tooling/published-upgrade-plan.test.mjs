import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPublishedUpgrade, targets } from './published-upgrade-plan.mjs';

const sha256 = 'a'.repeat(64);
const release = (tag, archives, fields = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: true,
  published_at: '2026-11-21T22:01:47Z',
  assets: archives.map((name) => ({ name, digest: 'sha256:' + sha256 })),
  ...fields,
});

test('selects the newest published package independently for each native target', () => {
  const releases = [
    release('v0.2.9', ['GLEECH-0.2.9-x64-setup.exe']),
    release('macos-alpha-0.2.9', ['GLEECH-0.2.9-mac-arm64.zip', 'GLEECH-0.2.9-mac-x64.zip']),
    release('v0.2.10', ['GLEECH-0.2.10-x64-setup.exe', 'GLEECH-0.2.10-mac-arm64.zip']),
    release('linux-omarchy-alpha-0.2.11', ['GLEECH-0.2.11-linux-x86_64.AppImage']),
    release('v0.2.12', ['GLEECH-0.2.12-x64-setup.exe'], { draft: true }),
    release('v0.2.13', ['GLEECH-0.2.13-mac-x64.zip'], { published_at: null }),
  ];
  const expected = {
    'win32-x64': ['0.2.10', 'v0.2.10'],
    'darwin-arm64': ['0.2.10', 'v0.2.10'],
    'darwin-x64': ['0.2.9', 'macos-alpha-0.2.9'],
    'linux-x64': ['0.2.11', 'linux-omarchy-alpha-0.2.11'],
  };
  for (const [target, [version, tag]] of Object.entries(expected)) {
    const source = targets[target];
    assert.deepEqual(selectPublishedUpgrade(releases, source), {
      version,
      tag,
      archive: source.archive.replace(source.version, version),
      sha256,
    });
  }
});

test('rejects a newer package without a SHA-256 digest instead of selecting an older one', () => {
  const releases = [
    release('v0.2.3', ['GLEECH-0.2.3-x64-setup.exe']),
    release('v0.2.4', [], { assets: [{ name: 'GLEECH-0.2.4-x64-setup.exe', digest: null }] }),
  ];
  assert.throws(
    () => selectPublishedUpgrade(releases, targets['win32-x64']),
    /GLEECH-0\.2\.4-x64-setup\.exe has no valid SHA-256 digest/,
  );
});

test('requires an upgrade beyond the frozen starting release', () => {
  const source = targets['linux-x64'];
  assert.throws(
    () => selectPublishedUpgrade([release(source.tag, [source.archive])], source),
    /No newer published package/,
  );
});
