import { Arch } from 'electron-builder';
import { prepareFfmpeg } from '../../../tooling/prepare-ffmpeg.mjs';

export default async function beforePack(context) {
  await prepareFfmpeg(`${context.electronPlatformName}-${Arch[context.arch]}`);
}
