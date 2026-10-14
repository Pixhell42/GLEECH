import type { PreviewBackdrop } from './preview-backdrop';
import { withoutImageData } from '@gleech/project-model';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FitIcon } from './Icons';
import {
  PreviewRenderer,
  fitImage,
  zoomAt,
  type ViewTransform,
  type RenderInfo,
  type ExportPixels,
  type PixelImage,
  needsInteractivePreview,
  InteractivePreviewBudget,
  PREVIEW_REFINE_DELAY_MS,
} from '@gleech/renderer-core';
import {
  effectsNeedSubject,
  type ImageSource,
  type EffectInstance,
  type SubjectMask,
  type MaskStroke,
} from '@gleech/project-model';
import { RenderCancelledError } from '@gleech/effects';
import type { ImportedImage } from '../../shared/image-api';
import { EffectProcessor } from './EffectProcessor';
import { MaskPaintSurface, type MaskPainting } from './MaskPaintSurface';

export interface ViewportHandle {
  showImage(
    image: ImportedImage,
    effects?: readonly EffectInstance[],
    masterSeed?: number,
  ): Promise<void>;
  clearImage(): void;
  cancelRender(): void;
  exportPixels(
    image: PixelImage,
    effects?: readonly EffectInstance[],
    masterSeed?: number,
    signal?: AbortSignal,
  ): Promise<ExportPixels>;
}

interface Props {
  backdrop: PreviewBackdrop;
  controlsContainer: HTMLDivElement | null;
  comparisonContainer: HTMLDivElement | null;
  effects: readonly EffectInstance[];
  masterSeed: number;
  busy: boolean;
  onOpen(): void;
  onOpenSample(): void;
  onDrop(file: File): void;
  onError(message: string): void;
  onInfo(info: RenderInfo): void;
  originalPixels(id: string): Promise<PixelImage>;
  maskPainting: MaskPainting | null;
  feedback: { text: string; id: number } | null;
}

function maskDraftRecipe(
  effects: readonly EffectInstance[],
  target: string | undefined,
  stroke: MaskStroke | null,
): readonly EffectInstance[] {
  return stroke && target
    ? effects.map((effect) =>
        effect.instanceId === target && effect.paintedMask
          ? {
              ...effect,
              paintedMask: {
                ...effect.paintedMask,
                strokes: [...effect.paintedMask.strokes, stroke],
              },
            }
          : effect,
      )
    : effects;
}

