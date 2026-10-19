import { configureRendering } from './gpu';
beforeEach(() => configureRendering({ renderer: 'cpu', skipUnsupportedShaders: false }));
import { beforeEach, describe, expect, it } from 'vitest';
import { createCommandService } from '@gleech/command-service';
import { renderEffectsAsync } from '@gleech/effects';
import {
  createEffect,
  createProject,
  EFFECT_DEFINITIONS,
  type EffectInstance,
} from '@gleech/project-model';
import { decodePng, encodePng, resizeRgba } from './png';
import { blockCells, blockSize } from './blocks';
import { cpuRenderableStack, renderHeadless } from './engine';
import {
  addEffectFromSpec,
  formatValue,
  paramEntries,
  parseEffectSpec,
  parseParamValue,
  resolveEffectType,
  stepParam,
} from './params';
import { contactSheet } from './sheet';
import { cellWidth, truncate, wordmarkRows } from './style';
import { decodeInput } from './tui/terminal';
import { Screen } from './tui/screen';

const width = 23,
  height = 17;
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? [0, 90, 255][Math.floor(i / 4) % 3]! : (i * 53 + 7) % 256,
);
const image = { width, height, pixels: pixels.buffer };

function serviceWithSource() {
  const service = createCommandService(createProject('test'));
  service.setSource({ id: 'src', name: 'test.png', width, height, format: 'png', hasAlpha: true });
  return service;
}

describe('built-in PNG codec', () => {
  it('round-trips RGBA exactly, including transparent pixels', () => {
    const decoded = decodePng(encodePng(image, { Software: 'GLEECH test' }));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(new Uint8Array(decoded.pixels)).toEqual(pixels);
  });
  it('rejects data that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('GLEECH02 not an image'))).toThrow('Not a PNG');
  });
  it('averages alpha-weighted color when reducing', () => {
    const two = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 0]).buffer,
    };
    expect([...new Uint8Array(resizeRgba(two, 1, 1).pixels)]).toEqual([255, 0, 0, 128]);
  });
});

describe('headless rendering', () => {
  it('matches the shared renderer exactly at full resolution', async () => {
    const effects = [createEffect('rgb-split', 'a'), createEffect('scanlines', 'b')];
    const headless = await renderHeadless({ source: image, effects, masterSeed: 42 });
    const direct = await renderEffectsAsync({ ...image, pixels: pixels.slice().buffer }, effects, {
      masterSeed: 42,
      yieldControl: () => new Promise((resolve) => setImmediate(resolve)),
    });
    expect(new Uint8Array(headless.image.pixels)).toEqual(new Uint8Array(direct.pixels));
    expect(headless.warnings).toEqual([]);
  });
  it('is deterministic for a seed', async () => {
    const effects = [createEffect('pixel-sort', 'a'), createEffect('noise-grain', 'b')];
    const first = await renderHeadless({ source: image, effects, masterSeed: 7 });
    const second = await renderHeadless({ source: image, effects, masterSeed: 7 });
    expect(new Uint8Array(first.image.pixels)).toEqual(new Uint8Array(second.image.pixels));
  });
  it('renders reduced drafts at the requested size', async () => {
    const result = await renderHeadless({
      source: image,
      effects: [createEffect('rgb-split', 'a')],
      masterSeed: 1,
      previewMaxDimension: 8,
    });
    expect(Math.max(result.image.width, result.image.height)).toBe(8);
  });
  it('bypasses GPU-only imported shaders with a warning instead of failing', () => {
    const imported = {
      ...createEffect('rgb-split', 'x'),
      type: 'shader-import',
      shader: { name: 'Test WGSL', language: 'wgsl' },
    } as unknown as EffectInstance;
    const { effects, warnings } = cpuRenderableStack([createEffect('crt', 'a'), imported], true);
    expect(effects[1]!.enabled).toBe(false);
    expect(effects[0]!.enabled).toBe(true);
    expect(warnings[0]).toContain('Test WGSL');
  });
  it('fails clearly when a stack needs subject detection that is unavailable', async () => {
    const effect = createEffect('rgb-split', 'a');
    const subjectOnly = {
      ...effect,
      application: { ...effect.application, region: 'subject' },
    } as EffectInstance;
    await expect(
      renderHeadless({ source: image, effects: [subjectOnly], masterSeed: 1 }),
    ).rejects.toThrow('subject detection');
  });
});

