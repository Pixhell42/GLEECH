import { describe, expect, it } from 'vitest';
import {
  applyCompression,
  applyGifPreset,
  applySequenceKind,
  applyVideoPreset,
  COMPRESSION_CHOICES,
  defaultGifSettings,
  defaultVideoSettings,
  estimateGifSize,
  estimateVideoSize,
  formatSize,
  GIF_PRESETS,
  gifFrameCount,
  gifOutputExtension,
  gifOutputLabel,
  gifOutputSize,
  gifRenderLabel,
  LOOP_FORMATS,
  resolveVideoOutput,
  VIDEO_PRESETS,
  videoOutputExtension,
  videoOutputLabel,
  videoRenderLabel,
} from '../shared/render-presets';
import type { VideoRenderSettings } from '../shared/render';

const source = { width: 1920, height: 1080, fps: 30 };
const MB = 1e6;
const silent = (settings: VideoRenderSettings): VideoRenderSettings => ({
  ...settings,
  audio: { ...settings.audio, enabled: false },
});
const preset = (id: Parameters<typeof applyVideoPreset>[1]) =>
  silent(applyVideoPreset(defaultVideoSettings(source), id, source));

describe('video presets', () => {
  it('match the spec table', () => {
    const table = VIDEO_PRESETS.map((p) => [
      p.id,
      p.width,
      p.height,
      p.format,
      p.compression,
      p.audio.codec,
      p.audio.bitrateKbps,
      p.audio.normalize,
    ]);
    expect(table).toEqual([
      ['8k', 7680, 4320, 'mp4-hevc', 'highest', 'aac', 320, false],
      ['4k', 3840, 2160, 'mp4-hevc', 'highest', 'aac', 320, false],
      ['2k-master', 2048, 1152, 'mp4-hevc', 'high', 'aac', 320, false],
      ['1080p-social', 1920, 1080, 'mp4-h264', 'web', 'aac', 256, true],
      ['vertical', 1080, 1920, 'mp4-h264', 'web', 'aac', 256, true],
      ['draft', 960, 540, 'mp4-h264', 'small', 'aac', 128, false],
      ['edit-master', 1920, 1080, 'mov-prores', 'high', 'pcm', 0, false],
      ['4k-edit-master', 3840, 2160, 'mov-prores', 'high', 'pcm', 0, false],
      ['custom', null, null, 'mp4-h264', 'high', 'aac', 256, false],
    ]);
    expect(VIDEO_PRESETS.find((p) => p.id === 'vertical')?.hint).toBe('Reels · TikTok');
    expect(COMPRESSION_CHOICES.map((c) => c.id)).toEqual([
      'highest',
      'high',
      'web',
      'small',
      'lossless',
      'raw',
    ]);
  });

  it('defaults to 1080p Social framed for the source aspect', () => {
    const wide = defaultVideoSettings(source);
    expect(wide.preset).toBe('1080p-social');
    expect([wide.frame.width, wide.frame.height, wide.frame.fit, wide.frame.bars]).toEqual([
      1920,
      1080,
      'fit',
      'black',
    ]);
    expect(wide.compression).toBe('web');
    expect(wide.advanced.keyframeInterval).toBe(60);
    expect(wide.audio).toMatchObject({ codec: 'aac', bitrateKbps: 256, normalize: true });
    const square = defaultVideoSettings({ width: 1080, height: 1080, fps: 24 });
    expect(square.frame.bars).toBe('blur');
    expect(square.fps).toBe(24);
  });

  it('applies presets, keeping user framing and custom sizes', () => {
    const base = defaultVideoSettings(source);
    const vertical = applyVideoPreset(base, 'vertical', source);
    expect([vertical.frame.width, vertical.frame.height, vertical.frame.bars]).toEqual([
      1080,
      1920,
      'blur',
    ]);
    const colored = applyVideoPreset(
      { ...base, frame: { ...base.frame, bars: 'color', barColor: '#ff0000' } },
      '4k',
      source,
    );
    expect(colored.frame.bars).toBe('color');
    expect(colored.advanced.colorDepth).toBe(10);
    const custom = applyVideoPreset(
      { ...base, frame: { ...base.frame, width: 1080, height: 1350 } },
      'custom',
      source,
    );
    expect([custom.frame.width, custom.frame.height, custom.compression]).toEqual([
      1080,
      1350,
      'high',
    ]);
    expect(applyVideoPreset(base, 'edit-master', source).audio.codec).toBe('pcm');
    expect(applySequenceKind(base, 'flipbook').sequence.every).toBe('2');
  });

  it('resolves the real output format and labels', () => {
    const base = defaultVideoSettings(source);
    expect(videoOutputLabel(base)).toBe('MP4 · H.264 (web)');
    expect(videoOutputLabel(preset('4k'))).toBe('MP4 · H.265 (HEVC)');
    expect(videoOutputLabel(preset('edit-master'))).toBe('MOV · ProRes 422 HQ');
    expect(videoOutputLabel(applyCompression(preset('edit-master'), 'highest'))).toBe(
      'MOV · ProRes 4444 XQ',
    );
    expect(videoOutputLabel(applyCompression(base, 'lossless'))).toBe('MKV · FFV1 (lossless)');
    expect(videoOutputExtension(applyCompression(base, 'lossless'))).toBe('mkv');
    expect(videoOutputLabel(applyCompression(base, 'raw'))).toBe('MOV · Uncompressed 10-bit 4:2:2');
    const overlay = { ...base, overlay: { ...base.overlay, enabled: true } };
    const resolved = resolveVideoOutput(overlay);
    expect(resolved).toMatchObject({ kind: 'movie', codec: 'prores', alpha: true });
    expect(resolved.label).toBe('MOV · ProRes 4444 + alpha');
    expect(resolved.kind === 'movie' && resolved.switched).toContain(
      "MP4 can't store transparency",
    );
    expect(videoOutputLabel(applyCompression(overlay, 'lossless'))).toBe(
      'MOV · PNG codec + alpha (lossless)',
    );
    expect(videoOutputLabel({ ...overlay, format: 'webm-vp9' })).toBe('WebM · VP9 + alpha');
    const sequence = { ...base, output: 'sequence' as const };
    expect(videoOutputLabel(sequence)).toBe('PNG · 16-bit');
    expect(videoOutputExtension(sequence)).toBe('');
    expect(videoRenderLabel(base, 180)).toBe('Render Video');
    expect(videoRenderLabel(sequence, 180)).toBe('Render 180 Frames');
    const flip = applySequenceKind(base, 'flipbook');
    expect(videoRenderLabel(flip, 90)).toBe('Make Flip Book');
    expect(
      videoRenderLabel(
        {
          ...flip,
          sequence: { ...flip.sequence, flipbook: { ...flip.sequence.flipbook, kind: 'sprite' } },
        },
        90,
      ),
    ).toBe('Make Sprite Sheet');
  });
});

