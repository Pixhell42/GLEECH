import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  createEffect,
  createProject,
  createTimeline,
  createLfo,
  evaluateEffectsAt,
  LFO_SHAPES,
  frameSeed,
  type ProjectState,
  type SolidEffect,
} from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import { encodeProject } from '../../main/project-file';
import { configureRendering } from '../gpu';
import { decodePng, encodePng } from '../png';
import { Session } from '../session';
import { charWidth } from '../style';
import { previewTimeline, type TimelinePreviewFrame } from '../timeline-preview';
import { exportTimeline } from '../timeline';
import { runTui } from './app';
import { Terminal } from './terminal';
import { TimelineTransport } from './timeline';
import { createTuiSettings, type TuiSettings } from './settings';

const pixels = Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
const png = encodePng({ width: 2, height: 2, pixels: pixels.buffer });
function project(): ProjectState {
  const solid = createEffect('solid', 'paint') as SolidEffect;
  return {
    ...createProject('Animation', 17),
    source: { id: 'source', name: 'blue.png', width: 2, height: 2, format: 'png', hasAlpha: false },
    timeline: {
      ...createTimeline({ fps: 2, duration: 1.5 }),
      loop: false,
      workArea: { start: 0.5, end: 1.5 },
      inOut: { start: 0, end: 1 },
    },
    effects: [
      {
        ...solid,
        params: { ...solid.params, content: 'color', fillColor: '#ff0000' },
        animation: {
          amount: {
            keys: [
              { t: 0, value: 0, interpolation: 'linear' },
              { t: 1, value: 1, interpolation: 'linear' },
            ],
          },
        },
      } as SolidEffect,
    ],
  };
}
function session(state = project(), path: string | null = null) {
  return Session.fromProjectBytes(
    encodeProject(state, new Map([['source', { png: Uint8Array.from(png).buffer }]])),
    path,
  );
}
const rgba = (frame: { pixels: ArrayBuffer }) => [...new Uint8Array(frame.pixels).slice(0, 4)];

beforeEach(() => {
  configureRendering({ renderer: 'cpu', skipUnsupportedShaders: false });
  vi.stubEnv('GLEECH_GRAPHICS', 'blocks');
});
afterEach(() => vi.unstubAllEnvs());

describe('timeline transport', () => {
  it('keeps seeks separate from the document and respects exclusive range ends', () => {
    const state = project();
    const transport = new TimelineTransport(state.timeline);
    transport.seek(99);
    expect(transport.frame).toBe(2);
    transport.cycleRange();
    expect(transport.rangeKind).toBe('work');
    transport.play();
    expect(transport.time).toBe(0.5);
    expect(transport.schedule()).toEqual({ times: [0.5, 1], fps: 2, endTime: 1.5 });
    transport.completed();
    expect(transport.playing).toBe(false);
    expect(transport.frame).toBe(2);
    transport.sync({ ...state.timeline!, loop: true });
    transport.completed();
    expect(transport.playing).toBe(true);
    expect(transport.time).toBe(0.5);
    expect(state.timeline).toEqual(project().timeline);
    transport.sync({ ...state.timeline!, workArea: null });
    expect(transport.rangeKind).toBe('whole');
    transport.sync(undefined);
    expect(transport.playing).toBe(false);
    expect(transport.frame).toBe(0);
  });

  it.each([24, 30, 60, 120])('caps %i FPS playback while sampling exact project frames', (fps) => {
    const transport = new TimelineTransport(createTimeline({ fps, duration: 1 }));
    transport.seek(1);
    transport.play();
    const plan = transport.schedule();
    expect(plan.fps).toBeLessThanOrEqual(15);
    expect(plan.times[0]).toBeCloseTo(1 / fps, 6);
    expect(plan.times.every((t) => Math.abs(t * fps - Math.round(t * fps)) < 0.0001)).toBe(true);
    expect(plan.times.at(-1)).toBeLessThan(1);
    expect(plan.endTime).toBe(1);
  });

  it('keeps rounded In/Out points on their exact project frame boundaries', () => {
    const transport = new TimelineTransport({
      ...createTimeline({ fps: 30, duration: 1 }),
      loop: false,
      inOut: { start: 0.066667, end: 0.066667 + 1 / 30 },
    });
    transport.rangeKind = 'inout';
    transport.play();
    expect(transport.frame).toBe(2);
    expect(transport.schedule().times).toEqual([0.066667]);
    transport.completed();
    expect(transport.frame).toBe(2);
  });
});

