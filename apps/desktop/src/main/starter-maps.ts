import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LayerImage } from '@gleech/project-model';
import { assertLayerImage } from '@gleech/project-model';
import type { StarterMapItem } from '../shared/image-api';

export function createStarterMapLibrary(directory: string, kind: 'depth' | 'vector') {
  let catalog: Promise<readonly StarterMapItem[]> | undefined;
  const list = () =>
    (catalog ??= (async () => {
      const data = JSON.parse(await readFile(join(directory, 'catalog.json'), 'utf8')) as {
        version: number;
        maps: Omit<StarterMapItem, 'thumbnail'>[];
      };
      if (data.version !== 1 || !Array.isArray(data.maps) || data.maps.length > 128)
        throw new Error(`Invalid starter ${kind} map catalog.`);
      const ids = new Set<string>();
      return Promise.all(
        data.maps.map(async (map) => {
          if (
            !/^[a-z0-9-]{1,64}$/.test(map.id) ||
            ids.has(map.id) ||
            typeof map.name !== 'string' ||
            typeof map.description !== 'string' ||
            typeof map.category !== 'string' ||
            map.width !== 2048 ||
            map.height !== 2048
          )
            throw new Error(`Invalid starter ${kind} map entry.`);
          ids.add(map.id);
          const bytes = await readFile(join(directory, `${map.id}-thumb.png`));
          return { ...map, thumbnail: 'data:image/png;base64,' + bytes.toString('base64') };
        }),
      );
    })());
  return {
    list,
    async image(id: unknown): Promise<LayerImage> {
      const map = (await list()).find((map) => map.id === id);
      if (!map) throw new Error(`Choose a starter ${kind} map from the library.`);
      const bytes = await readFile(join(directory, `${map.id}.png`));
      const image: LayerImage = {
        source: {
          id: `${kind}-map-v1:${map.id}`,
          name: `${map.name}.png`,
          width: map.width,
          height: map.height,
          format: 'png',
          hasAlpha: false,
        },
        png: 'data:image/png;base64,' + bytes.toString('base64'),
      };
      assertLayerImage(image);
      return image;
    },
  };
}
