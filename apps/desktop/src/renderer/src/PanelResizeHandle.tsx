import { useEffect, useRef, type PointerEvent } from 'react';

export function PanelResizeHandle({
  side,
  width,
  min,
  max,
  onResize,
  onFinish,
}: {
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onResize(width: number): void;
  onFinish(): void;
}) {
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const pending = useRef<number | null>(null);
  const flush = () => {
    if (pending.current !== null) {
      onResize(pending.current);
      pending.current = null;
    }
  };
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      document.body.classList.remove('resizing-panels');
    },
    [],
  );
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    flush();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.classList.remove('resizing-panels');
    onFinish();
  };
  return (
    <div
      className={`panel-resize-handle resize-${side}`}
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${side} panel`}
      aria-orientation="vertical"
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(width)}
      title="Drag to resize. Arrow keys adjust width; Home restores the minimum."
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { pointer: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.classList.add('resizing-panels');
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        pending.current = start.width + (event.clientX - start.x) * (side === 'left' ? 1 : -1);
        if (frame.current === null)
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            flush();
          });
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        onResize(
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : width +
                (event.key === 'ArrowRight' ? 1 : -1) *
                  (side === 'left' ? 1 : -1) *
                  (event.shiftKey ? 40 : 10),
        );
        onFinish();
      }}
    />
  );
}