describe('shared runner previews', () => {
  it.each(LFO_SHAPES)(
    'renders saved $label LFO modulation through the shared runner',
    async ({ value: shape }) => {
      const state = project();
      const solid = state.effects[0]!;
      const doc = session({
        ...state,
        effects: [
          {
            ...solid,
            animation: {
              amount: {
                keys: [],
                modulators: [
                  { ...createLfo('shape'), shape, sync: false, depth: 1, combine: 'add' },
                ],
              },
            },
          } as SolidEffect,
        ],
      });
      const frames: TimelinePreviewFrame[] = [];
      await previewTimeline(doc, doc.state, [0, 0.5, 1], {
        onFrame(frame) {
          frames.push(frame);
        },
      });
      const { renderHeadless } = await import('../engine');
      for (const frame of frames) {
        const expected = await renderHeadless({
          source: await doc.sourceImage(),
          effects: evaluateEffectsAt(doc.state.effects, frame.time, { bpm: 120, seed: 17 }),
          masterSeed: 17,
        });
        expect(frame.image.pixels).toEqual(expected.image.pixels);
      }
      expect(doc.dirty).toBe(false);
    },
  );
  it('matches exported animation pixels at original timeline times and keeps raw frames', async () => {
    const doc = session();
    const frames: TimelinePreviewFrame[] = [];
    await previewTimeline(doc, doc.state, [0, 0.5, 1], {
      maxDimension: 64,
      onFrame: (frame) => {
        frames.push(frame);
      },
    });
    expect(frames.map((f) => rgba(f.image))).toEqual([
      [0, 0, 255, 255],
      [128, 0, 128, 255],
      [255, 0, 0, 255],
    ]);
    expect(frames.map((f) => f.time)).toEqual([0, 0.5, 1]);
    expect(frames.every((f) => rgba(f.original).join() === '0,0,255,255')).toBe(true);
    expect(doc.dirty).toBe(false);
  });

  it('uses frame seeds and effect active ranges from the shared runner', async () => {
    const state = project();
    const effect = { ...createEffect('noise-grain', 'noise'), activeRange: { start: 0.5, end: 1 } };
    const doc = session({
      ...state,
      effects: [effect],
      timeline: {
        ...state.timeline!,
        seed: { mode: 'every-frame', every: 2 },
      },
    });
    const frames: TimelinePreviewFrame[] = [];
    await previewTimeline(doc, doc.state, [0, 0.5, 1], {
      onFrame: (frame) => {
        frames.push(frame);
      },
    });
    expect(rgba(frames[0]!.image)).toEqual([0, 0, 255, 255]);
    expect(rgba(frames[2]!.image)).toEqual([0, 0, 255, 255]);
    const { renderHeadless } = await import('../engine');
    const expected = await renderHeadless({
      source: await doc.sourceImage(),
      effects: [effect],
      masterSeed: frameSeed(17, doc.state.timeline!.seed, 1),
    });
    expect(frames[1]!.image.pixels).toEqual(expected.image.pixels);
  });

  it('cancels a paced stream without delivering more frames', async () => {
    const doc = session();
    const abort = new AbortController();
    const frames: number[] = [];
    await expect(
      previewTimeline(doc, doc.state, [0, 0.5, 1], {
        paced: true,
        signal: abort.signal,
        onFrame(frame) {
          frames.push(frame.time);
          abort.abort();
        },
      }),
    ).rejects.toBeInstanceOf(RenderCancelledError);
    expect(frames).toEqual([0]);
  });

  it('holds the final frame until the playback range ends and aborts that wait', async () => {
    const doc = session();
    const abort = new AbortController();
    let done = false;
    let displayed = false;
    const pending = previewTimeline(doc, doc.state, [1], {
      paced: true,
      endTime: 2,
      signal: abort.signal,
      onFrame() {
        displayed = true;
      },
    }).finally(() => {
      done = true;
    });
    // Attach the rejection handler before aborting the finishing encoder.
    const rejected = expect(pending).rejects.toBeInstanceOf(RenderCancelledError);
    await vi.waitFor(() => expect(displayed).toBe(true));
    expect(done).toBe(false);
    abort.abort();
    await rejected;
  });

  it('keeps relative clip links attached to the original project after Save As', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-tui-links-'));
    try {
      const state = project();
      const doc = session(
        {
          ...state,
          timeline: {
            ...state.timeline!,
            video: {
              path: 'clip ü #1.mp4',
              name: 'clip',
              width: 2,
              height: 2,
              fps: 2,
              duration: 1,
              hasAudio: false,
            },
          },
        },
        join(root, 'original', 'animation.gleech'),
      );
      expect(doc.state.timeline?.video?.path).toBe(join(root, 'original', 'clip ü #1.mp4'));
      await doc.save(join(root, 'moved.gleech'));
      const reopened = await Session.open(doc.path!);
      expect(reopened.state.timeline?.video?.path).toBe(join(root, 'original', 'clip ü #1.mp4'));
    } finally {
      expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });
});

