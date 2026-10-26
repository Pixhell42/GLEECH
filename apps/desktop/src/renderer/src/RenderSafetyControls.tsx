import type { RenderMemoryAssessment, RenderSafetySettings } from '../../shared/render-safety';
import { memorySize } from '../../shared/render-safety';
import { useEffect, useRef } from 'react';

export function RenderSafetyControls({
  value,
  assessment,
  partsAvailable,
  onChange,
}: {
  value: RenderSafetySettings;
  assessment: RenderMemoryAssessment | null;
  partsAvailable: boolean;
  onChange(value: RenderSafetySettings): void;
}) {
  const update = (change: Partial<RenderSafetySettings>) => onChange({ ...value, ...change });
  return (
    <section className="render-section render-safety" aria-label="Export memory and recovery">
      <h3>Memory and recovery</h3>
      <label>
        <input
          type="checkbox"
          checked={value.checkMemory}
          onChange={(event) => update({ checkMemory: event.target.checked })}
        />{' '}
        Check memory before exporting
      </label>
      <p className="render-hint" aria-live="polite">
        {assessment
          ? `Estimated peak RAM: ${memorySize(assessment.estimatedPeakBytes)} · ` +
            (assessment.availableRAMBytes === null
              ? 'Free RAM unavailable'
              : `Currently available: ${memorySize(assessment.availableRAMBytes)}`)
          : 'Preparing memory estimate…'}
      </p>
      <label>
        Memory mode{' '}
        <select
          aria-label="Export memory mode"
          value={value.mode}
          onChange={(event) => update({ mode: event.target.value as RenderSafetySettings['mode'] })}
        >
          <option value="auto">Automatic</option>
          <option value="standard">Standard</option>
          <option value="one-frame">One frame at a time</option>
          <option value="tiled" disabled={!!assessment?.tiledUnavailable}>
            Tiled processing · compatible effects only
          </option>
        </select>
      </label>
      {value.mode === 'auto' && assessment && (
        <p className="render-hint">
          Automatic mode selects{' '}
          {assessment.mode === 'standard' ? 'standard processing' : 'one frame at a time'}.
        </p>
      )}
      {assessment?.tiledUnavailable && <p className="render-hint">{assessment.tiledUnavailable}</p>}
      {value.mode === 'tiled' && (
        <label>
          Tile size{' '}
          <select
            aria-label="Render tile size"
            value={value.tileSize}
            onChange={(event) =>
              update({ tileSize: Number(event.target.value) as RenderSafetySettings['tileSize'] })
            }
          >
            {[256, 512, 1024].map((size) => (
              <option key={size} value={size}>
                {size} × {size}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Effect processing size{' '}
        <select
          aria-label="Effect processing size"
          value={value.processing}
          onChange={(event) =>
            update({ processing: event.target.value as RenderSafetySettings['processing'] })
          }
        >
          <option value="source">Full source resolution</option>
          <option value="output">Output resolution when smaller</option>
        </select>
      </label>
      <p className="render-hint">
        Processing at a smaller output size uses less memory and can change fine effect detail.
      </p>
      <label>
        <input
          type="checkbox"
          checked={partsAvailable && value.segmentSeconds > 0}
          disabled={!partsAvailable}
          onChange={(event) =>
            update({
              segmentSeconds: event.target.checked ? 30 : 0,
              ...(!event.target.checked ? { keepParts: false, resume: false } : {}),
            })
          }
        />{' '}
        Render in parts and assemble at the end
      </label>
      {!partsAvailable && (
        <p className="render-hint">Movie parts and resume are available for Video movie outputs.</p>
      )}
      {partsAvailable && value.segmentSeconds > 0 && (
        <>
          <label>
            Seconds per part{' '}
            <input
              aria-label="Seconds per render part"
              type="number"
              min={1}
              max={600}
              value={value.segmentSeconds}
              onChange={(event) =>
                update({
                  segmentSeconds: Math.min(600, Math.max(1, Number(event.target.value) || 1)),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.keepParts}
              onChange={(event) =>
                update({
                  keepParts: event.target.checked,
                  ...(!event.target.checked ? { resume: false } : {}),
                })
              }
            />{' '}
            Keep completed parts for recovery
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.resume}
              onChange={(event) =>
                update({
                  resume: event.target.checked,
                  ...(event.target.checked ? { keepParts: true } : {}),
                })
              }
            />{' '}
            Resume completed parts
          </label>
          <p className="render-hint">
            Verified parts are saved beside the output. Resume requires the same project, media,
            range, format and part length. Imported shaders may replay earlier frames to restore
            their state.
          </p>
        </>
      )}
      <p className="render-hint">
        Splitting a video does not shrink a single frame. GPU memory availability cannot be reliably
        measured on every system.
      </p>
    </section>
  );
}

export function RenderMemoryWarning({
  assessment,
  partsAvailable,
  choose,
}: {
  assessment: RenderMemoryAssessment;
  partsAvailable: boolean;
  choose(action: 'one-frame' | 'tiled' | 'parts' | 'smaller' | 'cancel'): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={modal}
      className="render-memory-warning"
      role="alertdialog"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        choose('cancel');
      }}
      aria-labelledby="render-memory-title"
      aria-describedby="render-memory-detail"
    >
      <h3 id="render-memory-title">This export may exceed available memory</h3>
      <p id="render-memory-detail">
        Estimated peak: {memorySize(assessment.estimatedPeakBytes)}. Safe RAM budget:{' '}
        {memorySize(assessment.usableRAMBytes ?? 0)}.
      </p>
      <p>
        Choose a lower-memory option before rendering. A single frame and its effects must still
        fit.
      </p>
      <div className="render-memory-actions">
        <button type="button" onClick={() => choose('one-frame')}>
          Use one frame at a time
        </button>
        <button
          type="button"
          disabled={!!assessment.tiledUnavailable}
          onClick={() => choose('tiled')}
        >
          Use tiled processing
        </button>
        <button type="button" disabled={!partsAvailable} onClick={() => choose('parts')}>
          Export in parts
        </button>
        <button type="button" onClick={() => choose('smaller')}>
          Reduce resolution
        </button>
        <button type="button" autoFocus onClick={() => choose('cancel')}>
          Back to settings
        </button>
      </div>
    </dialog>
  );
}