describe('video size estimates', () => {
  const near = (bytes: number, mb: number, tolerance = 0.02) =>
    expect(Math.abs(bytes / MB - mb) / mb).toBeLessThan(tolerance);

  it('reproduce the measured 6 s, 30 fps encodes', () => {
    const base = preset('custom');
    near(estimateVideoSize(applyCompression(base, 'highest'), 180, 30).typical, 15.3);
    near(estimateVideoSize(applyCompression(base, 'high'), 180, 30).typical, 10.8);
    near(estimateVideoSize(preset('1080p-social'), 180, 30).typical, 7.7);
    near(estimateVideoSize(preset('draft'), 180, 30).typical, 5.5 * Math.pow(0.25, 0.7));
    near(estimateVideoSize(preset('4k'), 180, 30).typical, 32.7, 0.03);
    near(estimateVideoSize(applyCompression(preset('4k'), 'high'), 180, 30).typical, 23.3, 0.03);
    near(estimateVideoSize(preset('8k'), 180, 30).typical, 87, 0.03);
    near(estimateVideoSize(preset('edit-master'), 180, 30).typical, 174);
    near(estimateVideoSize(preset('4k-edit-master'), 180, 30).typical, 696);
    near(estimateVideoSize(applyCompression(base, 'lossless'), 180, 30).typical, 75);
    // 4K Web is capped by the 12 Mbps limit.
    near(
      estimateVideoSize({ ...preset('1080p-social'), frame: preset('4k').frame }, 180, 30).typical,
      9.9,
    );
    // v210 is exact: 5120 bytes per row at 1920 px.
    expect(estimateVideoSize(applyCompression(base, 'raw'), 180, 30).typical).toBe(
      5120 * 1080 * 180,
    );
  });

  it('gives calm–heavy ranges and adds audio', () => {
    const highest = estimateVideoSize(applyCompression(preset('custom'), 'highest'), 180, 30);
    near(highest.low, 2.6);
    near(highest.high, 108);
    const withAudio = estimateVideoSize(defaultVideoSettings(source), 180, 30);
    near(withAudio.typical, 7.7 + 0.192);
    const sequence = { ...preset('custom'), output: 'sequence' as const };
    near(estimateVideoSize(sequence, 180, 30).typical, 325);
    const overlay = { ...sequence, overlay: { ...sequence.overlay, enabled: true } };
    near(estimateVideoSize(overlay, 180, 30).typical, 341);
    expect(formatSize(7.7 * MB)).toBe('7.7 MB');
    expect(formatSize(174 * MB)).toBe('174 MB');
    expect(formatSize(995 * MB * 2)).toBe('2.0 GB');
  });
});

