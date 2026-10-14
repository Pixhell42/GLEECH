import type { ParameterDefinition } from '@gleech/project-model';
import { GradientStopEditor } from './GradientStopEditor';
import { ColorControl } from './ColorControl';
import { InfoTooltip } from './InfoTooltip';

interface Props {
  colorKey: string;
  label: string;
  value: string;
  gradient: 'spatial' | 'field';
  params: Readonly<Record<string, number | string>>;
  parameters: Readonly<Record<string, ParameterDefinition>>;
  disabled: boolean;
  hideMode?: boolean;
  onChange(params: Readonly<Record<string, number | string>>): void;
  beginGesture(): void;
  endGesture(): void;
}

export function GradientColorControl({
  colorKey,
  label,
  value,
  gradient,
  params,
  parameters,
  disabled,
  hideMode = false,
  onChange,
  beginGesture,
  endGesture,
}: Props) {
  const active = params[`${colorKey}Mode`] === 'gradient';
  const end = String(params[`${colorKey}End`] ?? parameters[`${colorKey}End`]!.default);
  const mode = parameters[`${colorKey}Mode`]!;
  const angle = (Number(params[`${colorKey}Angle`] ?? 0) * Math.PI) / 180;
  return (
    <div className="gradient-color-control">
      {!hideMode && (
        <div
          className="color-mode"
          role="group"
          aria-label={`${label} mode`}
          data-settings-kind="color"
          data-settings-key={colorKey}
        >
          {(['solid', 'gradient'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={(option === 'gradient') === active}
              disabled={disabled}
              onClick={() => {
                endGesture();
                onChange({ [`${colorKey}Mode`]: option });
              }}
            >
              {option === 'solid' ? 'Solid' : 'Gradient'}
            </button>
          ))}
          <InfoTooltip label={`${label} mode`} text={mode.description} />
        </div>
      )}
      {active && (
        <GradientStopEditor
          colorKey={colorKey}
          label={label}
          start={value}
          end={end}
          params={params}
          disabled={disabled}
          onChange={onChange}
          beginGesture={beginGesture}
          endGesture={endGesture}
        />
      )}
      {active && <div className="color-stop-title">Start</div>}
      <ColorControl
        label={label}
        value={value}
        disabled={disabled}
        beginGesture={beginGesture}
        endGesture={endGesture}
        onChange={(color) => onChange({ [colorKey]: color })}
      />
      {active && (
        <>
          <div className="color-stop-title">End</div>
          <div data-settings-kind="parameter" data-settings-key={`${colorKey}End`}>
            <ColorControl
              label={`${label} end`}
              value={end}
              disabled={disabled}
              beginGesture={beginGesture}
              endGesture={endGesture}
              onChange={(color) => onChange({ [`${colorKey}End`]: color })}
            />
          </div>
          {gradient === 'spatial' &&
            ['Angle', 'CenterX', 'CenterY', 'Span'].map((suffix) => {
              const key = `${colorKey}${suffix}`;
              const control = parameters[key]!;
              if (control.kind !== 'number') return null;
              const value = Number(params[key] ?? control.default);
              return (
                <div
                  className="gradient-placement"
                  key={key}
                  data-settings-kind="parameter"
                  data-settings-key={key}
                >
                  <span>
                    <span className="control-title">
                      {control.label}{' '}
                      <InfoTooltip label={control.label} text={control.description} />
                    </span>
                    <output>
                      {value}
                      {suffix === 'Angle' ? '°' : '%'}
                    </output>
                  </span>
                  <input
                    type="range"
                    aria-label={control.label}
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={value}
                    disabled={
                      disabled ||
                      (suffix === 'CenterX' && Math.abs(Math.cos(angle)) < 1e-12) ||
                      (suffix === 'CenterY' && Math.abs(Math.sin(angle)) < 1e-12)
                    }
                    onPointerDown={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      beginGesture();
                    }}
                    onPointerUp={endGesture}
                    onPointerCancel={endGesture}
                    onBlur={endGesture}
                    onKeyDown={(event) => {
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
                        ].includes(event.key)
                      )
                        beginGesture();
                    }}
                    onKeyUp={endGesture}
                    onChange={(event) => onChange({ [key]: event.target.valueAsNumber })}
                  />
                </div>
              );
            })}
        </>
      )}
    </div>
  );
}
