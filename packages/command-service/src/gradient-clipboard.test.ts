import { describe, expect, it } from 'vitest';
import { createEffect, type HalftoneEffect } from '@gleech/project-model';
import { copySettings, encodeSettings, decodeSettings, pastedSettings } from './settings-clipboard';
const stops = JSON.stringify([
  { position: 0, color: '#ff0000' },
  { position: 0.25, color: '#00ff00' },
  { position: 1, color: '#0000ff' },
]);
describe('Multi-stop color clipboard', () => {
  it('matches reduction-ramp endpoints to ink and paper roles for plain colors', () => {
    for (const [type, start, end] of [
      ['indexed-palette', 'paletteStart', 'paletteEnd'],
      ['dither', 'rampStart', 'rampEnd'],
    ] as const) {
      const source = createEffect(type, 'source');
      Object.assign(source.params, { [start]: '#102030', [end]: '#ddeeff' });
      const destination = createEffect('threshold', 'threshold');
      const dark = pastedSettings(
        destination,
        copySettings(source, { kind: 'parameter', key: start })!,
        { kind: 'effect' },
      )!;
      const light = pastedSettings(
        destination,
        copySettings(source, { kind: 'parameter', key: end })!,
        { kind: 'effect' },
      )!;
      expect(dark.params).toMatchObject({ inkColor: '#102030' });
      expect(light.params).toMatchObject({ paperColorEnd: '#ddeeff' });
    }
  });
  it('transfers palette and dither ramps with all stops through portable clipboard packets', () => {
    for (const [type, start, end] of [
      ['indexed-palette', 'paletteStart', 'paletteEnd'],
      ['dither', 'rampStart', 'rampEnd'],
    ] as const) {
      const e = createEffect(type, 'ramp');
      Object.assign(e.params, { [start]: '#ff0000', [end]: '#0000ff', [start + 'Stops']: stops });
      const packet = decodeSettings(
        encodeSettings(copySettings(e, { kind: 'color', key: start })!),
      )!;
      expect(packet).toMatchObject({ gradient: { mode: 'gradient', end: '#0000ff', stops } });
      const destination = pastedSettings(createEffect('gradient-map', 'map'), packet, {
        kind: 'color',
        key: 'shadows',
      })!;
      expect(destination.params).toMatchObject({
        shadows: '#ff0000',
        highlights: '#0000ff',
        shadowsStops: stops,
      });
      const back = decodeSettings(
        encodeSettings(copySettings(destination, { kind: 'color', key: 'shadows' })!),
      )!;
      const returned = pastedSettings(createEffect(type, 'back'), back, {
        kind: 'color',
        key: start,
      })!;
      expect(returned.params).toMatchObject({
        [start]: '#ff0000',
        [end]: '#0000ff',
        [start + 'Stops']: stops,
      });
      const malformed = JSON.parse(encodeSettings(packet));
      malformed.gradient.stops = '[invalid]';
      expect(decodeSettings(JSON.stringify(malformed))).toBeNull();
    }
  });
  it('copies all stops between compatible color roles and into Gradient Map', () => {
    const e = createEffect('halftone', 'multi') as HalftoneEffect;
    const source = {
      ...e,
      params: {
        ...e.params,
        foregroundColor: '#ff0000',
        foregroundColorEnd: '#0000ff',
        foregroundColorMode: 'gradient' as const,
        foregroundColorStops: stops,
      },
    };
    const packet = decodeSettings(
      encodeSettings(copySettings(source, { kind: 'color', key: 'foregroundColor' })!),
    )!;
    const destination = pastedSettings(createEffect('gradient-map', 'map'), packet, {
      kind: 'color',
      key: 'shadows',
    })!;
    expect(destination.params).toMatchObject({
      shadowsStops: stops,
      shadows: '#ff0000',
      highlights: '#0000ff',
    });
    const back = decodeSettings(
      encodeSettings(copySettings(destination, { kind: 'color', key: 'shadows' })!),
    )!;
    expect(
      pastedSettings(createEffect('scanlines', 'lines'), back, { kind: 'color', key: 'color' })!
        .params,
    ).toMatchObject({ colorStops: stops });
  });
});
