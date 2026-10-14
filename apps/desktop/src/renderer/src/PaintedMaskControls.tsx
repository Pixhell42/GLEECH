import { memo, useEffect, useRef } from 'react';
import { renderPaintedMaskAsync } from '@gleech/effects';
import {
  type PaintedMask,
  type MaskBrush,
  MASK_BRUSH_SHAPES,
  MASK_FALLOFFS,
  MAX_MASK_POINTS,
  MAX_MASK_STROKES,
  DEFAULT_MASK_FRAME,
  attachMaskPattern,
} from '@gleech/project-model';
import { InfoTooltip } from './InfoTooltip';

export const MaskThumbnail = memo(function MaskThumbnail({ mask }: { mask: PaintedMask }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    void renderPaintedMaskAsync(mask, 48, 36, {
      isCancelled: () => !active,
      yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
    }).then((values) => {
      if (!active || !values || !canvas.current) return;
      const pixels = new Uint8ClampedArray(values.length * 4);
      for (let i = 0; i < values.length; i++) {
        const v = Math.round(values[i]! * 255);
        pixels.set([v, v, v, 255], i * 4);
      }
      canvas.current.getContext('2d')!.putImageData(new ImageData(pixels, 48, 36), 0, 0);
    });
    return () => {
      active = false;
    };
  }, [mask]);
  return <canvas ref={canvas} width={48} height={36} aria-label="Painted mask thumbnail" />;
});

