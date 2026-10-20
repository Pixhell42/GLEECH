import { useMemo } from 'react';
import {
  AUDIO_BANDS,
  LFO_DIVISIONS,
  LFO_SHAPES,
  analysisBinFrequency,
  bandLimits,
  createAudioModulator,
  createLfo,
  decodeAudioAnalysis,
  evaluateParameter,
  getEffectDefinition,
  parameterBaseValue,
  type AudioAnalysis,
  type AudioModulator,
  type EffectInstance,
  type LfoModulator,
  type ModulationContext,
  type Modulator,
  type ParameterAnimation,
  type ParameterDefinition,
} from '@gleech/project-model';
import { formatParameterValue } from './animation-format';
import { SIGNAL_COLORS } from './animation-ui';
import { ChevronIcon, PlusIcon, SineIcon, TrashIcon, WaveformIcon } from './Icons';

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  color,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  color: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="render-switch modulator-switch"
      style={{ ['--switch-on' as string]: color }}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  /** `title` is the full name for tooltips and screen readers when `label` is short. */
  options: readonly { value: T; label: string; title?: string }[];
  onChange(value: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="render-segmented wide modulator-choice" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.title ?? option.label}
          title={option.title}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  onChange(value: number): void;
  disabled?: boolean;
}) {
  return (
    <label className="modulator-slider">
      <span>
        {label}
        <output>{text}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </label>
  );
}

/** Mean spectrum of the whole track, drawn behind the band selector. */
function Spectrum({
  analysis,
  modulator,
}: {
  analysis: AudioAnalysis | undefined;
  modulator: AudioModulator;
}) {
  const bars = useMemo(() => {
    if (!analysis) return null;
    const { spectrum } = decodeAudioAnalysis(analysis);
    const frames = Math.max(1, Math.floor(spectrum.length / analysis.bins));
    const sums = new Array<number>(analysis.bins).fill(0);
    for (let frame = 0; frame < frames; frame++)
      for (let bin = 0; bin < analysis.bins; bin++)
        sums[bin]! += spectrum[frame * analysis.bins + bin]!;
    const peak = Math.max(1, ...sums);
    return sums.map((sum, bin) => ({ level: sum / peak, hz: analysisBinFrequency(analysis, bin) }));
  }, [analysis]);
  const { low, high } = bandLimits(modulator);
  if (!bars) return <div className="modulator-spectrum empty">Analyzing audio…</div>;
  return (
    <div className="modulator-spectrum" aria-hidden="true">
      <div className="modulator-spectrum-bars">
        {bars.map((bar, index) => (
          <span
            key={index}
            className={bar.hz >= low && bar.hz <= high ? 'in-band' : undefined}
            style={{ height: `${Math.max(4, bar.level * 100)}%` }}
          />
        ))}
      </div>
      <div className="modulator-spectrum-labels">
        <span>20 Hz</span>
        <span>
          {Math.round(low)}–{high >= 1000 ? `${Math.round(high / 100) / 10}k` : Math.round(high)} Hz
        </span>
        <span>20 kHz</span>
      </div>
    </div>
  );
}

/** Output range as two thumbs on one track. */
function RangePair({
  low,
  high,
  onChange,
  disabled,
}: {
  low: number;
  high: number;
  onChange(low: number, high: number): void;
  disabled?: boolean;
}) {
  return (
    <div className="modulator-range">
      <span>
        Output range
        <output>
          {Math.round(low * 100)}% – {Math.round(high * 100)}%
        </output>
      </span>
      <div
        className="modulator-range-track"
        style={{
          ['--range-low' as string]: `${low * 100}%`,
          ['--range-high' as string]: `${high * 100}%`,
        }}
      >
        <input
          type="range"
          aria-label="Output range minimum"
          min={0}
          max={1}
          step={0.01}
          value={low}
          disabled={disabled}
          onChange={(event) => onChange(Math.min(event.target.valueAsNumber, high), high)}
        />
        <input
          type="range"
          aria-label="Output range maximum"
          min={0}
          max={1}
          step={0.01}
          value={high}
          disabled={disabled}
          onChange={(event) => onChange(low, Math.max(event.target.valueAsNumber, low))}
        />
      </div>
    </div>
  );
}