export const ImageViewport = forwardRef<ViewportHandle, Props>(function ImageViewport(
  {
    backdrop,
    controlsContainer,
    comparisonContainer,
    effects,
    masterSeed,
    busy,
    onOpen,
    onOpenSample,
    onDrop,
    onError,
    onInfo,
    originalPixels,
    maskPainting,
    feedback,
  },
  ref,
) {
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const ready = useRef<Promise<PreviewRenderer> | null>(null);
  const current = useRef<{
    source: ImageSource;
    raw: PixelImage;
    previewWidth: number;
    full: boolean;
    subject?: Promise<SubjectMask>;
  } | null>(null);
  const processor = useRef<EffectProcessor | null>(null);
  const recipe = useRef(effects);
  const baseRecipe = useRef(effects);
  const maskStroke = useRef<MaskStroke | null>(null);
  const seed = useRef(masterSeed);
  const comparison = useRef(false);
  const editedCache = useRef<{
    raw: PixelImage;
    effects: readonly EffectInstance[];
    seed: number;
    pixels: PixelImage;
  } | null>(null);
  const revision = useRef(0);
  const rendering = useRef<Promise<void> | null>(null);
  const previewPhase = useRef<'draft' | 'detail' | 'waiting'>('detail');
  const draftImage = useRef<PixelImage | null>(null);
  const previewBudget = useRef(new InteractivePreviewBudget());
  const budgetSource = useRef<PixelImage | null>(null);
  const wakeRefine = useRef<(() => void) | null>(null);
  const painting = useRef(maskPainting);
  const transform = useRef<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const fitMode = useRef(true);
  const fetching = useRef<string | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; view: ViewTransform } | null>(null);
  const frame = useRef<number | null>(null);
  const paintedScale = useRef<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [backdropSource, setBackdropSource] = useState<string | null>(null);
  const [source, setSource] = useState<ImageSource | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [originalView, setOriginalView] = useState(false);
  const [heldOriginal, setHeldOriginal] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [detectingSubject, setDetectingSubject] = useState(false);
  const [maskPan, setMaskPan] = useState(false);
  const paintingEffectId = maskPainting?.effectId;

  const apply = useCallback((next: ViewTransform) => {
    transform.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const element = layer.current;
      if (!element) return;
      const view = transform.current;
      // Pan only moves the composited image; it never renders React or uploads pixels.
      element.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
      if (paintedScale.current !== view.scale) {
        element.style.backgroundSize = `${32 / view.scale}px ${32 / view.scale}px`;
        paintedScale.current = view.scale;
        setZoom(view.scale);
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  const renderCurrent = useCallback((): Promise<void> => {
    revision.current++;
    wakeRefine.current?.();
    if (layer.current) layer.current.dataset.requestedRevision = String(revision.current);
    // Let a small in-flight preview finish so a continuous slider drag still
    // paints frames. Full-detail work is cancelled as soon as controls change.
    if (
      previewPhase.current !== 'draft' ||
      draftImage.current !== current.current?.raw ||
      comparison.current
    )
      processor.current?.cancelPreview();
    if (rendering.current) return rendering.current;
    setPreviewBusy(true);
    const render = async () => {
      const renderer = await ready.current;
      if (!renderer) throw new Error('The viewport is not ready.');
      while (current.current) {
        const image = current.current;
        const version = revision.current;
        const effects = recipe.current;
        const masterSeed = seed.current;
        const original = comparison.current;
        const raw = image.raw;
        if (budgetSource.current !== raw) {
          previewBudget.current.reset();
          budgetSource.current = raw;
        }
        const started = performance.now();
        let pixels = raw;
        const progressive =
          !original && (needsInteractivePreview(raw, effects) || painting.current !== null);
        let cached = false;
        if (!original && effects.some((effect) => effect.enabled && effect.params.amount > 0)) {
          const cache = editedCache.current;
          if (cache?.raw === raw && cache.effects === effects && cache.seed === masterSeed) {
            pixels = cache.pixels;
            cached = true;
          } else {
            try {
              let subjectMask: SubjectMask | undefined;
              if (effectsNeedSubject(effects, raw.pixels)) {
                setDetectingSubject(true);
                image.subject ??= window.gleech.subjectMask(image.source.id).then((result) => {
                  if (!result.ok) {
                    delete image.subject;
                    throw new Error(result.error);
                  }
                  return result.value;
                });
                try {
                  subjectMask = await image.subject;
                } finally {
                  setDetectingSubject(false);
                }
                if (current.current !== image || raw !== image.raw || version !== revision.current)
                  continue;
              }
              previewPhase.current = progressive ? 'draft' : 'detail';
              draftImage.current = raw;
              pixels = await processor.current!.render(raw, effects, {
                masterSeed,
                reference: image.source,
                purpose: 'preview',
                subjectMask,
                ...(progressive ? { previewMaxDimension: previewBudget.current.maximum } : {}),
                ...(maskStroke.current && painting.current
                  ? { activeMaskId: painting.current.effectId }
                  : {}),
              });
              if (
                progressive &&
                current.current === image &&
                raw === image.raw &&
                !comparison.current
              ) {
                await renderer.show(pixels);
                previewBudget.current.record(performance.now() - started);
                if (layer.current) {
                  layer.current.dataset.previewQuality = 'interactive';
                  layer.current.dataset.previewWidth = String(pixels.width);
                  layer.current.dataset.interactiveRevision = String(version);
                  layer.current.dataset.interactiveRenderMs = String(performance.now() - started);
                  layer.current.dataset.previewBudgetMaximum = String(
                    previewBudget.current.maximum,
                  );
                  layer.current.dataset.interactiveFrames = String(
                    Number(layer.current.dataset.interactiveFrames ?? 0) + 1,
                  );
                }
                if (version !== revision.current) continue;
                // Keep the active stroke on the fast raster. A pause while the
                // pointer is still down must not start expensive full-detail work.
                // Committing the stroke requests the exact refinement normally.
                if (maskStroke.current) return;
                previewPhase.current = 'waiting';
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(() => {
                    wakeRefine.current = null;
                    resolve();
                  }, PREVIEW_REFINE_DELAY_MS);
                  wakeRefine.current = () => {
                    clearTimeout(timer);
                    wakeRefine.current = null;
                    resolve();
                  };
                });
                if (current.current !== image || raw !== image.raw || version !== revision.current)
                  continue;
                previewPhase.current = 'detail';
                pixels = await processor.current!.render(raw, effects, {
                  masterSeed,
                  reference: image.source,
                  purpose: 'preview',
                  subjectMask,
                });
              }
            } catch (error) {
              if (error instanceof RenderCancelledError) continue;
              throw error;
            }
          }
        }
        if (current.current !== image || raw !== image.raw || version !== revision.current)
          continue;
        if (!original) editedCache.current = { raw, effects, seed: masterSeed, pixels };
        previewPhase.current = 'detail';
        await renderer.show(pixels);
        if (version !== revision.current) continue;
        if (layer.current) {
          layer.current.dataset.renderRecipe = JSON.stringify(effects.map(withoutImageData));
          layer.current.dataset.renderSource = image.source.id;
          layer.current.dataset.renderRevision = String(version);
          layer.current.dataset.renderSeed = String(masterSeed);
          layer.current.dataset.renderMode = original ? 'original' : 'edited';
          layer.current.dataset.previewQuality = 'full';
          layer.current.dataset.previewWidth = String(pixels.width);
          layer.current.dataset.previewCache = cached ? 'hit' : 'miss';
          layer.current.dataset.renderMs = String(performance.now() - started);
          layer.current.dataset.shaderBackend = pixels.shaderBackend ?? '';
          layer.current.dataset.shaderReason = pixels.shaderReason ?? '';
          layer.current.dataset.cancelledPreviews = String(
            processor.current?.cancelledPreviews ?? 0,
          );
        }
        if (version === revision.current) return;
      }
    };
    const task = render();
    rendering.current = task;
    void task.then(
      () => {
        rendering.current = null;
        setPreviewBusy(false);
      },
      () => {
        rendering.current = null;
        setPreviewBusy(false);
      },
    );
    return task;
  }, []);

  useEffect(() => {
    painting.current = maskPainting;
    if (!maskPainting) maskStroke.current = null;
  }, [maskPainting]);
  useEffect(() => {
    maskStroke.current = null;
    if (!paintingEffectId) return;
    setOriginalView(false);
    setHeldOriginal(false);
  }, [paintingEffectId]);
  useEffect(() => {
    baseRecipe.current = effects;
    recipe.current = maskDraftRecipe(effects, painting.current?.effectId, maskStroke.current);
    seed.current = masterSeed;
    comparison.current = originalView || heldOriginal;
    if (current.current)
      void renderCurrent().catch((error) => {
        onError(error instanceof Error ? error.message : 'Could not render effects.');
      });
  }, [effects, masterSeed, originalView, heldOriginal, onError, renderCurrent]);

  const draftMaskStroke = useCallback(
    (stroke: MaskStroke | null) => {
      maskStroke.current = stroke;
      const target = painting.current?.effectId;
      recipe.current = maskDraftRecipe(baseRecipe.current, target, stroke);
      if (current.current)
        void renderCurrent().catch((error) => {
          onError(error instanceof Error ? error.message : 'Could not render mask.');
        });
    },
    [onError, renderCurrent],
  );

  useEffect(() => {
    const release = () => {
      setHeldOriginal(false);
      setMaskPan(false);
    };
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  }, []);

  const upgradeDetail = useCallback(
    async (scale: number) => {
      const image = current.current;
      if (
        !image ||
        image.full ||
        fetching.current ||
        image.source.width * scale * devicePixelRatio <= image.previewWidth
      )
        return;
      fetching.current = image.source.id;
      setLoadingDetail(true);
      try {
        const pixels = await originalPixels(image.source.id);
        if (current.current !== image) return;
        const renderer = await ready.current;
        if (!renderer || current.current !== image) return;
        image.raw = pixels;
        image.full = true;
        await renderCurrent();
      } catch (error) {
        if (current.current === image)
          onError(error instanceof Error ? error.message : 'Could not load image detail.');
      } finally {
        fetching.current = null;
        setLoadingDetail(false);
      }
    },
    [onError, originalPixels, renderCurrent],
  );

  const changeZoom = useCallback(
    (scale: number, point?: { x: number; y: number }) => {
      if (!current.current || !stage.current) return;
      fitMode.current = false;
      const next = zoomAt(
        transform.current,
        scale,
        point ?? { x: stage.current.clientWidth / 2, y: stage.current.clientHeight / 2 },
      );
      apply(next);
      void upgradeDetail(next.scale);
    },
    [apply, upgradeDetail],
  );

  const fit = useCallback(() => {
    if (!current.current || !stage.current) return;
    fitMode.current = true;
    const next = fitImage(current.current.source, {
      width: stage.current.clientWidth,
      height: stage.current.clientHeight,
    });
    // Fit never enlarges above native display resolution.
    if (next.scale > 1 / devicePixelRatio) {
      next.scale = 1 / devicePixelRatio;
      next.x = (stage.current.clientWidth - current.current.source.width * next.scale) / 2;
      next.y = (stage.current.clientHeight - current.current.source.height * next.scale) / 2;
    }
    apply(next);
    void upgradeDetail(next.scale);
  }, [apply, upgradeDetail]);

  useEffect(() => {
    const host = surface.current;
    const container = stage.current;
    if (!host || !container) return;
    // Separate hosts avoid an old StrictMode initialization replacing a newer canvas.
    const rendererHost = document.createElement('div');
    host.replaceChildren(rendererHost);
    let active = true;
    const effectProcessor = new EffectProcessor();
    processor.current = effectProcessor;
    const promise = PreviewRenderer.create(rendererHost, (info) => {
      if (active) onInfo(info);
    });
    ready.current = promise;
    const observer = new ResizeObserver(() => {
      if (fitMode.current) fit();
    });
    observer.observe(container);
    const wheel = (event: WheelEvent) => {
      if (!current.current) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      changeZoom(transform.current.scale * Math.exp(-event.deltaY * 0.0015), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    container.addEventListener('wheel', wheel, { passive: false });
    return () => {
      active = false;
      wakeRefine.current?.();
      effectProcessor.dispose();
      observer.disconnect();
      container.removeEventListener('wheel', wheel);
      void promise.then((renderer) => renderer.dispose());
    };
  }, [changeZoom, fit, onInfo]);

  useImperativeHandle(
    ref,
    () => ({
      cancelRender() {
        processor.current?.cancelAll();
      },
      clearImage() {
        maskStroke.current = null;
        current.current = null;
        revision.current++;
        wakeRefine.current?.();
        editedCache.current = null;
        processor.current?.cancelPreview();
        setSource(null);
      },
      async showImage(image, nextEffects = recipe.current, nextSeed = seed.current) {
        maskStroke.current = null;
        const renderer = await ready.current;
        if (!renderer) throw new Error('The viewport is still starting. Please try again.');
        const previous = current.current;
        const oldRecipe = recipe.current;
        const oldBaseRecipe = baseRecipe.current;
        const oldSeed = seed.current;
        recipe.current = nextEffects;
        baseRecipe.current = nextEffects;
        seed.current = nextSeed;
        current.current = {
          source: image.source,
          raw: image.preview,
          previewWidth: image.preview.width,
          full: image.preview.width === image.source.width,
        };
        try {
          await renderCurrent();
        } catch (error) {
          current.current = previous;
          recipe.current = oldRecipe;
          baseRecipe.current = oldBaseRecipe;
          seed.current = oldSeed;
          editedCache.current = null;
          if (previous) await renderCurrent().catch(() => {});
          throw error;
        }
        const backdropCanvas = document.createElement('canvas');
        backdropCanvas.width = image.preview.width;
        backdropCanvas.height = image.preview.height;
        backdropCanvas
          .getContext('2d')!
          .putImageData(
            new ImageData(
              new Uint8ClampedArray(image.preview.pixels),
              image.preview.width,
              image.preview.height,
            ),
            0,
            0,
          );
        setBackdropSource(backdropCanvas.toDataURL('image/png'));
        setSource(image.source);
        fit();
      },
      async exportPixels(image, effects = recipe.current, masterSeed = seed.current, signal) {
        const renderer = await ready.current;
        if (!renderer) throw new Error('The viewport is not ready.');
        let subjectMask: SubjectMask | undefined;
        if (effectsNeedSubject(effects, image.pixels)) {
          const id = current.current?.source.id;
          if (!id) throw new Error('Open an image before exporting.');
          const result = await window.gleech.subjectMask(id);
          if (!result.ok) throw new Error(result.error);
          subjectMask = result.value;
        }
        signal?.throwIfAborted();
        const rendered = effects.some((effect) => effect.enabled && effect.params.amount > 0)
          ? await processor.current!.render(image, effects, {
              masterSeed,
              reference: image,
              purpose: 'export',
              subjectMask,
            })
          : image;
        signal?.throwIfAborted();
        return renderer.exportPixels(rendered);
      },
    }),
    [fit, renderCurrent],
  );

  return (
    <main
      className={`viewport${dropActive ? ' drop-active' : ''}`}
      aria-label="Image viewport"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
        if (!busy) setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        if (busy) return;
        if (event.dataTransfer.files.length !== 1) {
          onError('Drop one image at a time.');
          return;
        }
        const file = event.dataTransfer.files[0];
        if (file) onDrop(file);
      }}
    >
      <div
        className="viewport-stage"
        ref={stage}
        tabIndex={0}
        aria-label="Pan and zoom image"
        onKeyDown={(event) => {
          if (event.code === 'Space') {
            event.preventDefault();
            if (maskPainting) setMaskPan(true);
            else if (source) setHeldOriginal(true);
          }
          if (event.key === 'Home') {
            event.preventDefault();
            fit();
          }
          if (event.key === '1') {
            event.preventDefault();
            changeZoom(1 / devicePixelRatio);
          }
        }}
        onKeyUp={(event) => {
          if (event.code === 'Space') {
            event.preventDefault();
            setHeldOriginal(false);
            setMaskPan(false);
          }
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setHeldOriginal(false);
          setMaskPan(false);
        }}
        onPointerDown={(event) => {
          if (!source || ![0, 1].includes(event.button)) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            view: transform.current,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          fitMode.current = false;
          apply({
            ...start.view,
            x: start.view.x + event.clientX - start.x,
            y: start.view.y + event.clientY - start.y,
          });
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <div
          ref={layer}
          className="image-layer"
          data-testid="image-layer"
          data-preview-backdrop={backdrop.mode}
          hidden={!source}
          style={{
            backgroundColor:
              backdrop.mode === 'black'
                ? '#000000'
                : backdrop.mode === 'white'
                  ? '#ffffff'
                  : backdrop.mode === 'custom'
                    ? backdrop.color
                    : undefined,
            backgroundImage:
              backdrop.mode === 'checkerboard'
                ? undefined
                : backdrop.mode === 'overlay' && backdropSource
                  ? `linear-gradient(#ff386455,#ff386455), url("${backdropSource}")`
                  : 'none',
            backgroundSize: backdrop.mode === 'overlay' ? '100% 100%' : undefined,
            width: source?.width ?? 1,
            height: source?.height ?? 1,
          }}
        >
          <div className="image-surface" ref={surface} />
          {source && maskPainting && (
            <MaskPaintSurface
              key={`${source.id}:${maskPainting.effectId}`}
              painting={maskPainting}
              onDraft={draftMaskStroke}
              width={source.width}
              height={source.height}
              pan={maskPan}
              disabled={busy}
            />
          )}
        </div>
        {!source && (
          <div className="empty-state">
            <div className="image-mark" aria-hidden="true">
              ＋
            </div>
            <h2>It's not broken. It's just a GLEECH.</h2>
            <p>Drop an image here, open a file, or paste from your clipboard.</p>
            <div className="empty-image-actions">
              <button className="primary-button" onClick={onOpen} disabled={busy}>
                Choose image
              </button>
              <button
                onClick={onOpenSample}
                disabled={busy}
                title="Try the unfiltered statue head included with GLEECH."
              >
                Try sample image
              </button>
            </div>
            <span className="empty-hint">PNG · JPEG · WebP</span>
          </div>
        )}
        {dropActive && <div className="drop-overlay">Drop to open image</div>}
        {source && (originalView || heldOriginal) && (
          <div className="comparison-badge">Original</div>
        )}
        {(feedback || loadingDetail || previewBusy) && source && (
          <div className="detail-loading" role="status">
            {feedback ? (
              <span key={feedback.id} data-feedback-id={feedback.id}>
                {feedback.text}
              </span>
            ) : loadingDetail ? (
              'Loading full image detail…'
            ) : detectingSubject ? (
              'Detecting subject…'
            ) : (
              'Updating preview…'
            )}
          </div>
        )}
      </div>
      {controlsContainer &&
        createPortal(
          <div className="viewport-tools" aria-label="Viewport controls">
            <div className="viewport-zoom-controls">
              <button
                aria-label="Zoom out"
                onClick={() => changeZoom(transform.current.scale / 1.25)}
                disabled={!source}
              >
                −
              </button>
              <button
                aria-label="Actual pixels"
                title="Actual pixels (1)"
                disabled={!source}
                onClick={() => changeZoom(1 / devicePixelRatio)}
              >
                <output aria-label="Current zoom">
                  {source ? `${Math.round(zoom * devicePixelRatio * 100)}%` : '—'}
                </output>
              </button>
              <button
                aria-label="Zoom in"
                onClick={() => changeZoom(transform.current.scale * 1.25)}
                disabled={!source}
              >
                ＋
              </button>
            </div>
            <div className="viewport-view-controls">
              <button onClick={fit} disabled={!source} title="Fit image (Home)" aria-label="Fit">
                <FitIcon />
              </button>
            </div>
          </div>,
          controlsContainer,
        )}
      {comparisonContainer &&
        createPortal(
          <div className="compare-controls" aria-label="Image comparison">
            <button
              disabled={!source || maskPainting !== null}
              aria-pressed={!(originalView || heldOriginal)}
              onClick={() => setOriginalView(false)}
            >
              Edited
            </button>
            <button
              disabled={!source || maskPainting !== null}
              aria-pressed={originalView || heldOriginal}
              onClick={() => setOriginalView(true)}
              title="Original image. Hold Space in the viewport for a temporary comparison."
            >
              Original
            </button>
          </div>,
          comparisonContainer,
        )}
    </main>
  );
});
