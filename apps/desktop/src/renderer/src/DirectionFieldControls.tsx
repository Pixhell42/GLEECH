import { useEffect, useRef, useState } from 'react';
import {
  directionFieldParams,
  getEffectDefinition,
  supportsDirectionField,
  type EffectInstance,
  type LayerImage,
} from '@gleech/project-model';
import { createDirectionSampler } from '@gleech/effects';
import type { ImportedImage } from '../../shared/image-api';
import { unwrap } from '../../shared/image-api';
import { StarterMapPicker } from './StarterMapPicker';
import { InfoTooltip } from './InfoTooltip';
import { InspectorSection } from './InspectorSections';

export function DirectionFieldControls({
  effect,
  effects,
  image,
  disabled,
  onFieldChange,
  onChange,
}: {
  effect: EffectInstance;
  effects: readonly EffectInstance[];
  image: ImportedImage | undefined;
  disabled: boolean;
  onFieldChange(params: Readonly<Record<string, number | string>>, image: LayerImage | null): void;
  onChange(params: Readonly<Record<string, number | string>>): void;
}) {
  const [picker, setPicker] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [previewError, setPreviewError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    p = directionFieldParams(effect.params);
  const decodedMap = useRef<{
    png: string;
    promise: Promise<{ width: number; height: number; pixels: ArrayBuffer }>;
  } | null>(null);
  const sources = effects.filter(
    (e) =>
      e.instanceId !== effect.instanceId &&
      supportsDirectionField(e) &&
      directionFieldParams(e.params).directionSource !== 'native',
  );
  useEffect(() => {
    let active = true;
    async function draw() {
      if (!image || !canvas.current) return;
      let map: { width: number; height: number; pixels: ArrayBuffer } | undefined;
      if (p.directionSource === 'image' && effect.directionImage) {
        const png = effect.directionImage.png;
        if (decodedMap.current?.png !== effect.directionImage.png)
          decodedMap.current = {
            png: effect.directionImage.png,
            promise: (async () => {
              const bitmap = new Image();
              bitmap.src = png;
              await bitmap.decode();
              const c = document.createElement('canvas');
              c.width = c.height = 192;
              const context = c.getContext('2d')!;
              context.drawImage(bitmap, 0, 0, 192, 192);
              return {
                width: 192,
                height: 192,
                pixels: context.getImageData(0, 0, 192, 192).data.buffer as ArrayBuffer,
              };
            })(),
          };
        map = await decodedMap.current.promise;
      }
      if (!active || !canvas.current) return;
      const context = canvas.current.getContext('2d')!;
      context.fillStyle = '#16171b';
      context.fillRect(0, 0, 240, 120);
      const field = createDirectionSampler(effect.params, image.source, image.preview, map),
        vector = new Float64Array(2);
      context.strokeStyle = '#edc45d';
      context.lineWidth = 1.4;
      for (let y = 10; y < 120; y += 20)
        for (let x = 10; x < 240; x += 20) {
          field(x / 240, y / 120, vector);
          const dx = vector[0]! * 10,
            dy = vector[1]! * 10;
          if (Math.hypot(dx, dy) < 0.3) continue;
          const angle = Math.atan2(dy, dx),
            ex = x + dx / 2,
            ey = y + dy / 2;
          context.beginPath();
          context.moveTo(x - dx / 2, y - dy / 2);
          context.lineTo(ex, ey);
          context.lineTo(ex - Math.cos(angle - 0.6) * 3, ey - Math.sin(angle - 0.6) * 3);
          context.moveTo(ex, ey);
          context.lineTo(ex - Math.cos(angle + 0.6) * 3, ey - Math.sin(angle + 0.6) * 3);
          context.stroke();
        }
      canvas.current.dataset.mapId =
        p.directionSource === 'image' ? (effect.directionImage?.source.id ?? '') : '';
    }
    void draw()
      .then(() => {
        if (active) setPreviewError(null);
      })
      .catch(() => {
        if (active) {
          canvas.current?.getContext('2d')?.clearRect(0, 0, 240, 120);
          if (canvas.current) delete canvas.current.dataset.mapId;
          setPreviewError('Could not display the direction map preview.');
        }
      });
    return () => {
      active = false;
    };
  }, [effect.params, effect.directionImage, image, p.directionSource]);
  async function choose(id?: string) {
    setPicker(false);
    setLoading(true);
    setError(null);
    try {
      const map = unwrap(
        await (id ? window.gleech.chooseVectorMap(id) : window.gleech.openLayerImage('vector')),
      );
      if (map)
        onFieldChange(
          {
            directionSource: 'image',
            directionScale: 100,
            directionX: 50,
            directionY: 50,
            directionRotation: 0,
            directionInvert: 'off',
          },
          map,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the vector map.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="direction-field-controls" data-settings-kind="direction-field">
      <InspectorSection
        sectionId="direction-field"
        title="Direction field"
        headingClassName="direction-field-heading"
        help={
          <InfoTooltip
            label="Shared direction field"
            text="Reuse radial, spiral, flow and imported vectors across compatible filters. Fields stay anchored to the stage canvas. Copying keeps the saved pattern and embedded image as independent settings; edits do not propagate to other layers."
          />
        }
      >
        {p.directionSource !== 'native' && (
          <canvas
            ref={canvas}
            className="direction-field-preview"
            width={240}
            height={120}
            aria-label="Direction field preview"
          />
        )}
        <div className="depth-map-actions">
          <button disabled={disabled || loading} onClick={() => void choose()}>
            Import
          </button>
          <button disabled={disabled || loading} onClick={() => setPicker(true)}>
            Starter Maps
          </button>
        </div>
        {picker && (
          <StarterMapPicker
            kind="vector"
            onChoose={(id) => void choose(id)}
            onClose={() => setPicker(false)}
          />
        )}
        {loading && <span role="status">Loading direction map…</span>}
        {error && <span role="alert">{error}</span>}
        {previewError && <span role="alert">{previewError}</span>}
        {p.directionSource === 'image' && (
          <p className="quiet">
            {effect.directionImage?.source.name ?? 'Choose a vector map to activate this field.'}
          </p>
        )}
        {sources.length > 0 && (
          <label className="effect-control">
            <span>Copy direction field from</span>
            <select
              aria-label="Copy direction field from"
              value=""
              disabled={disabled}
              onChange={(event) => {
                const source = sources.find((e) => e.instanceId === event.target.value);
                if (source) {
                  const recipe = Object.fromEntries(
                    Object.entries(directionFieldParams(source.params)).filter(
                      ([key]) => key !== 'directionDrift',
                    ),
                  );
                  onFieldChange(recipe, source.directionImage ?? null);
                }
              }}
            >
              <option value="">Choose a layer…</option>
              {sources.map((e, i) => (
                <option key={e.instanceId} value={e.instanceId}>
                  {getEffectDefinition(e).title} · {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        {p.directionSource === 'flow' && (
          <button
            disabled={disabled}
            title="Create a new saved flow pattern. Copied fields keep their own seed."
            onClick={() => onChange({ directionSeed: (p.directionSeed + 1) % 65536 })}
          >
            New flow pattern
          </button>
        )}
      </InspectorSection>
    </div>
  );
}
