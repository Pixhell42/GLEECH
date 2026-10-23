import { expect, it } from 'vitest';
import { updateInstallMode } from './update-mode';

it('keeps unpacked Windows builds separate from NSIS installations and handles Mac/AppImage updates', () => {
  const base = { packaged: true, smoke: false, platform: 'win32', windowsInstalled: false };
  expect(updateInstallMode(base)).toBe('unavailable');
  expect(updateInstallMode({ ...base, windowsInstalled: true })).toBe('native');
  expect(updateInstallMode({ ...base, windowsInstalled: true, smoke: true })).toBe('unavailable');
  expect(updateInstallMode({ ...base, platform: 'darwin' })).toBe('finder');
  expect(
    updateInstallMode({ ...base, platform: 'linux', appImage: '/home/user/GLEECH.AppImage' }),
  ).toBe('native');
  expect(
    updateInstallMode({ ...base, platform: 'linux', appImage: '/tmp/.mount_gleech/AppRun' }),
  ).toBe('unavailable');
  expect(updateInstallMode({ ...base, platform: 'darwin', packaged: false })).toBe('unavailable');
});
