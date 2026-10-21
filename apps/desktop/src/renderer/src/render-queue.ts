// Desktop queue state and UI subscriptions. Frame processing lives in the
// shared timeline runner, reached through the desktop worker/IPC adapters.
import { RenderCancelledError } from '@gleech/effects';
import type { RenderResult, RenderTab } from '../../shared/render';
import {
  runDesktopTimelineRender,
  type DesktopTimelineRenderRequest as RenderRequest,
} from './desktop-timeline-runner';

export type { DesktopTimelineRenderRequest as RenderRequest } from './desktop-timeline-runner';

export type RenderStatus = 'queued' | 'rendering' | 'encoding' | 'done' | 'failed' | 'canceled';
export interface RenderJob {
  readonly id: string;
  readonly kind: RenderTab;
  readonly label: string;
  readonly outputPath: string;
  readonly status: RenderStatus;
  readonly done: number;
  readonly total: number;
  readonly startedAt: number | null;
  readonly result?: RenderResult;
  readonly error?: string;
}

class RenderQueue {
  private jobs: readonly RenderJob[] = [];
  private requests = new Map<string, RenderRequest>();
  private listeners = new Set<() => void>();
  private cancelled = new Set<string>();
  private active: { id: string; controller: AbortController } | null = null;
  private running = false;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly snapshot = () => this.jobs;

  enqueue(request: RenderRequest): string {
    const id = crypto.randomUUID();
    this.requests.set(id, request);
    this.update([
      ...this.jobs,
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
    void this.pump();
    return id;
  }

  cancel(id: string): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || !['queued', 'rendering', 'encoding'].includes(job.status)) return;
    this.cancelled.add(id);
    if (job.status === 'queued') this.patch(id, { status: 'canceled' });
    if (this.active?.id === id) this.active.controller.abort();
  }

  dismiss(id: string): void {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job || ['queued', 'rendering', 'encoding'].includes(job.status)) return;
    this.requests.delete(id);
    this.cancelled.delete(id);
    this.update(this.jobs.filter((entry) => entry.id !== id));
  }

  busy(): boolean {
    return this.jobs.some((job) => ['queued', 'rendering', 'encoding'].includes(job.status));
  }

  private update(jobs: readonly RenderJob[]) {
    this.jobs = jobs;
    for (const listener of this.listeners) listener();
  }
  private patch(id: string, change: Partial<RenderJob>) {
    this.update(this.jobs.map((job) => (job.id === id ? { ...job, ...change } : job)));
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.jobs.find((job) => job.status === 'queued');
        if (!next) break;
        await this.run(next.id);
      }
    } finally {
      this.running = false;
    }
  }

  private async run(id: string) {
    const request = this.requests.get(id);
    if (!request) return;
    const controller = new AbortController();
    this.active = { id, controller };
    this.patch(id, { status: 'rendering', startedAt: performance.now() });
    try {
      const result = await runDesktopTimelineRender(request, {
        signal: controller.signal,
        onProgress: ({ phase, done }) => this.patch(id, { status: phase, done }),
      });
      if (controller.signal.aborted) throw new RenderCancelledError();
      this.patch(id, { status: 'done', result });
    } catch (error) {
      if (error instanceof RenderCancelledError || this.cancelled.has(id))
        this.patch(id, { status: 'canceled' });
      else
        this.patch(id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'The render failed.',
        });
    } finally {
      this.active = null;
      this.cancelled.delete(id);
    }
  }
}

export const renderQueue = new RenderQueue();
