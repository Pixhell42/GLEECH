import { depthPreviewPixels, type DepthPreviewMode } from './depth-preview';
import { StarterMapPicker } from './StarterMapPicker';
import { unwrap } from '../../shared/image-api';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEPTH_FIELD_KEYS,
  createEffect,
  heightFieldParams,
  usesHeightField,
  getEffectDefinition,
  type DepthFieldEffect,
  type HeightConsumerEffect,
  type EffectInstance,
  type LayerImage,
} from '@gleech/project-model';
import type { ImportedImage } from '../../shared/image-api';
import { EffectProcessor } from './EffectProcessor';
import { InfoTooltip } from './InfoTooltip';
import { InspectorSection } from './InspectorSections';

interface Props {
  effect: HeightConsumerEffect;
  effects: readonly EffectInstance[];
  image: ImportedImage | undefined;
  disabled: boolean;
  onChange(params: Readonly<Record<string, number | string>>): void;
  endGesture(): void;
  onFieldChange(params: Readonly<Record<string, number | string>>, image: LayerImage | null): void;
}
export function DepthFieldControls({
  effect,
  effects,
  image,
  disabled,
  onChange,
  endGesture,
  onFieldChange,
}: Props) {
  const [previewMode, setPreviewMode] = useState<DepthPreviewMode>('grayscale');
  const [picker, setPicker] = useState(false);
  const [loadingMap, setLoadingMap] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const processor = useRef<EffectProcessor | null>(null);
  const [preview, setPreview] = useState<{
    key: string;
    urls?: Record<Exclude<DepthPreviewMode, 'hidden'>, string>;
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([
    image?.source.id,
    heightFieldParams(effect.params),
    effect.fieldImage?.source.id,
  ]);
  const recipe = useMemo(() => heightFieldParams(effect.params), [effect.params]);
  useEffect(() => {
    processor.current = new EffectProcessor();
    return () => {
      processor.current?.dispose();
      processor.current = null;
    };
  }, [retry]);
  useEffect(() => {
    if (!image || (recipe.fieldSource === 'image' && !effect.fieldImage)) return;
    const worker = processor.current!;
    let active = true;
    const timer = setTimeout(() => {
      const base = createEffect('depth-field', 'height-preview') as DepthFieldEffect;
      const field: DepthFieldEffect = {
        ...base,
        ...(effect.fieldImage ? { fieldImage: effect.fieldImage } : {}),
        params: { ...base.params, ...JSON.parse(key)[1], operation: 'field' },
      };
      void worker
        .render(image.preview, [field], {
          masterSeed: 0,
          reference: image.source,
          purpose: 'preview',
          previewMaxDimension: 160,
        })
        .then((rendered) => {
          if (!active) return;
          const urls = Object.fromEntries(
            (['grayscale', 'false-color', 'overlay'] as const).map((mode) => {
              const canvas = document.createElement('canvas');
              canvas.width = rendered.width;
              canvas.height = rendered.height;
              const pixels = depthPreviewPixels(rendered, image.preview, mode);
              canvas
                .getContext('2d')!
                .putImageData(new ImageData(pixels, rendered.width, rendered.height), 0, 0);
              return [mode, canvas.toDataURL('image/png')];
            }),
          ) as Record<Exclude<DepthPreviewMode, 'hidden'>, string>;
          setPreview({ key, urls });
        })
        .catch((error) => {
          if (active)
            setPreview({
              key,
              error: error instanceof Error ? error.message : 'Could not preview the field.',
            });
        });
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
      worker.cancelPreview();
    };
  }, [image, key, retry, effect.fieldImage, recipe.fieldSource]);
  const sources = effects.filter(
    (candidate): candidate is HeightConsumerEffect =>
      usesHeightField(candidate) && candidate.instanceId !== effect.instanceId,
  );
  const noise = ['perlin', 'simplex', 'value', 'voronoi'].includes(recipe.fieldSource);
  async function choose(id?: string) {
    setLoadingMap(true);
    setMapError(null);
    setPicker(false);
    try {
      const map = unwrap(
        await (id ? window.gleech.chooseDepthMap(id) : window.gleech.openLayerImage('depth')),
      );
      if (map)
        onFieldChange(
          { fieldSource: 'image', fieldScale: 100, fieldX: 50, fieldY: 50, fieldRotation: 0 },
          map,
        );
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'Could not load the depth map.');
    } finally {
      setLoadingMap(false);
    }
  }
  return (
    <div className="depth-field-controls">
      <InspectorSection
        sectionId={
          effect.instanceId.endsWith('-application') ? 'application-height-field' : 'height-field'
        }
        title="Height field"
        headingClassName="depth-field-heading"
        help={
          <InfoTooltip
            label="Height field"
            text="White is near/high and black is far/low. Brightness reads the current stage source; Imported Map embeds a grayscale or luminance image; other sources manufacture height from ramps, noise or shapes. This field stays fixed to the stage canvas. Copying a field keeps its recipe, image and saved seed; it creates no live link."
          />
        }
      >
        <label className="effect-control">
          <span className="control-title">
            Depth preview{' '}
            <InfoTooltip
              label="Depth preview"
              text="Grayscale shows white near/high and black far/low. False color runs blue (far) through cyan/yellow to red (near). Overlay mixes that signal with the stage source. Hidden hides this preview only; the field and exports stay unchanged."
            />
          </span>
          <select
            aria-label="Depth preview"
            value={previewMode}
            onChange={(event) => setPreviewMode(event.target.value as DepthPreviewMode)}
          >
            <option value="grayscale">Grayscale</option>
            <option value="false-color">False color</option>
            <option value="overlay">Image overlay</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <div
          hidden={previewMode === 'hidden'}
          className="depth-field-preview"
          aria-busy={
            !(recipe.fieldSource === 'image' && !effect.fieldImage) && preview?.key !== key
          }
        >
          {recipe.fieldSource === 'image' && !effect.fieldImage ? (
            <span>Choose an imported or starter map.</span>
          ) : preview?.key === key && preview.urls && previewMode !== 'hidden' ? (
            <img src={preview.urls[previewMode]} alt={`Depth field preview: ${previewMode}`} />
          ) : preview?.key === key && preview.error ? (
            <>
              <span>{preview.error}</span>
              <button onClick={() => setRetry(retry + 1)}>Retry field preview</button>
            </>
          ) : (
            <span>Updating field…</span>
          )}
        </div>
        <div className="depth-map-actions">
          <button type="button" disabled={disabled || loadingMap} onClick={() => void choose()}>
            Import map...
          </button>
          <button type="button" disabled={disabled || loadingMap} onClick={() => setPicker(true)}>
            Starter maps...
          </button>
        </div>
        {loadingMap && <span role="status">Loading depth map...</span>}
        {recipe.fieldSource === 'image' && (
          <span className="quiet">
            {effect.fieldImage
              ? effect.fieldImage.source.name
              : 'Choose an imported or starter map.'}
          </span>
        )}
        {mapError && <span role="alert">{mapError}</span>}
        {picker && (
          <StarterMapPicker onChoose={(id) => void choose(id)} onClose={() => setPicker(false)} />
        )}
        {noise && (
          <button
            disabled={disabled}
            onClick={() => {
              endGesture();
              onChange({ fieldSeed: (recipe.fieldSeed + 1) % 65536 });
            }}
            title="Create a new saved noise pattern for this field."
          >
            New field pattern
          </button>
        )}
        {sources.length > 0 && (
          <label>
            Copy field from
            <select
              aria-label="Copy field from"
              value=""
              disabled={disabled}
              onChange={(event) => {
                const source = sources.find((source) => source.instanceId === event.target.value);
                if (source) {
                  endGesture();
                  onFieldChange(
                    Object.fromEntries(
                      DEPTH_FIELD_KEYS.map((key) => [key, heightFieldParams(source.params)[key]]),
                    ),
                    source.fieldImage ?? null,
                  );
                }
              }}
            >
              <option value="">Choose a field…</option>
              {sources.map((source, index) => (
                <option key={source.instanceId} value={source.instanceId}>
                  {getEffectDefinition(source).title} {index + 1} ·{' '}
                  {heightFieldParams(source.params).fieldSource}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="visually-hidden" data-field-recipe={JSON.stringify(recipe)} />
      </InspectorSection>
    </div>
  );
}
