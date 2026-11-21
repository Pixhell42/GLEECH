// Frozen public packages. Acceptance must download these bytes, never rebuild them.
import assert from 'node:assert/strict';
import { targets as previous } from './installed-acceptance-plan.mjs';

const sourceVersion = '0.2.0';
export const targets = Object.fromEntries(
  Object.entries(previous).map(([key, value]) => {
    const prefix = key.startsWith('darwin')
      ? 'macos-alpha-'
      : key.startsWith('linux')
        ? 'linux-omarchy-alpha-'
        : 'v';
    return [
      key,
      {
        version: sourceVersion,
        tag: prefix + sourceVersion,
        archive: value.archive,
        sha256: value.sha256,
      },
    ];
  }),
);

export function comparePublishedVersions(a, b) {
  return a.localeCompare(b, 'en', { numeric: true });
}

export function updateManifestName(target) {
  const [platform, arch] = target.split('-');
  return `latest-${arch}${platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux' : ''}.yml`;
}

export function publishedReleaseTargets(version) {
  return Object.entries(targets).map(([target, source]) => ({
    tag: source.tag.replace(source.version, version),
    archive: source.archive.replace(source.version, version),
    manifest: updateManifestName(target),
  }));
}

export function readyPublishedRelease(expected, releases) {
  const published = new Map(
    releases
      .filter(
        (release) =>
          release?.draft === false &&
          Number.isSafeInteger(release.id) &&
          Number.isFinite(Date.parse(release.published_at)) &&
          Array.isArray(release.assets),
      )
      .map((release) => [release.tag_name, release]),
  );
  const downloads = [];
  let owner;
  for (const { tag, archive, manifest } of expected) {
    const release = published.get(tag);
    if (!release) return null;
    const base = `https://github.com/Pixhell42/GLEECH/releases/download/${tag}/`;
    if (
      ![archive, manifest].every((name) =>
        release.assets.some(
          (asset) =>
            asset?.name === name &&
            asset.state === 'uploaded' &&
            Number.isSafeInteger(asset.size) &&
            asset.size > 0 &&
            typeof asset.digest === 'string' &&
            /^sha256:[a-f0-9]{64}$/.test(asset.digest) &&
            asset.browser_download_url === base + name,
        ),
      )
    )
      return null;
    downloads.push(base + archive);
    const time = Date.parse(release.published_at);
    // GitHub publishes timestamps to the second, so break ties consistently.
    if (!owner || time > owner.time || (time === owner.time && release.id > owner.id))
      owner = { id: release.id, time };
  }
  return { releaseId: owner.id, downloads };
}

export function selectPublishedUpgrade(releases, source) {
  const [prefix, suffix] = source.archive.split(source.version);
  let latest;
  for (const release of releases) {
    if (
      release?.draft !== false ||
      !release.published_at ||
      typeof release.tag_name !== 'string' ||
      !/^\w[\w.-]*$/.test(release.tag_name) ||
      !Array.isArray(release.assets)
    )
      continue;
    for (const asset of release.assets) {
      const archive = asset?.name;
      if (typeof archive !== 'string' || !archive.startsWith(prefix) || !archive.endsWith(suffix))
        continue;
      const version = archive.slice(prefix.length, -suffix.length);
      if (
        !/^\d+\.\d+\.\d+$/.test(version) ||
        comparePublishedVersions(version, latest?.version ?? source.version) <= 0
      )
        continue;
      latest = { version, tag: release.tag_name, archive, digest: asset.digest };
    }
  }
  assert.ok(latest, `No newer published package matching ${source.archive}.`);
  assert.ok(
    typeof latest.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(latest.digest),
    `${latest.archive} has no valid SHA-256 digest.`,
  );
  const { version, tag, archive, digest } = latest;
  return { version, tag, archive, sha256: digest.slice(7) };
}

// The 0.2.3 candidate acceptance suite starts from the exact public 0.2.2 artifacts.
const release022Hashes = {
  'win32-x64': '1de1d58cf4c496a3db86e1c073c7ebe9996025c3820aa0e22d1956e2363ffcdb',
  'darwin-arm64': '7ea53fff71367790632357df6433fffa8a27aa1965befa71011f5df65aac8515',
  'darwin-x64': '5e11fd12b7ae4b8c5ac10c4972d8e159a7d13eee80a62310c17f319f03bfa4b5',
  'linux-x64': '37ca0cecf768ba8d04437c754e1efd4f996b96b0e711e8602c10a032c86b67d4',
};
const candidateSourceVersion = '0.2.2';
export const candidateSources = Object.fromEntries(
  Object.entries(targets).map(([key, source]) => [
    key,
    {
      version: candidateSourceVersion,
      tag: source.tag.replace(source.version, candidateSourceVersion),
      archive: source.archive.replace(source.version, candidateSourceVersion),
      sha256: release022Hashes[key],
    },
  ]),
);
