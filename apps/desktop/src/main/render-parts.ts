// Persistent checkpoints contain only complete, hashed movie parts. All names
// inside the owned directory are generated here; manifests never supply paths.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { RenderJobSpec, RenderResult } from '../shared/render';
import type { RawImage } from './render-frame';
import { encodedFrameDuration } from './ffmpeg-args';

interface Part {
  readonly frames: number;
  readonly bytes: number;
  readonly sha256: string;
}
interface Manifest {
  readonly version: 1;
  readonly key: string;
  readonly parts: readonly Part[];
}
interface PartEncoder {
  accept(edited: RawImage, original: RawImage | undefined, index: number): Promise<void>;
  finish(received: number): Promise<RenderResult>;
  cancel(): Promise<void>;
}
async function digest(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('A saved render part is not a regular file.');
  const hash = createHash('sha256');
  for await (const data of createReadStream(path)) hash.update(data);
  return { bytes: info.size, sha256: hash.digest('hex') };
}
async function absent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function createMovieParts(options: {
  readonly spec: RenderJobSpec;
  readonly extension: string;
  readonly temporary: string;
  readonly encoderSignature: string;
  createPart(spec: RenderJobSpec, id: string): Promise<PartEncoder>;
  assemble(list: string): Promise<RenderResult>;
}) {
  const { spec } = options;
  const safety = spec.safety!;
  const framesPerPart = Math.max(1, Math.round(safety.segmentSeconds * spec.fps));
  if (Math.ceil(spec.frameCount / framesPerPart) > 10000)
    throw new Error('Choose longer parts (at most 10,000 parts per export).');
  const persistent = safety.keepParts || safety.resume;
  if (persistent && !/^[a-f0-9]{64}$/.test(spec.resumeIdentity ?? ''))
    throw new Error('Saved parts need an immutable project identity.');
  const mediaIdentity = () =>
    Promise.all(
      [spec.sourcePath, spec.audio?.path, spec.clipAudio?.path]
        .filter((path): path is string => !!path)
        .map(async (path) => {
          const info = await stat(path);
          return { path, bytes: info.size, modified: info.mtimeMs };
        }),
    );
  const media = await mediaIdentity();
  const target = spec.checkpointTarget ?? spec.outputPath;
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        identity: spec.resumeIdentity,
        video: spec.video,
        fps: spec.fps,
        frames: spec.frameCount,
        source: [spec.sourceWidth, spec.sourceHeight],
        framesPerPart,
        media,
        encoder: options.encoderSignature,
        target,
      }),
    )
    .digest('hex');
  const folder = persistent
    ? join(
        dirname(target),
        `.${basename(target).replace(/[^a-z0-9._-]/gi, '_')}.${key.slice(0, 20)}.gleech-parts`,
      )
    : join(options.temporary, 'parts');
  const existing = await absent(folder);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
    throw new Error('The saved-parts location must be a regular directory.');
  if (!existing) await mkdir(folder, { recursive: false });
  const manifestFile = join(folder, 'gleech-parts.json');
  const lockFile = join(folder, 'active.json');
  const nonce = randomUUID();
  const oldLock = await absent(lockFile);
  if (oldLock) {
    if (!oldLock.isFile() || oldLock.isSymbolicLink() || oldLock.size > 4096)
      throw new Error('Invalid saved-parts lock. Choose another output.');
    const owner = JSON.parse(await readFile(lockFile, 'utf8')) as { pid: number; host: string };
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
      throw new Error('The saved parts are locked by another host.');
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive) throw new Error('Another export is using these saved parts.');
    await unlink(lockFile);
  }
  await writeFile(lockFile, JSON.stringify({ pid: process.pid, host: hostname(), nonce }), {
    flag: 'wx',
  });
  let unlocked = false;
  const unlock = async () => {
    if (unlocked) return;
    unlocked = true;
    const owner = JSON.parse(await readFile(lockFile, 'utf8')) as { nonce?: string };
    if (owner.nonce === nonce) await unlink(lockFile);
  };
  const partName = (index: number) => `part-${String(index).padStart(6, '0')}.${options.extension}`;
  let manifest: Manifest = { version: 1, key, parts: [] };
  let active: PartEncoder | null = null;
  let activeFrames = 0;
  let nextFrame = 0;
  let cancelled = false;
  const save = async () => {
    const temporary = join(folder, `manifest-${nonce}.partial`);
    await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx' });
    await rename(temporary, manifestFile);
  };
  try {
    const info = await absent(manifestFile);
    if (info) {
      if (!safety.resume)
        throw new Error(
          'Saved parts already exist. Enable Resume completed parts or choose another output name.',
        );
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 ** 2)
        throw new Error('Invalid saved-parts manifest.');
      manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Manifest;
      if (
        manifest.version !== 1 ||
        manifest.key !== key ||
        !Array.isArray(manifest.parts) ||
        manifest.parts.length > 10000
      )
        throw new Error('The saved parts do not match this export.');
      for (let index = 0; index < manifest.parts.length; index++) {
        const part = manifest.parts[index]!;
        const expected = Math.min(framesPerPart, spec.frameCount - nextFrame);
        if (part.frames !== expected || expected <= 0)
          throw new Error('Invalid saved-part frame range.');
        const actual = await digest(join(folder, partName(index)));
        if (actual.bytes !== part.bytes || actual.sha256 !== part.sha256)
          throw new Error(
            'A saved render part has changed. Choose a new output name to start again.',
          );
        nextFrame += part.frames;
      }
    } else {
      if (existing)
        throw new Error('This folder is not an owned render checkpoint. Choose another output.');
      await save();
    }
  } catch (error) {
    await unlock();
    throw error;
  }
  const resumedFrames = nextFrame;
  const finishPart = async () => {
    const encoder = active;
    if (!encoder || !activeFrames) return;
    const result = await encoder.finish(activeFrames);
    if (cancelled) throw new Error('Render cancelled.');
    const expected = join(folder, partName(manifest.parts.length));
    if (result.outputPath !== expected)
      throw new Error('The part encoder changed its output path.');
    const info = await digest(expected);
    manifest = { ...manifest, parts: [...manifest.parts, { frames: activeFrames, ...info }] };
    await save();
    active = null;
    activeFrames = 0;
  };
  return {
    resumeFrames: resumedFrames,
    async accept(edited: RawImage, original: RawImage | undefined, index: number) {
      if (cancelled) throw new Error('Render cancelled.');
      if (index !== nextFrame) throw new Error('Movie parts must receive frames in order.');
      if (!active) {
        const remaining = Math.min(framesPerPart, spec.frameCount - nextFrame);
        const video = spec.video!;
        const path = join(folder, partName(manifest.parts.length));
        const abandoned = await absent(path);
        if (abandoned) {
          if (!abandoned.isFile() || abandoned.isSymbolicLink())
            throw new Error('Invalid incomplete part.');
          await unlink(path);
        }
        active = await options.createPart(
          {
            ...spec,
            video: { ...video, audio: { ...video.audio, enabled: false } },
            safety: {
              ...safety,
              mode: 'one-frame',
              segmentSeconds: 0,
              keepParts: false,
              resume: false,
            },
            outputPath: path,
            frameCount: remaining,
          },
          randomUUID(),
        );
      }
      await active.accept(edited, original, index);
      activeFrames++;
      nextFrame++;
      if (activeFrames === framesPerPart) await finishPart();
    },
    async finish(received: number): Promise<RenderResult> {
      try {
        if (cancelled || received !== spec.frameCount || nextFrame !== spec.frameCount)
          throw new Error('The segmented export is incomplete.');
        await finishPart();
        if (JSON.stringify(await mediaIdentity()) !== JSON.stringify(media))
          throw new Error(
            'Source media changed during the export. Start a new export; completed parts have been preserved.',
          );
        const list = join(folder, `assemble-${nonce}.ffconcat`);
        await writeFile(
          list,
          'ffconcat version 1.0\n' +
            manifest.parts
              .map(
                (part, index) =>
                  `file '${partName(index)}'\nduration ${encodedFrameDuration(part.frames, spec.fps).toFixed(12)}\n`,
              )
              .join(''),
          { flag: 'wx' },
        );
        const result = await options.assemble(list);
        await unlink(list);
        return {
          ...result,
          resumedFrames,
          ...(persistent ? { checkpointPath: folder } : {}),
          notes: [
            ...result.notes,
            `${manifest.parts.length} completed parts assembled without re-rendering effects.`,
            ...(resumedFrames ? [`Reused ${resumedFrames} frames from verified saved parts.`] : []),
            ...(persistent ? [`Completed parts kept at ${folder}.`] : []),
          ],
        };
      } finally {
        await unlock();
      }
    },
    async cancel() {
      cancelled = true;
      await active?.cancel();
      await unlock();
    },
  };
}
