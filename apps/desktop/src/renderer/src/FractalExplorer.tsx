import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fractalOrbit,
  fractalPoint,
  zoomFractalAt,
  builtinShaderInvocation,
  mandelbrotSliceOffset,
} from '@gleech/effects';
import {
  FRACTAL_DEFAULTS,
  deriveEffectSeed,
  createEffect,
  type MandelbrotEffect,
  type BuiltinShaderEffect,
} from '@gleech/project-model';

interface Props {
  masterSeed?: number;
  effect: MandelbrotEffect | BuiltinShaderEffect;
  imageSize: { width: number; height: number };
  onChange(params: Readonly<Record<string, number | string>>): void;
  beginGesture(): void;
  endGesture(): void;
  onClose(): void;
}

function Coordinate({
  parameterKey,
  label,
  value,
  min,
  max,
  onChange,
  beginGesture,
  endGesture,
}: {
  parameterKey: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  beginGesture(): void;
  endGesture(): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label
      className="fractal-coordinate"
      data-settings-kind="parameter"
      data-settings-key={parameterKey}
    >
      {label}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? String(value)}
        onFocus={() => {
          beginGesture();
          setDraft(String(value));
        }}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const number = Number(text);
          if (text.trim() && Number.isFinite(number) && number >= min && number <= max)
            onChange(number);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={() => {
          setDraft(null);
          endGesture();
        }}
      />
    </label>
  );
}

const locations = [
  { label: 'Full set', centerReal: -0.5, centerImaginary: 0, zoom: 1, iterations: 128 },
  {
    label: 'Seahorse valley',
    centerReal: -0.77,
    centerImaginary: -0.13,
    zoom: 34,
    iterations: 256,
  },
  {
    label: 'Spiral boundary',
    centerReal: -0.7435,
    centerImaginary: 0.1314,
    zoom: 800,
    iterations: 512,
  },
  {
    label: 'West wing',
    centerReal: -1.6735,
    centerImaginary: -0.0003318,
    zoom: 22666,
    iterations: 256,
  },
];
const julias = [
  { label: 'Douady rabbit', juliaReal: -0.123, juliaImaginary: 0.745 },
  { label: 'Dendrite', juliaReal: 0, juliaImaginary: 1 },
  { label: 'Spirals', juliaReal: -0.7, juliaImaginary: 0.27015 },
];

