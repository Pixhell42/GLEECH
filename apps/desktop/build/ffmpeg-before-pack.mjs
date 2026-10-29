import { Arch } from 'electron-builder';
import { prepareFfmpeg } from '../../../tooling/prepare-ffmpeg.mjs';
import { prepareAppImageRuntime } from '../../../tooling/prepare-appimage-runtime.mjs';

export default async function beforePack(context) {
  await prepareFfmpeg(`${context.electronPlatformName}-${Arch[context.arch]}`);
  if (context.electronPlatformName === 'linux') await prepareAppImageRuntime();
}
