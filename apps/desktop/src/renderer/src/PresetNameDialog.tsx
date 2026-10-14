import { presetThumbnails } from './ShaderPreview';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EffectPreset, PresetRecipe } from '@gleech/project-model';
import { type PresetThumbnails } from '../../shared/image-api';

export function PresetNameDialog({
  name,
  preset,
  recipe,
  sourceId,
  saving,
  saveError,
  onClose,
  onSubmit,
}: {
  name: string;
  preset?: EffectPreset | undefined;
  recipe: PresetRecipe;
  sourceId: string | null;
  saving: boolean;
  saveError: string | null;
  onClose(): void;
  onSubmit(name: string, thumbnail: string, choice: 'image' | 'statue', recipe: PresetRecipe): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const [choice, setChoice] = useState<'image' | 'statue'>(preset?.thumbnailSource ?? 'image');
  const [previews, setPreviews] = useState<PresetThumbnails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [refreshImage, setRefreshImage] = useState(false);
  const [includeMasks, setIncludeMasks] = useState(Boolean(preset));
  const hasMasks = recipe.effects.some((effect) => effect.paintedMask !== undefined);
  const savedRecipe = useMemo<PresetRecipe>(() => {
    if (includeMasks || !hasMasks) return recipe;
    return {
      ...recipe,
      effects: recipe.effects.map((effect) => {
        const copy = { ...effect };
        delete copy.paintedMask;
        return copy;
      }),
    };
  }, [recipe, includeMasks, hasMasks]);
  const storedImage =
    preset && (preset.thumbnailSource ?? 'image') === 'image' && !refreshImage
      ? preset.thumbnail
      : null;
  const image = storedImage ?? previews?.image;
  const thumbnail = choice === 'image' ? image : previews?.statue;
  useEffect(() => {
    let active = true;
    void presetThumbnails(sourceId, savedRecipe)
      .then((result) => {
        if (active) {
          setPreviews(result);
          setError(null);
        }
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : 'Could not render thumbnail previews.',
          );
      });
    return () => {
      active = false;
    };
  }, [sourceId, savedRecipe, retry]);
  useEffect(() => {
    const dialog = modal.current!;
    dialog.showModal();
    input.current?.select();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={modal}
      className="stage-dialog preset-save-dialog"
      aria-labelledby="preset-name-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving && value.trim() && thumbnail)
            onSubmit(value.trim(), thumbnail, choice, savedRecipe);
        }}
      >
        <h2 id="preset-name-title">{preset ? 'Edit preset' : 'Save preset'}</h2>
        {!preset && (
          <p>Keep this effect stack, its application masks and seed in your local library.</p>
        )}
        <label>
          Preset name
          <input
            ref={input}
            aria-label="Preset name"
            value={value}
            maxLength={120}
            required
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </label>
        {!preset && hasMasks && (
          <label className="preset-mask-option">
            <input
              type="checkbox"
              aria-label="Include painted masks"
              checked={includeMasks}
              disabled={saving}
              onChange={(e) => {
                setPreviews(null);
                setIncludeMasks(e.target.checked);
              }}
            />
            Include painted masks{' '}
            <span className="quiet">Included masks scale with the next image’s canvas.</span>
          </label>
        )}
        <fieldset className="thumbnail-choices">
          <legend>Preset thumbnail</legend>
          {(['image', 'statue'] as const).map((option) => {
            const preview = option === 'image' ? image : previews?.statue;
            return (
              <label className="thumbnail-choice" key={option} data-selected={choice === option}>
                <input
                  type="radio"
                  aria-label={option === 'image' ? 'Current image' : 'Statue'}
                  name="thumbnail"
                  value={option}
                  checked={choice === option}
                  disabled={!preview}
                  onChange={() => setChoice(option)}
                />
                {preview ? (
                  <img
                    src={preview}
                    alt={
                      option === 'image' ? 'Current image preset preview' : 'Statue preset preview'
                    }
                  />
                ) : (
                  <span className="thumbnail-pending" role="status">
                    {option === 'image' && !sourceId
                      ? 'Open an image to preview'
                      : error
                        ? 'Preview unavailable'
                        : 'Rendering preview…'}
                  </span>
                )}
                <span>
                  {option === 'image' ? (storedImage ? 'Saved image' : 'Current image') : 'Statue'}
                </span>
              </label>
            );
          })}
        </fieldset>
        {storedImage && sourceId && (
          <button type="button" onClick={() => setRefreshImage(true)}>
            Refresh from current image
          </button>
        )}
        <p>
          {preset
            ? 'Update the name or thumbnail. The saved effects and seed stay the same.'
            : 'Both previews use this stack and its seed.'}
        </p>
        {error && (
          <p role="alert">
            {error}{' '}
            <button type="button" onClick={() => setRetry((number) => number + 1)}>
              Retry previews
            </button>
          </p>
        )}
        {saveError && <p role="alert">{saveError}</p>}
        <div className="stage-dialog-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={saving || !value.trim() || !thumbnail}
            type="submit"
          >
            {preset ? 'Save changes' : 'Save preset'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
