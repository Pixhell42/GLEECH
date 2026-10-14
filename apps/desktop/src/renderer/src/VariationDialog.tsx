import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateVariations } from '@gleech/command-service';
import { effectsNeedSubject, type EffectInstance, type SubjectMask } from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import { EffectProcessor } from './EffectProcessor';
import { unwrap, type ImportedImage } from '../../shared/image-api';

function freshSeed(previous?: number): number {
  let seed: number;
  do {
    seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  } while (seed === previous);
  return seed;
}
export function VariationDialog({
  image,
  effects,
  masterSeed,
  onApply,
  onClose,
}: {
  image: ImportedImage;
  effects: readonly EffectInstance[];
  masterSeed: number;
  onApply(effects: readonly EffectInstance[]): void;
  onClose(): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [seed, setSeed] = useState(() => freshSeed());
  const [intensity, setIntensity] = useState(0.5);
  const [previews, setPreviews] = useState<ReadonlyMap<string, { image?: string; error?: string }>>(
    new Map(),
  );
  const [retry, setRetry] = useState(0);
  const [applying, setApplying] = useState(false);
  const processor = useRef<EffectProcessor | null>(null);
  const subject = useRef<Promise<SubjectMask> | null>(null);
  const candidates = useMemo(
    () => generateVariations(effects, seed, intensity),
    [effects, seed, intensity],
  );
  const previewKey = useCallback((id: string) => `${id}:${intensity}:${retry}`, [intensity, retry]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = modal.current!;
    dialog.showModal();
    processor.current = new EffectProcessor();
    return () => {
      dialog.close();
      processor.current?.dispose();
      processor.current = null;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const worker = processor.current!;
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        let subjectMask: SubjectMask | undefined;
        if (
          candidates.some((candidate) =>
            effectsNeedSubject(candidate.effects, image.preview.pixels),
          )
        ) {
          subject.current ??= window.gleech
            .subjectMask(image.source.id)
            .then(unwrap)
            .catch((error) => {
              subject.current = null;
              throw error;
            });
          try {
            subjectMask = await subject.current;
          } catch (error) {
            if (active)
              setPreviews(
                new Map(
                  candidates.map((candidate) => [
                    previewKey(candidate.id),
                    {
                      error:
                        error instanceof Error ? error.message : 'Could not detect the subject.',
                    },
                  ]),
                ),
              );
            return;
          }
        }
        if (!active) return;
        for (const candidate of candidates) {
          if (!active) return;
          try {
            const rendered = await worker.render(image.preview, candidate.effects, {
              masterSeed,
              reference: image.source,
              purpose: 'preview',
              previewMaxDimension: 256,
              subjectMask,
            });
            if (!active) return;
            const canvas = document.createElement('canvas');
            canvas.width = rendered.width;
            canvas.height = rendered.height;
            canvas
              .getContext('2d')!
              .putImageData(
                new ImageData(
                  new Uint8ClampedArray(rendered.pixels),
                  rendered.width,
                  rendered.height,
                ),
                0,
                0,
              );
            const preview = canvas.toDataURL('image/png');
            setPreviews(
              (previous) => new Map([...previous, [previewKey(candidate.id), { image: preview }]]),
            );
          } catch (error) {
            if (!active || error instanceof RenderCancelledError) return;
            setPreviews(
              (previous) =>
                new Map([
                  ...previous,
                  [
                    previewKey(candidate.id),
                    {
                      error:
                        error instanceof Error ? error.message : 'Could not render this variation.',
                    },
                  ],
                ]),
            );
          }
        }
      })();
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
      worker.cancelPreview();
    };
  }, [image, candidates, masterSeed, retry, previewKey]);
  const lockedCount = effects.filter((effect) => effect.locked).length;
  return (
    <dialog
      ref={modal}
      className="variation-dialog"
      aria-labelledby="variation-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!applying) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="random-dialog-heading">
        <div>
          <h2 id="variation-title">Variation</h2>
          <p>Choose a variation of your current stack.</p>
        </div>
        <div className="variation-actions">
          <button
            disabled={applying}
            title="Refresh all nine previews with new variations. Keep this slider setting and locked effects."
            onClick={() => {
              setPreviews(new Map());
              setSeed((previous) => freshSeed(previous));
            }}
          >
            New Set
          </button>
          <button disabled={applying} aria-label="Close variations" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <label className="variation-intensity">
        <span>
          GLEECH <output>{Math.round(intensity * 100)}%</output>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={intensity}
          aria-label="GLEECH intensity"
          disabled={applying}
          title="Stable keeps variations closer to the current image. Distorted makes stronger changes. Locked effects remain untouched."
          onChange={(event) => {
            setPreviews(new Map());
            setIntensity(event.target.valueAsNumber);
          }}
        />
        <span className="quiet">
          <span>Stable</span>
          <span>Distorted</span>
        </span>
      </label>
      <div
        className="variation-grid"
        data-set-seed={seed}
        aria-busy={candidates.some((candidate) => !previews.has(previewKey(candidate.id)))}
      >
        {(['close', 'medium', 'distant'] as const).map((similarity, row) => (
          <section key={similarity} aria-label={`${similarity} variations`}>
            <h3>{['More similar', 'Similar', 'Less similar'][row]}</h3>
            <div className="variation-row">
              {candidates
                .filter((candidate) => candidate.similarity === similarity)
                .map((candidate, column) => {
                  const preview = previews.get(previewKey(candidate.id));
                  return (
                    <button
                      className="variation-tile"
                      key={candidate.id}
                      data-candidate-id={candidate.id}
                      disabled={applying || !preview?.image}
                      aria-label={`Apply ${similarity} variation ${column + 1}`}
                      title={
                        preview?.error ??
                        'Apply this preview to your project. Undo restores the original stack.'
                      }
                      onClick={() => {
                        setApplying(true);
                        onApply(candidate.effects);
                      }}
                    >
                      {preview?.image ? (
                        <img src={preview.image} alt={`${similarity} variation ${column + 1}`} />
                      ) : (
                        <span role="status">
                          {preview?.error ? 'Preview unavailable' : 'Rendering…'}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
      <div className="variation-footer">
        <span className="quiet">
          {lockedCount} locked · Select a preview to apply. Closing keeps your current stack.
        </span>
        {[...previews.values()].some((preview) => preview.error) && (
          <button
            onClick={() => {
              processor.current?.dispose();
              processor.current = new EffectProcessor();
              setPreviews(new Map());
              setRetry((x) => x + 1);
            }}
          >
            Retry previews
          </button>
        )}
      </div>
    </dialog>
  );
}
