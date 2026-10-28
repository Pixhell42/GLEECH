// Published packages only: this check must never rebuild either release.
import { targets as current } from './installed-acceptance-plan.mjs';

const previous = {
  'win32-x64': 'b733b7f60ed142e73549f463e0e2cf12b2a0943b9f6029ba7cca0bb0f094c8d7',
  'darwin-arm64': '0f5a9714e05c182db666830da57555db159bd13761baea17380019a19394f345',
  'darwin-x64': '4fd76aec45849ea818b50bf7a98e31d2456d2cac722e8c19057588b2e9453b2e',
  'linux-x64': 'b6512cf1173766abcb91de175c417d3f70cebc2b3e4a2af7271bbeabb54b214a',
};
export const targets = Object.fromEntries(
  Object.entries(current).map(([key, value]) => {
    const tag = key.startsWith('darwin')
      ? 'macos-alpha-'
      : key.startsWith('linux')
        ? 'linux-omarchy-alpha-'
        : 'v';
    return [
      key,
      {
        previous: {
          version: '0.1.2',
          tag: tag + '0.1.2',
          archive: value.archive.replace('0.2.0', '0.1.2'),
          sha256: previous[key],
        },
        current: {
          version: '0.2.0',
          tag: tag + '0.2.0',
          archive: value.archive,
          sha256: value.sha256,
        },
      },
    ];
  }),
);
