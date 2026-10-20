import { describe, expect, it } from 'vitest';
import {
  fitFrameSize,
  fpsRational,
  parseFfmpegProbe,
  parseProgressDuration,
  sourceColorMatrix,
  videoReaderArgs,
} from './media-probe';

// Real `ffmpeg -hide_banner -i <file>` stderr from ffmpeg 8.1 (Windows) and 6.1
// (Ubuntu), for clips made with `-f lavfi -i testsrc=…` and `sine=…`.
const MP4_H264_AAC = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf60.16.100
  Duration: 00:00:02.00, start: 0.000000, bitrate: 127 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 45 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      encoder         : Lavc60.31.102 libx264
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)
    Metadata:
      handler_name    : SoundHandler
At least one output file must be specified
`;

const ROTATED_FFMPEG_8 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'rotated.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf60.16.100
  Duration: 00:00:02.00, start: 0.000000, bitrate: 127 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 45 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      encoder         : Lavc60.31.102 libx264
    Side data:
      Display Matrix: rotation of 90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)
    Metadata:
      handler_name    : SoundHandler
At least one output file must be specified
`;

const ROTATED_FFMPEG_6 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'rotated.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf60.16.100
  Duration: 00:00:02.00, start: 0.000000, bitrate: 127 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 45 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      vendor_id       : [0][0][0][0]
      encoder         : Lavc60.31.102 libx264
    Side data:
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)
    Metadata:
      handler_name    : SoundHandler
      vendor_id       : [0][0][0][0]
At least one output file must be specified
`;

const NTSC = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'ntsc.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf60.16.100
  Duration: 00:00:02.00, start: 0.000000, bitrate: 51 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 44 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
    Metadata:
      handler_name    : VideoHandler
      encoder         : Lavc60.31.102 libx264
At least one output file must be specified
`;

const ANAMORPHIC = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'anamorphic.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
    compatible_brands: isomiso2avc1mp41
    encoder         : Lavf60.16.100
  Duration: 00:00:01.00, start: 0.000000, bitrate: 109 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 720x480 [SAR 8:9 DAR 4:3], 99 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
    Metadata:
      handler_name    : VideoHandler
      encoder         : Lavc60.31.102 libx264
At least one output file must be specified
`;

const GIF = `Input #0, gif, from 'anim.gif':
  Duration: 00:00:01.00, start: 0.000000, bitrate: 153 kb/s
  Stream #0:0: Video: gif, bgra, 160x120 [SAR 64:64 DAR 4:3], 10 fps, 10 tbr, 100 tbn
At least one output file must be specified
`;

const WEBM = `Input #0, matroska,webm, from 'clip.webm':
  Metadata:
    ENCODER         : Lavf60.16.100
  Duration: 00:00:02.01, start: 0.000000, bitrate: 154 kb/s
  Stream #0:0: Video: vp9 (Profile 1), gbrp(pc, gbr/unknown/unknown, progressive), 320x240, SAR 1:1 DAR 4:3, 24 fps, 24 tbr, 1k tbn
    Metadata:
      ENCODER         : Lavc60.31.102 libvpx-vp9
      DURATION        : 00:00:02.000000000
  Stream #0:1: Audio: opus, 48000 Hz, stereo, fltp
    Metadata:
      ENCODER         : Lavc60.31.102 libopus
      DURATION        : 00:00:02.008000000
At least one output file must be specified
`;

const PRORES = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mov':
  Metadata:
    major_brand     : qt
    minor_version   : 512
    compatible_brands: qt
    encoder         : Lavf60.16.100
  Duration: 00:00:01.00, start: 0.000000, bitrate: 5564 kb/s
  Stream #0:0[0x1]: Video: prores (4444) (ap4h / 0x68347061), yuv444p12le(progressive), 320x240, 5557 kb/s, SAR 1:1 DAR 4:3, 24 fps, 24 tbr, 12288 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      vendor_id       : FFMP
      encoder         : Lavc60.31.102 prores_ks
At least one output file must be specified
`;

const MP3_WITH_COVER = `Input #0, mp3, from 'covered.mp3':
  Metadata:
    encoder         : Lavf60.16.100
  Duration: 00:00:03.00, start: 0.025056, bitrate: 66 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, mono, fltp, 64 kb/s, start 0.025057
  Stream #0:1: Video: png, rgb24(pc, gbr/unknown/unknown), 64x64 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn, start 0.025056 (attached pic)
    Metadata:
      comment         : Other
At least one output file must be specified
`;