/**
 * A modulated parameter's stack: base value, live value and one card per
 * modulator. Cards apply top to bottom after keyframes; the result is clamped.
 */
export function ModulatorPanel({
  effect,
  paramKey,
  definition,
  animation,
  t,
  modulation,
  audioName,
  hasAudio,
  disabled,
  onBack,
  onChange,
  onBase,
  beginGesture,
  endGesture,
}: {
  effect: EffectInstance;
  paramKey: string;
  definition: ParameterDefinition;
  animation: ParameterAnimation | undefined;
  t: number;
  modulation: ModulationContext;
  audioName: string | null;
  hasAudio: boolean;
  disabled: boolean;
  onBack(): void;
  onChange(animation: ParameterAnimation | null): void;
  onBase(value: number): void;
  beginGesture(): void;
  endGesture(): void;
}) {
  const modulators = animation?.modulators ?? [];
  const base = parameterBaseValue(effect, paramKey);
  const live = animation ? evaluateParameter(animation, base, t, definition, modulation) : base;
  const number = definition.kind === 'number' ? definition : null;
  const update = (next: readonly Modulator[]) => {
    const keys = animation?.keys ?? [];
    onChange(
      keys.length || next.length ? { keys, ...(next.length ? { modulators: next } : {}) } : null,
    );
  };
  const patch = (id: string, change: Partial<AudioModulator> | Partial<LfoModulator>) =>
    update(
      modulators.map((modulator) =>
        modulator.id === id ? ({ ...modulator, ...change } as Modulator) : modulator,
      ),
    );
  const gesture = { onPointerDown: beginGesture, onPointerUp: endGesture, onKeyUp: endGesture };

  return (
    <section className="modulator-panel" aria-label={`${definition.label} modulators`}>
      <div className="modulator-heading">
        <button type="button" className="ib" aria-label="Back to effect controls" onClick={onBack}>
          <span className="modulator-back">
            <ChevronIcon open={false} />
          </span>
        </button>
        <div>
          <h2>{definition.label}</h2>
          <small>
            {getEffectDefinition(effect).title} · base {formatParameterValue(definition, base)} ·{' '}
            {modulators.length} modulator{modulators.length === 1 ? '' : 's'}
          </small>
        </div>
        <output className="modulator-live" title="Live value at the playhead">
          {formatParameterValue(definition, live)}
        </output>
      </div>
      {number && (
        <div className="control-card modulator-base" {...gesture}>
          <Slider
            label="Base value"
            value={Number(base)}
            min={number.min}
            max={number.max}
            step={number.step}
            text={formatParameterValue(definition, base)}
            disabled={disabled || Boolean(animation?.keys.length)}
            onChange={onBase}
          />
          {Boolean(animation?.keys.length) && (
            <p className="modulation-note">Keyframes set the value before modulators apply.</p>
          )}
        </div>
      )}
      {modulators.map((modulator, index) =>
        modulator.kind === 'audio' ? (
          <article
            key={modulator.id}
            className="modulator-card audio"
            style={{ ['--signal' as string]: SIGNAL_COLORS.audio }}
            {...gesture}
          >
            <header>
              <WaveformIcon />
              <strong>Audio</strong>
              <span>{audioName ?? 'No audio track'}</span>
              <button
                type="button"
                className="ib"
                aria-label={`Remove audio modulator ${index + 1}`}
                disabled={disabled}
                onClick={() => update(modulators.filter((entry) => entry.id !== modulator.id))}
              >
                <TrashIcon />
              </button>
              <Toggle
                label="Enable audio modulator"
                color={SIGNAL_COLORS.audio}
                checked={modulator.enabled}
                disabled={disabled}
                onChange={(enabled) => patch(modulator.id, { enabled })}
              />
            </header>
            {!hasAudio && (
              <p className="modulation-note">Add an audio track in the timeline to drive this.</p>
            )}
            <Spectrum analysis={modulation.audio} modulator={modulator} />
            <Choice
              label="Band"
              value={modulator.band}
              options={AUDIO_BANDS.map((band) => ({ value: band.value, label: band.label }))}
              disabled={disabled}
              onChange={(band) => {
                const preset = AUDIO_BANDS.find((entry) => entry.value === band)!;
                patch(modulator.id, {
                  band,
                  ...(band === 'custom' ? {} : { lowHz: preset.low, highHz: preset.high }),
                });
              }}
            />
            {modulator.band === 'custom' && (
              <div className="modulator-pair">
                <Slider
                  label="Low"
                  value={modulator.lowHz}
                  min={20}
                  max={Math.min(19000, modulator.highHz - 10)}
                  step={10}
                  text={`${Math.round(modulator.lowHz)} Hz`}
                  disabled={disabled}
                  onChange={(lowHz) => patch(modulator.id, { lowHz })}
                />
                <Slider
                  label="High"
                  value={modulator.highHz}
                  min={Math.max(40, modulator.lowHz + 10)}
                  max={20000}
                  step={10}
                  text={`${Math.round(modulator.highHz)} Hz`}
                  disabled={disabled}
                  onChange={(highHz) => patch(modulator.id, { highHz })}
                />
              </div>
            )}
            <div className="modulator-pair">
              <Slider
                label="Attack"
                value={modulator.attackMs}
                min={0}
                max={500}
                step={1}
                text={`${Math.round(modulator.attackMs)} ms`}
                disabled={disabled}
                onChange={(attackMs) => patch(modulator.id, { attackMs })}
              />
              <Slider
                label="Release"
                value={modulator.releaseMs}
                min={0}
                max={2000}
                step={5}
                text={`${Math.round(modulator.releaseMs)} ms`}
                disabled={disabled}
                onChange={(releaseMs) => patch(modulator.id, { releaseMs })}
              />
            </div>
            <RangePair
              low={modulator.outMin}
              high={modulator.outMax}
              disabled={disabled}
              onChange={(outMin, outMax) => patch(modulator.id, { outMin, outMax })}
            />
            <div className="modulator-pair">
              <Slider
                label="Intensity"
                value={modulator.intensity ?? 1}
                min={0}
                max={4}
                step={0.05}
                text={`${Math.round((modulator.intensity ?? 1) * 100)}%`}
                disabled={disabled}
                onChange={(intensity) => patch(modulator.id, { intensity })}
              />
              <Slider
                label="Position"
                value={modulator.offset ?? 0}
                min={-1}
                max={1}
                step={0.01}
                text={`${(modulator.offset ?? 0) > 0 ? '+' : ''}${Math.round((modulator.offset ?? 0) * 100)}%`}
                disabled={disabled}
                onChange={(offset) => patch(modulator.id, { offset })}
              />
            </div>
            <p className="modulation-note">
              Intensity 0% flattens the curve, 100% follows the audio as analyzed, and more
              exaggerates peaks and valleys. Position moves the whole curve up or down.
            </p>
            <div className="modulator-row">
              <span>Invert</span>
              <Toggle
                label="Invert audio curve"
                color={SIGNAL_COLORS.audio}
                checked={modulator.invert ?? false}
                disabled={disabled}
                onChange={(invert) => patch(modulator.id, { invert })}
              />
            </div>
            <div className="modulator-row">
              <span>Mode</span>
              <Choice
                label="Combine"
                value={modulator.combine}
                options={[
                  { value: 'replace', label: 'Rep', title: 'Replace' },
                  { value: 'add', label: 'Add' },
                  { value: 'subtract', label: 'Sub', title: 'Subtract' },
                  { value: 'multiply', label: 'Multi', title: 'Multiply' },
                ]}
                disabled={disabled}
                onChange={(combine) => patch(modulator.id, { combine })}
              />
            </div>
          </article>
        ) : (
          <article
            key={modulator.id}
            className="modulator-card lfo"
            style={{ ['--signal' as string]: SIGNAL_COLORS.lfo }}
            {...gesture}
          >
            <header>
              <SineIcon />
              <strong>LFO</strong>
              <span>
                {modulator.combine === 'add' ? 'Add' : 'Multiply'} · ±
                {Math.round(modulator.depth * 100)}%
              </span>
              <button
                type="button"
                className="ib"
                aria-label={`Remove LFO ${index + 1}`}
                disabled={disabled}
                onClick={() => update(modulators.filter((entry) => entry.id !== modulator.id))}
              >
                <TrashIcon />
              </button>
              <Toggle
                label="Enable LFO"
                color={SIGNAL_COLORS.lfo}
                checked={modulator.enabled}
                disabled={disabled}
                onChange={(enabled) => patch(modulator.id, { enabled })}
              />
            </header>
            <Choice
              label="Shape"
              value={modulator.shape}
              options={LFO_SHAPES.map((shape) =>
                // "Random steps" is too wide for the card; the full name is the tooltip.
                shape.value === 'random'
                  ? { value: shape.value, label: 'Random', title: shape.label }
                  : { value: shape.value, label: shape.label },
              )}
              disabled={disabled}
              onChange={(shape) => patch(modulator.id, { shape })}
            />
            <div className="modulator-row">
              <span>Sync to tempo</span>
              <Toggle
                label="Sync LFO to tempo"
                color={SIGNAL_COLORS.lfo}
                checked={modulator.sync}
                disabled={disabled}
                onChange={(sync) => patch(modulator.id, { sync })}
              />
            </div>
            {modulator.sync ? (
              <div className="modulator-row">
                <span>Rate · {modulation.bpm} BPM</span>
                <select
                  aria-label="LFO rate"
                  value={modulator.division}
                  disabled={disabled}
                  onChange={(event) =>
                    patch(modulator.id, {
                      division: event.target.value as LfoModulator['division'],
                    })
                  }
                >
                  {LFO_DIVISIONS.map((division) => (
                    <option key={division.value} value={division.value}>
                      {division.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Slider
                label="Rate"
                value={modulator.rate}
                min={0.05}
                max={20}
                step={0.05}
                text={`${modulator.rate.toFixed(2)} Hz`}
                disabled={disabled}
                onChange={(rate) => patch(modulator.id, { rate })}
              />
            )}
            <div className="modulator-pair">
              <Slider
                label="Depth"
                value={modulator.depth}
                min={0}
                max={1}
                step={0.01}
                text={`±${Math.round(modulator.depth * 100)}%`}
                disabled={disabled}
                onChange={(depth) => patch(modulator.id, { depth })}
              />
              <Slider
                label="Phase"
                value={modulator.phase}
                min={0}
                max={360}
                step={1}
                text={`${Math.round(modulator.phase)}°`}
                disabled={disabled}
                onChange={(phase) => patch(modulator.id, { phase })}
              />
            </div>
            <div className="modulator-row">
              <span>Combine</span>
              <Choice
                label="Combine"
                value={modulator.combine}
                options={[
                  { value: 'add', label: 'Add' },
                  { value: 'multiply', label: 'Multi', title: 'Multiply' },
                ]}
                disabled={disabled}
                onChange={(combine) => patch(modulator.id, { combine })}
              />
            </div>
          </article>
        ),
      )}
      <div className="modulator-add">
        <button
          type="button"
          disabled={disabled || modulators.length >= 8}
          onClick={() => update([...modulators, createLfo(crypto.randomUUID())])}
        >
          <PlusIcon /> Add LFO
        </button>
        <button
          type="button"
          disabled={disabled || modulators.length >= 8 || !hasAudio}
          title={hasAudio ? 'Follow a band of the audio track' : 'Add an audio track first'}
          onClick={() => update([...modulators, createAudioModulator(crypto.randomUUID())])}
        >
          <PlusIcon /> Link to audio
        </button>
      </div>
      <p className="quiet modulator-hint">
        Modulators apply top to bottom after keyframes, and the result is clamped to the control’s
        range, so audio and an LFO can drive the same control together.
      </p>
    </section>
  );
}
