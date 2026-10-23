import { isAbsolute } from 'node:path';
import type { UpdateState } from '../shared/updates';

export function updateInstallMode(options: {
  packaged: boolean;
  smoke: boolean;
  platform: string;
  windowsInstalled: boolean;
  appImage?: string | undefined;
}): UpdateState['installMode'] {
  if (!options.packaged || options.smoke) return 'unavailable';
  if (options.platform === 'darwin') return 'finder';
  if (options.platform === 'win32') return options.windowsInstalled ? 'native' : 'unavailable';
  if (
    options.platform === 'linux' &&
    options.appImage &&
    isAbsolute(options.appImage) &&
    !options.appImage.startsWith('/tmp/.mount_')
  )
    return 'native';
  return 'unavailable';
}
