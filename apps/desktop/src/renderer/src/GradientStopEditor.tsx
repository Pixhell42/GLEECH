import { useRef, useState } from 'react';
import { gradientStops, MAX_GRADIENT_STOPS, type GradientStop } from '@gleech/project-model';
import { ColorControl } from './ColorControl';
import { InfoTooltip } from './InfoTooltip';

interface Props {
  colorKey: string;
  label: string;
  start: string;
  end: string;
  params: Readonly<Record<string, number | string>>;
  disabled: boolean;
  onChange(params: Readonly<Record<string, number | string>>): void;
  beginGesture(): void;
  endGesture(): void;
}
export function GradientStopEditor({
  colorKey,
  label,
  start,
  end,
  params,
  disabled,
  onChange,
  beginGesture,
  endGesture,
}: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState(false);
  const stops = gradientStops(params, colorKey, start, end);
  const index = Math.min(selected, stops.length - 1);
  const intermediate = index > 0 && index < stops.length - 1;
  const update = (next: readonly GradientStop[]) =>
    onChange({ [`${colorKey}Stops`]: JSON.stringify(next) });
  const move = (position: number) => {
    if (!intermediate || disabled) return;
    const next = Math.max(
      stops[index - 1]!.position,
      Math.min(stops[index + 1]!.position, position),
    );
    update(
      stops.map((stop, i) =>
        i === index ? { ...stop, position: Math.round(next * 1000) / 1000 } : stop,
      ),
    );
  };
  const at = (clientX: number) => {
    const bounds = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  };
  const add = (position: number) => {
    if (
      disabled ||
      stops.length >= MAX_GRADIENT_STOPS ||
      stops.some((stop) => Math.abs(stop.position - position) < 0.002)
    )
      return;
    endGesture();
    const right = stops.findIndex((stop) => stop.position > position);
    if (right < 1) return;
    const a = stops[right - 1]!,
      b = stops[right]!;
    const mix = (position - a.position) / (b.position - a.position);
    const color =
      '#' +
      [1, 3, 5]
        .map((offset) =>
          Math.round(
            parseInt(a.color.slice(offset, offset + 2), 16) * (1 - mix) +
              parseInt(b.color.slice(offset, offset + 2), 16) * mix,
          )
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    const next = [...stops];
    next.splice(right, 0, { position: Math.round(position * 1000) / 1000, color });
    update(next);
    setSelected(right);
  };
  const remove = () => {
    if (!intermediate || disabled) return;
    endGesture();
    update(stops.filter((_, i) => i !== index));
    setSelected(index - 1);
  };
  const finish = () => {
    setDragging(false);
    endGesture();
  };
  return (
    <div className="gradient-stop-editor" data-settings-kind="color" data-settings-key={colorKey}>
      <div className="gradient-stop-heading">
        Color stops{' '}
        <InfoTooltip
          label={`${label} color stops`}
          text="Click the bar to add a color. Drag an intermediate stop to move it, or use arrow keys. Select a stop to edit its color. Endpoints remain fixed; Delete removes an intermediate stop. Up to 16 colors."
        />
      </div>
      <div
        ref={track}
        className="gradient-stop-track"
        onPointerDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) add(at(event.clientX));
        }}
      >
        <div
          className="gradient-preview"
          role="img"
          aria-label={label === 'Gradient Map tonal ramp' ? label : `${label} gradient preview`}
          style={{
            background: `linear-gradient(90deg, ${stops.map((stop) => `${stop.color} ${stop.position * 100}%`).join(', ')})`,
          }}
        />
        {stops.map((stop, i) => (
          <button
            key={i}
            className="gradient-stop"
            type="button"
            disabled={disabled}
            aria-label={`${label} stop ${i + 1}`}
            aria-pressed={index === i}
            title={`${Math.round(stop.position * 100)}% · ${stop.color}`}
            style={{ left: `${stop.position * 100}%`, backgroundColor: stop.color }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              setSelected(i);
              if (i > 0 && i < stops.length - 1 && !disabled) {
                beginGesture();
                setDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
              }
            }}
            onPointerMove={(event) => {
              if (dragging && event.currentTarget.hasPointerCapture(event.pointerId))
                move(at(event.clientX));
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onBlur={finish}
            onClick={() => setSelected(i)}
            onKeyDown={(event) => {
              if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                remove();
              } else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                beginGesture();
                move(
                  stop.position +
                    (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01),
                );
              }
            }}
            onKeyUp={endGesture}
          />
        ))}
      </div>
      <div className="gradient-stop-actions">
        <button
          type="button"
          disabled={disabled || stops.length >= MAX_GRADIENT_STOPS}
          onClick={() => {
            let gap = 0;
            for (let i = 1; i < stops.length - 1; i++)
              if (
                stops[i + 1]!.position - stops[i]!.position >
                stops[gap + 1]!.position - stops[gap]!.position
              )
                gap = i;
            add((stops[gap]!.position + stops[gap + 1]!.position) / 2);
          }}
        >
          Add stop
        </button>
        <button type="button" disabled={disabled || !intermediate} onClick={remove}>
          Remove stop
        </button>
      </div>
      {intermediate && (
        <ColorControl
          label={`${label} stop color`}
          value={stops[index]!.color}
          disabled={disabled}
          beginGesture={beginGesture}
          endGesture={endGesture}
          onChange={(color) =>
            update(stops.map((stop, i) => (i === index ? { ...stop, color } : stop)))
          }
        />
      )}
    </div>
  );
}
