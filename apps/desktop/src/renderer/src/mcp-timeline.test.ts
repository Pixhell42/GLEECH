import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEffect,
  createProject,
  createTimeline,
  type ProjectState,
} from '@gleech/project-model';
import { requestSchema, type McpRequest } from '@gleech/mcp/protocol';
import type { RenderJob, RenderRequest } from './render-queue';

const queue = vi.hoisted(() => {
  let jobs: RenderJob[] = [];
  const listeners = new Set<() => void>();
  const requests: RenderRequest[] = [];
  const update = (next: RenderJob[]) => {
    jobs = next;
    for (const listener of listeners) listener();
  };
  return {
    requests,
    reset() {
      jobs = [];
      requests.length = 0;
      listeners.clear();
    },
    patch(id: string, change: Partial<RenderJob>) {
      update(jobs.map((job) => (job.id === id ? { ...job, ...change } : job)));
    },
    add(job: RenderJob) {
      update([...jobs, job]);
    },
    renderQueue: {
      enqueue(request: RenderRequest) {
        requests.push(request);
        const id = `00000000-0000-4000-8000-${String(requests.length).padStart(12, '0')}`;
        update([
          ...jobs,
          {
            id,
            kind: request.kind,
            label: request.label,
            outputPath: request.spec.outputPath,
            status: 'queued',
            done: 0,
            total: request.times.length,
            startedAt: null,
          },
        ]);
        return id;
      },
      snapshot: () => jobs,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      cancel(id: string) {
        update(jobs.map((job) => (job.id === id ? { ...job, status: 'canceled' as const } : job)));
      },
    },
  };
});
vi.mock('./render-queue', () => ({ renderQueue: queue.renderQueue }));
const { TIMELINE_MCP_ACTIONS, mcpRenderSettings, runTimelineMcp } = await import('./mcp-timeline');

const gleech = {
  renderStatus: vi.fn(async () => ({
    ok: true as const,
    value: { available: true, version: '7.1' },
  })),
  mcpRenderTarget: vi.fn(
    async (): Promise<{ ok: true; value: string } | { ok: false; error: string }> => ({
      ok: true,
      value: 'C:\\Exports\\clip.mp4',
    }),
  ),
};
function project(): ProjectState {
  return {
    ...createProject('Clip', 7),
    source: {
      id: 'source',
      name: 'clip.png',
      width: 1600,
      height: 900,
      format: 'png',
      hasAlpha: false,
    },
    effects: [createEffect('rgb-split', 'layer')],
    timeline: { ...createTimeline({ fps: 10, duration: 4 }), workArea: { start: 1, end: 3 } },
  };
}
function context(state = project(), signal = new AbortController().signal) {
  let playhead = 5;
  return {
    dispatchId: 'dispatch',
    project: () => state,
    revision: () => 3,
    playhead: () => playhead,
    setPlayhead: vi.fn((frame: number) => {
      playhead = frame;
    }),
    videoMediaId: () => null,
    signal,
    deadline: Date.now() + 60000,
  };
}
const render = (input: Record<string, unknown>) =>
  requestSchema.parse({ action: 'render_video', path: 'C:\\Exports\\clip.mp4', ...input });