/** Decode the real screen's ANSI diff output, so assertions see the current UI. */
function terminalHarness(
  doc: Session,
  columns = 120,
  rows = 30,
  settings: TuiSettings | false = false,
) {
  const input = new PassThrough();
  let x = 0,
    y = 0;
  let cells = Array.from({ length: rows }, () => Array<string>(columns).fill(' '));
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        // eslint-disable-next-line no-control-regex -- terminal screen protocol
        for (const match of String(chunk).matchAll(/\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]+|\x1b./gu)) {
          const part = match[0];
          if (part.startsWith('\x1b')) {
            if (part.endsWith('H')) {
              const coords = part.slice(2, -1).split(';').map(Number);
              y = (coords[0] || 1) - 1;
              x = (coords[1] || 1) - 1;
            } else if (part === '\x1b[2J') cells = cells.map((row) => row.map(() => ' '));
          } else
            for (const char of part) {
              if (char === '\n') {
                y++;
                x = 0;
                continue;
              }
              if (char === '\r') {
                x = 0;
                continue;
              }
              if (cells[y] && x < columns) cells[y]![x] = char;
              x += charWidth(char.codePointAt(0)!);
            }
        }
        callback();
      },
    }),
    { columns, rows },
  );
  const listeners = process.listenerCount('SIGINT');
  const running = runTui(
    doc,
    false,
    new Terminal(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream),
    { settings },
  );
  const text = () => cells.map((row) => row.join('')).join('\n');
  const key = (value: string) => {
    input.write(Buffer.from(value));
  };
  const see = (value: string | RegExp) =>
    vi.waitFor(
      () => {
        if (typeof value === 'string') expect(text()).toContain(value);
        else expect(text()).toMatch(value);
      },
      { timeout: 4000, interval: 10 },
    );
  return {
    key,
    text,
    see,
    running,
    async close() {
      // A process signal also verifies cleanup while dialogs/playback are active.
      process.emit('SIGINT');
      expect(await running).toBe(130);
      expect(process.listenerCount('SIGINT')).toBe(listeners);
      expect(input.listenerCount('data')).toBe(0);
      expect(output.listenerCount('resize')).toBe(0);
      input.destroy();
      output.destroy();
    },
  };
}
const right = '\x1b[C',
  down = '\x1b[B',
  enter = '\r',
  esc = '\x1b';

