import {
  supportsHeightField,
  copyApplication,
  supportsLayerImage,
  assertEffectPreset,
  type EffectPreset,
  copyPaintedMask,
  copyCanvasDrawing,
} from '@gleech/project-model';
import { FILE_APPLICATION } from './file-metadata';

export const MAX_PRESET_BYTES = 16 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Explicitly copy recipe fields so neither projects nor image paths travel with a preset.
function portablePreset(value: unknown): EffectPreset {
  assertEffectPreset(value);
  return {
    schemaVersion: 1,
    id: value.id,
    name: value.name.trim(),
    createdAt: value.createdAt,
    masterSeed: value.masterSeed,
    thumbnail: value.thumbnail,
    ...(value.thumbnailSource ? { thumbnailSource: value.thumbnailSource } : {}),
    effects: value.effects.map((effect) => ({
      instanceId: effect.instanceId,
      type: effect.type,
      version: effect.version,
      enabled: effect.enabled,
      seedOffset: effect.seedOffset,
      ...(effect.patternId ? { patternId: effect.patternId } : {}),
      ...(effect.locked !== undefined ? { locked: effect.locked } : {}),
      application: copyApplication(effect.application),
      params: { ...effect.params },
      ...(effect.directionImage
        ? {
            directionImage: {
              source: { ...effect.directionImage.source },
              png: effect.directionImage.png,
            },
          }
        : {}),
      ...(effect.type === 'shader-import' ? { shader: structuredClone(effect.shader) } : {}),
      ...(effect.type === 'solid' && effect.drawing
        ? { drawing: copyCanvasDrawing(effect.drawing) }
        : {}),
      ...(effect.type === 'glyph' && effect.glyphFont
        ? { glyphFont: { ...effect.glyphFont } }
        : {}),
      ...(supportsHeightField(effect) && effect.fieldImage
        ? { fieldImage: { source: { ...effect.fieldImage.source }, png: effect.fieldImage.png } }
        : {}),
      ...(supportsLayerImage(effect) && effect.image
        ? { image: { source: { ...effect.image.source }, png: effect.image.png } }
        : {}),
      ...(effect.paintedMask
        ? {
            paintedMask: copyPaintedMask(effect.paintedMask),
          }
        : {}),
    })) as EffectPreset['effects'],
  };
}

export function encodePreset(preset: EffectPreset): Buffer {
  const bytes = Buffer.from(
    JSON.stringify(
      {
        format: 'gleech-preset',
        schemaVersion: 1,
        rendererVersion: 1,
        application: FILE_APPLICATION,
        preset: portablePreset(preset),
      },
      null,
      2,
    ) + '\n',
  );
  if (bytes.length > MAX_PRESET_BYTES) throw new Error('This preset exceeds the 16 MB file limit.');
  return bytes;
}

export function decodePreset(bytes: Buffer): EffectPreset {
  if (!bytes.length || bytes.length > MAX_PRESET_BYTES)
    throw new Error('Choose a preset file smaller than 16 MB.');
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('The preset file is incomplete or damaged.');
  }
  if (
    !value ||
    value.format !== 'gleech-preset' ||
    value.schemaVersion !== 1 ||
    value.rendererVersion !== 1
  )
    throw new Error('Choose a supported GLEECH preset (.gleechpreset).');
  return portablePreset(value.preset);
}

export function presetThumbnailBytes(preset: EffectPreset): ArrayBuffer {
  const png = Buffer.from(preset.thumbnail.split(',')[1]!, 'base64');
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(pngSignature) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('The preset thumbnail is damaged.');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!width || !height || width > 384 || height > 384)
    throw new Error('The preset thumbnail must be 384 pixels or smaller.');
  return Uint8Array.from(png).buffer;
}

export function presetFileName(name: string): string {
  const stem =
    Array.from(name, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')
      .trim()
      .replace(/[. ]+$/, '') || 'Preset';
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem);
  return `${reserved ? '_' : ''}${stem}.gleechpreset`;
}