describe('effect specs and parameters', () => {
  it('resolves effect IDs, titles and unique searches', () => {
    expect(resolveEffectType('pixel-sort')).toBe('pixel-sort');
    expect(resolveEffectType('Pixel Sorting')).toBe('pixel-sort');
    expect(() => resolveEffectType('definitely-not-an-effect')).toThrow('Unknown effect');
  });
  it('parses specs with percentages, choices and application keys', () => {
    const service = serviceWithSource();
    addEffectFromSpec(service, 'pixel-sort:amount=60%,criterion=hue,coverage=50%', 'p1');
    const effect = service.getState().effects[0]!;
    expect(effect.params.amount).toBe(0.6);
    expect((effect.params as Record<string, unknown>)['criterion']).toBe('hue');
    expect(effect.application.coverage).toBe(0.5);
    expect(service.canUndo()).toBe(true);
  });
  it('keeps commas inside values that are not followed by a key', () => {
    expect(parseEffectSpec('glyph:text=A,B C,amount=1').values).toEqual([
      ['text', 'A,B C'],
      ['amount', '1'],
    ]);
  });
  it('rejects out-of-range values and unknown keys', () => {
    const service = serviceWithSource();
    expect(() => addEffectFromSpec(service, 'rgb-split:amount=2', 'a')).toThrow('between');
    expect(() => addEffectFromSpec(serviceWithSource(), 'rgb-split:nope=1', 'b')).toThrow(
      'no parameter',
    );
  });
  it('formats and steps values like the desktop inspector', () => {
    const amount = EFFECT_DEFINITIONS['pixel-sort'].parameters['amount']!;
    expect(formatValue(amount, 0.42)).toBe('42%');
    expect(stepParam(amount, 1, 1, false)).toBe(1);
    expect(stepParam(amount, 0.5, -1, true)).toBeLessThan(0.5);
    const blend = EFFECT_DEFINITIONS['pixel-sort'].parameters['blendMode']!;
    expect(stepParam(blend, 'normal', 1, false)).not.toBe('normal');
    expect(parseParamValue(blend, 'Normal')).toBe('normal');
  });
  it('lists every definition parameter plus application controls', () => {
    const entries = paramEntries(createEffect('crt', 'a'));
    expect(entries.some((entry) => entry.key === 'amount')).toBe(true);
    expect(entries.some((entry) => entry.key === 'application.coverage')).toBe(true);
  });
});

describe('terminal input', () => {
  it('decodes keys, modifiers, mouse and paste', () => {
    const events = decodeInput('a\x1b[A\x1b[1;2C\x03\r\x1b[Z\x1b[<0;10;5M\x1b[200~hi\x1b[201~J');
    expect(events.map((e) => (e.kind === 'key' ? e.name : e.kind))).toEqual([
      'a',
      'up',
      'right',
      'c',
      'enter',
      'tab',
      'mouse',
      'paste',
      'j',
    ]);
    expect(events[2]).toMatchObject({ shift: true });
    expect(events[3]).toMatchObject({ ctrl: true });
    expect(events[6]).toMatchObject({ x: 9, y: 4, button: 'left', action: 'press' });
    expect(events[7]).toMatchObject({ text: 'hi' });
    expect(events[8]).toMatchObject({ shift: true, text: 'J' });
  });
  it('treats a lone escape as Escape', () => {
    expect(decodeInput('\x1b')).toMatchObject([{ kind: 'key', name: 'escape' }]);
  });
});

describe('terminal drawing', () => {
  it('only rewrites cells that changed between frames', () => {
    const screen = new Screen(3, [0, 0, 0], [255, 255, 255]);
    screen.resize(10, 2);
    screen.text(0, 0, 'GLEECH', { fg: [233, 196, 106] });
    let first = '';
    screen.flush((data) => (first += data));
    expect(first).toContain('GLEECH');
    let second = '';
    screen.flush((data) => (second += data));
    expect(second).toBe('');
    screen.text(0, 1, 'x');
    let third = '';
    screen.flush((data) => (third += data));
    expect(third).toContain('x');
    expect(third).not.toContain('GLEECH');
  });
  it('fits half-block previews inside the cell grid', () => {
    const size = blockSize(768, 384, 40, 40);
    expect(size.cols).toBe(40);
    expect(size.rows).toBe(10);
    const cells = blockCells(image, 4, 3);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveLength(4);
  });
  it('measures wide characters and truncates by cells', () => {
    expect(cellWidth('GLEECH')).toBe(6);
    expect(cellWidth('界')).toBe(2);
    expect(truncate('Feedback Bloom / Melt', 10)).toBe('Feedback…');
    expect(wordmarkRows()).toHaveLength(3);
  });
});

