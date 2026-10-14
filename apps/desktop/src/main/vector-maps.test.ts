import { describe, expect, it } from 'vitest';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createProject, type EffectPreset } from '@gleech/project-model';
import { createCommandService } from '@gleech/command-service';
import { createVectorMapLibrary } from './vector-maps';
import { encodeProject, decodeProject } from './project-file';
import { encodePreset, decodePreset } from './preset-file';
import { decodeLayerImages } from './image-worker';

const directory = 'apps/desktop/resources/vector-maps';
const library = createVectorMapLibrary(directory);

describe('starter vector maps', () => {
  it('ships forty distinct opaque 2048px RGB maps with exact hashes and separate directional thumbnails', async () => {
    const maps = await library.list();
    const manifest = JSON.parse(await readFile(`${directory}/catalog.json`, 'utf8')) as {
      maps: { id: string; sha256: string }[];
    };
    expect(maps).toHaveLength(40);
    expect(new Set(maps.map((map) => map.category)).size).toBe(6);
    const hashes = new Set<string>();
    for (const item of maps) {
      const image = await library.image(item.id);
      const png = Buffer.from(image.png.slice(22), 'base64');
      const metadata = await sharp(png).metadata();
      expect([metadata.width, metadata.height, metadata.channels, metadata.hasAlpha]).toEqual([
        2048,
        2048,
        3,
        false,
      ]);
      expect(image.source.id).toBe(`vector-map-v1:${item.id}`);
      const hash = createHash('sha256').update(png).digest('hex');
      expect(hash).toBe(manifest.maps.find((entry) => entry.id === item.id)!.sha256);
      hashes.add(hash);
      const stats = await sharp(png).stats();
      expect([stats.channels[2]!.min, stats.channels[2]!.max]).toEqual([128, 128]);
      const thumb = await sharp(Buffer.from(item.thumbnail.slice(22), 'base64')).metadata();
      expect([thumb.width, thumb.height]).toEqual([192, 192]);
    }
    expect(hashes.size).toBe(40);
  }, 20000);

  it('encodes uniform directions and exactly neutral unused channels', async () => {
    const horizontal = await sharp(`${directory}/horizontal-flow.png`).stats();
    expect(horizontal.channels.map((c) => [c.min, c.max])).toEqual([
      [223, 223],
      [128, 128],
      [128, 128],
    ]);
    const diagonal = await sharp(`${directory}/diagonal-flow.png`).stats();
    expect(diagonal.channels.map((c) => [c.min, c.max])).toEqual([
      [204, 204],
      [204, 204],
      [128, 128],
    ]);
    const shear = await sharp(`${directory}/horizontal-shear.png`).stats();
    expect([shear.channels[1]!.min, shear.channels[1]!.max]).toEqual([128, 128]);
  });

  it('encodes clockwise flow as right at the top and down at the right, and reverses its counterpart', async () => {
    for (const [id, signs] of [
      ['clockwise-vortex', [1, 1]],
      ['counterclockwise-vortex', [-1, -1]],
    ] as const) {
      const top = await sharp(`${directory}/${id}.png`)
        .extract({ left: 1024, top: 0, width: 1, height: 1 })
        .raw()
        .toBuffer();
      const right = await sharp(`${directory}/${id}.png`)
        .extract({ left: 2047, top: 1024, width: 1, height: 1 })
        .raw()
        .toBuffer();
      expect(Math.sign(top[0]! - 128)).toBe(signs[0]);
      expect(top[1]).toBe(128);
      expect(Math.sign(right[1]! - 128)).toBe(signs[1]);
      expect(right[0]).toBe(128);
    }
  });

  it('embeds map bytes in projects and portable presets and restores them after Undo/Redo', async () => {
    const image = await library.image('radial-ripples');
    const commands = createCommandService(createProject('Vectors', 51));
    const png = Uint8Array.from(
      await sharp({ create: { width: 1, height: 1, channels: 4, background: '#eeeeee' } })
        .png()
        .toBuffer(),
    ).buffer;
    commands.setSource({
      id: 'source',
      name: 'source.png',
      width: 1,
      height: 1,
      format: 'png',
      hasAlpha: false,
    });
    commands.addEffect('motion-transfer', 'motion');
    const before = commands.getState();
    commands.updateEffect('motion', { image });
    const after = commands.getState();
    commands.undo();
    expect(commands.getState()).toBe(before);
    commands.redo();
    expect(commands.getState()).toBe(after);
    const restored = decodeProject(encodeProject(after, new Map([['source', { png }]]))).project;
    expect(restored.effects).toEqual(after.effects);
    const preset: EffectPreset = {
      schemaVersion: 1,
      id: 'vectors',
      name: 'Vectors',
      createdAt: '2026-10-07T00:00:00Z',
      masterSeed: 51,
      effects: after.effects,
      thumbnail: (await library.list())[0]!.thumbnail,
    };
    expect(decodePreset(encodePreset(preset))).toEqual(preset);
    const decoded = await decodeLayerImages(restored.effects);
    expect([decoded.get(image.source.id)!.width, decoded.get(image.source.id)!.height]).toEqual([
      2048, 2048,
    ]);
  });

  it('accepts known IDs only and keeps vector and depth asset namespaces independent', async () => {
    for (const id of [
      '../depth-maps/radial-dome',
      'radial-dome',
      null,
      {},
      'horizontal-flow.png',
    ]) {
      await expect(library.image(id)).rejects.toThrow('Choose a starter vector map');
    }
    const image = await library.image('horizontal-flow');
    expect(image).toEqual(await library.image('horizontal-flow'));
  });

  it('rejects malformed catalog entries before resolving any file paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gleech-vector-catalog-'));
    await writeFile(
      join(dir, 'catalog.json'),
      JSON.stringify({ version: 1, maps: [{ id: '../escape' }] }),
    );
    await expect(createVectorMapLibrary(dir).list()).rejects.toThrow(
      'Invalid starter vector map entry',
    );
  });
});
