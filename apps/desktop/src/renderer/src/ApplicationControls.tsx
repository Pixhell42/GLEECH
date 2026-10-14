import {
  applicationParameters,
  applicationValue,
  setApplicationValue,
  isDepthApplication,
  createEffect,
  heightFieldParams,
  DEPTH_FIELD_KEYS,
  type EffectApplication,
  type EffectInstance,
  type ApplicationRegion,
  type DepthFieldEffect,
} from '@gleech/project-model';
import type { ImportedImage } from '../../shared/image-api';
import { DepthFieldControls } from './DepthFieldControls';
import { InfoTooltip } from './InfoTooltip';
import { InspectorSection } from './InspectorSections';

interface Props {
  effect: EffectInstance;
  effects: readonly EffectInstance[];
  image: ImportedImage | undefined;
  disabled: boolean;
  onChange(application: Partial<EffectApplication>): void;
  beginGesture(): void;
  endGesture(): void;
}
export function ApplicationControls({
  effect,
  effects,
  image,
  disabled,
  onChange,
  beginGesture,
  endGesture,
}: Props) {
  const app = effect.application,
    region = app.region;
  const depth = isDepthApplication(region);
  const detail = ['content-edges', 'flat-areas', 'high-detail', 'low-detail'].includes(region);
  const signal = depth || detail || ['highlights', 'midtones', 'shadows', 'alpha'].includes(region);
  const bands = region.endsWith('-bands');
  const field = heightFieldParams(app.depthField ?? {});
  const pseudo: DepthFieldEffect = {
    ...(createEffect('depth-field', `${effect.instanceId}-application`) as DepthFieldEffect),
    ...(app.depthImage ? { fieldImage: app.depthImage } : {}),
    params: { ...(createEffect('depth-field', 'defaults') as DepthFieldEffect).params, ...field },
  };
  const update = (key: string, value: number | string) => {
    const next = setApplicationValue(app, key, value);
    if (key === 'application.region') {
      const selected = value as ApplicationRegion;
      const coverage = [
        'highlights',
        'midtones',
        'shadows',
        'depth-near',
        'depth-mid',
        'depth-far',
      ].includes(selected)
        ? 1 / 3
        : [
              'content-edges',
              'flat-areas',
              'high-detail',
              'low-detail',
              'horizontal-bands',
              'vertical-bands',
            ].includes(selected)
          ? 0.5
          : 1;
      onChange({ ...next, coverage });
    } else onChange(next);
  };
  const controls = applicationParameters();
  return (
    <InspectorSection sectionId="application" title="Application" className="application-section">
      <div className="control-card">
        {Object.entries(controls)
          .filter(([key]) => {
            if (key.startsWith('application.depthField.')) {
              if (!depth) return false;
              const fieldKey = key.slice('application.depthField.'.length);
              if (fieldKey === 'fieldSeed') return false;
              if (fieldKey === 'fieldShape') return field.fieldSource === 'shapes';
              if (['fieldDetail', 'fieldRoughness'].includes(fieldKey))
                return ['perlin', 'simplex', 'value', 'voronoi'].includes(field.fieldSource);
              return true;
            }
            if (['application.rangeStart', 'application.rangeEnd'].includes(key)) return signal;
            if (key === 'application.detailScale') return detail;
            if (key.startsWith('application.band')) return bands;
            return true;
          })
          .map(([key, control]) => {
            if (control.kind !== 'number' && control.kind !== 'choice') return null;
            const value = applicationValue(app, key);
            const label = key.startsWith('application.depthField.')
              ? `Mask ${control.label}`
              : control.label;
            return (
              <div
                className={`effect-control control-${control.kind}`}
                key={key}
                data-settings-kind="parameter"
                data-settings-key={key}
              >
                <span>
                  <span className="control-title">
                    {key === 'application.region'
                      ? 'Apply to'
                      : key === 'application.invert'
                        ? 'Invert'
                        : label}{' '}
                    <InfoTooltip label={label} text={control.description} />
                  </span>
                  {control.kind === 'number' && (
                    <output>
                      {control.unit === 'percent'
                        ? `${Math.round(Number(value) * 100)}%`
                        : control.unit === 'multiplier'
                          ? `${Number(value).toFixed(2)}×`
                          : control.unit === 'degrees'
                            ? `${value}°`
                            : control.unit === 'count'
                              ? String(value)
                              : `${Number(value).toFixed(1)}%`}
                    </output>
                  )}
                </span>
                {key === 'application.invert' ? (
                  <label className="tint-toggle">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={label}
                      checked={value === 'on'}
                      disabled={disabled}
                      onChange={(event) => {
                        endGesture();
                        update(key, event.target.checked ? 'on' : 'off');
                      }}
                    />
                  </label>
                ) : control.kind === 'choice' ? (
                  <select
                    aria-label={label}
                    value={String(value)}
                    disabled={disabled}
                    onChange={(event) => {
                      endGesture();
                      update(key, event.target.value);
                    }}
                  >
                    {control.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="range"
                    aria-label={label}
                    value={Number(value)}
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    disabled={disabled}
                    onPointerDown={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      beginGesture();
                    }}
                    onPointerUp={endGesture}
                    onPointerCancel={endGesture}
                    onBlur={endGesture}
                    onKeyDown={beginGesture}
                    onKeyUp={endGesture}
                    onChange={(event) => update(key, event.target.valueAsNumber)}
                  />
                )}
              </div>
            );
          })}
        {depth && (
          <DepthFieldControls
            effect={pseudo}
            effects={effects}
            image={image}
            disabled={disabled}
            endGesture={endGesture}
            onChange={(change) => onChange({ depthField: { ...field, ...change } })}
            onFieldChange={(change, attachment) =>
              onChange({
                depthField: {
                  ...field,
                  ...Object.fromEntries(
                    DEPTH_FIELD_KEYS.filter((key) => key in change).map((key) => [
                      key,
                      change[key],
                    ]),
                  ),
                },
                depthImage: attachment ?? undefined,
              })
            }
          />
        )}
      </div>
    </InspectorSection>
  );
}
