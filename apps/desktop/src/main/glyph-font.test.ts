import { describe, expect, it } from 'vitest';
import {
  createEffect,
  createProject,
  assertEffect,
  assertGlyphFont,
  encodeFontCoverage,
  decodeFontCoverage,
  FONT_TILE_WIDTH,
  FONT_TILE_HEIGHT,
  type GlyphEffect,
  type GlyphFontAtlas,
} from '@gleech/project-model';
import { renderEffects, renderEffectsAsync } from '@gleech/effects';
import { fontCoverage } from '../../../../packages/effects/src/font-coverage';
import {
  createCommandService,
  copySettings,
  encodeSettings,
  decodeSettings,
  pastedSettings,
  resetSettings,
} from '@gleech/command-service';
import { generateGleechStack } from '@gleech/command-service';
import { encodePreset, decodePreset } from './preset-file';
import { encodeProject, decodeProject } from './project-file';

const size = FONT_TILE_WIDTH * FONT_TILE_HEIGHT;
const source = {
  id: 'source',
  name: 'source.png',
  width: 32,
  height: 32,
  format: 'png' as const,
  hasAlpha: true,
};
function atlas(value = 128): GlyphFontAtlas {
  return {
    version: 1,
    id: 'original-font',
    family: 'Test face',
    style: 'Regular',
    postscriptName: 'Test-face',
    characters: ' A@',
    missing: '',
    data: encodeFontCoverage(
      Uint8Array.from({ length: size * 3 }, (_, i) => (i < size ? 0 : i < size * 2 ? value : 255)),
    ),
  };
}
const fontEffect = (): GlyphEffect => {
  const effect = createEffect('glyph', 'font') as GlyphEffect;
  return {
    ...effect,
    glyphFont: atlas(),
    params: {
      ...effect.params,
      style: 'custom-text',
      fontSource: 'installed',
      text: 'A',
      coloring: 'custom',
      foregroundColor: '#ffffff',
      backgroundColor: '#000000',
      cellSize: 16,
      aspect: 1,
      glyphScale: 1,
    },
  };
};
const image = { width: 32, height: 32, pixels: new Uint8Array(32 * 32 * 4).fill(255).buffer };
describe('portable glyph fonts', () => {
  it('preserves character sheets in project, snapshot and portable preset files', () => {
    const effect = fontEffect();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
      'base64',
    );
    const imageSource = { ...source, width: 1, height: 1 };
    const project = {
      ...createProject('Font', 1),
      source: imageSource,
      origin: imageSource,
      effects: [effect],
      snapshots: [
        {
          id: 'snapshot',
          name: 'Saved font',
          createdAt: '2026-10-07T00:00:00.000Z',
          parentId: null,
          source: imageSource,
          rendered: { ...imageSource, id: 'rendered' },
          effects: [effect],
          masterSeed: 1,
        },
      ],
    };
    expect(
      decodeProject(
        encodeProject(
          project,
          new Map([
            [source.id, { png: Uint8Array.from(png).buffer }],
            ['rendered', { png: Uint8Array.from(png).buffer }],
          ]),
        ),
      ).project,
    ).toEqual(project);
    const preset = {
      schemaVersion: 1 as const,
      id: 'font',
      name: 'Font',
      createdAt: '2026-10-07T00:00:00.000Z',
      masterSeed: 1,
      thumbnail: 'data:image/png;base64,' + png.toString('base64'),
      effects: [effect],
    };
    expect((decodePreset(encodePreset(preset)).effects[0] as GlyphEffect).glyphFont).toEqual(
      effect.glyphFont,
    );
  });
  it('round trips run and literal coverage, including block boundaries', () => {
    for (const input of [
      new Uint8Array(size),
      new Uint8Array(size).fill(255),
      Uint8Array.from({ length: size }, (_, i) => i % 256),
      Uint8Array.from({ length: size }, (_, i) => (i % 129 < 127 ? 13 : i % 256)),
    ])
      expect(decodeFontCoverage(encodeFontCoverage(input), 1)).toEqual(input);
  });
  it('rejects truncated, oversized and invalid encoded character sheets', () => {
    for (const data of [
      '',
      'AAAA',
      '===!',
      'AAAA=',
      Buffer.from([255]).toString('base64'),
      Buffer.from([255, 1]).toString('base64'),
    ])
      expect(() => decodeFontCoverage(data, 1)).toThrow();
    expect(() => decodeFontCoverage(atlas().data, 0)).toThrow();
    expect(() => decodeFontCoverage(atlas().data, 1025)).toThrow();
  });
  it('validates recipe metadata and does not trust an atlas ID alone', () => {
    assertGlyphFont(atlas());
    for (const value of [
      null,
      { ...atlas(), version: 2 },
      { ...atlas(), data: 'broken' },
      { ...atlas(), characters: 'AA@' },
      { ...atlas(), missing: 'Z' },
      { ...atlas(), family: '\0' },
      { ...atlas(), fontPath: 'secret.ttf' },
    ])
      expect(() => assertGlyphFont(value)).toThrow();
    expect(() =>
      assertEffect({ ...createEffect('blur', 'b'), glyphFont: atlas() } as unknown as GlyphEffect),
    ).toThrow();
  });
  it('samples alpha coverage smoothly, respects whitespace/bounds and updates changed IDs', () => {
    const first = fontCoverage(atlas());
    expect(first.sample(' ', 0.5, 0.5)).toBe(0);
    expect(first.sample('A', 0.5, 0.5)).toBeCloseTo(128 / 255);
    expect(first.sample('A', -0.1, 0.5)).toBe(0);
    expect(first.rank('@ A')).toEqual([' ', 'A', '@']);
    expect(fontCoverage(atlas(64)).sample('A', 0.5, 0.5)).toBeCloseTo(64 / 255);
  });
  it('renders saved font coverage identically in synchronous/async execution', async () => {
    const effect = fontEffect();
    const first = renderEffects(image, [effect]);
    expect(new Uint8Array(first.pixels)[(8 * 32 + 8) * 4]).toBe(128);
    expect(await renderEffectsAsync(image, [effect], { yieldControl: async () => {} })).toEqual(
      first,
    );
    expect(new Uint8Array(first.pixels).filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(
      true,
    );
  });
  it('keeps built-in recipes and nontext styles independent of font assets', () => {
    const effect = fontEffect();
    for (const style of ['ascii', 'emoji', 'braille', 'blocks'] as const) {
      const built = {
        ...effect,
        params: { ...effect.params, style, fontSource: 'builtin' as const },
      };
      const { glyphFont: _font, ...without } = built;
      expect(renderEffects(image, [built])).toEqual(renderEffects(image, [without]));
      if (style !== 'ascii')
        expect(
          renderEffects(image, [
            { ...built, params: { ...built.params, fontSource: 'installed' } },
          ]),
        ).toEqual(renderEffects(image, [without]));
      expect(_font).toBeDefined();
    }
  });
  it('copies/pastes the atlas with an effect and preserves it through duplication/undo', () => {
    const effect = fontEffect(),
      data = copySettings(effect, { kind: 'effect' })!;
    const decoded = decodeSettings(encodeSettings(data))!;
    expect(
      pastedSettings(createEffect('glyph', 'target'), decoded, { kind: 'effect' }),
    ).toMatchObject({ glyphFont: effect.glyphFont, params: { fontSource: 'installed' } });
    const commands = createCommandService({
      ...createProject('Test', 1),
      source,
      effects: [effect],
    });
    commands.duplicateEffect('font', 'duplicate');
    expect(commands.getState().effects[1]).toMatchObject({ glyphFont: effect.glyphFont });
    commands.updateEffect('font', { glyphFont: atlas(64) });
    commands.undo();
    expect((commands.getState().effects[0] as GlyphEffect).glyphFont).toEqual(effect.glyphFont);
    expect(() => {
      const commands = createCommandService({
        ...createProject('Test', 1),
        source,
        effects: [createEffect('blur', 'blur')],
      });
      commands.updateEffect('blur', { glyphFont: atlas() });
    }).toThrow();
  });
  it('preserves user fonts in GLEECH/Var and resets font source to built-in', () => {
    const effect = fontEffect();
    for (const seed of [1, 2, 3, 4])
      expect(
        generateGleechStack([effect], { mode: 'existing-only', complexity: 'gleeched', seed })[0],
      ).toMatchObject({ glyphFont: effect.glyphFont, params: { fontSource: 'installed' } });
    expect(resetSettings(effect, { kind: 'parameter', key: 'fontSource' })).toMatchObject({
      params: { fontSource: 'builtin' },
    });
  });
});
