import { join } from 'node:path';
import { Arch } from 'electron-builder';
import cliAfterPack from './cli-after-pack.mjs';
import { verifyPrepared } from '../../../tooling/prepare-ffmpeg.mjs';
import { assertNoFfmpegStaging } from '../../../tooling/ffmpeg-package-layout.mjs';

export default async function afterPack(context) {
  await cliAfterPack(context);
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, 'GLEECH.app/Contents/Resources')
      : join(context.appOutDir, 'resources');
  assertNoFfmpegStaging(resources);
  await verifyPrepared(
    join(resources, 'ffmpeg'),
    `${context.electronPlatformName}-${Arch[context.arch]}`,
  );
}
