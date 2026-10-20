import { describe, expect, it } from 'vitest';
import {
  atempoChain,
  audioPlan,
  buildAudioFileArgs,
  buildLoopArgs,
  buildVideoArgs,
  describeFfmpegError,
  describeOverrides,
  formatRate,
  loopRepeatArgs,
  sizeLimitAttempts,
  videoEncoderCandidates,
  type LoopArgsInput,
} from './ffmpeg-args';
import {
  applyCompression,
  defaultGifSettings,
  defaultVideoSettings,
  resolveVideoOutput,
  type ResolvedMovie,
} from '../shared/render-presets';
import type { GifRenderSettings, VideoRenderSettings } from '../shared/render';

const CPU = [
  'libx264',
  'libx265',
  'prores_ks',
  'ffv1',
  'v210',
  'png',
  'rawvideo',
  'libvpx-vp9',
  'aac',
  'libopus',
  'pcm_s24le',
  'gif',
  'apng',
  'libwebp_anim',
];
const base = defaultVideoSettings({ width: 1920, height: 1080, fps: 30 });
const track = { path: 'C:/music/track01.wav', start: 1.5, duration: 6 };
const clip = { path: 'C:/clips/clip.mp4', start: 0, duration: 6 };

function video(settings: VideoRenderSettings, extra: { width?: number; height?: number } = {}) {
  const output = resolveVideoOutput(settings) as ResolvedMovie;
  const encoder = videoEncoderCandidates(output.codec, settings.advanced.encoder, CPU, 'win32')[0]!;
  const args = buildVideoArgs({
    settings,
    output,
    width: extra.width ?? settings.frame.width,
    height: extra.height ?? settings.frame.height,
    fps: 30,
    frameCount: 180,
    encoder,
    encoders: CPU,
    audio: track,
    clipAudio: clip,
    outputPath: 'C:/out/render.partial',
  });
  const flag = (name: string) => args[args.lastIndexOf(name) + 1];
  return { args, flag, joined: args.join(' '), graph: flag('-filter_complex') ?? '' };
}

describe('video encoders', () => {
  it('prefers CPU encoders and honours forced GPU families', () => {
    expect(videoEncoderCandidates('h264', 'auto', CPU, 'win32')).toEqual(['libx264']);
    const all = [...CPU, 'h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf', 'hevc_nvenc'];
    expect(videoEncoderCandidates('h264', 'auto', all, 'win32')).toEqual([
      'libx264',
      'h264_nvenc',
      'h264_amf',
      'h264_qsv',
      'h264_mf',
    ]);
    expect(videoEncoderCandidates('h264', 'amf', all, 'win32')[0]).toBe('h264_amf');
    expect(videoEncoderCandidates('hevc', 'auto', ['hevc_nvenc', 'hevc_mf'], 'win32')).toEqual([
      'hevc_nvenc',
      'hevc_mf',
    ]);
    expect(videoEncoderCandidates('h264', 'auto', ['h264_videotoolbox'], 'darwin')).toEqual([
      'h264_videotoolbox',
    ]);
    expect(videoEncoderCandidates('prores', 'auto', ['prores'], 'linux')).toEqual(['prores']);
  });

  it('formats NTSC rates exactly', () => {
    expect(formatRate(29.97)).toBe('30000/1001');
    expect(formatRate(23.976)).toBe('24000/1001');
    expect(formatRate(25)).toBe('25');
  });
});

