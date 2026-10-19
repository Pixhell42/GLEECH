import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { configureRendering } from './gpu';
import { Session } from './session';
import { decodePng, encodePng } from './png';
import { cpuRenderableStack } from './engine';
import { readShader } from './library';
import { createImportedShader } from '@gleech/project-model';
import { decodeProject } from '../main/project-file';
import { fileMetadataXmp } from '../main/file-metadata';
const image = { width: 1, height: 1, pixels: Uint8Array.from([200, 80, 20, 255]).buffer };
beforeEach(() => configureRendering({ renderer: 'cpu', skipUnsupportedShaders: false }));
async function temporary(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'gleech-cli-io-'));
  if (dirname(directory) !== tmpdir()) throw new Error('Unexpected test directory.');
  try {
    await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
describe('CLI file safety and compatibility', () => {
  it('preserves an existing project unless overwrite is explicitly requested', async () => {
    await temporary(async (directory) => {
      const path = join(directory, 'art.gleech');
      const session = await Session.fromImageBytes(encodePng(image), 'art.png');
      await writeFile(path, 'keep this artwork');
      await expect(session.save(path)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('keep this artwork');
      expect(await readdir(directory)).toEqual(['art.gleech']);
      await session.save(path, true);
      expect(decodeProject(await readFile(path)).project.source?.width).toBe(1);
    });
  });
  it('round-trips a shader project through the desktop project format', async () => {
    await temporary(async (directory) => {
      const session = await Session.fromImageBytes(encodePng(image), 'art.png');
      const shader = await readShader(
        fileURLToPath(
          new URL('../../resources/shaders/prism-weave.gleech-shader', import.meta.url),
        ),
      );
      session.service.addShader(shader, 'imported');
      const path = join(directory, 'shader.gleech');
      await session.save(path);
      const reopened = await Session.open(path);
      expect(reopened.state.effects).toEqual(session.state.effects);
      expect((await reopened.sourceImage()).pixels).toEqual(image.pixels);
    });
  });
  it('requires explicit permission to bypass imported shaders on CPU', async () => {
    const shader = await readShader(
      fileURLToPath(new URL('../../resources/shaders/prism-weave.gleech-shader', import.meta.url)),
    );
    const effect = createImportedShader(shader, 'a');
    expect(() => cpuRenderableStack([effect])).toThrow('requires GPU');
    expect(cpuRenderableStack([effect], true).effects[0]?.enabled).toBe(false);
  });
});
describe('bounded PNG fallback', () => {
  it('rejects compressed pixels exceeding the declared image dimensions', () => {
    const wide = encodePng({
      width: 2,
      height: 1,
      pixels: Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]).buffer,
    });
    const small = encodePng(image);
    wide.set(small.subarray(8, 33), 8); // Valid 1x1 header/CRC with a 2x1 compressed payload.
    expect(() => decodePng(wide)).toThrow();
  });
  it('rejects corrupted chunks', () => {
    const png = encodePng(image);
    png[20] = png[20]! ^ 1;
    expect(() => decodePng(png)).toThrow('checksum');
  });
  it('embeds complete XMP without changing decoded pixels', () => {
    const xmp = fileMetadataXmp();
    const png = encodePng(image, {}, { xmp });
    expect(png.toString('utf8')).toContain('XML:com.adobe.xmp');
    expect(png.toString('utf8')).toContain('https://x.com/pixhell');
    expect(png.toString('utf8')).toContain('https://github.com/Pixhell42/GLEECH');
    expect(decodePng(png).pixels).toEqual(image.pixels);
  });
});