export function FractalExplorer({
  masterSeed = 0,
  effect,
  imageSize,
  onChange: change,
  beginGesture,
  endGesture,
  onClose,
}: Props) {
  const modal = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; params: MandelbrotEffect['params'] } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slices = effect.type === 'shader-mandelbrot-slices';
  const sliceBias = useMemo(
    () =>
      slices
        ? mandelbrotSliceOffset(
            builtinShaderInvocation(
              effect as BuiltinShaderEffect,
              deriveEffectSeed(masterSeed, effect.patternId ?? effect.instanceId),
              imageSize,
            ),
          )
        : { real: 0, imaginary: 0 },
    [slices, effect, masterSeed, imageSize],
  );
  const viewBias = useCallback(
    (zoom: number) => {
      const params = effect.params as Readonly<Record<string, number | string>>;
      const short = Math.min(imageSize.width, imageSize.height);
      const x = ((0.5 - Number(params.centerX) / 100) * imageSize.width) / short;
      const y = ((0.5 - Number(params.centerY) / 100) * imageSize.height) / short;
      const angle = (Number(params.rotation) * Math.PI) / 180;
      return {
        real: sliceBias.real + ((Math.cos(angle) * x - Math.sin(angle) * y) * 3) / zoom,
        imaginary: sliceBias.imaginary + ((Math.sin(angle) * x + Math.cos(angle) * y) * 3) / zoom,
      };
    },
    [effect.params, imageSize, sliceBias],
  );
  const p = useMemo(() => {
    const shaderParams = effect.params as Readonly<Record<string, number | string>>;
    return slices
      ? {
          ...(createEffect('mandelbrot', 'navigator') as MandelbrotEffect).params,
          centerReal:
            Number(shaderParams.fractalX) + viewBias(Number(shaderParams.fractalZoom)).real,
          centerImaginary:
            Number(shaderParams.fractalY) + viewBias(Number(shaderParams.fractalZoom)).imaginary,
          zoom: (Number(shaderParams.fractalZoom) * 3.4) / 3,
          rotation: -Number(shaderParams.rotation),
          iterations: Number(shaderParams.iterations),
          mapping: 'texture' as const,
        }
      : (effect as MandelbrotEffect).params;
  }, [effect, slices, viewBias]);
  const zoomMaximum = slices ? (128 * 3.4) / 3 : 100000;
  const zoomMinimum = slices ? (0.5 * 3.4) / 3 : 0.25;
  const onChange = useCallback(
    (params: Readonly<Record<string, number | string>>) => {
      if (!slices) {
        change(params);
        return;
      }
      const mapped: Record<string, number | string> = {};
      const zoom =
        params.zoom === undefined
          ? Number((effect.params as Readonly<Record<string, number | string>>).fractalZoom)
          : Math.max(0.5, Math.min(128, (Number(params.zoom) * 3) / 3.4));
      const bias = viewBias(zoom);
      for (const [key, value] of Object.entries(params)) {
        if (key === 'centerReal')
          mapped.fractalX = Math.max(-2, Math.min(1, Number(value) - bias.real));
        else if (key === 'centerImaginary')
          mapped.fractalY = Math.max(-1.5, Math.min(1.5, Number(value) - bias.imaginary));
        else if (key === 'zoom')
          mapped.fractalZoom = Math.max(0.5, Math.min(128, (Number(value) * 3) / 3.4));
        else if (key === 'rotation') mapped.rotation = -Number(value);
        else if (key === 'iterations')
          mapped.iterations = Math.max(16, Math.min(96, Number(value)));
      }
      change(mapped);
    },
    [slices, change, effect.params, viewBias],
  );
  const julia = p.formula === 'julia';
  const factor = Math.min(360 / imageSize.width, 240 / imageSize.height);
  const width = Math.max(1, Math.round(imageSize.width * factor));
  const height = Math.max(1, Math.round(imageSize.height * factor));
  useEffect(() => {
    const dialog = modal.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      dialog.close();
      opener?.focus();
      endGesture();
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [endGesture]);

  useEffect(() => {
    const target = canvas.current!;
    const context = target.getContext('2d')!;
    const image = context.createImageData(width, height);
    let row = 0;
    let frame: ReturnType<typeof setTimeout>;
    target.dataset.ready = 'false';
    const draw = () => {
      const deadline = performance.now() + 8;
      const firstRow = row;
      for (; row < height; row++) {
        for (let x = 0; x < width; x++) {
          const point = fractalPoint(p, x + 0.5, row + 0.5, width, height);
          const result = fractalOrbit(point.real, point.imaginary, p);
          const intensity = result.inside ? 0 : 0.5 + 0.5 * Math.cos(Math.log1p(result.count) * 3);
          const index = (row * width + x) * 4;
          image.data.set(
            [22 + intensity * 222, 30 + intensity * 176, 48 + intensity * 53, 255],
            index,
          );
        }
        if (performance.now() >= deadline) {
          row++;
          break;
        }
      }
      context.putImageData(image, 0, 0, 0, firstRow, width, row - firstRow);
      if (row < height) frame = setTimeout(draw, 0);
      else {
        target.dataset.ready = 'true';
      }
    };
    frame = setTimeout(draw, 0);
    return () => clearTimeout(frame);
  }, [p, width, height]);

  useEffect(() => {
    const target = canvas.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (drag.current) return;
      if (!wheelTimer.current) {
        target.focus();
        endGesture();
        beginGesture();
      } else clearTimeout(wheelTimer.current);
      const box = target.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      onChange(
        zoomFractalAt(
          p,
          ((event.clientX - box.left) * width) / box.width,
          ((event.clientY - box.top) * height) / box.height,
          width,
          height,
          Math.max(
            zoomMinimum / p.zoom,
            Math.min(zoomMaximum / p.zoom, Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.004)),
          ),
        ),
      );
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
        endGesture();
      }, 200);
    };
    target.addEventListener('wheel', wheel, { passive: false });
    return () => target.removeEventListener('wheel', wheel);
  }, [p, width, height, beginGesture, endGesture, onChange, zoomMinimum, zoomMaximum]);

  const finish = () => {
    if (drag.current) {
      drag.current = null;
      endGesture();
    }
  };
  return (
    <dialog
      ref={modal}
      className="fractal-explorer"
      aria-labelledby="fractal-explorer-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="fractal-explorer-heading">
        <h2 id="fractal-explorer-title">Explore {julia ? 'Julia' : 'Mandelbrot'}</h2>
        <button onClick={onClose}>Done</button>
      </div>
      <p>Drag to pan. Scroll to zoom toward the pointer. Changes update your image.</p>
      <div className="fractal-navigator">
        <canvas
          ref={canvas}
          width={width}
          height={height}
          tabIndex={0}
          aria-label="Fractal navigator"
          role="img"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (wheelTimer.current) {
              clearTimeout(wheelTimer.current);
              wheelTimer.current = null;
            }
            endGesture();
            event.currentTarget.focus({ preventScroll: true });
            beginGesture();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, params: p };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const box = event.currentTarget.getBoundingClientRect();
            const start = fractalPoint(drag.current.params, width / 2, height / 2, width, height);
            const moved = fractalPoint(
              drag.current.params,
              width / 2 + ((event.clientX - drag.current.x) * width) / box.width,
              height / 2 + ((event.clientY - drag.current.y) * height) / box.height,
              width,
              height,
            );
            onChange({
              centerReal: Math.max(
                -3,
                Math.min(3, start.real - moved.real + drag.current.params.centerReal),
              ),
              centerImaginary: Math.max(
                -3,
                Math.min(
                  3,
                  start.imaginary - moved.imaginary + drag.current.params.centerImaginary,
                ),
              ),
            });
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onKeyDown={(event) => {
            if (event.key === '+' || event.key === '-' || event.key === '=') {
              event.preventDefault();
              endGesture();
              onChange(
                zoomFractalAt(p, width / 2, height / 2, width, height, event.key === '-' ? 0.5 : 2),
              );
            } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              endGesture();
              const point = fractalPoint(
                p,
                width / 2 + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0),
                height / 2 + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0),
                width,
                height,
              );
              onChange({
                centerReal: Math.max(-3, Math.min(3, point.real)),
                centerImaginary: Math.max(-3, Math.min(3, point.imaginary)),
              });
            }
          }}
        />
      </div>
      <div className="fractal-explorer-actions">
        <select
          aria-label={julia ? 'Julia starting shape' : 'Fractal location'}
          value=""
          onChange={(event) => {
            endGesture();
            const index = Number(event.target.value);
            if (julia) {
              const params = { ...julias[index]! };
              const { juliaReal, juliaImaginary } = params;
              onChange({
                juliaReal,
                juliaImaginary,
                centerReal: 0,
                centerImaginary: 0,
                zoom: 1,
                iterations: 256,
              });
            } else {
              const { centerReal, centerImaginary, zoom, iterations } = locations[index]!;
              onChange({ centerReal, centerImaginary, zoom, iterations });
            }
          }}
        >
          <option value="" disabled>
            {julia ? 'Choose starting shape…' : 'Jump to boundary…'}
          </option>
          {(julia ? julias : locations).map((location, index) => (
            <option key={location.label} value={index}>
              {location.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            endGesture();
            onChange({ centerReal: julia ? 0 : -0.5, centerImaginary: 0, zoom: 1, rotation: 0 });
          }}
        >
          Reset View
        </button>
      </div>
      <label
        className="fractal-zoom"
        data-settings-kind="parameter"
        data-settings-key={slices ? 'fractalZoom' : 'zoom'}
      >
        Fractal zoom <output>{(slices ? (p.zoom * 3) / 3.4 : p.zoom).toFixed(2)}×</output>
        <input
          type="range"
          aria-label="Explore zoom"
          min={Math.log2(zoomMinimum)}
          max={Math.log2(zoomMaximum)}
          step="0.01"
          value={Math.log2(p.zoom)}
          onPointerDown={() => beginGesture()}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onBlur={endGesture}
          onKeyDown={beginGesture}
          onKeyUp={endGesture}
          onChange={(event) => onChange({ zoom: 2 ** event.target.valueAsNumber })}
        />
      </label>
      <details>
        <summary>Precise coordinates</summary>
        <div className="fractal-coordinates">
          {(
            [
              'centerReal',
              'centerImaginary',
              ...(julia ? (['juliaReal', 'juliaImaginary'] as const) : []),
            ] as const
          ).map((key) => (
            <Coordinate
              key={key}
              parameterKey={slices ? (key === 'centerReal' ? 'fractalX' : 'fractalY') : key}
              label={
                key === 'centerReal'
                  ? 'Real center'
                  : key === 'centerImaginary'
                    ? 'Imaginary center'
                    : key === 'juliaReal'
                      ? 'Julia real coordinate'
                      : 'Julia imaginary coordinate'
              }
              value={p[key] ?? FRACTAL_DEFAULTS[key as 'juliaReal' | 'juliaImaginary']}
              min={key.startsWith('julia') ? -2 : -3}
              max={key.startsWith('julia') ? 2 : 3}
              beginGesture={beginGesture}
              endGesture={endGesture}
              onChange={(value) => onChange({ [key]: value })}
            />
          ))}
        </div>
      </details>
    </dialog>
  );
}