export function PaintedMaskControls({
  effectId,
  brush,
  onBrush,
  overlay,
  onOverlay,
  onDone,
  onEnable,
  onClear,
  onInvert,
  onRemove,
  disabled,
  mask,
  shader,
  onMask,
  onFill,
  beginGesture,
  endGesture,
}: {
  effectId: string;
  brush: MaskBrush;
  onBrush(brush: MaskBrush): void;
  overlay: boolean;
  onOverlay(value: boolean): void;
  onDone(): void;
  onEnable(enabled: boolean): void;
  onClear(): void;
  onInvert(): void;
  onRemove(): void;
  disabled: boolean;
  mask: PaintedMask;
  shader: boolean;
  onMask(mask: PaintedMask): void;
  onFill(): void;
  beginGesture(): void;
  endGesture(): void;
}) {
  const full =
    mask.strokes.length >= MAX_MASK_STROKES ||
    mask.strokes.reduce((total, stroke) => total + stroke.points.length, 0) >= MAX_MASK_POINTS;
  return (
    <section
      className="mask-controls"
      aria-label="Mask painting controls"
      onPointerDownCapture={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === 'range') beginGesture();
      }}
      onPointerUpCapture={endGesture}
      onPointerCancelCapture={endGesture}
      onKeyDownCapture={(e) => {
        if (
          e.target instanceof HTMLInputElement &&
          e.target.type === 'range' &&
          [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End',
            'PageUp',
            'PageDown',
          ].includes(e.key)
        )
          beginGesture();
      }}
      onKeyUpCapture={endGesture}
      onBlurCapture={endGesture}
    >
      <div className="mask-controls-heading" data-settings-kind="mask" data-effect-id={effectId}>
        Paint mask{' '}
        <InfoTooltip
          label="Paint mask"
          text="Paint reveals this effect; Erase hides it. Red shows hidden areas. Masks stay fixed to the image canvas and combine with Application coverage. Hold Space to pan, or choose Done (Esc) to leave painting."
        />
        <button onClick={onDone}>Done</button>
      </div>
      <label className="mask-enabled-control">
        Mask enabled
        <input
          type="checkbox"
          role="switch"
          aria-label="Enable painted mask"
          checked={mask.enabled}
          disabled={disabled}
          onChange={(event) => onEnable(event.target.checked)}
        />
      </label>
      <div className="mask-mode-controls">
        {(['paint', 'erase'] as const).map((mode) => (
          <button
            key={mode}
            disabled={disabled}
            aria-pressed={brush.mode === mode}
            onClick={() => onBrush({ ...brush, mode })}
          >
            {mode === 'paint' ? 'Paint' : 'Erase'}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          aria-pressed={mask.inverted}
          onClick={onInvert}
          title="Swap the visible and hidden areas of this mask."
        >
          Invert
        </button>
      </div>
      <label className="mask-choice">
        Brush shape{' '}
        <select
          aria-label="Brush shape"
          value={brush.shape}
          disabled={disabled}
          onChange={(e) => onBrush({ ...brush, shape: e.target.value as MaskBrush['shape'] })}
        >
          {MASK_BRUSH_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {shape[0]!.toUpperCase() + shape.slice(1)}
            </option>
          ))}
        </select>
      </label>
      {(['size', 'hardness', 'opacity'] as const).map((key) => (
        <label className="mask-slider" key={key}>
          <span>
            {key === 'size' ? 'Brush size' : key === 'hardness' ? 'Hardness' : 'Opacity'}{' '}
            <InfoTooltip
              label={
                key === 'size' ? 'Brush size' : key === 'hardness' ? 'Hardness' : 'Mask opacity'
              }
              text={
                key === 'size'
                  ? 'Brush diameter as a percentage of the image’s shorter side. It stays the same size in image pixels when you zoom.'
                  : key === 'hardness'
                    ? 'The solid center of the brush. At 100% the edge is clipped; lower values give the selected falloff more space.'
                    : 'Strength of a painted stroke or new shape. Repeated strokes build up coverage.'
              }
            />
            <output>
              {key === 'size' ? Number(brush.size.toFixed(1)) : Math.round((brush[key] ?? 1) * 100)}
              %
            </output>
          </span>
          <input
            type="range"
            aria-label={
              key === 'size' ? 'Brush size' : key === 'hardness' ? 'Mask hardness' : 'Mask opacity'
            }
            min={key === 'size' ? 0.1 : 0}
            max={key === 'size' ? 100 : 1}
            step={key === 'size' ? 0.1 : 0.01}
            value={brush[key] ?? 1}
            disabled={disabled}
            onChange={(e) => onBrush({ ...brush, [key]: e.target.valueAsNumber })}
          />
        </label>
      ))}
      <details className="mask-transform-controls">
        <summary>Mask transform</summary>
        {(['x', 'y', 'scaleX', 'scaleY', 'rotation'] as const).map((key) => (
          <label className="mask-slider" key={key}>
            <span>
              {
                {
                  x: 'Move X',
                  y: 'Move Y',
                  scaleX: 'Scale X',
                  scaleY: 'Scale Y',
                  rotation: 'Rotate',
                }[key]
              }{' '}
              <output>
                {Number((mask.frame ?? DEFAULT_MASK_FRAME)[key].toFixed(2))}
                {key === 'rotation' ? '°' : key === 'x' || key === 'y' ? '%' : '×'}
              </output>
            </span>
            <input
              type="range"
              aria-label={`Mask ${key}`}
              min={key === 'rotation' ? -180 : key === 'x' || key === 'y' ? -100 : 0.1}
              max={key === 'rotation' ? 180 : key === 'x' || key === 'y' ? 100 : 4}
              step={0.01}
              value={(mask.frame ?? DEFAULT_MASK_FRAME)[key]}
              disabled={disabled}
              onChange={(e) =>
                onMask({
                  ...mask,
                  frame: { ...(mask.frame ?? DEFAULT_MASK_FRAME), [key]: e.target.valueAsNumber },
                })
              }
            />
          </label>
        ))}
        <button disabled={disabled} onClick={() => onMask({ ...mask, frame: DEFAULT_MASK_FRAME })}>
          Reset transform
        </button>
      </details>
      {shader && (
        <label className="mask-overlay-toggle">
          <input
            type="checkbox"
            aria-label="Attach shader pattern"
            checked={mask.pattern?.attached ?? false}
            disabled={disabled}
            onChange={(e) => onMask(attachMaskPattern(mask, e.target.checked))}
          />
          Attach shader pattern{' '}
          <InfoTooltip
            label="Attach shader pattern"
            text="Attached patterns follow the mask’s Move, Scale and Rotate controls. Detached patterns stay on the stage canvas. Switching attachment preserves the current appearance and seed; effect locks still control GLEECH randomization."
          />
        </label>
      )}
      <label className="mask-choice">
        Falloff{' '}
        <InfoTooltip
          label="Mask falloff"
          text="How the soft edge fades: Linear is an even ramp, Smooth eases into and out of the fade, and Gaussian has a rounded photographic falloff. Hardness at 100% disables the fade."
        />
        <select
          aria-label="Mask falloff"
          value={brush.falloff}
          disabled={disabled || brush.hardness === 1}
          onChange={(e) => onBrush({ ...brush, falloff: e.target.value as MaskBrush['falloff'] })}
        >
          {MASK_FALLOFFS.map((falloff) => (
            <option key={falloff} value={falloff}>
              {falloff[0]!.toUpperCase() + falloff.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="mask-overlay-toggle">
        <input type="checkbox" checked={overlay} onChange={(e) => onOverlay(e.target.checked)} />
        Show mask overlay
      </label>
      <div className="mask-actions">
        <button
          disabled={disabled}
          onClick={onFill}
          title="Reveal the whole effect. Erase to hide parts."
        >
          Fill
        </button>
        <button
          disabled={disabled}
          onClick={onClear}
          title="Clear painted areas. This effect will be hidden until you paint again."
        >
          Clear
        </button>
        <button
          disabled={disabled}
          onClick={onRemove}
          title="Remove the painted mask and apply this effect across its Application region."
        >
          Remove mask
        </button>
      </div>
      {full && (
        <p role="status">
          This mask is full. Clear it to paint again, or bake this stage and start a new mask.
        </p>
      )}
    </section>
  );
}
