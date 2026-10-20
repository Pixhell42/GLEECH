import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCommandService } from '@gleech/command-service';
import {
  AUDIO_BANDS,
  INTERPOLATIONS,
  LFO_DIVISIONS,
  LFO_SHAPES,
  MAX_TIMELINE_SECONDS as MODEL_MAX_SECONDS,
  createEffect,
  createProject,
  createTimeline,
} from '@gleech/project-model';
import { createMcpCommands } from './commands';
import {
  AUDIO_BAND_VALUES,
  KEY_INTERPOLATIONS,
  LFO_DIVISION_VALUES,
  LFO_SHAPE_VALUES,
  MAX_TIMELINE_SECONDS,
  isMutation,
  renderOutputIsFolder,
  requestSchema,
  requiresFullControl,
  type McpRequest,
} from './protocol';
import { createGleechMcpServer } from './server';

const modId = 'b1d7e0b4-6a43-4a49-9d1b-6d2f0d7a7c11';
function setup(withTimeline = false) {
  const commands = createCommandService({
    ...createProject('Timeline test', 8172),
    source: {
      id: 'source',
      name: 'source.png',
      width: 100,
      height: 50,
      format: 'png',
      hasAlpha: true,
    },
    effects: [
      createEffect('rgb-split', 'bottom'),
      createEffect('gradient-map', 'top'),
      createEffect('system-crash', 'text'),
    ],
    ...(withTimeline ? { timeline: createTimeline({ fps: 10, duration: 4 }) } : {}),
  });
  const adapter = createMcpCommands(commands, () => modId);
  const apply = (...operations: unknown[]) =>
    adapter.execute({ action: 'apply_operations', operations });
  return { commands, adapter, apply };
}
const effect = (commands: ReturnType<typeof setup>['commands'], id: string) =>
  commands.getState().effects.find((entry) => entry.instanceId === id)!;

