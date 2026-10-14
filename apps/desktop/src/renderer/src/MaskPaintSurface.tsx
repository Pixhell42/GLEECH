import { useCallback, useEffect, useRef } from 'react';
import {
  MAX_MASK_POINTS,
  MAX_MASK_STROKES,
  type PaintedMask,
  type MaskBrush,
  type MaskStroke,
  type MaskPoint,
  DEFAULT_MASK_FRAME,
  maskFrameAffine,
  invertMaskAffine,
  transformMaskPoint,
} from '@gleech/project-model';
import { previewSize } from '@gleech/renderer-core';
import { VectorMaskSurface, type MaskTool } from './VectorMaskSurface';

export interface MaskPainting {
  effectId: string;
  mask: PaintedMask;
  brush: MaskBrush;
  overlay: boolean;
  onCommit(stroke: MaskStroke): void;
  onDone(): void;
  tool: MaskTool;
  feather: number;
  geometryDraft: PaintedMask | null;
  onGeometryDraft(mask: PaintedMask | null): void;
  onMask(mask: PaintedMask): void;
  beginGesture(): void;
  endGesture(): void;
  layer: boolean;
}
export function MaskPaintSurface({
  painting,
  width,
  height,
  pan,
  disabled,
  onDraft,
}: {
  painting: MaskPainting;
  width: number;
  height: number;
  pan: boolean;
  disabled: boolean;
  onDraft(stroke: MaskStroke | null): void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlayWorker = useRef<Worker | null>(null);
  const active = useRef<{ id: number; stroke: MaskStroke; points: MaskPoint[] } | null>(null);
  const frame = useRef<number | null>(null);
  const cursorPoint = useRef<MaskPoint | null>(null);
  const outline = useRef<SVGGElement>(null);
  const remaining =
    painting.mask.strokes.length >= MAX_MASK_STROKES
      ? 0
      : MAX_MASK_POINTS - painting.mask.strokes.reduce((count, s) => count + s.points.length, 0);
  const { mask: baseMask, geometryDraft, overlay } = painting;
  const postOverlay = useCallback(
    (stroke: MaskStroke | null) => {
      if (!overlay) return;
      const mask = stroke
        ? { ...baseMask, strokes: [...baseMask.strokes, stroke] }
        : (geometryDraft ?? baseMask);
      const size = previewSize(width, height, 256);
      overlayWorker.current?.postMessage({ mask, ...size });
    },
    [baseMask, geometryDraft, overlay, width, height],
  );
  const schedule = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const p = cursorPoint.current;
      const element = outline.current;
      if (element) {
        element.style.visibility = p && !pan ? 'visible' : 'hidden';
        if (p) {
          const displayed = transformMaskPoint(
            maskFrameAffine(
              painting.mask.frame ?? DEFAULT_MASK_FRAME,
              painting.mask.width,
              painting.mask.height,
            ),
            p,
          );
          element.setAttribute(
            'transform',
            `translate(${displayed.x * width} ${displayed.y * height}) rotate(${painting.mask.frame?.rotation ?? 0})`,
          );
        }
      }
      const next = active.current
        ? { ...active.current.stroke, points: [...active.current.points] }
        : null;
      if (next) {
        postOverlay(next);
        onDraft(next);
      }
    });
  };
  function point(
    clientX: number,
    clientY: number,
    rect = svg.current!.getBoundingClientRect(),
  ): MaskPoint {
    const local = transformMaskPoint(
      invertMaskAffine(
        maskFrameAffine(
          painting.mask.frame ?? DEFAULT_MASK_FRAME,
          painting.mask.width,
          painting.mask.height,
        ),
      ),
      {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
      },
    );
    return {
      x: Math.max(-1, Math.min(2, local.x)),
      y: Math.max(-1, Math.min(2, local.y)),
    };
  }
  function finish(commit: boolean) {
    const current = active.current;
    active.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    onDraft(null);
    postOverlay(current && commit ? { ...current.stroke, points: [...current.points] } : null);
    if (current && commit) painting.onCommit({ ...current.stroke, points: [...current.points] });
  }
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        if (active.current) finish(false);
        else painting.onDone();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  });
  useEffect(() => {
    const worker = new Worker(new URL('./mask-overlay-worker.ts', import.meta.url), {
      type: 'module',
    });
    overlayWorker.current = worker;
    worker.onmessage = (
      event: MessageEvent<{ width: number; height: number; pixels: ArrayBuffer }>,
    ) => {
      const element = canvas.current;
      if (!element) return;
      const { width, height, pixels } = event.data;
      element.width = width;
      element.height = height;
      element
        .getContext('2d')!
        .putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    };
    return () => {
      worker.terminate();
      overlayWorker.current = null;
    };
  }, []);
  useEffect(() => {
    const element = outline.current,
      p = cursorPoint.current;
    if (!element) return;
    element.style.visibility = p && !pan ? 'visible' : 'hidden';
    if (p) {
      const displayed = transformMaskPoint(
        maskFrameAffine(baseMask.frame ?? DEFAULT_MASK_FRAME, baseMask.width, baseMask.height),
        p,
      );
      element.setAttribute(
        'transform',
        `translate(${displayed.x * width} ${displayed.y * height}) rotate(${baseMask.frame?.rotation ?? 0})`,
      );
    }
  }, [pan, baseMask, width, height]);
  useEffect(() => {
    postOverlay(
      active.current ? { ...active.current.stroke, points: [...active.current.points] } : null,
    );
  }, [postOverlay]);
  const radius = (Math.min(painting.mask.width, painting.mask.height) * painting.brush.size) / 200;
  const maskFrame = painting.mask.frame ?? DEFAULT_MASK_FRAME;
  const rx = ((radius * width) / painting.mask.width) * maskFrame.scaleX,
    ry = ((radius * height) / painting.mask.height) * maskFrame.scaleY;
  return (
    <div
      className="mask-paint-surface"
      data-pan={pan}
      data-disabled={disabled}
      data-settings-kind={painting.layer ? 'effect' : 'mask'}
      data-effect-id={painting.effectId}
    >
      <canvas
        ref={canvas}
        className="mask-overlay-canvas"
        hidden={!painting.overlay}
        aria-hidden="true"
      />
      <svg
        style={{ display: painting.tool === 'brush' ? undefined : 'none' }}
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="application"
        aria-label={painting.layer ? 'Draw layer' : 'Paint effect mask'}
        tabIndex={0}
        onPointerDown={(e) => {
          if (pan || disabled || e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          if (remaining < 1) return;
          e.currentTarget.focus();
          const p = point(e.clientX, e.clientY);
          const mode = painting.mask.inverted
            ? painting.brush.mode === 'paint'
              ? 'erase'
              : 'paint'
            : painting.brush.mode;
          active.current = {
            id: e.pointerId,
            stroke: { ...painting.brush, mode, points: [] },
            points: [p],
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          cursorPoint.current = p;
          schedule();
        }}
        onPointerMove={(e) => {
          if (pan || disabled) return;
          const rect = svg.current!.getBoundingClientRect();
          const p = point(e.clientX, e.clientY, rect);
          cursorPoint.current = p;
          const current = active.current;
          if (!current || current.id !== e.pointerId) {
            schedule();
            return;
          }
          e.stopPropagation();
          const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
          // Preserve the curved pointer path through frames delayed by rendering.
          for (const sample of samples.length ? samples : [e.nativeEvent]) {
            const next = point(sample.clientX, sample.clientY, rect);
            const last = current.points.at(-1)!;
            if (
              current.points.length < remaining &&
              Math.hypot((next.x - last.x) * width, (next.y - last.y) * height) >= 0.25
            )
              current.points.push(next);
          }
          schedule();
        }}
        onPointerUp={(e) => {
          if (active.current?.id !== e.pointerId) return;
          e.stopPropagation();
          const p = point(e.clientX, e.clientY);
          if (active.current.points.length < remaining) active.current.points.push(p);
          finish(true);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={(e) => {
          if (active.current?.id === e.pointerId) finish(true);
        }}
        onLostPointerCapture={(e) => {
          if (active.current?.id === e.pointerId) finish(true);
        }}
        onPointerLeave={() => {
          if (!active.current) {
            cursorPoint.current = null;
            schedule();
          }
        }}
      >
        <g
          ref={outline}
          className="mask-brush-outline"
          data-mode={painting.brush.mode}
          style={{ visibility: 'hidden' }}
        >
          {painting.brush.shape === 'circle' ? (
            <ellipse cx={0} cy={0} rx={rx} ry={ry} vectorEffect="non-scaling-stroke" />
          ) : painting.brush.shape === 'square' ? (
            <rect
              x={-rx}
              y={-ry}
              width={rx * 2}
              height={ry * 2}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <polygon
              points={`0,${-ry} ${rx},0 0,${ry} ${-rx},0`}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      </svg>
      {painting.tool !== 'brush' && !pan && (
        <VectorMaskSurface
          key={painting.tool}
          mask={painting.mask}
          tool={painting.tool}
          width={width}
          height={height}
          disabled={disabled}
          opacity={painting.brush.opacity ?? 1}
          feather={painting.feather}
          onDraft={painting.onGeometryDraft}
          onCommit={painting.onMask}
          beginGesture={painting.beginGesture}
          endGesture={painting.endGesture}
        />
      )}
    </div>
  );
}