const WAV_GUESSED_LAYOUT = `[aist#0:0/pcm_s16le @ 0x613592c59380] Guessed Channel Layout: stereo
Input #0, wav, from 'tone.wav':
  Metadata:
    encoder         : Lavf60.16.100
  Duration: 00:00:03.00, bitrate: 1411 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, 2 channels, s16, 1411 kb/s
At least one output file must be specified
`;

const SURROUND = `Input #0, wav, from 'surround.wav':
  Metadata:
    encoder         : Lavf60.16.100
  Duration: 00:00:01.00, bitrate: 4608 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, 5.1, s16, 4608 kb/s
At least one output file must be specified
`;

const BROKEN = `[in#0 @ 0000026f6fa61340] Format mov,mp4,m4a,3gp,3g2,mj2 detected only with low score of 1, misdetection possible!
[in#0 @ 0000026f6fa61340] moov atom not found
[in#0 @ 0000026f6fa96780] Error opening input: Invalid data found when processing input
Error opening input file broken.mp4.
Error opening input files: Invalid data found when processing input
`;

const PROGRESS = `frame=90
fps=0.00
stream_0_0_q=-1.0
bitrate=N/A
total_size=N/A
out_time_us=3000000
out_time_ms=3000000
out_time=00:00:03.000000
dup_frames=0
drop_frames=0
speed=1.3e+03x
progress=end
`;

describe('parseFfmpegProbe', () => {
  it('reads video and audio streams', () => {
    expect(parseFfmpegProbe(MP4_H264_AAC)).toEqual({
      duration: 2,
      video: {
        width: 320,
        height: 240,
        fps: 25,
        codec: 'h264',
        rotation: 0,
        codedHeight: 240,
        colorMatrix: null,
      },
      audio: { sampleRate: 44100, channels: 1, codec: 'aac' },
      error: null,
    });
  });

  it('swaps width and height for portrait rotation in both ffmpeg spellings', () => {
    expect(parseFfmpegProbe(ROTATED_FFMPEG_8).video).toMatchObject({
      width: 240,
      height: 320,
      rotation: 270,
    });
    expect(parseFfmpegProbe(ROTATED_FFMPEG_6).video).toMatchObject({
      width: 240,
      height: 320,
      rotation: 90,
    });
  });

  it('keeps conventional NTSC rates and applies non-square pixels', () => {
    expect(parseFfmpegProbe(NTSC).video?.fps).toBe(29.97);
    expect(parseFfmpegProbe(ANAMORPHIC).video).toMatchObject({ width: 640, height: 480 });
    expect(
      parseFfmpegProbe(NTSC.replace('29.97 fps, 29.97 tbr', '23.98 fps, 23.98 tbr')).video?.fps,
    ).toBe(23.976);
  });

  it('reads GIF, WebM, ProRes and CRLF output', () => {
    expect(parseFfmpegProbe(GIF)).toMatchObject({
      duration: 1,
      video: { width: 160, height: 120, fps: 10, codec: 'gif' },
      audio: null,
    });
    expect(parseFfmpegProbe(WEBM.replace(/\n/g, '\r\n'))).toMatchObject({
      duration: 2.01,
      video: { width: 320, height: 240, fps: 24, codec: 'vp9' },
      audio: { sampleRate: 48000, channels: 2, codec: 'opus' },
    });
    expect(parseFfmpegProbe(PRORES).video).toMatchObject({ codec: 'prores', width: 320, fps: 24 });
  });

  it('falls back to stream duration tags and tbr when the header lacks them', () => {
    const live = WEBM.replace('Duration: 00:00:02.01', 'Duration: N/A').replace('24 fps, ', '');
    const probe = parseFfmpegProbe(live);
    expect(probe.duration).toBeCloseTo(2.008, 6);
    expect(probe.video?.fps).toBe(24);
    const untagged = parseFfmpegProbe(
      live.replace(/\s+DURATION\s+:.*$/gm, '').replace('24 tbr', '1k tbr'),
    );
    expect(untagged.duration).toBeNull();
    // A bare "1k tbr" is a timebase, not a frame rate.
    expect(untagged.video?.fps).toBe(30);
  });

  it('ignores cover art and reads channel layouts', () => {
    const covered = parseFfmpegProbe(MP3_WITH_COVER);
    expect(covered.video).toBeNull();
    expect(covered.audio).toEqual({ sampleRate: 44100, channels: 1, codec: 'mp3' });
    expect(parseFfmpegProbe(WAV_GUESSED_LAYOUT).audio).toEqual({
      sampleRate: 44100,
      channels: 2,
      codec: 'pcm_s16le',
    });
    expect(parseFfmpegProbe(SURROUND).audio?.channels).toBe(6);
    expect(parseFfmpegProbe(SURROUND.replace('5.1', '7.1.4')).audio?.channels).toBe(12);
  });

  it('reports why ffmpeg could not open a file', () => {
    expect(parseFfmpegProbe(BROKEN)).toEqual({
      duration: null,
      video: null,
      audio: null,
      error: 'Invalid data found when processing input',
    });
  });
});

