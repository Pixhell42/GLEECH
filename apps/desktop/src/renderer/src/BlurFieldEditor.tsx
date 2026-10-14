import { useRef, useState } from 'react';
import type { BlurEffect, FieldPointKey } from '@gleech/project-model';
import { InfoTooltip } from './InfoTooltip';

interface Props {
  effect: BlurEffect;
  disabled: boolean;
  imageSize: { width: number; height: number };
  onChange(params: Readonly<Record<string, number | string>>): void;
  beginGesture(): void;
  endGesture(): void;
}
export function BlurFieldEditor({
  effect,
  disabled,
  imageSize,
  onChange,
  beginGesture,
  endGesture,
}: Props) {
  const [selection, setSelection] = useState(0);
  const selected = Math.min(selection, effect.params.pointCount - 1);
  const active = useRef<number | null>(null);
  const key = (index: number, axis: string) => `point${index}${axis}` as FieldPointKey;
  const move = (svg: SVGSVGElement, x: number, y: number, index: number) => {
    const transform = svg.getScreenCTM();
    if (!transform) return;
    const p = new DOMPoint(x, y).matrixTransform(transform.inverse());
    onChange({
      [key(index, 'X')]: Math.round(Math.max(0, Math.min(100, p.x)) * 10) / 10,
      [key(index, 'Y')]: Math.round(Math.max(0, Math.min(100, p.y)) * 10) / 10,
    });
  };
  const finish = () => {
    active.current = null;
    endGesture();
  };
  return (
    <div className="blur-field">
      <span className="control-title">
        Focus field{' '}
        <InfoTooltip
          label="Focus field"
          text="Drag points to position them. Each point has its own radius; zero keeps that spot sharp. Radii interpolate smoothly by inverse squared distance. Add up to eight points. Each drag is one Undo step. Arrow keys move a focused point."
        />
      </span>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
        role="group"
        aria-label="Blur field graph"
        onPointerMove={(event) => {
          if (active.current !== null)
            move(event.currentTarget, event.clientX, event.clientY, active.current);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      >
        <rect x="0" y="0" width="100" height="100" className="field-background" />
        {Array.from({ length: effect.params.pointCount }, (_, i) => (
          <ellipse
            key={i}
            cx={effect.params[key(i, 'X')]}
            cy={effect.params[key(i, 'Y')]}
            rx={selected === i ? 4 : 3}
            ry={((selected === i ? 4 : 3) * imageSize.width) / imageSize.height}
            className={selected === i ? 'field-point selected' : 'field-point'}
            role="slider"
            aria-label={`Field point ${i + 1}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={effect.params[key(i, 'X')]}
            aria-valuetext={`X ${effect.params[key(i, 'X')]}%, Y ${effect.params[key(i, 'Y')]}%`}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : 0}
            onFocus={() => setSelection(i)}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              setSelection(i);
              beginGesture();
              active.current = i;
              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (
                disabled ||
                !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
              )
                return;
              event.preventDefault();
              beginGesture();
              const axis = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? 'X' : 'Y';
              const delta =
                (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) *
                (event.shiftKey ? 10 : 1);
              onChange({
                [key(i, axis)]: Math.max(0, Math.min(100, effect.params[key(i, axis)] + delta)),
              });
            }}
            onKeyUp={endGesture}
            onBlur={finish}
          />
        ))}
      </svg>
      <div className="field-actions">
        <label>
          Selected point{' '}
          <select
            aria-label="Selected field point"
            disabled={disabled}
            value={selected}
            onChange={(e) => setSelection(Number(e.target.value))}
          >
            {Array.from({ length: effect.params.pointCount }, (_, i) => (
              <option key={i} value={i}>
                Point {i + 1}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled || effect.params.pointCount === 8}
          onClick={() => {
            endGesture();
            const index = effect.params.pointCount;
            const position = [
              [50, 50],
              [25, 25],
              [75, 25],
              [25, 75],
              [75, 75],
              [50, 20],
            ][Math.max(0, index - 2)]!;
            onChange({
              pointCount: index + 1,
              [key(index, 'X')]: position[0]!,
              [key(index, 'Y')]: position[1]!,
              [key(index, 'Radius')]: effect.params.radius,
            });
            setSelection(index);
          }}
        >
          Add point
        </button>
        <button
          disabled={disabled || effect.params.pointCount === 1}
          onClick={() => {
            endGesture();
            const changes: Record<string, number> = { pointCount: effect.params.pointCount - 1 };
            for (let i = selected; i < effect.params.pointCount - 1; i++)
              for (const axis of ['X', 'Y', 'Radius'])
                changes[key(i, axis)] = effect.params[key(i + 1, axis)];
            onChange(changes);
            setSelection(Math.max(0, selected - 1));
          }}
        >
          Remove point
        </button>
      </div>
      {(['X', 'Y', 'Radius'] as const).map((axis) => (
        <label
          className="effect-control"
          key={axis}
          data-settings-kind="parameter"
          data-settings-key={key(selected, axis)}
        >
          <span>
            <span className="control-title">
              Point {axis === 'Radius' ? 'radius' : axis}{' '}
              <InfoTooltip
                label={`Point ${axis}`}
                text={
                  axis === 'Radius'
                    ? 'Blur radius at this point, in percent of the shorter original image side.'
                    : 'Position of the selected point as a percentage of the canvas.'
                }
              />
            </span>
            <output>{effect.params[key(selected, axis)].toFixed(1)}%</output>
          </span>
          <input
            aria-label={`Point ${axis === 'Radius' ? 'radius' : axis}`}
            type="range"
            min="0"
            max={axis === 'Radius' ? 10 : 100}
            step=".1"
            value={effect.params[key(selected, axis)]}
            disabled={disabled}
            onPointerDown={(e) => {
              e.currentTarget.focus({ preventScroll: true });
              beginGesture();
            }}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onBlur={endGesture}
            onKeyDown={(e) => {
              if (
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
            onKeyUp={endGesture}
            onChange={(e) => onChange({ [key(selected, axis)]: e.target.valueAsNumber })}
          />
        </label>
      ))}
    </div>
  );
}