describe('MCP timeline protocol', () => {
  it('mirrors the project-model timeline enumerations and limits', () => {
    expect(KEY_INTERPOLATIONS).toEqual(INTERPOLATIONS.map((option) => option.value));
    expect(LFO_SHAPE_VALUES).toEqual(LFO_SHAPES.map((option) => option.value));
    expect(LFO_DIVISION_VALUES).toEqual(LFO_DIVISIONS.map((option) => option.value));
    expect(AUDIO_BAND_VALUES).toEqual(AUDIO_BANDS.map((option) => option.value));
    expect(MAX_TIMELINE_SECONDS).toBe(MODEL_MAX_SECONDS);
  });
  it('parses timeline operations with UI defaults and rejects malformed values', () => {
    const parsed = requestSchema.parse({
      action: 'apply_operations',
      operations: [
        {
          action: 'set_keyframes',
          instanceId: 'a',
          parameter: 'amount',
          keys: [{ time: 1, value: 0.5 }],
        },
        {
          action: 'set_modulators',
          instanceId: 'a',
          parameter: 'amount',
          modulators: [{ kind: 'lfo' }],
        },
      ],
    });
    expect(parsed).toMatchObject({
      operations: [
        { keys: [{ time: 1, value: 0.5, interpolation: 'ease-in-out' }], merge: false },
        {
          modulators: [
            { kind: 'lfo', enabled: true, shape: 'sine', sync: true, division: '1/2', depth: 0.12 },
          ],
        },
      ],
    });
    for (const operation of [
      { action: 'set_keyframes', instanceId: 'a', parameter: 'amount', keys: [] },
      { action: 'set_keyframes', instanceId: 'a', parameter: '__proto__', keys: null },
      {
        action: 'set_keyframes',
        instanceId: 'a',
        parameter: 'amount',
        keys: [{ time: 1, value: 1, inHandle: { dt: 0.5, dv: 0 } }],
      },
      {
        action: 'set_keyframes',
        instanceId: 'a',
        parameter: 'amount',
        keys: [{ time: -1, value: 1 }],
      },
      {
        action: 'set_keyframes',
        instanceId: 'a',
        parameter: 'amount',
        keys: [{ time: 1, value: 1, interpolation: 'wobble' }],
      },
      {
        action: 'set_modulators',
        instanceId: 'a',
        parameter: 'amount',
        modulators: [{ kind: 'audio', band: 'custom', lowHz: 500, highHz: 100 }],
      },
      {
        action: 'set_modulators',
        instanceId: 'a',
        parameter: 'amount',
        modulators: [{ kind: 'lfo', depth: 2 }],
      },
      { action: 'set_active_range', instanceId: 'a', range: { start: 2, end: 1 } },
      { action: 'set_timeline', fps: 0 },
      { action: 'set_timeline', seed: { mode: 'sometimes' } },
      { action: 'set_timeline', invented: true },
    ])
      expect(
        requestSchema.safeParse({ action: 'apply_operations', operations: [operation] }).success,
      ).toBe(false);
  });
  it('validates playhead, render and status requests with clear messages and permissions', () => {
    expect(requestSchema.safeParse({ action: 'set_playhead' }).success).toBe(false);
    expect(requestSchema.safeParse({ action: 'set_playhead', frame: 1, time: 1 }).success).toBe(
      false,
    );
    const playhead = requestSchema.parse({ action: 'set_playhead', time: 1.5 });
    expect(isMutation(playhead)).toBe(true);
    expect(requiresFullControl(playhead)).toBe(false);

    const render = requestSchema.parse({ action: 'render_video', path: 'C:\\out\\clip.mp4' });
    expect(render).toMatchObject({ tab: 'video', overrides: {}, overwrite: false, wait: false });
    expect(requiresFullControl(render)).toBe(true);
    const unknown = requestSchema.safeParse({
      action: 'render_video',
      path: 'C:\\out\\clip.mp4',
      overrides: { frame: { width: 1280, depth: 3 }, sparkle: true },
    });
    expect(unknown.success).toBe(false);
    const messages = unknown.error!.issues.map((issue) => issue.message).join('\n');
    expect(messages).toContain('Unknown Video render setting: overrides.frame.depth');
    expect(messages).toContain('overrides.sparkle');
    expect(messages).toContain('list_render_presets');
    for (const overrides of [
      { upscale: { engine: 'command' } },
      { upscale: { command: 'calc.exe {in} {out}' } },
      { upscale: { model: '../../evil' } },
      { sequence: { subfolder: true } },
      { frame: { width: 1 } },
      { format: 'gif' },
    ])
      expect(
        requestSchema.safeParse({ action: 'render_video', path: 'C:\\a.mp4', overrides }).success,
      ).toBe(false);
    const gif = requestSchema.safeParse({
      action: 'render_video',
      tab: 'gif',
      preset: '4k',
      path: 'C:\\a.gif',
      overrides: { fps: 25 },
    });
    expect(gif.error!.issues.map((issue) => issue.message).join('\n')).toMatch(
      /Unknown GIF & Loops preset "4k"\. Choose one of: social, hq, tiny, sticker, crunchy, custom/,
    );
    expect(
      requestSchema.safeParse({
        action: 'render_video',
        tab: 'gif',
        preset: 'tiny',
        path: 'C:\\a.webp',
        overrides: { format: 'webp', fps: 24, segments: [{ start: 0, end: 1 }] },
        range: { start: 0, end: 2 },
        wait: true,
      }).success,
    ).toBe(true);

    expect(requestSchema.safeParse({ action: 'render_status', cancel: true }).success).toBe(false);
    const status = requestSchema.parse({ action: 'render_status' });
    expect(isMutation(status)).toBe(false);
    const cancel = requestSchema.parse({
      action: 'render_status',
      jobId: modId,
      cancel: true,
    });
    expect(requiresFullControl(cancel)).toBe(true);
    for (const action of ['get_timeline', 'list_render_presets'])
      expect(isMutation(requestSchema.parse({ action }))).toBe(false);
  });
  it('decides when a render path names a folder of PNG frames', () => {
    const folder = (tab: 'video' | 'gif', overrides: Record<string, unknown>) =>
      renderOutputIsFolder({ tab, overrides });
    expect(folder('video', {})).toBe(false);
    expect(folder('video', { output: 'sequence' })).toBe(true);
    expect(folder('video', { sequence: { kind: 'files' } })).toBe(true);
    expect(folder('video', { output: 'sequence', sequence: { kind: 'flipbook' } })).toBe(false);
    expect(folder('video', { output: 'movie', sequence: { kind: 'files' } })).toBe(false);
    expect(folder('gif', {})).toBe(false);
  });
});