describe('contact sheets', () => {
  it('lays out variants in a near-square grid', () => {
    const sheet = contactSheet([image, image, image, image, image], 10, 2);
    // 3 columns × 2 rows of 10×7 cells with 2px gaps.
    expect(sheet.width).toBe(3 * 10 + 4 * 2);
    expect(sheet.height).toBe(2 * 7 + 3 * 2);
  });
});

describe('terminal graphics', () => {
  it('reads kitty, sixel and cell-size replies', async () => {
    const { parseProbe } = await import('./tui/graphics');
    expect(parseProbe('\x1b_Gi=31;OK\x1b\\\x1b[6;20;10t\x1b[?62;4;22c')).toEqual({
      kitty: true,
      sixel: true,
      cell: { width: 10, height: 20 },
    });
    expect(parseProbe('\x1b[?62;22c')).toEqual({ kitty: false, sixel: false });
  });
  it('maps known terminals to their image protocol', async () => {
    const { protocolFromEnv, resolveCaps } = await import('./tui/graphics');
    expect(protocolFromEnv({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm');
    expect(protocolFromEnv({ TERM: 'xterm-kitty' })).toBe('kitty');
    expect(protocolFromEnv({ TERM_PROGRAM: 'ghostty' })).toBe('kitty');
    expect(protocolFromEnv({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('blocks');
    expect(protocolFromEnv({ ALACRITTY_WINDOW_ID: '1' })).toBe('blocks');
    expect(protocolFromEnv({ TERM_PROGRAM: 'iTerm.app', TMUX: '/tmp/x' })).toBe('blocks');
    expect(protocolFromEnv({ GLEECH_GRAPHICS: 'sixel', TMUX: '/tmp/x' })).toBe('sixel');
    // Windows Terminal is identified by asking it: DA1 advertises sixel.
    expect(protocolFromEnv({ WT_SESSION: 'x' })).toBe(null);
    expect(resolveCaps({ WT_SESSION: 'x' }, { kitty: false, sixel: true }).protocol).toBe('sixel');
    expect(resolveCaps({}, null)).toMatchObject({
      protocol: 'blocks',
      cellWidth: 10,
      cellHeight: 20,
    });
  });
  it('encodes sixel that decodes back to the quantized pixels', async () => {
    const { quantize, sixelImage, decodeSixel } = await import('./tui/graphics');
    const gradient = Uint8Array.from({ length: 37 * 14 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : ((i >> 2) * (i % 4 === 0 ? 7 : i % 4 === 1 ? 3 : 11)) % 256,
    );
    const img = { width: 37, height: 14, pixels: gradient.buffer };
    const { indices, palette } = quantize(img, [16, 16, 17]);
    expect(palette.length).toBeLessThan(256);
    const decoded = decodeSixel(sixelImage(img, [16, 16, 17]));
    expect([decoded.width, decoded.height]).toEqual([37, 14]);
    expect(Array.from(decoded.indices)).toEqual(Array.from(indices));
  });
  it('fits and zooms viewports without leaving the image', async () => {
    const { viewportImage, clampView } = await import('./tui/viewport');
    const fit = viewportImage(image, image, { zoom: 0, cx: 0.5, cy: 0.5 }, 40, 20, [0, 0, 0]);
    expect([fit.width, fit.height]).toEqual([40, 20]);
    const zoomed = viewportImage(image, image, { zoom: 2, cx: 0, cy: 0 }, 10, 10, [0, 0, 0]);
    const px = new Uint8Array(zoomed.pixels);
    // Clamped to the top-left: the first screen pixel is image pixel (0, 0).
    expect(clampView({ zoom: 2, cx: 0, cy: 0 }, image, 10, 10)).toMatchObject({
      cx: 5 / 2 / width,
    });
    expect(px[3]).toBe(255);
  });
});
