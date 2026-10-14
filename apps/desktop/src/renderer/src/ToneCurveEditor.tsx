import { useRef } from 'react';
import { createCurveSampler } from '@gleech/effects';
import { CURVE_KEYS, EFFECT_DEFINITIONS, type LevelsCurvesEffect } from '@gleech/project-model';
import { InfoTooltip } from './InfoTooltip';

interface Props {
  effect: LevelsCurvesEffect;
  disabled: boolean;
  onChange(params: Readonly<Record<string, number | string>>): void;
  beginGesture(): void;
  endGesture(): void;
}

export function ToneCurveEditor({ effect, disabled, onChange, beginGesture, endGesture }: Props) {
  const active = useRef<number | null>(null);
  const sample = createCurveSampler(effect.params);
  const path = Array.from(
    { length: 129 },
    (_, i) => `${i === 0 ? 'M' : 'L'} ${(i * 100) / 128} ${100 - sample(i / 128) * 100}`,
  ).join(' ');
  const changeAt = (svg: SVGSVGElement, clientY: number, index: number) => {
    const transform = svg.getScreenCTM();
    if (!transform) return;
    const point = new DOMPoint(0, clientY).matrixTransform(transform.inverse());
    onChange({
      [CURVE_KEYS[index]!]: Math.round(Math.max(0, Math.min(1, 1 - point.y / 100)) * 100) / 100,
    });
  };
  const finish = () => {
    active.current = null;
    endGesture();
  };
  return (
    <div className="tone-curve">
      <span className="control-title">
        Tonal curve{' '}
        <InfoTooltip
          label="Tonal curve"
          text="Input brightness runs left to right; output brightness runs bottom to top. Drag any of the five points vertically. Focus a point and use Up/Down to adjust it. The diagonal is unchanged brightness; raising points brightens their tones. Each drag is one Undo step."
        />
      </span>
      <svg
        viewBox="-10 -10 120 120"
        role="group"
        aria-label="Tonal curve graph"
        tabIndex={-1}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          const transform = event.currentTarget.getScreenCTM();
          if (!transform) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
            transform.inverse(),
          );
          const index = Math.max(0, Math.min(4, Math.round(point.x / 25)));
          active.current = index;
          beginGesture();
          event.currentTarget.setPointerCapture(event.pointerId);
          changeAt(event.currentTarget, event.clientY, index);
        }}
        onPointerMove={(event) => {
          if (active.current !== null) changeAt(event.currentTarget, event.clientY, active.current);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      >
        <rect x="0" y="0" width="100" height="100" className="curve-backdrop" />
        {[0, 25, 50, 75, 100].map((position) => (
          <g key={position} className="curve-grid">
            <line x1={position} y1="0" x2={position} y2="100" />
            <line x1="0" y1={position} x2="100" y2={position} />
          </g>
        ))}
        <path d="M 0 100 L 100 0" className="curve-identity" />
        <path d={path} className="curve-result" />
        {CURVE_KEYS.map((key, i) => (
          <circle
            key={key}
            data-settings-kind="parameter"
            data-settings-key={key}
            cx={i * 25}
            cy={100 - effect.params[key] * 100}
            r="3"
            className="curve-point"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`${EFFECT_DEFINITIONS['levels-curves'].parameters[key]!.label} graph handle`}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(effect.params[key] * 100)}
            aria-disabled={disabled}
            onKeyDown={(event) => {
              if (
                disabled ||
                !['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
              )
                return;
              event.preventDefault();
              beginGesture();
              const value =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 1
                    : effect.params[key] +
                      (event.key === 'ArrowUp'
                        ? 0.01
                        : event.key === 'ArrowDown'
                          ? -0.01
                          : event.key === 'PageUp'
                            ? 0.1
                            : -0.1);
              onChange({ [key]: Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 });
            }}
            onKeyUp={endGesture}
            onBlur={endGesture}
          />
        ))}
      </svg>
    </div>
  );
}