describe('GIF & Loops presets', () => {
  it('match the spec table', () => {
    expect(
      GIF_PRESETS.map((p) => [p.id, p.width, p.fps, p.colors, p.dither, p.scaling, p.sizeLimitMb]),
    ).toEqual([
      ['social', 480, 15, 256, 'bayer', 'lanczos', 8],
      ['hq', 720, 24, 256, 'floyd-steinberg', 'lanczos', 0],
      ['tiny', 240, 12, 64, 'bayer', 'bicubic', 1],
      ['sticker', 320, 15, 128, 'none', 'lanczos', 0],
      ['crunchy', 256, 10, 32, 'none', 'nearest', 0],
    ]);
    const defaults = defaultGifSettings();
    expect(defaults).toMatchObject({
      preset: 'social',
      format: 'gif',
      width: 480,
      transparent: false,
    });
    expect(applyGifPreset(defaults, 'sticker').transparent).toBe(true);
    expect(applyGifPreset({ ...defaults, transparent: true }, 'tiny').transparent).toBe(true);
    expect(applyGifPreset(defaults, 'custom')).toEqual({ ...defaults, preset: 'custom' });
    expect(LOOP_FORMATS.find((f) => f.id === 'webp')?.hint).toContain('6× smaller');
    expect(LOOP_FORMATS.find((f) => f.id === 'apng')?.hint).toContain('5×');
  });

  it('labels, extensions and sizes', () => {
    const gif = defaultGifSettings();
    expect([gifOutputExtension(gif), gifRenderLabel(gif), gifOutputLabel(gif)]).toEqual([
      'gif',
      'Export GIF',
      'GIF',
    ]);
    const apng = { ...gif, format: 'apng' as const, transparent: true };
    expect([gifOutputExtension(apng), gifRenderLabel(apng), gifOutputLabel(apng)]).toEqual([
      'png',
      'Export APNG',
      'APNG + alpha',
    ]);
    expect(gifRenderLabel({ ...gif, format: 'mp4' })).toBe('Export Loop');
    expect(gifOutputSize(gif, 16 / 9)).toEqual({ width: 480, height: 270 });
    expect(gifOutputSize({ width: 241, format: 'mp4' }, 16 / 9)).toEqual({
      width: 242,
      height: 136,
    });
  });

  it('counts loop frames after speed and loop style', () => {
    const gif = defaultGifSettings();
    expect(gifFrameCount(gif, 6)).toBe(90);
    expect(gifFrameCount({ ...gif, loop: 'boomerang' }, 6)).toBe(178);
    expect(gifFrameCount({ ...gif, speed: 2 }, 6)).toBe(45);
    expect(
      gifFrameCount(
        {
          ...gif,
          loop: 'concat',
          segments: [
            { start: 1, end: 3 },
            { start: 5, end: 6 },
          ],
        },
        10,
      ),
    ).toBe(45);
  });

  it('estimates reproduce the measured loops', () => {
    const near = (bytes: number, mb: number) =>
      expect(Math.abs(bytes / MB - mb) / mb).toBeLessThan(0.02);
    const gif = defaultGifSettings();
    for (const p of GIF_PRESETS) {
      const settings = applyGifPreset(gif, p.id);
      near(estimateGifSize(settings, p.fps * 6).typical, p.measuredMb);
    }
    const tiny = estimateGifSize(applyGifPreset(gif, 'tiny'), 72);
    expect(tiny.overLimit).toBe(true);
    expect(estimateGifSize(gif, 90).overLimit).toBe(false);
    near(estimateGifSize({ ...gif, format: 'webp' }, 90).typical, 1.1);
    near(estimateGifSize({ ...gif, format: 'apng' }, 90).typical, 30.7);
    near(estimateGifSize({ ...gif, format: 'mp4' }, 90).typical, 1.0);
    // Fewer colors and lossy shrink a GIF.
    expect(estimateGifSize({ ...gif, colors: 64, lossy: 50 }, 90).typical).toBeLessThan(
      estimateGifSize(gif, 90).typical * 0.6,
    );
  });
});