describe('movie arguments', () => {
  it('pipes raw RGBA and encodes Web as capped H.264 with fast start', () => {
    const { args, flag, joined, graph } = video(base);
    expect(joined).toContain('-f rawvideo -pix_fmt rgba -s 1920x1080 -r 30 -i pipe:0');
    expect(flag('-c:v')).toBe('libx264');
    expect(flag('-crf')).toBe('22');
    expect(flag('-profile:v')).toBe('high');
    expect(flag('-level:v')).toBe('4.2');
    expect(flag('-maxrate')).toBe('12M');
    expect(flag('-bufsize')).toBe('24M');
    expect(flag('-pix_fmt')).toBe('yuv420p');
    expect(flag('-movflags')).toBe('+faststart');
    expect(flag('-g')).toBe('60');
    expect(flag('-colorspace')).toBe('bt709');
    expect(graph).toContain('scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]');
    expect(args.slice(-3)).toEqual(['-f', 'mp4', 'C:/out/render.partial']);
    // Audio: track at the range start, AAC 256k, normalized and trimmed.
    expect(joined).toContain('-ss 1.5 -t 6 -i C:/music/track01.wav');
    expect(graph).toContain('loudnorm=I=-14:TP=-1.5:LRA=11');
    expect(graph).toContain('atrim=0:6[aout]');
    expect(joined).toContain('-c:a aac -b:a 256k');
    expect(args).toContain('[aout]');
  });

  it('maps compression to CRF, depth and speed', () => {
    const highest = video(applyCompression({ ...base, format: 'mp4-hevc' }, 'highest'));
    expect([highest.flag('-c:v'), highest.flag('-crf'), highest.flag('-pix_fmt')]).toEqual([
      'libx265',
      '14',
      'yuv420p10le',
    ]);
    expect(highest.flag('-preset')).toBe('slow');
    expect(highest.flag('-tag:v')).toBe('hvc1');
    const small = video(applyCompression(base, 'small'));
    expect([small.flag('-crf'), small.flag('-profile:v'), small.flag('-preset')]).toEqual([
      '28',
      'main',
      'fast',
    ]);
    expect(small.args).not.toContain('-maxrate');
    const high10 = video(applyCompression(base, 'highest'));
    expect(high10.flag('-profile:v')).toBe('high10');
  });

  it('builds ProRes, FFV1, v210, PNG and raw masters', () => {
    const prores = video({
      ...applyCompression({ ...base, format: 'mov-prores' }, 'high'),
      audio: { ...base.audio, codec: 'pcm' },
    });
    expect([prores.flag('-c:v'), prores.flag('-profile:v'), prores.flag('-pix_fmt')]).toEqual([
      'prores_ks',
      '3',
      'yuv422p10le',
    ]);
    expect(prores.flag('-c:a')).toBe('pcm_s24le');
    expect(prores.args).not.toContain('-movflags');
    expect(prores.args.slice(-2, -1)).toEqual(['mov']);
    const overlay = video({ ...base, overlay: { ...base.overlay, enabled: true } });
    expect([
      overlay.flag('-profile:v'),
      overlay.flag('-pix_fmt'),
      overlay.flag('-alpha_bits'),
    ]).toEqual(['4', 'yuva444p10le', '16']);
    const ffv1 = video(applyCompression(base, 'lossless'));
    expect([ffv1.flag('-c:v'), ffv1.flag('-pix_fmt'), ffv1.flag('-f')]).toEqual([
      'ffv1',
      'bgr0',
      'matroska',
    ]);
    expect(ffv1.graph).not.toContain('out_color_matrix');
    expect(video(applyCompression(base, 'raw')).flag('-c:v')).toBe('v210');
    const png = video(
      applyCompression({ ...base, overlay: { ...base.overlay, enabled: true } }, 'lossless'),
    );
    expect([png.flag('-c:v'), png.flag('-pix_fmt')]).toEqual(['png', 'rgba']);
    const raw = video(
      applyCompression({ ...base, overlay: { ...base.overlay, enabled: true } }, 'raw'),
    );
    expect([raw.flag('-c:v'), raw.flag('-pix_fmt')]).toEqual(['rawvideo', 'argb']);
    const vp9 = video({ ...base, format: 'webm-vp9', overlay: { ...base.overlay, enabled: true } });
    expect([vp9.flag('-c:v'), vp9.flag('-pix_fmt'), vp9.flag('-c:a')]).toEqual([
      'libvpx-vp9',
      'yuva420p',
      'libopus',
    ]);
  });

  it('crops odd sizes for 4:2:0 and maps GPU encoders', () => {
    const odd = video({ ...base, frame: { ...base.frame, width: 1081, height: 1351 } });
    expect(odd.graph).toContain('crop=1080:1350:0:0');
    const nvenc = buildVideoArgs({
      settings: applyCompression(
        { ...base, format: 'mp4-hevc', advanced: { ...base.advanced, encoder: 'nvenc' } },
        'highest',
      ),
      output: {
        kind: 'movie',
        container: 'mp4',
        codec: 'hevc',
        alpha: false,
        extension: 'mp4',
        label: '',
      },
      width: 1920,
      height: 1080,
      fps: 30,
      frameCount: 30,
      encoder: 'hevc_nvenc',
      encoders: CPU,
      outputPath: 'out.mp4',
    }).join(' ');
    expect(nvenc).toContain('-c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 15 -b:v 0');
    expect(nvenc).toContain('-maxrate 250M -bufsize 500M -profile:v main10');
    expect(nvenc).toContain('-pix_fmt p010le');
  });

  it('mixes, fades and exports separate audio', () => {
    const mixed = video({
      ...base,
      audio: { ...base.audio, source: 'mix', normalize: false, fadeIn: 0.25, fadeOut: 0.5 },
    });
    expect(mixed.graph).toContain('amix=inputs=2');
    expect(mixed.graph).toContain('afade=t=in:st=0:d=0.25');
    expect(mixed.graph).toContain('afade=t=out:st=5.5:d=0.5');
    expect(mixed.graph).not.toContain('loudnorm');
    const silent = video({ ...base, audio: { ...base.audio, enabled: false } });
    expect(silent.args).not.toContain('-c:a');
    const wav = buildAudioFileArgs({
      audio: base.audio,
      clip,
      duration: 6,
      outputPath: 'C:/out/name_audio.wav',
    })!;
    expect(wav.join(' ')).toContain('-c:a pcm_s24le -ar 48000 -f wav C:/out/name_audio.wav');
    expect(wav.join(' ')).toContain('-i C:/clips/clip.mp4');
    expect(buildAudioFileArgs({ audio: base.audio, duration: 6, outputPath: 'x.wav' })).toBeNull();
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2']);
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
    expect(atempoChain(1.5)).toEqual(['atempo=1.5']);
  });

  it('applies each track level before mixing', () => {
    const track = { path: 'C:/music/song.wav', start: 0, duration: 6, volume: 0.25 };
    const clipSound = { path: 'C:/clips/clip.mp4', start: 0, duration: 6 };
    const plan = audioPlan({
      audio: { source: 'mix', normalize: false, fadeIn: 0, fadeOut: 0 },
      track,
      clip: clipSound,
      duration: 6,
      firstInput: 1,
    })!;
    expect(plan.filter).toContain('channel_layouts=stereo,volume=0.25[a0]');
    expect(plan.filter).toContain('channel_layouts=stereo[a1]');
    expect(plan.filter).toContain('amix=inputs=2');
  });
});