describe('color matrix', () => {
  it('reads color tags and picks Chromium’s matrix for untagged video', () => {
    const tagged = MP4_H264_AAC.replace('yuv420p(progressive)', 'yuv420p(tv, bt709, progressive)');
    expect(parseFfmpegProbe(tagged).video?.colorMatrix).toBe('bt709');
    const mixed = MP4_H264_AAC.replace(
      'yuv420p(progressive)',
      'yuvj420p(pc, smpte170m/bt709/iec61966-2-1, progressive)',
    );
    expect(parseFfmpegProbe(mixed).video?.colorMatrix).toBe('smpte170m');
    expect(parseFfmpegProbe(WEBM).video?.colorMatrix).toBe('gbr');
    expect(parseFfmpegProbe(PRORES).video?.colorMatrix).toBeNull();
    expect(sourceColorMatrix({ colorMatrix: 'bt709', codedHeight: 480 })).toBe('auto');
    expect(sourceColorMatrix({ colorMatrix: null, codedHeight: 576 })).toBe('bt601');
    expect(sourceColorMatrix({ colorMatrix: null, codedHeight: 720 })).toBe('bt709');
    // A portrait phone clip is stored landscape: the stored height decides.
    expect(parseFfmpegProbe(ROTATED_FFMPEG_8).video?.codedHeight).toBe(240);
  });
});

describe('decode helpers', () => {
  it('reads the measured duration from -progress output', () => {
    expect(parseProgressDuration(PROGRESS)).toBe(3);
    expect(parseProgressDuration('progress=end\n')).toBeNull();
  });

  it('writes exact ffmpeg frame rates', () => {
    expect(fpsRational(30)).toBe('30/1');
    expect(fpsRational(30000 / 1001)).toBe('30000/1001');
    expect(fpsRational(29.97)).toBe('2997/100');
    expect(fpsRational(23.976)).toBe('2997/125');
  });

  it('fits frames without upscaling', () => {
    expect(fitFrameSize(1920, 1080, 960)).toEqual({ width: 960, height: 540 });
    expect(fitFrameSize(1080, 1920, 640)).toEqual({ width: 360, height: 640 });
    expect(fitFrameSize(320, 240, 4096)).toEqual({ width: 320, height: 240 });
  });

  it('builds a reader that seeks before the start and picks frames by time', () => {
    const args = videoReaderArgs('C:\\clips\\a.mp4', {
      start: 5,
      fps: 30,
      count: 90,
      width: 640,
      height: 360,
    });
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '4.000000']);
    expect(args[args.indexOf('-i') + 1]).toBe('file:C:\\clips\\a.mp4');
    expect(args[args.indexOf('-vf') + 1]).toBe(
      'settb=AVTB,setpts=PTS-1000244.141,fps=fps=30/1:start_time=0:round=up,' +
        'scale=640:360:flags=bicubic+accurate_rnd+full_chroma_int:in_color_matrix=auto,format=rgba',
    );
    expect(args.slice(-7)).toEqual([
      '-frames:v',
      '90',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1',
    ]);
    // Near the start there is nothing earlier to seek to.
    expect(
      videoReaderArgs('/a.mp4', { start: 0.25, fps: 24, count: 1, width: 2, height: 2 }),
    ).not.toContain('-ss');
  });
});
