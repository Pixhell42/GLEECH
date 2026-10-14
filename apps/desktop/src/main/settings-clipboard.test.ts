import { describe, expect, it } from 'vitest';
import {
  createProject,
  createEffect,
  createPaintedMask,
  DEFAULT_MASK_BRUSH,
  assertEffect,
} from '@gleech/project-model';
import { renderEffects } from '@gleech/effects';
import { createCommandService } from '@gleech/command-service';
import {
  copySettings,
  decodeSettings,
  encodeSettings,
  pastedSettings,
  settingsPasteTarget,
  resetSettings,
} from '@gleech/command-service';

const image = {
  width: 31,
  height: 19,
  pixels: Uint8Array.from({ length: 31 * 19 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 13) % 256))
    .buffer,
};
function commands() {
  const service = createCommandService(createProject('Copy', 345));
  service.setSource({
    id: 'source',
    name: 'source.png',
    width: 31,
    height: 19,
    format: 'png',
    hasAlpha: false,
  });
  return service;
}
describe('settings clipboard', () => {
  it('transfers bounded custom glyph text and resets one parameter without losing falloffs', () => {
    const source = createEffect('glyph', 'source'),
      target = createEffect('glyph', 'target');
    Object.assign(source.params, {
      text: 'GLEECH 🙂 42',
      glyphSet: ' .▲█',
      sizeFalloff: 'on',
      sizeFrom: 0.3,
      colorFalloff: 'on',
    });
    const copied = decodeSettings(
      encodeSettings(copySettings(source, { kind: 'parameter', key: 'text' })!),
    )!;
    const pasted = pastedSettings(target, copied, { kind: 'effect' })!;
    expect(pasted.type).toBe('glyph');
    expect(pasted.params).toMatchObject({ text: 'GLEECH 🙂 42', sizeFalloff: 'off' });
    expect(pastedSettings(createEffect('blur', 'blur'), copied, { kind: 'effect' })).toBeNull();
    const whole = pastedSettings(target, copySettings(source, { kind: 'effect' })!, {
      kind: 'effect',
    })!;
    expect(whole.params).toMatchObject({
      text: 'GLEECH 🙂 42',
      glyphSet: ' .▲█',
      sizeFalloff: 'on',
      sizeFrom: 0.3,
      colorFalloff: 'on',
    });
    expect(resetSettings(whole, { kind: 'parameter', key: 'text' })!.params).toMatchObject({
      text: 'GLEECH',
      sizeFrom: 0.3,
    });
    expect(decodeSettings(JSON.stringify({ ...copied, value: 'x'.repeat(513) }))).toBeNull();
  });
  it('matches exact color names, then similar roles, then the first color field', () => {
    const source = createEffect('gradient-map', 'source');
    Object.assign(source.params, { shadows: '#124578', highlights: '#fedcba', color: '#234567' });
    const halftone = createEffect('halftone', 'target');
    const shadows = copySettings(source, { kind: 'parameter', key: 'shadows' })!;
    const highlights = copySettings(source, { kind: 'parameter', key: 'highlights' })!;
    const dark = pastedSettings(halftone, shadows, { kind: 'parameter', key: 'backgroundColor' })!;
    expect((dark.params as Readonly<Record<string, number | string>>).foregroundColor).toBe(
      '#124578',
    );
    expect((dark.params as Readonly<Record<string, number | string>>).backgroundColor).toBe(
      (halftone.params as Readonly<Record<string, number | string>>).backgroundColor,
    );
    expect(settingsPasteTarget(halftone, shadows, { kind: 'effect' })).toEqual({
      kind: 'parameter',
      key: 'foregroundColor',
    });
    expect(
      (
        pastedSettings(halftone, highlights, { kind: 'effect' })!.params as Readonly<
          Record<string, number | string>
        >
      ).backgroundColor,
    ).toBe('#fedcba');
    const tint = copySettings(source, { kind: 'parameter', key: 'color' })!;
    expect(
      (
        pastedSettings(createEffect('glow', 'glow'), tint, { kind: 'effect' })!.params as Readonly<
          Record<string, number | string>
        >
      ).color,
    ).toBe('#234567');
    const glow = createEffect('glow', 'glow');
    Object.assign(glow.params, { glowColor: '#abcdef' });
    const unknown = copySettings(createEffect('noise-grain', 'noise'), {
      kind: 'parameter',
      key: 'noiseColor',
    })!;
    expect(
      (
        pastedSettings(halftone, unknown, { kind: 'effect' })!.params as Readonly<
          Record<string, number | string>
        >
      ).foregroundColor,
    ).toBe('#f6c65b');
    expect(
      (
        pastedSettings(halftone, copySettings(glow, { kind: 'parameter', key: 'glowColor' })!, {
          kind: 'effect',
        })!.params as Readonly<Record<string, number | string>>
      ).backgroundColor,
    ).toBe('#abcdef');
  });
  it('accepts plain hex colors, targets an explicit color field and otherwise uses the first', () => {
    const target = createEffect('halftone', 'target');
    for (const text of [' #AbC ', 'abc', 'ABCDEF', '#abcdef']) {
      const color = decodeSettings(text)!;
      expect(color.kind).toBe('color');
      const expected = text.trim().replace('#', '').length === 3 ? '#aabbcc' : '#abcdef';
      expect(
        (
          pastedSettings(target, color, { kind: 'effect' })!.params as Readonly<
            Record<string, number | string>
          >
        ).foregroundColor,
      ).toBe(expected);
      const explicit = pastedSettings(target, color, {
        kind: 'parameter',
        key: 'backgroundColorEnd',
      })!;
      expect(
        (explicit.params as Readonly<Record<string, number | string>>).backgroundColorEnd,
      ).toBe(expected);
      expect((explicit.params as Readonly<Record<string, number | string>>).foregroundColor).toBe(
        (target.params as Readonly<Record<string, number | string>>).foregroundColor,
      );
    }
    for (const text of ['#12', '#abcd', '#aabbccdd', '#ggffff', 'red', 'hello'])
      expect(decodeSettings(text)).toBeNull();
  });
  it('transfers both gradient colors and compatible placement in one undoable edit', () => {
    const service = commands();
    service.addEffect('halftone', 'source');
    service.addEffect('glow', 'target');
    service.updateEffect('source', {
      params: {
        backgroundColor: '#112233',
        backgroundColorEnd: '#aabbcc',
        backgroundColorMode: 'gradient',
        backgroundColorAngle: 73,
        backgroundColorCenterX: 26,
        backgroundColorCenterY: 71,
        backgroundColorSpan: 140,
      },
    });
    const before = service.getState();
    const data = copySettings(before.effects[0]!, { kind: 'color', key: 'backgroundColor' })!;
    expect(decodeSettings(encodeSettings(data))).toEqual(data);
    expect(service.pasteEffectSettings('target', data, { kind: 'effect' })).toBe(true);
    const params = service.getState().effects[1]!.params;
    expect(params).toMatchObject({
      glowColor: '#112233',
      glowColorEnd: '#aabbcc',
      glowColorMode: 'gradient',
      glowColorAngle: 73,
      glowColorCenterX: 26,
      glowColorCenterY: 71,
      glowColorSpan: 140,
    });
    expect(settingsPasteTarget(before.effects[1]!, data, { kind: 'effect' })).toEqual({
      kind: 'color',
      key: 'glowColor',
    });
    service.undo();
    expect(service.getState()).toBe(before);
    service.redo();
    expect(service.getState().effects[1]!.params).toEqual(params);
    const stop = copySettings(before.effects[0]!, {
      kind: 'parameter',
      key: 'backgroundColorEnd',
    })!;
    const pasted = pastedSettings(createEffect('halftone', 'stop'), stop, { kind: 'effect' })!;
    expect((pasted.params as Readonly<Record<string, number | string>>).backgroundColorEnd).toBe(
      '#aabbcc',
    );
    expect((pasted.params as Readonly<Record<string, number | string>>).backgroundColor).toBe(
      '#ffffff',
    );
  });
  it('transfers field gradients and Gradient Map ramps without inventing placement controls', () => {
    const source = createEffect('halftone', 'source');
    Object.assign(source.params, {
      backgroundColor: '#112233',
      backgroundColorEnd: '#aabbcc',
      backgroundColorMode: 'gradient',
      backgroundColorAngle: 73,
    });
    const data = copySettings(source, { kind: 'color', key: 'backgroundColor' })!;
    const fractal = pastedSettings(createEffect('mandelbrot', 'fractal'), data, {
      kind: 'effect',
    })!;
    expect(fractal.params).toMatchObject({
      outsideColor: '#112233',
      outsideColorEnd: '#aabbcc',
      outsideColorMode: 'gradient',
    });
    expect(fractal.params).not.toHaveProperty('outsideColorAngle');
    const map = pastedSettings(createEffect('gradient-map', 'map'), data, {
      kind: 'color',
      key: 'shadows',
    })!;
    // Exact semantic match wins: paper/light matches Highlights, but only Shadows accepts a complete ramp.
    expect(map.params).toMatchObject({ shadows: '#112233', highlights: '#aabbcc' });
    const ramp = copySettings(map, { kind: 'color', key: 'shadows' })!;
    expect(decodeSettings(encodeSettings(ramp))).toEqual(ramp);
    const ink = pastedSettings(source, ramp, { kind: 'effect' })!;
    expect(ink.params).toMatchObject({
      foregroundColor: '#112233',
      foregroundColorEnd: '#aabbcc',
      foregroundColorMode: 'gradient',
    });
  });
  it('rejects corrupt color/gradient payloads and keeps whole-filter colors from overwriting one another', () => {
    const source = createEffect('halftone', 'source');
    Object.assign(source.params, { foregroundColor: '#112233', backgroundColor: '#aabbcc' });
    const whole = copySettings(source, { kind: 'effect' })!;
    const mapped = pastedSettings(createEffect('gradient-map', 'map'), whole, { kind: 'effect' })!;
    expect((mapped.params as Readonly<Record<string, number | string>>).shadows).toBe('#112233');
    expect((mapped.params as Readonly<Record<string, number | string>>).highlights).toBe('#aabbcc');
    const gradient = copySettings(source, { kind: 'color', key: 'foregroundColor' })!;
    if (gradient.kind !== 'color') throw new Error('Expected color');
    for (const invalid of [
      { ...gradient, value: 'invalid' },
      { ...gradient, key: '__proto__' },
      { ...gradient, gradient: { ...gradient.gradient, end: '#xxx' } },
      { ...gradient, gradient: { ...gradient.gradient, angle: 900 } },
      { ...gradient, gradient: { mode: 'gradient', end: '#112233' } },
      { ...gradient, sourceType: 'noise-grain', key: 'noiseColor' },
    ])
      expect(decodeSettings(JSON.stringify(invalid))).toBeNull();
    const target = createEffect('glow', 'target');
    const extracted = pastedSettings(target, whole, { kind: 'color', key: 'glowColor' })!;
    expect((extracted.params as Readonly<Record<string, number | string>>).glowColor).toBe(
      '#aabbcc',
    );
  });
  it('routes a single parameter by its key and makes an incompatible paste a no-op', () => {
    const service = commands();
    service.addEffect('blur', 'blur');
    service.addEffect('hue-saturation', 'tone');
    service.updateEffect('blur', { params: { radius: 7, amount: 0.5 } });
    const effect = service.getState().effects[0]!;
    const radius = copySettings(effect, { kind: 'parameter', key: 'radius' })!;
    const before = service.getState();
    expect(service.pasteEffectSettings('tone', radius, { kind: 'effect' })).toBe(false);
    expect(service.getState()).toBe(before);
    const opacity = copySettings(effect, { kind: 'parameter', key: 'amount' })!;
    expect(
      service.pasteEffectSettings('tone', opacity, { kind: 'parameter', key: 'lightness' }),
    ).toBe(true);
    expect(service.getState().effects[1]!.params.amount).toBe(0.5);
    service.undo();
    expect(service.getState()).toBe(before);
    expect(decodeSettings(encodeSettings(radius))).toEqual(radius);
  });
  it('rejects incompatible units, ranges, choices, malformed and ordinary clipboard text', () => {
    const glow = createEffect('glow', 'glow');
    Object.assign(glow.params, { strength: 2 });
    expect(
      pastedSettings(
        createEffect('wave-distortion', 'wave'),
        copySettings(glow, { kind: 'parameter', key: 'strength' })!,
        { kind: 'effect' },
      ),
    ).toBeNull();
    const blur = createEffect('blur', 'blur');
    const scanlines = createEffect('scanlines', 'scanlines');
    Object.assign(scanlines.params, { frequency: 999 });
    expect(
      pastedSettings(
        createEffect('wave-distortion', 'wave'),
        copySettings(scanlines, { kind: 'parameter', key: 'frequency' })!,
        { kind: 'effect' },
      ),
    ).toBeNull();
    Object.assign(blur.params, { style: 'lens' });
    expect(
      pastedSettings(
        createEffect('noise-grain', 'noise'),
        copySettings(blur, { kind: 'parameter', key: 'style' })!,
        { kind: 'effect' },
      ),
    ).toBeNull();
    for (const text of [
      '',
      'hello',
      '{',
      '{}',
      JSON.stringify({ format: 'gleech-settings', version: 2 }),
      JSON.stringify({
        format: 'gleech-settings',
        version: 1,
        kind: 'parameter',
        sourceType: 'blur',
        key: '__proto__',
        value: '#ffffff',
      }),
      JSON.stringify({
        format: 'gleech-settings',
        version: 1,
        kind: 'parameter',
        sourceType: 'blur',
        key: 'radius',
        value: 999,
      }),
    ])
      expect(decodeSettings(text)).toBeNull();
    const levels = createEffect('levels-curves', 'levels');
    const source = createEffect('levels-curves', 'source');
    Object.assign(source.params, { inputBlack: 0.8, inputWhite: 0.9 });
    Object.assign(levels.params, { inputWhite: 0.6 });
    expect(
      pastedSettings(levels, copySettings(source, { kind: 'parameter', key: 'inputBlack' })!, {
        kind: 'effect',
      }),
    ).toBeNull();
  });
  it('copies masks independently, creates or replaces them and retains immutable Undo state', () => {
    const service = commands();
    service.addEffect('hue-saturation', 'source');
    service.addEffect('blur', 'target');
    service.setEffectMask('source', {
      ...createPaintedMask(31, 19),
      inverted: true,
      strokes: [{ ...DEFAULT_MASK_BRUSH, points: [{ x: 0.4, y: 0.5 }] }],
    });
    const source = service.getState().effects[0]!;
    const data = copySettings(source, { kind: 'mask' })!;
    const before = service.getState();
    expect(service.pasteEffectSettings('target', data, { kind: 'effect' })).toBe(true);
    expect(service.getState().effects[1]!.paintedMask).toEqual(source.paintedMask);
    service.setEffectMask('source', createPaintedMask(31, 19));
    expect(service.getState().effects[1]!.paintedMask).toEqual(source.paintedMask);
    service.undo();
    service.undo();
    expect(service.getState()).toBe(before);
    expect(copySettings(createEffect('blur', 'none'), { kind: 'mask' })).toBeNull();
    expect(decodeSettings(encodeSettings(data))).toEqual(data);
  });
  it('copies compatible whole-filter settings while retaining target identity and seed', () => {
    const source = createEffect('hue-saturation', 'source');
    Object.assign(source.params, { amount: 0.3, blendMode: 'screen', lightness: 0.7 });
    Object.assign(source.application, { region: 'left', coverage: 0.6, softness: 0.2 });
    const data = copySettings(source, { kind: 'effect' })!;
    const target = createEffect('blur', 'target');
    const applied = pastedSettings(target, data, { kind: 'effect' })!;
    expect(applied.instanceId).toBe('target');
    expect(applied.type).toBe('blur');
    expect(applied.params.amount).toBe(0.3);
    expect(applied.params.blendMode).toBe('screen');
    expect(applied.params).not.toHaveProperty('lightness');
    expect(applied.application).toEqual(source.application);
    expect(applied.seedOffset).toBe(target.seedOffset);
    assertEffect(applied);
  });
  it('duplicates above with the same procedural output, independent settings and one Undo step', () => {
    const service = commands();
    service.addEffect('noise-grain', 'original');
    service.addEffect('blur', 'top');
    service.updateEffect('original', { params: { style: 'voronoi', scale: 9 } });
    service.varyEffect('original');
    const before = service.getState();
    service.duplicateEffect('original', 'duplicate');
    const after = service.getState();
    expect(after.effects.map((x) => x.instanceId)).toEqual(['original', 'duplicate', 'top']);
    expect(renderEffects(image, [after.effects[0]!], { masterSeed: 345 }).pixels).toEqual(
      renderEffects(image, [after.effects[1]!], { masterSeed: 345 }).pixels,
    );
    service.undo();
    expect(service.getState()).toBe(before);
    service.redo();
    expect(service.getState()).toBe(after);
    service.varyEffect('duplicate');
    expect(service.getState().effects[0]!.seedOffset).toBe(1);
    expect(service.getState().effects[1]!.seedOffset).toBe(2);
    const copied = copySettings(after.effects[0]!, { kind: 'effect' })!;
    const pasted = pastedSettings(createEffect('noise-grain', 'pasted'), copied, {
      kind: 'effect',
    })!;
    expect(renderEffects(image, [pasted], { masterSeed: 345 }).pixels).toEqual(
      renderEffects(image, [after.effects[0]!], { masterSeed: 345 }).pixels,
    );
    expect(() => assertEffect({ ...pasted, patternId: '' })).toThrow();
  });
});