describe('loop arguments', () => {
  const gif = defaultGifSettings();
  function loop(settings: GifRenderSettings, extra: Partial<LoopArgsInput> = {}) {
    const args = buildLoopArgs({
      settings,
      inputPath: 'C:/tmp/frames.rgba',
      inputWidth: 480,
      inputHeight: 270,
      inputFps: 30,
      frameCount: 60,
      outputPath: 'C:/out/loop.partial',
      encoders: CPU,
      ...extra,
    });
    const flag = (name: string) => args[args.lastIndexOf(name) + 1];
    return { args, flag, graph: flag('-filter_complex') ?? '' };
  }

  it('builds the GIF palette graph', () => {
    const { graph, flag, args } = loop(gif);
    expect(args.join(' ')).toContain(
      '-f rawvideo -pix_fmt rgba -s 480x270 -r 30 -i C:/tmp/frames.rgba',
    );
    expect(graph).toContain('fps=15');
    expect(graph).toContain('palettegen=max_colors=256:stats_mode=full:reserve_transparent=0');
    expect(graph).toContain('paletteuse=dither=bayer:bayer_scale=3[out]');
    expect([flag('-c:v'), flag('-loop'), flag('-f')]).toEqual(['gif', '0', 'gif']);
    const changes = loop({
      ...gif,
      palette: 'changes',
      dither: 'sierra',
      transparent: true,
      colors: 64,
    });
    expect(changes.graph).toContain(
      'palettegen=max_colors=64:stats_mode=diff:reserve_transparent=1',
    );
    expect(changes.graph).toContain(
      'paletteuse=dither=sierra2_4a:diff_mode=rectangle:alpha_threshold=128',
    );
    const frame = loop({ ...gif, palette: 'frame', dither: 'floyd-steinberg' });
    expect(frame.graph).toContain('stats_mode=single');
    expect(frame.graph).toContain('paletteuse=dither=floyd_steinberg:new=1');
  });

  it('applies loop style, speed, smoothing and scaling', () => {
    expect(loop({ ...gif, loop: 'reverse' }).graph).toContain('[0:v]reverse');
    const boomerang = loop({ ...gif, loop: 'boomerang' }).graph;
    expect(boomerang).toContain('split[fwd][back]');
    expect(boomerang).toContain('reverse,trim=start_frame=1:end_frame=59,setpts=PTS-STARTPTS[rev]');
    expect(boomerang).toContain('[fwd][rev]concat=n=2:v=1:a=0[boom]');
    expect(loop({ ...gif, speed: 2 }).graph).toContain('setpts=PTS/2,fps=15');
    expect(loop({ ...gif, speed: 0.5, fps: 24, smoothing: 'blend' }).graph).toContain(
      'setpts=PTS/0.5,framerate=fps=24',
    );
    expect(loop({ ...gif, speed: 0.5, fps: 24, smoothing: 'motion' }).graph).toContain(
      'minterpolate=fps=24:mi_mode=mci',
    );
    expect(loop({ ...gif, smoothing: 'blend' }).graph).toContain('tblend=all_mode=average,fps=15');
    const alpha = loop({
      ...gif,
      speed: 0.5,
      fps: 24,
      smoothing: 'motion',
      transparent: true,
    }).graph;
    expect(alpha).toContain('alphaextract,framerate=fps=24');
    expect(alpha).toContain('alphamerge');
    expect(loop(gif, { overrides: { width: 240 } }).graph).toContain('scale=240:135:flags=lanczos');
    expect(loop({ ...gif, scaling: 'nearest' }, { overrides: { width: 240 } }).graph).toContain(
      'flags=neighbor',
    );
  });

  it('repeat flags follow each muxer', () => {
    expect(loopRepeatArgs('gif', 'forever')).toEqual(['-loop', '0']);
    expect(loopRepeatArgs('gif', 'once')).toEqual(['-loop', '-1']);
    expect(loopRepeatArgs('gif', '3')).toEqual(['-loop', '2']);
    expect(loopRepeatArgs('webp', 'once')).toEqual(['-loop', '1']);
    expect(loopRepeatArgs('apng', '3')).toEqual(['-plays', '3']);
    expect(loopRepeatArgs('mp4', '3')).toEqual([]);
  });

  it('builds WebP, APNG and MP4 loops', () => {
    const webp = loop({ ...gif, format: 'webp', repeat: 'once' }, { overrides: { quality: 60 } });
    expect([webp.flag('-c:v'), webp.flag('-quality'), webp.flag('-loop'), webp.flag('-f')]).toEqual(
      ['libwebp_anim', '60', '1', 'webp'],
    );
    const apng = loop({ ...gif, format: 'apng', transparent: true });
    expect([apng.flag('-c:v'), apng.flag('-pix_fmt'), apng.flag('-plays')]).toEqual([
      'apng',
      'rgba',
      '0',
    ]);
    const mp4 = loop(
      { ...gif, format: 'mp4', audio: true, speed: 2 },
      { audio: track, overrides: { crf: 27 } },
    );
    expect([mp4.flag('-c:v'), mp4.flag('-crf'), mp4.flag('-pix_fmt')]).toEqual([
      'libx264',
      '27',
      'yuv420p',
    ]);
    expect(mp4.args.join(' ')).toContain('-c:a aac -b:a 160k');
    // 60 frames at 30 fps, 2× speed → 1 s loop from 2 s of audio.
    expect(mp4.args.join(' ')).toContain('-ss 1.5 -t 2 -i C:/music/track01.wav');
    expect(mp4.graph).toContain('atempo=2');
    expect(mp4.graph).toContain('atrim=0:1[aout]');
  });

  it('plans size-limit retries that get smaller', () => {
    for (const format of ['gif', 'webp', 'apng', 'mp4'] as const) {
      const attempts = sizeLimitAttempts({ ...gif, format });
      expect(attempts.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < attempts.length; i++)
        expect(attempts[i]!.factor).toBeLessThanOrEqual(attempts[i - 1]!.factor + 1e-9);
      expect(attempts.at(-1)!.factor).toBeLessThan(0.35);
    }
    const tiny = { ...gif, colors: 64, fps: 12 as const, width: 240 };
    expect(describeOverrides(tiny, { colors: 32, fps: 10, width: 192 })).toBe(
      '64 → 32 colors, 12 → 10 fps, 240 → 192 px',
    );
  });
});

describe('ffmpeg errors', () => {
  it('explain common failures in plain language with the stderr tail', () => {
    const message = describeFfmpegError(
      'frame=  10 fps=0.0\n[out#0/mp4 @ 0x1] Error writing trailer: No space left on device\n',
      1,
    );
    expect(message).toMatch(/^The disk is full\. ffmpeg said: .*No space left on device/);
    expect(message).not.toContain('frame=');
    expect(describeFfmpegError('Cannot load nvcuda.dll\n', 1)).toContain('NVIDIA encoder');
    expect(describeFfmpegError('', 3)).toBe('ffmpeg stopped with an error (code 3).');
  });
});
