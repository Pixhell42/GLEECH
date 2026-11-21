// Frozen public packages. Acceptance must download these bytes, never rebuild them.
import { targets as previous } from './installed-acceptance-plan.mjs';

const liveVersion = '0.2.3';
const liveHashes = {
  'win32-x64': 'e962da9a5d95b8d83fc72285a8dc07863aeee665cb89f7236e38186baa91f790',
  'darwin-arm64': '5ddc62f4d596e033f4e1c9cf01f73b6dd75f84c7b4da8740e47cc9f9de3360c8',
  'darwin-x64': '212ee29b3abfc606cb9f7d671ce079652838258315bf0b8b593c03fdcf1b4ef2',
  'linux-x64': 'b1db26146a75c365fb7d1c198db5d8c91b6896ddba4c8d65cf93e5b58feb6e18',
};
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
        previous: {
          version: '0.2.0',
          tag: prefix + '0.2.0',
          archive: value.archive,
          sha256: value.sha256,
        },
        current: {
          version: liveVersion,
          tag: prefix + liveVersion,
          archive: value.archive.replace('0.2.0', liveVersion),
          sha256: liveHashes[key],
        },
      },
    ];
  }),
);

// The 0.2.3 candidate acceptance suite starts from the exact public 0.2.2 artifacts.
const release022Hashes = {
  'win32-x64': '1de1d58cf4c496a3db86e1c073c7ebe9996025c3820aa0e22d1956e2363ffcdb',
  'darwin-arm64': '7ea53fff71367790632357df6433fffa8a27aa1965befa71011f5df65aac8515',
  'darwin-x64': '5e11fd12b7ae4b8c5ac10c4972d8e159a7d13eee80a62310c17f319f03bfa4b5',
  'linux-x64': '37ca0cecf768ba8d04437c754e1efd4f996b96b0e711e8602c10a032c86b67d4',
};
const candidateSourceVersion = '0.2.2';
export const candidateSources = Object.fromEntries(
  Object.entries(targets).map(([key, { current }]) => [
    key,
    {
      version: candidateSourceVersion,
      tag: current.tag.replace(current.version, candidateSourceVersion),
      archive: current.archive.replace(current.version, candidateSourceVersion),
      sha256: release022Hashes[key],
    },
  ]),
);