describe('MCP timeline editing', () => {
  it('creates the timeline and keys in one revision and one Undo step, snapping to frames', () => {
    const { commands, adapter, apply } = setup();
    let notifications = 0;
    commands.subscribe(() => notifications++);
    const before = commands.getState();
    const unchanged = before.effects[0];
    const result = adapter.execute({
      action: 'apply_operations',
      expectedRevision: 0,
      operations: [
        {
          action: 'set_timeline',
          fps: 10,
          duration: 4,
          loop: false,
          workArea: { start: 0.52, end: 3 },
        },
        {
          action: 'set_keyframes',
          instanceId: 'top',
          parameter: 'midpoint',
          keys: [
            { time: 2.04, value: 0.9, interpolation: 'linear' },
            { time: 0.01, value: 0.1, interpolation: 'bezier', outHandle: { dt: 0.5, dv: 0.2 } },
          ],
        },
      ],
    });
    expect(notifications).toBe(1);
    expect(result.revision).toBe(1);
    const state = commands.getState();
    expect(state.timeline).toMatchObject({
      fps: 10,
      duration: 4,
      loop: false,
      workArea: { start: 0.5, end: 3 },
    });
    expect(state.effects[0]).toBe(unchanged);
    expect(effect(commands, 'top').animation).toEqual({
      midpoint: {
        keys: [
          { t: 0, value: 0.1, interpolation: 'bezier', outHandle: { dt: 0.5, dv: 0.2 } },
          { t: 2, value: 0.9, interpolation: 'linear' },
        ],
      },
    });
    expect(result.timeline).toMatchObject({
      fps: 10,
      frameCount: 40,
      end: 4,
      workArea: { start: 0.5, end: 3 },
    });
    const top = (result.effects as { instanceId: string; animation: unknown }[]).find(
      (layer) => layer.instanceId === 'top',
    )!;
    expect(top.animation).toEqual({
      midpoint: {
        keys: [
          {
            time: 0,
            frame: 0,
            value: 0.1,
            interpolation: 'bezier',
            outHandle: { dt: 0.5, dv: 0.2 },
          },
          { time: 2, frame: 20, value: 0.9, interpolation: 'linear' },
        ],
        modulators: [],
      },
    });
    commands.undo();
    expect(commands.getState()).toBe(before);
    expect(commands.getState().timeline).toBeUndefined();
    expect(() =>
      adapter.execute({
        action: 'apply_operations',
        expectedRevision: 1,
        operations: [{ action: 'set_timeline', fps: 24 }],
      }),
    ).toThrow(/Project changed/);
    apply({ action: 'set_timeline' });
    expect(commands.getState().timeline).toMatchObject({ fps: 30, duration: 10, loop: true });
  });
  it('updates timeline settings, clears optional ranges and re-times keys on fps changes', () => {
    const { commands, apply } = setup(true);
    apply(
      {
        action: 'set_timeline',
        inOut: { start: 1, end: 2 },
        bpm: 128,
        seed: { mode: 'every-n', every: 4 },
      },
      {
        action: 'set_keyframes',
        instanceId: 'bottom',
        parameter: 'horizontal',
        keys: [{ time: 1.3, value: 2 }],
      },
    );
    expect(commands.getState().timeline).toMatchObject({
      inOut: { start: 1, end: 2 },
      bpm: 128,
      seed: { mode: 'every-n', every: 4 },
    });
    apply({ action: 'set_timeline', fps: 4, inOut: null, bpm: null, seed: { mode: 'fixed' } });
    const timeline = commands.getState().timeline!;
    expect(timeline).not.toHaveProperty('inOut');
    expect(timeline).not.toHaveProperty('bpm');
    expect(timeline.seed).toEqual({ mode: 'fixed', every: 4 });
    expect(effect(commands, 'bottom').animation!.horizontal!.keys[0]!.t).toBe(1.25);
    expect(() => apply({ action: 'set_timeline', workArea: { start: 1, end: 9 } })).toThrow(
      /workArea end \(9 s\) is after the timeline end \(4 s\)/,
    );
    expect(() => apply({ action: 'set_timeline', workArea: { start: 1, end: 1.1 } })).toThrow(
      /at least one frame/,
    );
  });
  it('sets the audio track level and reports it with get_timeline', () => {
    const { commands, adapter, apply } = setup(true);
    expect(() => apply({ action: 'set_timeline', audioVolume: 0.5 })).toThrow(/no audio track/);
    commands.updateTimeline({
      audio: {
        path: 'C:/music/song.wav',
        name: 'song.wav',
        duration: 4,
        sampleRate: 48000,
        channels: 2,
      },
    });
    apply({ action: 'set_timeline', audioVolume: 0.4, audioMuted: true });
    expect(commands.getState().timeline!.audio).toMatchObject({ volume: 0.4, muted: true });
    expect(
      (adapter.execute({ action: 'get_timeline' }) as { timeline: { audio: unknown } }).timeline
        .audio,
    ).toMatchObject({ name: 'song.wav', volume: 0.4, muted: true, fromClip: false });
    expect(() => apply({ action: 'set_timeline', audioVolume: 1.2 })).toThrow();
  });
  it('rejects bad keys with helpful errors and leaves the project untouched', () => {
    const { commands, apply } = setup(true);
    const before = commands.getState();
    const keyframes =
      (parameter: string, keys: unknown, instanceId = 'top') =>
      () =>
        apply({ action: 'set_keyframes', instanceId, parameter, keys });
    expect(keyframes('text', [{ time: 0, value: 'hi' }], 'text')).toThrow(
      /Parameter text cannot be animated on System Crash \(text\)\. Animatable keys: amount, .*application\.coverage/,
    );
    expect(keyframes('glow', [{ time: 0, value: 1 }])).toThrow(
      /Unknown parameter: glow on Gradient Map \(top\)\. Animatable keys: amount, shadows, highlights, midpoint, reverse/,
    );
    expect(keyframes('midpoint', [{ time: 0, value: 2 }])).toThrow(
      /Key 1: Midpoint needs a number from 0\.05 to 0\.95/,
    );
    expect(keyframes('reverse', [{ time: 0, value: 'sideways' }])).toThrow(
      /Reverse must be one of off, on/,
    );
    expect(keyframes('shadows', [{ time: 0, value: 'red' }])).toThrow(/#RRGGBB/);
    expect(keyframes('midpoint', [{ time: 9, value: 0.5 }])).toThrow(
      /after the timeline end \(4 s\)\. Extend duration with set_timeline/,
    );
    expect(
      keyframes('midpoint', [
        { time: 1, value: 0.5 },
        { time: 1.02, value: 0.6 },
      ]),
    ).toThrow(/Key 2 \(1\.02 s\) lands on frame 10/);
    expect(commands.getState()).toBe(before);
    const { apply: withoutTimeline } = setup();
    expect(() =>
      withoutTimeline({
        action: 'set_keyframes',
        instanceId: 'top',
        parameter: 'midpoint',
        keys: [{ time: 0, value: 0.5 }],
      }),
    ).toThrow(/no timeline yet\. Add a set_timeline operation first/);
  });
  it('merges, clears and animates colors, choices and application keys', () => {
    const { commands, apply } = setup(true);
    apply(
      {
        action: 'set_keyframes',
        instanceId: 'top',
        parameter: 'shadows',
        keys: [
          { time: 0, value: '#000000' },
          { time: 1, value: '#ffffff' },
        ],
      },
      {
        action: 'set_keyframes',
        instanceId: 'top',
        parameter: 'reverse',
        keys: [{ time: 2, value: 'on', interpolation: 'hold' }],
      },
      {
        action: 'set_keyframes',
        instanceId: 'top',
        parameter: 'application.coverage',
        keys: [{ time: 3, value: 0.25 }],
      },
    );
    apply({
      action: 'set_keyframes',
      instanceId: 'top',
      parameter: 'shadows',
      merge: true,
      keys: [
        { time: 1, value: '#ff0000' },
        { time: 2, value: '#00ff00' },
      ],
    });
    const animation = effect(commands, 'top').animation!;
    expect(animation.shadows!.keys.map((key) => [key.t, key.value])).toEqual([
      [0, '#000000'],
      [1, '#ff0000'],
      [2, '#00ff00'],
    ]);
    expect(animation['application.coverage']!.keys).toHaveLength(1);
    apply(
      { action: 'set_keyframes', instanceId: 'top', parameter: 'shadows', keys: null },
      { action: 'set_keyframes', instanceId: 'top', parameter: 'midpoint', keys: null },
    );
    expect(effect(commands, 'top').animation).not.toHaveProperty('shadows');
  });
  it('sets ordered modulators with stable ids and keeps keys when modulators are removed', () => {
    const { commands, apply } = setup(true);
    expect(() =>
      apply({
        action: 'set_modulators',
        instanceId: 'top',
        parameter: 'reverse',
        modulators: [{ kind: 'lfo' }],
      }),
    ).toThrow(/Modulators need a numeric parameter; Reverse \(reverse\) is a choice control/);
    apply(
      {
        action: 'set_keyframes',
        instanceId: 'bottom',
        parameter: 'horizontal',
        keys: [{ time: 0, value: 1 }],
      },
      {
        action: 'set_modulators',
        instanceId: 'bottom',
        parameter: 'horizontal',
        modulators: [
          { kind: 'lfo', shape: 'random', depth: 0.5 },
          { kind: 'audio', id: 'kick', band: 'custom', lowHz: 30, highHz: 90, combine: 'add' },
        ],
      },
    );
    const lane = effect(commands, 'bottom').animation!.horizontal!;
    expect(lane.keys).toHaveLength(1);
    expect(lane.modulators).toEqual([
      {
        kind: 'lfo',
        id: modId,
        enabled: true,
        shape: 'random',
        sync: true,
        division: '1/2',
        rate: 1,
        depth: 0.5,
        phase: 90,
        combine: 'add',
      },
      {
        kind: 'audio',
        id: 'kick',
        enabled: true,
        band: 'custom',
        lowHz: 30,
        highHz: 90,
        attackMs: 8,
        releaseMs: 180,
        outMin: 0.4,
        outMax: 1,
        combine: 'add',
      },
    ]);
    // Omitted ids keep the modulator's id at the same position (random LFOs keep their pattern).
    apply({
      action: 'set_modulators',
      instanceId: 'bottom',
      parameter: 'horizontal',
      modulators: [{ kind: 'lfo', shape: 'random', depth: 0.2 }, { kind: 'audio' }],
    });
    expect(effect(commands, 'bottom').animation!.horizontal!.modulators!.map((m) => m.id)).toEqual([
      modId,
      'kick',
    ]);
    expect(() =>
      apply({
        action: 'set_modulators',
        instanceId: 'bottom',
        parameter: 'horizontal',
        modulators: [
          { kind: 'lfo', id: 'same' },
          { kind: 'lfo', id: 'same' },
        ],
      }),
    ).toThrow(/Duplicate modulator id: same/);
    apply({
      action: 'set_modulators',
      instanceId: 'bottom',
      parameter: 'horizontal',
      modulators: [],
    });
    expect(effect(commands, 'bottom').animation!.horizontal).toEqual({ keys: lane.keys });
    apply(
      {
        action: 'set_modulators',
        instanceId: 'top',
        parameter: 'amount',
        modulators: [{ kind: 'lfo', id: 'x' }],
      },
      { action: 'set_modulators', instanceId: 'top', parameter: 'amount', modulators: [] },
    );
    expect(effect(commands, 'top')).not.toHaveProperty('animation');
  });
  it('snaps active ranges, removes them with null and respects layer locks', () => {
    const { commands, adapter, apply } = setup(true);
    apply({ action: 'set_active_range', instanceId: 'bottom', range: { start: 0.96, end: 2.04 } });
    expect(effect(commands, 'bottom').activeRange).toEqual({ start: 1, end: 2 });
    expect(adapter.state().effects.at(-1)).toMatchObject({ activeRange: { start: 1, end: 2 } });
    expect(() =>
      apply({ action: 'set_active_range', instanceId: 'bottom', range: { start: 3, end: 5 } }),
    ).toThrow(/after the timeline end/);
    apply({ action: 'set_active_range', instanceId: 'bottom', range: null });
    expect(effect(commands, 'bottom')).not.toHaveProperty('activeRange');

    commands.setEffectLocked('top', true);
    const locked = commands.getState();
    for (const operation of [
      {
        action: 'set_keyframes',
        instanceId: 'top',
        parameter: 'amount',
        keys: [{ time: 0, value: 1 }],
      },
      { action: 'set_keyframes', instanceId: 'top', parameter: 'amount', keys: null },
      { action: 'set_modulators', instanceId: 'top', parameter: 'amount', modulators: [] },
      { action: 'set_active_range', instanceId: 'top', range: null },
    ])
      expect(() => apply(operation)).toThrow(/locked/);
    expect(commands.getState()).toBe(locked);
    apply(
      { action: 'set_locked', instanceId: 'top', locked: false },
      { action: 'set_active_range', instanceId: 'top', range: { start: 0, end: 1 } },
    );
    expect(effect(commands, 'top').activeRange).toEqual({ start: 0, end: 1 });
  });
  it('reports the timeline, animated layers and animatable keys without media data', () => {
    const { commands, adapter, apply } = setup();
    expect(adapter.execute({ action: 'get_timeline' })).toMatchObject({
      timeline: null,
      layers: [],
      note: expect.stringMatching(/set_timeline/),
    });
    expect(adapter.state().timeline).toBeNull();
    commands.setTimeline({
      ...createTimeline({ fps: 25, duration: 2 }),
      markers: [{ id: 'm1', t: 0.4, name: 'Drop' }],
      audio: {
        path: 'C:\\private\\song.wav',
        name: 'song.wav',
        duration: 2,
        sampleRate: 48000,
        channels: 2,
        analysis: {
          rate: 50,
          bins: 1,
          minHz: 40,
          maxHz: 16000,
          spectrum: 'AAAA',
          peaks: 'AAAA',
          beats: [0.5, 1, 1.5],
          bpm: 120,
        },
      },
    });
    apply(
      {
        action: 'set_keyframes',
        instanceId: 'top',
        parameter: 'midpoint',
        keys: [
          { time: 0, value: 0.2, interpolation: 'linear' },
          { time: 1, value: 0.8, interpolation: 'hold' },
        ],
      },
      {
        action: 'set_modulators',
        instanceId: 'top',
        parameter: 'amount',
        modulators: [{ kind: 'audio', id: 'a' }],
      },
      { action: 'set_active_range', instanceId: 'bottom', range: { start: 0, end: 1 } },
    );
    const info = adapter.execute({ action: 'get_timeline' });
    expect(info).toMatchObject({
      revision: 2,
      timeline: {
        fps: 25,
        frameCount: 50,
        end: 2,
        tempo: 120,
        bpm: null,
        markers: [{ id: 'm1', name: 'Drop', time: 0.4, frame: 10 }],
        audio: { name: 'song.wav', analysis: { bpm: 120, beats: 3 } },
        video: null,
      },
      layers: [
        {
          instanceId: 'top',
          index: 1,
          activeRange: null,
          parameters: [
            {
              parameter: 'midpoint',
              label: 'Midpoint',
              kind: 'number',
              keys: 2,
              firstKey: 0,
              lastKey: 1,
              interpolations: ['linear', 'hold'],
              modulators: [],
            },
            {
              parameter: 'amount',
              keys: 0,
              modulators: [{ id: 'a', kind: 'audio', enabled: true }],
            },
          ],
        },
        { instanceId: 'bottom', index: 2, activeRange: { start: 0, end: 1 }, parameters: [] },
      ],
    });
    const text = JSON.stringify([info, adapter.state()]);
    expect(text).not.toContain('private');
    expect(text).not.toContain('AAAA');
    const parameters = adapter.execute({ action: 'get_effect_parameters', instanceId: 'top' });
    expect(parameters.animatableParameters).toEqual(
      expect.arrayContaining(['amount', 'shadows', 'midpoint', 'reverse', 'application.coverage']),
    );
    expect(parameters).toMatchObject({
      activeRange: null,
      animation: {
        midpoint: {
          keys: [
            { time: 0, frame: 0 },
            { time: 1, frame: 25 },
          ],
        },
      },
    });
    expect(() => adapter.execute({ action: 'set_playhead', frame: 1 })).toThrow(/desktop app/);
  });
});

describe('MCP timeline tools', () => {
  it('registers timeline and render tools with descriptions and batches the edit aliases', async () => {
    const commands = setup(true).commands;
    const adapter = createMcpCommands(commands, () => modId);
    const received: McpRequest[] = [];
    const server = createGleechMcpServer(async (request) => {
      received.push(request);
      return request.action === 'render_video' ? { jobId: modId } : adapter.execute(request);
    });
    const client = new Client({ name: 'Timeline client', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
      for (const name of [
        'get_timeline',
        'set_playhead',
        'list_render_presets',
        'render_video',
        'render_status',
        'set_timeline',
        'set_keyframes',
        'set_modulators',
        'set_active_range',
      ])
        expect(tools.get(name)?.description?.length).toBeGreaterThan(40);
      expect(tools.get('get_timeline')!.annotations?.readOnlyHint).toBe(true);
      expect(tools.get('render_video')!.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
      const keyed = await client.callTool({
        name: 'set_keyframes',
        arguments: {
          instanceId: 'top',
          parameter: 'midpoint',
          keys: [{ time: 0.5, value: 0.3 }],
          expectedRevision: 0,
        },
      });
      expect(keyed.isError).not.toBe(true);
      expect(keyed.structuredContent).toHaveProperty('revision', 1);
      expect(received.at(-1)).toMatchObject({
        action: 'apply_operations',
        expectedRevision: 0,
        operations: [{ action: 'set_keyframes', merge: false }],
      });
      const failed = await client.callTool({
        name: 'set_keyframes',
        arguments: { instanceId: 'top', parameter: 'glow', keys: [{ time: 0.5, value: 0.3 }] },
      });
      expect(failed.isError).toBe(true);
      expect(JSON.stringify(failed.content)).toContain('Animatable keys');
      const render = await client.callTool({
        name: 'render_video',
        arguments: { path: 'C:\\out\\clip.mp4', overrides: { frame: { width: 640 } } },
      });
      expect(render.structuredContent).toEqual({ jobId: modId });
      const invalid = await client.callTool({
        name: 'render_video',
        arguments: { path: 'C:\\out\\clip.mp4', overrides: { colour: 'red' } },
      });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid.content)).toContain('Unknown Video render setting');
    } finally {
      adapter.dispose();
      await client.close();
      await server.close();
    }
  });
});
