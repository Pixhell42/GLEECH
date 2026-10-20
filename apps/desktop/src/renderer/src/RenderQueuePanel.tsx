import { useSyncExternalStore } from 'react';
import { renderQueue, type RenderJob } from './render-queue';
import { formatSize } from '../../shared/render-presets';
import { CloseIcon, FolderIcon, RenderIcon } from './Icons';

function statusText(job: RenderJob): string {
  switch (job.status) {
    case 'queued':
      return 'Waiting…';
    case 'rendering':
      return `Frame ${job.done.toLocaleString('en-US')} of ${job.total.toLocaleString('en-US')}`;
    case 'encoding':
      return 'Finishing file…';
    case 'done':
      return job.result
        ? `Saved · ${formatSize(job.result.bytes)}${job.result.files > 1 ? ` · ${job.result.files.toLocaleString('en-US')} files` : ''}`
        : 'Saved';
    case 'canceled':
      return 'Canceled';
    case 'failed':
      return job.error ?? 'The render failed.';
  }
}

/** Background renders: progress, cancel and Show in folder. */
export function RenderQueuePanel({ onError }: { onError(message: string): void }) {
  const jobs = useSyncExternalStore(renderQueue.subscribe, renderQueue.snapshot);
  if (!jobs.length) return null;
  return (
    <section className="render-queue" aria-label="Renders" aria-live="polite">
      {jobs.map((job) => {
        const active =
          job.status === 'queued' || job.status === 'rendering' || job.status === 'encoding';
        const progress =
          job.status === 'done'
            ? 1
            : job.status === 'encoding'
              ? 0.99
              : job.total
                ? job.done / job.total
                : 0;
        return (
          <article key={job.id} className={`render-job ${job.status}`} data-status={job.status}>
            <RenderIcon />
            <div className="render-job-text">
              <strong title={job.outputPath}>{job.label}</strong>
              <span title={job.status === 'failed' ? job.error : undefined}>{statusText(job)}</span>
              {active && (
                <span
                  className="render-job-bar"
                  role="progressbar"
                  aria-label={`${job.label} progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                >
                  <span style={{ width: `${progress * 100}%` }} />
                </span>
              )}
              {job.result?.notes.map((note) => (
                <small key={note}>{note}</small>
              ))}
            </div>
            {job.status === 'done' && job.result && (
              <button
                className="ib"
                aria-label={`Show ${job.label} in folder`}
                title="Show in folder"
                onClick={() =>
                  void window.gleech.revealRender(job.result!.outputPath).then((result) => {
                    if (!result.ok) onError(result.error);
                  })
                }
              >
                <FolderIcon />
              </button>
            )}
            <button
              className="ib"
              aria-label={active ? `Cancel ${job.label}` : `Dismiss ${job.label}`}
              title={active ? 'Cancel render' : 'Dismiss'}
              onClick={() => (active ? renderQueue.cancel(job.id) : renderQueue.dismiss(job.id))}
            >
              <CloseIcon />
            </button>
          </article>
        );
      })}
    </section>
  );
}