beforeEach(() => {
  queue.reset();
  vi.stubGlobal('window', { gleech });
  gleech.renderStatus.mockClear();
  gleech.mcpRenderTarget.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP timeline actions in the renderer', () => {
  it('lists the actions App routes here', () => {
    expect(TIMELINE_MCP_ACTIONS).toEqual([
      'get_timeline',
      'set_playhead',
      'list_render_presets',
      'render_video',
      'render_status',
    ]);
  });
  it('merges overrides onto presets the way the Render dialog does', () => {
    const source = { width: 1600, height: 900, fps: 10 };
    const video = mcpRenderSettings(
      {
        tab: 'video',
        preset: 'draft',
        overrides: { compression: 'highest', frame: { width: 1280 } },
      },
      source,
    ).video;
    expect(video).toMatchObject({
      preset: 'draft',
      format: 'mp4-h264',
      compression: 'highest',
      frame: { width: 1280, height: 540 },
      advanced: { colorDepth: 10, speed: 'slow', keyframeInterval: 20 },
      output: 'movie',
    });
    expect(
      mcpRenderSettings(
        {
          tab: 'video',
          overrides: { sequence: { kind: 'flipbook', flipbook: { kind: 'sprite' } } },
        },
        source,
      ).video,
    ).toMatchObject({
      preset: '1080p-social',
      output: 'sequence',
      sequence: {
        kind: 'flipbook',
        every: '2',
        subfolder: false,
        flipbook: { kind: 'sprite', paper: 'letter' },
      },
    });
    expect(
      mcpRenderSettings(
        { tab: 'gif', preset: 'tiny', overrides: { format: 'webp', colors: 16 } },
        source,
      ).gif,
    ).toMatchObject({ preset: 'tiny', width: 240, fps: 12, format: 'webp', colors: 16 });
  });
  it('moves and reports the playhead in frames, seconds and timecode', async () => {
    const ctx = context();
    expect(await runTimelineMcp({ action: 'get_timeline' }, ctx)).toMatchObject({
      revision: 3,
      timeline: { fps: 10, frameCount: 40 },
      playhead: { frame: 5, time: 0.5, timecode: '00:00:05' },
    });
    expect(
      await runTimelineMcp(requestSchema.parse({ action: 'set_playhead', time: 99 }), ctx),
    ).toMatchObject({ frame: 39, time: 3.9, timecode: '00:03:09', clamped: true });
    expect(ctx.setPlayhead).toHaveBeenCalledWith(39);
    await expect(
      runTimelineMcp(requestSchema.parse({ action: 'set_playhead', frame: 2 }), {
        ...ctx,
        project: () => ({ ...project(), timeline: undefined }) as unknown as ProjectState,
      }),
    ).rejects.toThrow(/no timeline yet/);
  });
  it('queues a validated render and reports its estimate and job', async () => {
    const value = await runTimelineMcp(render({ preset: 'draft' }), context());
    expect(gleech.mcpRenderTarget).toHaveBeenCalledWith('dispatch');
    expect(queue.requests).toHaveLength(1);
    expect(queue.requests[0]!.spec).toMatchObject({
      kind: 'video',
      outputPath: 'C:\\Exports\\clip.mp4',
    });
    expect(value).toMatchObject({
      tab: 'video',
      preset: 'draft',
      output: 'MP4 · H.264',
      range: { kind: 'work', start: 1, end: 3 },
      framesRendered: 20,
      size: { width: 960, height: 540 },
      estimate: { text: expect.stringMatching(/MB$/) },
      job: { status: 'queued', startedBy: 'mcp', requestedPath: 'C:\\Exports\\clip.mp4' },
    });
  });
  it('refuses mismatched extensions, missing ranges and failed approvals before queueing', async () => {
    await expect(
      runTimelineMcp(
        render({ overrides: { format: 'mov-prores', compression: 'high' } }),
        context(),
      ),
    ).rejects.toThrow(/End path with \.mov/);
    await expect(runTimelineMcp(render({ range: 'inout' }), context())).rejects.toThrow(
      /no In\/Out points/,
    );
    await expect(
      runTimelineMcp(render({ range: { start: 1, end: 9 } }), context()),
    ).rejects.toThrow(/after the timeline end/);
    gleech.mcpRenderTarget.mockResolvedValueOnce({
      ok: false,
      error: 'Output already exists. Use a new path or explicitly allow overwrite.',
    });
    await expect(runTimelineMcp(render({}), context())).rejects.toThrow(/already exists/);
    expect(queue.requests).toHaveLength(0);
  });
  it('waits for the result and cancels the render when a waiting call is cancelled', async () => {
    const pending = runTimelineMcp(render({ wait: true, range: { start: 0, end: 1 } }), context());
    await vi.waitFor(() => expect(queue.requests).toHaveLength(1));
    const id = queue.renderQueue.snapshot()[0]!.id;
    queue.patch(id, { status: 'rendering', done: 5 });
    queue.patch(id, {
      status: 'done',
      done: 10,
      result: { outputPath: 'C:\\Exports\\clip (2).mp4', bytes: 2_500_000, files: 1, notes: [] },
    });
    expect(await pending).toMatchObject({
      finished: true,
      job: { status: 'done', outputPath: 'C:\\Exports\\clip (2).mp4', size: '2.5 MB', progress: 1 },
    });

    const controller = new AbortController();
    const waiting = runTimelineMcp(render({ wait: true }), context(project(), controller.signal));
    await vi.waitFor(() => expect(queue.requests).toHaveLength(2));
    controller.abort();
    await expect(waiting).rejects.toThrow(/cancelled/);
    expect(queue.renderQueue.snapshot()[1]!.status).toBe('canceled');
  });
  it('lists jobs with paths only for MCP renders and cancels by jobId', async () => {
    queue.add({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'gif',
      label: 'mine.gif',
      outputPath: 'C:\\Users\\me\\Videos\\mine.gif',
      status: 'rendering',
      done: 1,
      total: 4,
      startedAt: 0,
    });
    await runTimelineMcp(render({}), context());
    await expect(runTimelineMcp(render({}), context())).rejects.toThrow(
      /Another queued render already writes to this path/,
    );
    const status = (await runTimelineMcp(
      requestSchema.parse({ action: 'render_status' }),
      context(),
    )) as { jobs: Record<string, unknown>[]; active: number };
    expect(status.active).toBe(2);
    expect(status.jobs[0]).toMatchObject({ label: 'mine.gif', startedBy: 'app', progress: 0.25 });
    expect(JSON.stringify(status.jobs[0])).not.toContain('Users');
    expect(status.jobs[1]).toHaveProperty('requestedPath', 'C:\\Exports\\clip.mp4');
    const cancel: McpRequest = requestSchema.parse({
      action: 'render_status',
      jobId: status.jobs[1]!.jobId,
      cancel: true,
    });
    expect(await runTimelineMcp(cancel, context())).toMatchObject({
      cancelled: true,
      job: { status: 'canceled' },
    });
    await expect(runTimelineMcp(cancel, context())).rejects.toThrow(/already ended/);
  });
  it('describes presets, defaults, ranges and upscalers for clients', async () => {
    const value = (await runTimelineMcp({ action: 'list_render_presets' }, context())) as {
      video: { presets: { id: string }[]; defaults: Record<string, unknown> };
      gif: { presets: { id: string }[] };
      upscale: { engines: { id: string }[] };
      ranges: unknown;
      ffmpeg: unknown;
    };
    expect(value.video.presets.map((preset) => preset.id)).toContain('4k');
    expect(value.video.defaults).not.toHaveProperty('preset');
    expect(value.video.defaults).toHaveProperty('sequence.kind', 'files');
    expect(value.video.defaults).not.toHaveProperty('sequence.subfolder');
    expect(value.video.defaults).not.toHaveProperty('upscale.command');
    expect(value.gif.presets.map((preset) => preset.id)).toContain('sticker');
    expect(value.upscale.engines.map((engine) => engine.id)).not.toContain('command');
    expect(value.ranges).toEqual({
      default: 'work',
      whole: { start: 0, end: 4 },
      work: { start: 1, end: 3 },
      inout: null,
    });
    expect(value.ffmpeg).toEqual({ available: true, version: '7.1' });
  });
});
