// Frozen public packages. Acceptance must download these bytes, never rebuild them.
import { targets as previous } from './installed-acceptance-plan.mjs';

const hashes = {
  'win32-x64': 'e12e55c270613fa73ea8e8ac19290f13a8fd5232b4cd35f3d548b98875cfdb3a',
  'darwin-arm64': '82d367620fbab1d6a367d48ef2d5df76c4370da8b755de9c60641f09edc9be2c',
  'darwin-x64': '2f49c0394fdc447c19726dcb6b785cb8adb236cb8b06f34be9c8e27581ba07bf',
  'linux-x64': '2f20da61bbb3b1ce033141f97469b67c8de0ad85a0d8c783290cd2ad4c3084a0',
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
          version: '0.2.1',
          tag: prefix + '0.2.1',
          archive: value.archive.replace('0.2.0', '0.2.1'),
          sha256: hashes[key],
        },
      },
    ];
  }),
);