describe('interactive TUI timeline', () => {
  it('exposes Settings, update preferences and fixed support links without changing the timeline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-tui-settings-ui-'));
    const opened: string[] = [];
    const settings = createTuiSettings({
      folder: root,
      discover: async () => null,
      open: async (url) => {
        opened.push(url);
      },
    });
    await settings.ready;
    const doc = session();
    const before = doc.state;
    const tui = terminalHarness(doc, 120, 30, settings);
    try {
      await tui.see('TIMELINE');
      tui.key(right);
      await tui.see('0.500s  frame 2/3');
      tui.key(',');
      await tui.see('SETTINGS');
      await tui.see('Automatic update notifications: On');
      tui.key(right + enter);
      await tui.see('Automatic update notifications: Off');
      tui.key(down + enter);
      await tui.see('You’re up to date.');
      tui.key('2');
      await tui.see('Cash App · $Pixhell');
      tui.key(right + enter);
      await vi.waitFor(() => expect(opened).toContain('https://cash.app/$Pixhell'));
      tui.key('3' + right + enter);
      await vi.waitFor(() =>
        expect(opened).toContain('https://github.com/Pixhell42/GLEECH/issues/new?template=bug.yml'),
      );
      tui.key('4' + right + enter);
      await vi.waitFor(() => expect(opened).toContain('https://discord.gg/b7Mq8fjvk'));
      tui.key('5');
      await tui.see('Third-party notices');
      tui.key(esc);
      await tui.see('0.500s  frame 2/3');
      expect(doc.state).toBe(before);
      expect(doc.dirty).toBe(false);
      expect(doc.service.canUndo()).toBe(false);
    } finally {
      await tui.close();
      expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps Settings keyboard navigation usable in a 72 by 20 terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-tui-settings-small-'));
    const settings = createTuiSettings({ folder: root, discover: async () => null });
    await settings.ready;
    const tui = terminalHarness(session(), 72, 20, settings);
    try {
      await tui.see('TIMELINE');
      tui.key('\x1bOQ');
      await tui.see('SETTINGS');
      tui.key('2');
      await tui.see('Cash App · $Pixhell');
      tui.key('\x1b[6~');
      await tui.see('Bitcoin address:');
      tui.key('1' + right + down.repeat(4) + enter);
      await tui.see('WHAT’S NEW');
      tui.key(esc + esc);
      await tui.see('TIMELINE');
    } finally {
      await tui.close();
      expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });
  it('uses plain t for modes and Shift+T for Add Shader in either mode', async () => {
    const doc = session();
    const state = doc.state;
    const tui = terminalHarness(doc);
    try {
      await tui.see('TIMELINE');
      tui.key('T');
      await tui.see('ADD SHADER');
      expect(doc.state).toBe(state);
      tui.key(esc);
      tui.key('t');
      await tui.see('Image mode');
      await vi.waitFor(() => expect(tui.text()).not.toContain('TIMELINE'));
      tui.key('T');
      await tui.see('ADD SHADER');
      tui.key(esc);
      tui.key('t');
      await tui.see('TIMELINE');
      expect(tui.text()).not.toContain('ADD SHADER');
      expect(doc.state).toBe(state);
      expect(doc.dirty).toBe(false);
      expect(doc.service.canUndo()).toBe(false);
    } finally {
      await tui.close();
    }
  });

  it('opens saved timelines, seeks by key and mouse, and pauses playback for export', async () => {
    const doc = session();
    const tui = terminalHarness(doc);
    try {
      await tui.see('frame 1/3');
      tui.key(right);
      await tui.see('0.500s  frame 2/3');
      tui.key('\x1b[F');
      await tui.see('1.000s  frame 3/3');
      tui.key('g');
      await tui.see('GO TO TIME');
      tui.key('\x15' + '0' + enter);
      await tui.see('0.000s  frame 1/3');
      // Scrub to the final frame, then drag back to the beginning.
      tui.key('\x1b[<0;118;28M');
      await tui.see('frame 3/3');
      tui.key('\x1b[<32;3;28M\x1b[<0;3;28m');
      await tui.see('frame 1/3');
      tui.key(' ');
      await tui.see('PLAY');
      await tui.see('frame 2/3');
      tui.key('e');
      await tui.see('EXPORT TIMELINE');
      expect(tui.text()).toContain('PAUSED');
      tui.key(esc);
      expect(doc.dirty).toBe(false);
      expect(doc.service.canUndo()).toBe(false);
    } finally {
      await tui.close();
    }
  });

  it('edits In/Out and work ranges with undo, and keeps mode switches out of history', async () => {
    const doc = session();
    const tui = terminalHarness(doc, 72, 20);
    try {
      await tui.see('TIMELINE');
      tui.key(right + 'i' + right + 'o' + 'w');
      await vi.waitFor(() =>
        expect(doc.state.timeline?.workArea).toEqual({ start: 0.5, end: 1.5 }),
      );
      expect(doc.state.timeline?.inOut).toEqual({ start: 0.5, end: 1.5 });
      tui.key('W');
      expect(doc.state.timeline?.workArea).toBeNull();
      tui.key('u');
      expect(doc.state.timeline?.workArea).toEqual({ start: 0.5, end: 1.5 });
      const state = doc.state;
      tui.key('t');
      await tui.see('Image mode');
      tui.key('t');
      await tui.see('TIMELINE');
      expect(doc.state).toBe(state);
      tui.key('e');
      await tui.see('EXPORT TIMELINE');
      tui.key(esc);
      tui.key('?');
      await tui.see('KEYS');
      tui.key(down.repeat(8));
      expect(tui.text()).toContain('KEYS');
    } finally {
      await tui.close();
    }
  });

  it('creates an undoable timeline on an image and restores image mode on undo', async () => {
    const doc = await Session.fromImageBytes(png, 'blue.png');
    const tui = terminalHarness(doc);
    try {
      await tui.see('GLEECH');
      tui.key('t');
      await tui.see('frame 1/300');
      expect(doc.state.timeline).toBeDefined();
      tui.key('u');
      await vi.waitFor(() => expect(doc.state.timeline).toBeUndefined());
      await vi.waitFor(() => expect(tui.text()).not.toContain('TIMELINE'));
    } finally {
      await tui.close();
    }
  });

  it('exports animated PNG pixels via the real settings dialog, including a nonzero range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-tui-export-'));
    const doc = session(project(), join(root, 'animation ü #1.gleech'));
    const tui = terminalHarness(doc);
    try {
      await tui.see('TIMELINE');
      tui.key('r' + 'e');
      await tui.see('EXPORT TIMELINE');
      // Click Format twice: MP4 -> GIF -> PNG, exercising modal mouse capture.
      tui.key('\x1b[<0;40;10M');
      await tui.see('GIF');
      tui.key('\x1b[<0;40;10M');
      await tui.see('PNG sequence');
      expect(tui.text()).toContain('Work area');
      tui.key(down.repeat(6) + enter);
      await tui.see('Exported 2 frames');
      const folder = join(root, 'animation ü #1-frames');
      const names = (await readdir(folder)).sort();
      expect(names).toHaveLength(2);
      expect(
        await Promise.all(
          names.map(async (name) => rgba(decodePng(await readFile(join(folder, name))))),
        ),
      ).toEqual([
        [128, 0, 128, 255],
        [255, 0, 0, 255],
      ]);
      // Replacing existing output requires a second Enter, and Escape preserves it.
      const before = await readFile(join(folder, names[0]!));
      tui.key('e');
      await tui.see('EXPORT TIMELINE');
      tui.key('\x1b[D' + down.repeat(6) + enter);
      await tui.see('Output exists.');
      tui.key(esc);
      expect(await readFile(join(folder, names[0]!))).toEqual(before);
      expect((await readdir(root)).some((n) => n.startsWith('.gleech-timeline-'))).toBe(false);
    } finally {
      await tui.close();
      expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exports unsaved timeline documents through the same host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-tui-unsaved-'));
    try {
      const result = await exportTimeline(session(), {
        timeline: true,
        format: 'png',
        output: join(root, 'frames'),
      });
      expect(result.input).toBeNull();
      expect(result.frames).toBe(3);
    } finally {
      expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exports the selected timeline frame as an image, and returns from nested settings prompts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-tui-frame-'));
    const tui = terminalHarness(session());
    try {
      await tui.see('TIMELINE');
      tui.key(right + 'e');
      await tui.see('EXPORT TIMELINE');
      tui.key(down.repeat(2) + enter);
      await tui.see('OUTPUT FRAME RATE');
      tui.key(esc);
      await tui.see('EXPORT TIMELINE');
      tui.key(enter);
      await tui.see('OUTPUT FRAME RATE');
      tui.key('\x15' + '0' + enter);
      await tui.see('EXPORT TIMELINE');
      tui.key(down.repeat(4) + enter);
      await tui.see('--fps must be');
      tui.key(esc);
      tui.key('E');
      await tui.see('EXPORT IMAGE');
      const path = join(root, 'selected.png');
      tui.key('\x15' + '\x1b[200~' + path + '\x1b[201~' + enter);
      await tui.see('Exported selected.png');
      expect(rgba(decodePng(await readFile(path)))).toEqual([128, 0, 128, 255]);
    } finally {
      await tui.close();
      expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cancels an export from the keyboard, blocks background edits and preserves prior frames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gleech-tui-cancel-'));
    const state = project();
    const doc = session(
      { ...state, timeline: { ...state.timeline!, fps: 30, duration: 60 } },
      join(root, 'animation.gleech'),
    );
    const folder = join(root, 'animation-frames');
    await exportTimeline(doc, { timeline: true, format: 'png', output: folder, end: '0.1' });
    const names = (await readdir(folder)).sort();
    const before = await Promise.all(names.map((name) => readFile(join(folder, name))));
    const tui = terminalHarness(doc);
    try {
      await tui.see('TIMELINE');
      tui.key('e');
      await tui.see('EXPORT TIMELINE');
      tui.key('\x1b[D' + down.repeat(6) + enter);
      await tui.see('Output exists.');
      tui.key(enter);
      await tui.see('EXPORTING TIMELINE');
      tui.key('i' + '\x1b[<0;4;4M'); // Underlying stack/timeline must not receive these.
      tui.key(esc);
      await tui.see('Timeline export cancelled.');
      expect(doc.dirty).toBe(false);
      expect((await readdir(folder)).sort()).toEqual(names);
      expect(await Promise.all(names.map((name) => readFile(join(folder, name))))).toEqual(before);
      expect((await readdir(root)).some((n) => n.startsWith('.gleech-timeline-'))).toBe(false);
    } finally {
      await tui.close();
      expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
