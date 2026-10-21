import { INTERPOLATIONS, type Interpolation } from '@gleech/project-model';
import type { ParameterKeyInfo } from './animation-ui';
import { DiamondIcon, SineIcon, TriangleLeftIcon, TriangleRightIcon, WaveformIcon } from './Icons';

/**
 * Keyframe diamond beside a control's value. Grey outline: not animated (click
 * to animate). Gold outline: animated, no key here (moving the control adds
 * one). Solid gold: key at the playhead (click removes it).
 */
export function KeyframeButtons({
  label,
  info,
  showStatic,
  disabled,
  onToggle,
  onJump,
  onModulators,
}: {
  label: string;
  info: ParameterKeyInfo;
  showStatic: boolean;
  disabled: boolean;
  onToggle(): void;
  onJump(direction: -1 | 1): void;
  onModulators(): void;
}) {
  const modulated = info.modulators !== null;
  return (
    <span
      className={`keyframe-buttons${info.animated ? ' animated' : ''}${showStatic ? ' show-static' : ''}`}
      data-keyframe-state={info.keyHere ? 'key' : info.animated ? 'animated' : 'static'}
    >
      {modulated && (
        <button
          type="button"
          className={`modulator-tag modulator-${info.modulators}`}
          aria-label={`Edit modulators for ${label}`}
          title="Edit modulators"
          disabled={disabled}
          onClick={onModulators}
        >
          {info.modulators === 'lfo' ? <SineIcon size={12} /> : <WaveformIcon size={12} />}
          {info.modulators === 'audio'
            ? 'Audio'
            : info.modulators === 'lfo'
              ? 'LFO'
              : 'Audio + LFO'}
        </button>
      )}
      {info.animated && (info.previous || info.next) && (
        <button
          type="button"
          className="keyframe-step"
          aria-label={`Previous ${label} keyframe`}
          title="Previous keyframe"
          disabled={disabled || !info.previous}
          onClick={() => onJump(-1)}
        >
          <TriangleLeftIcon />
        </button>
      )}
      {(!modulated || info.animated) && (
        <button
          type="button"
          className="keyframe-diamond"
          aria-label={
            !info.animated
              ? `Animate ${label}`
              : info.keyHere
                ? `Remove ${label} keyframe at playhead`
                : `Add ${label} keyframe at playhead`
          }
          aria-pressed={info.keyHere}
          title={
            !info.animated
              ? 'Animate: add a keyframe at the playhead'
              : info.keyHere
                ? 'Remove the keyframe at the playhead'
                : 'Add a keyframe at the playhead'
          }
          disabled={disabled}
          onClick={onToggle}
        >
          <DiamondIcon filled={info.keyHere} />
        </button>
      )}
      {info.animated && (info.previous || info.next) && (
        <button
          type="button"
          className="keyframe-step"
          aria-label={`Next ${label} keyframe`}
          title="Next keyframe"
          disabled={disabled || !info.next}
          onClick={() => onJump(1)}
        >
          <TriangleRightIcon />
        </button>
      )}
    </span>
  );
}

/** Animation card for the selected parameter: ease, modulators and Clear. */
export function AnimationCard({
  label,
  interpolation,
  keyCount,
  canLinkAudio,
  copied = false,
  disabled,
  onEase,
  onAddLfo,
  onLinkAudio,
  onClear,
}: {
  label: string;
  interpolation: Interpolation | 'mixed' | null;
  keyCount: number;
  canLinkAudio: boolean;
  /** The keys were copied from audio/LFO modulation; Link to audio restores it. */
  copied?: boolean;
  disabled: boolean;
  onEase(interpolation: Interpolation): void;
  onAddLfo(): void;
  onLinkAudio(): void;
  onClear(): void;
}) {
  return (
    <section className="animation-card" aria-label={`Animation · ${label}`}>
      <h3>
        Animation · <span>{label}</span>
      </h3>
      <div className="control-card">
        <label className="animation-row">
          <span>Keyframe ease</span>
          <select
            aria-label="Keyframe ease"
            disabled={disabled || keyCount === 0}
            value={interpolation === null || interpolation === 'mixed' ? '' : interpolation}
            onChange={(event) => onEase(event.target.value as Interpolation)}
          >
            {(interpolation === null || interpolation === 'mixed') && (
              <option value="">{interpolation === 'mixed' ? 'Mixed' : 'No keys'}</option>
            )}
            {INTERPOLATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="animation-actions">
          <button type="button" disabled={disabled} onClick={onAddLfo}>
            Add LFO
          </button>
          <button
            type="button"
            disabled={disabled || (!canLinkAudio && !copied)}
            title={
              copied
                ? 'Restore the link these keys were copied from, replacing them'
                : canLinkAudio
                  ? 'Drive this control from the audio track'
                  : 'Add an audio track first'
            }
            onClick={onLinkAudio}
          >
            Link to audio
          </button>
          <button type="button" className="danger-text" disabled={disabled} onClick={onClear}>
            Clear
          </button>
        </div>
        {copied && (
          <p className="modulation-note">
            Copied from modulation. Link to audio restores the original link and replaces these
            keys.
          </p>
        )}
      </div>
    </section>
  );
}
