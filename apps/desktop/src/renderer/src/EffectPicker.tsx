import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  FAVORITES_STORAGE_KEY,
  favoriteKey,
  parseFavorites,
  orderFavorites,
  type FavoriteKind,
} from './library-favorites';
import {
  EFFECT_CATEGORIES,
  EFFECT_CATEGORY,
  filterEffectCatalog,
  type EffectCategory,
} from '@gleech/project-model/effect-catalog';
import type { LibraryPreset, LibraryShader } from '../../shared/image-api';
import { ShaderCredits } from './ShaderCredits';
import { ShaderName } from './ShaderName';
import {
  EFFECT_DEFINITIONS,
  ADVANCED_SHADER_TYPES,
  type AdvancedShaderType,
  isShaderEffect,
  type EffectType,
  type EffectPreset,
  type PresetPlacement,
} from '@gleech/project-model';
import rgbSplit from './assets/effects/rgb-split.webp';
import blockCorruption from './assets/effects/block-corruption.webp';
import spatialCrush from './assets/effects/spatial-crush.webp';
import bitCrush from './assets/effects/bit-crush.webp';
import waveDistortion from './assets/effects/wave-distortion.webp';
import scanlines from './assets/effects/scanlines.webp';
import halftone from './assets/effects/halftone.webp';
import mirroring from './assets/effects/mirroring.webp';
import kaleidoscope from './assets/effects/kaleidoscope.webp';
import pixelSort from './assets/effects/pixel-sort.webp';
import indexedPalette from './assets/effects/indexed-palette.webp';
import threshold from './assets/effects/threshold.webp';
import dither from './assets/effects/dither.webp';
import glyph from './assets/effects/glyph.webp';
import crt from './assets/effects/crt.webp';
import signalTearing from './assets/effects/signal-tearing.webp';
import channelTransform from './assets/effects/channel-transform.webp';
import temporalEcho from './assets/effects/temporal-echo.webp';
import chromaMosh from './assets/effects/chroma-mosh.webp';
import motionMosh from './assets/effects/motion-mosh.webp';
import shapes from './assets/effects/shapes.webp';
import mandelbrot from './assets/effects/fractal-weave.webp';
import recursiveSpace from './assets/effects/recursive-space.webp';
import gradientMap from './assets/effects/gradient-map.webp';
import hueSaturation from './assets/effects/hue-saturation.webp';
import levelsCurves from './assets/effects/levels-curves.webp';
import glow from './assets/effects/glow.webp';
import noiseGrain from './assets/effects/noise-grain.webp';
import depthField from './assets/effects/depth-field.webp';
import feedbackBloom from './assets/effects/feedback-bloom.webp';
import compressionBreakup from './assets/effects/compression-breakup.webp';
import jpegRecompression from './assets/effects/jpeg-recompression.webp';
import blur from './assets/effects/blur.webp';
import solid from './assets/effects/solid.webp';
import transform from './assets/effects/transform.webp';

import bitDamage from './assets/effects/bit-damage.webp';
import freezeDropout from './assets/effects/freeze-dropout.webp';
import photoAdjustments from './assets/effects/photo-adjustments.webp';
import detail from './assets/effects/detail.webp';
import halation from './assets/effects/halation.webp';
import vignette from './assets/effects/vignette.webp';

import vectorCorruption from './assets/effects/vector-corruption.webp';

import referenceMosh from './assets/effects/reference-mosh.webp';

import motionTransfer from './assets/effects/motion-transfer.webp';

import depthParallax from './assets/effects/depth-parallax.webp';

import depthHaze from './assets/effects/depth-haze.webp';

import depthColorMap from './assets/effects/depth-color-map.webp';

import cutout from './assets/effects/cutout.webp';

import lensDistortion from './assets/effects/lens-distortion.webp';
import shaderRipple from './assets/effects/shader-ripple.webp';
import shaderPlasma from './assets/effects/shader-plasma.webp';
import shaderGlass from './assets/effects/shader-liquid-glass.webp';
import shaderIridescence from './assets/effects/shader-iridescence.webp';
import shaderHologram from './assets/effects/shader-hologram.webp';
import shaderFlow from './assets/effects/shader-flow-field.webp';
import shaderCaustics from './assets/effects/shader-caustics.webp';
import shaderChrome from './assets/effects/shader-liquid-chrome.webp';
import shaderMirage from './assets/effects/shader-heat-mirage.webp';
import shaderNebula from './assets/effects/shader-nebula.webp';
import shaderMembrane from './assets/effects/shader-cellular-membrane.webp';
import shaderMoire from './assets/effects/shader-moire.webp';
import shaderFracture from './assets/effects/shader-digital-fracture.webp';
import shaderDiffraction from './assets/effects/shader-diffraction.webp';
import shaderTunnel from './assets/effects/shader-infinity-tunnel.webp';
import shaderCrystal from './assets/effects/shader-crystal-facets.webp';
import shaderCircuit from './assets/effects/shader-circuit-matrix.webp';
import shaderLattice from './assets/effects/shader-data-lattice.webp';
import shaderOpArt from './assets/effects/shader-op-art.webp';
import shaderPolar from './assets/effects/shader-polar-grid.webp';

import chromaticErosion from './assets/effects/shader-chromatic-erosion.webp';
import bloomField from './assets/effects/shader-bloom-field.webp';
import windowFragments from './assets/effects/window-fragments.webp';
import contourWaves from './assets/effects/contour-waves.webp';
import pixelDissolve from './assets/effects/pixel-dissolve.webp';
import neonPrint from './assets/effects/neon-print.webp';
import systemCrash from './assets/effects/system-crash.webp';
import terminalWireframe from './assets/effects/terminal-wireframe.webp';
import radialExtrusion from './assets/effects/shader-radial-extrusion.webp';
import cellularMesh from './assets/effects/shader-cellular-mesh.webp';
import particleBurst from './assets/effects/shader-particle-burst.webp';
import spectralTerrain from './assets/effects/shader-spectral-terrain.webp';
import neonEdges from './assets/effects/shader-neon-edges.webp';
import wireGhost from './assets/effects/shader-wire-ghost.webp';
import prismaticShatter from './assets/effects/shader-prismatic-shatter.webp';
import signalWeave from './assets/effects/signal-weave.webp';
import dataWeave from './assets/effects/data-weave.webp';
import microCollage from './assets/effects/micro-collage.webp';
import celShading from './assets/effects/cel-shading.webp';
import signalCollapse from './assets/effects/shader-signal-collapse.webp';
import paintFlow from './assets/effects/shader-paint-flow.webp';
import billowingSmoke from './assets/effects/shader-billowing-smoke.webp';
import liquidMarbling from './assets/effects/shader-liquid-marbling.webp';
import truchetMosaic from './assets/effects/shader-truchet-mosaic.webp';
import microculture from './assets/effects/shader-microculture.webp';
import prismaticPanels from './assets/effects/shader-prismatic-panels.webp';
import pixelStretch from './assets/effects/pixel-stretch.webp';
import ledMatrix from './assets/effects/led-matrix.webp';
import granularEcho from './assets/effects/granular-echo.webp';
import pigmentDrag from './assets/effects/pigment-drag.webp';
const advancedImages = import.meta.glob<string>('./assets/effects/shader-*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const thumbnails: Record<EffectType, string> = {
  ...(Object.fromEntries(
    ADVANCED_SHADER_TYPES.map((type) => [type, advancedImages[`./assets/effects/${type}.webp`]!]),
  ) as Record<AdvancedShaderType, string>),
  'granular-echo': granularEcho,
  'pigment-drag': pigmentDrag,
  'shader-liquid-marbling': liquidMarbling,
  'shader-truchet-mosaic': truchetMosaic,
  'shader-microculture': microculture,
  'shader-prismatic-panels': prismaticPanels,
  'pixel-stretch': pixelStretch,
  'led-matrix': ledMatrix,
  'cel-shading': celShading,
  'shader-signal-collapse': signalCollapse,
  'shader-paint-flow': paintFlow,
  'shader-billowing-smoke': billowingSmoke,
  'shader-chromatic-erosion': chromaticErosion,
  'shader-bloom-field': bloomField,
  'window-fragments': windowFragments,
  'contour-waves': contourWaves,
  'pixel-dissolve': pixelDissolve,
  'neon-print': neonPrint,
  'system-crash': systemCrash,
  'terminal-wireframe': terminalWireframe,
  'shader-radial-extrusion': radialExtrusion,
  'shader-cellular-mesh': cellularMesh,
  'shader-particle-burst': particleBurst,
  'shader-spectral-terrain': spectralTerrain,
  'shader-neon-edges': neonEdges,
  'shader-wire-ghost': wireGhost,
  'shader-prismatic-shatter': prismaticShatter,
  'signal-weave': signalWeave,
  'data-weave': dataWeave,
  'micro-collage': microCollage,
  'shader-ripple': shaderRipple,
  'shader-plasma': shaderPlasma,
  'shader-liquid-glass': shaderGlass,
  'shader-iridescence': shaderIridescence,
  'shader-hologram': shaderHologram,
  'shader-flow-field': shaderFlow,
  'shader-caustics': shaderCaustics,
  'shader-liquid-chrome': shaderChrome,
  'shader-heat-mirage': shaderMirage,
  'shader-nebula': shaderNebula,
  'shader-cellular-membrane': shaderMembrane,
  'shader-moire': shaderMoire,
  'shader-digital-fracture': shaderFracture,
  'shader-diffraction': shaderDiffraction,
  'shader-infinity-tunnel': shaderTunnel,
  'shader-crystal-facets': shaderCrystal,
  'shader-circuit-matrix': shaderCircuit,
  'shader-data-lattice': shaderLattice,
  'shader-op-art': shaderOpArt,
  'shader-polar-grid': shaderPolar,
  'lens-distortion': lensDistortion,
  cutout: cutout,
  'depth-color-map': depthColorMap,
  'depth-haze': depthHaze,
  'depth-parallax': depthParallax,
  'motion-transfer': motionTransfer,
  'reference-mosh': referenceMosh,
  'vector-corruption': vectorCorruption,
  'bit-damage': bitDamage,
  'freeze-dropout': freezeDropout,
  'photo-adjustments': photoAdjustments,
  detail,
  halation,
  vignette,
  'channel-transform': channelTransform,
  'temporal-echo': temporalEcho,
  'signal-tearing': signalTearing,
  crt,
  glyph,
  solid,
  transform,
  'noise-grain': noiseGrain,
  blur,
  'rgb-split': rgbSplit,
  'block-corruption': blockCorruption,
  'spatial-crush': spatialCrush,
  'bit-crush': bitCrush,
  'wave-distortion': waveDistortion,
  scanlines,
  halftone,
  mirroring,
  kaleidoscope,
  'motion-mosh': motionMosh,
  'chroma-mosh': chromaMosh,
  'pixel-sort': pixelSort,
  'indexed-palette': indexedPalette,
  threshold,
  dither,
  'feedback-bloom': feedbackBloom,
  'compression-breakup': compressionBreakup,
  'jpeg-recompression': jpegRecompression,
  'depth-field': depthField,
  shapes,
  mandelbrot,
  'recursive-space': recursiveSpace,
  'gradient-map': gradientMap,
  'hue-saturation': hueSaturation,
  'levels-curves': levelsCurves,
  glow,
};

interface Props {
  shaders: readonly LibraryShader[];
  onImportShader(): void;
  onChooseShader(shader: LibraryShader): void;
  onDeleteShader(shader: LibraryShader): void;
  onChoose(type: EffectType): void;
  onClose(): void;
  presets: readonly LibraryPreset[];
  initialTab: 'effects' | 'presets';
  returnFocus?: RefObject<HTMLElement | null>;
  libraryError: string | null;
  loading: boolean;
  operationError: string | null;
  onDismissError(): void;
  canSave: boolean;
  canApply: boolean;
  onRetry(): void;
  onSave(): void;
  onRename(preset: EffectPreset): void;
  onDelete(preset: EffectPreset): void;
  onImport(): void;
  onExport(preset: EffectPreset): void;
  onApply(preset: EffectPreset, placement: PresetPlacement): void;
}

const placements: readonly { value: PresetPlacement; label: string; description: string }[] = [
  {
    value: 'replace',
    label: 'Replace All',
    description:
      'Replace the entire current stack with this preset, including its saved seed. Your image and stages stay available. Undo restores the previous stack.',
  },
  {
    value: 'above',
    label: 'Add Above',
    description:
      'Place this preset at the top of the visible stack, so it runs after the current effects. Keep the current seed; the preset’s random patterns may vary. Undo removes the added stack.',
  },
  {
    value: 'below',
    label: 'Add Below',
    description:
      'Place this preset at the bottom of the visible stack, so it runs before the current effects. Keep the current seed; the preset’s random patterns may vary. Undo removes the added stack.',
  },
  {
    value: 'merge',
    label: 'Merge',
    description:
      'Keep your current versions of the preset’s effect types, add missing types, and remove the others. Use the preset’s order and keep the current seed. Undo restores your previous stack.',
  },
];

export function EffectPicker({
  shaders,
  onImportShader,
  onChooseShader,
  onDeleteShader,
  onChoose,
  onClose,
  presets,
  initialTab,
  returnFocus,
  libraryError,
  loading,
  operationError,
  onDismissError,
  canSave,
  canApply,
  onRetry,
  onSave,
  onRename,
  onDelete,
  onImport,
  onExport,
  onApply,
}: Props) {
  const modal = useRef<HTMLDialogElement>(null);
  const flyout = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState('');
  const [effectSearch, setEffectSearch] = useState('');
  const [category, setCategory] = useState<EffectCategory | 'Favorites'>('All');
  const [presetSource, setPresetSource] = useState('all');
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => {
    try {
      return parseFavorites(localStorage.getItem(FAVORITES_STORAGE_KEY));
    } catch {
      return new Set();
    }
  });
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const toggleFavorite = (kind: FavoriteKind, id: string) => {
    const key = favoriteKey(kind, id),
      next = new Set(favorites);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...next]));
      setFavorites(next);
      setFavoriteError(null);
    } catch {
      setFavoriteError('Could not save favorites. Please try again.');
    }
  };
  const [choice, setChoice] = useState<{
    preset: EffectPreset;
    left: number;
    top: number;
    opener: HTMLButtonElement;
  } | null>(null);
  const dismissChoice = () => {
    choice?.opener.focus();
    setChoice(null);
  };
  useEffect(() => {
    const dialog = modal.current!;
    const opener =
      returnFocus?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => {
      dialog.close();
      opener?.focus();
    };
  }, [returnFocus]);

  useEffect(() => {
    if (!choice) return;
    if (!flyout.current?.matches(':popover-open')) flyout.current?.showPopover();
    flyout.current?.querySelector('button')?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !flyout.current?.contains(event.target) &&
        !choice.opener.contains(event.target)
      )
        setChoice(null);
    };
    const resize = () =>
      setChoice((previous) =>
        previous ? { ...previous, ...flyoutPosition(previous.opener) } : null,
      );
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', resize);
    };
  }, [choice]);

  const filtered = orderFavorites(
    presets.filter(
      (preset) =>
        (presetSource === 'all' ||
          (presetSource === 'favorites'
            ? favorites.has(favoriteKey('preset', preset.id))
            : presetSource === 'built-in'
              ? preset.builtIn
              : !preset.builtIn)) &&
        `${preset.name} ${preset.description ?? ''}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
    ),
    favorites,
    (p) => favoriteKey('preset', p.id),
    (p) => p.name,
  );
  const tiles = [
    ...filterEffectCatalog(effectSearch, category === 'Favorites' ? 'All' : category).map(
      (type) => ({
        key: favoriteKey('effect', type),
        kind: 'effect' as const,
        id: type,
        type,
        shader: null,
        title: EFFECT_DEFINITIONS[type].title,
        description: EFFECT_DEFINITIONS[type].description,
        thumbnail: thumbnails[type],
      }),
    ),
    ...shaders
      .filter(
        (shader) =>
          ['All', 'Favorites', 'Shaders'].includes(category) &&
          effectSearch
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .every((term) =>
              `${shader.package.name} ${shader.package.description} ${shader.package.authors.map((author) => author.name).join(' ')} shaders`
                .toLowerCase()
                .includes(term),
            ),
      )
      .map((shader) => ({
        key: favoriteKey('shader', shader.id),
        kind: 'shader' as const,
        id: shader.id,
        type: null,
        shader,
        title: shader.package.name,
        description: shader.package.description,
        thumbnail: shader.thumbnail,
      })),
  ];
  const filteredEffects = orderFavorites(
    tiles.filter((tile) => category !== 'Favorites' || favorites.has(tile.key)),
    favorites,
    (tile) => tile.key,
    (tile) => tile.title,
  );

  return (
    <dialog
      ref={modal}
      id="effect-catalog"
      className="effect-picker"
      aria-labelledby="effect-picker-title"
      aria-describedby="effect-picker-description"
      onCancel={(event) => {
        event.preventDefault();
        if (choice) dismissChoice();
        else onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && choice) {
          event.preventDefault();
          dismissChoice();
        }
      }}
      onWheel={() => setChoice(null)}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <div className="effect-picker-heading">
        <div>
          <h2 id="effect-picker-title">{canApply ? 'Add an effect' : 'Filters and presets'}</h2>
          <p id="effect-picker-description">
            {canApply
              ? 'Choose an effect or a saved effect stack.'
              : 'Browse filters and presets. Open an image to apply them.'}
          </p>
        </div>
        <button className="effect-picker-close" aria-label="Close effect picker" onClick={onClose}>
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {operationError && (
        <div className="preset-operation-error" role="alert">
          <span>{operationError}</span>
          <button onClick={onDismissError} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {favoriteError && (
        <div className="preset-operation-error" role="alert">
          {favoriteError}
        </div>
      )}
      <div className="catalog-header">
        <div className="catalog-tabs" role="tablist" aria-label="Effect library">
          {(['effects', 'presets'] as const).map((name) => (
            <button
              key={name}
              role="tab"
              id={`catalog-tab-${name}`}
              aria-controls={`catalog-panel-${name}`}
              aria-selected={tab === name}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => {
                setTab(name);
                setChoice(null);
              }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 'effects'
                    : event.key === 'End'
                      ? 'presets'
                      : tab === 'effects'
                        ? 'presets'
                        : 'effects';
                setTab(next);
                setChoice(null);
                modal.current?.querySelector<HTMLButtonElement>(`#catalog-tab-${next}`)?.focus();
              }}
            >
              {name === 'effects' ? 'Effects' : 'Presets'}
            </button>
          ))}
        </div>
        {tab === 'effects' && (
          <button
            type="button"
            className="shader-add"
            onClick={() => {
              setCategory('Shaders');
              onImportShader();
            }}
          >
            Add Shader
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        id="catalog-panel-effects"
        aria-labelledby="catalog-tab-effects"
        hidden={tab !== 'effects'}
      >
        <div className="effect-search-toolbar">
          <input
            type="search"
            aria-label="Search effects"
            placeholder="Search effects or styles…"
            value={effectSearch}
            onChange={(event) => setEffectSearch(event.currentTarget.value)}
          />
          <span role="status">
            {filteredEffects.length} {filteredEffects.length === 1 ? 'effect' : 'effects'}
          </span>
        </div>
        <div className="effect-catalog-layout">
          <nav className="effect-category-nav" aria-label="Effect categories">
            <button
              type="button"
              aria-pressed={category === 'Favorites'}
              onClick={() => setCategory('Favorites')}
            >
              Favorites{' '}
              <span>
                {filterEffectCatalog('').filter((type) =>
                  favorites.has(favoriteKey('effect', type)),
                ).length +
                  shaders.filter((shader) => favorites.has(favoriteKey('shader', shader.id)))
                    .length}
              </span>
            </button>
            {EFFECT_CATEGORIES.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={category === name}
                onClick={() => setCategory(name)}
              >
                {name}
                <span>
                  {filterEffectCatalog('', name).length +
                    (name === 'All' || name === 'Shaders' ? shaders.length : 0)}
                </span>
              </button>
            ))}
          </nav>
          <div>
            <div className="effect-grid">
              {filteredEffects.map((tile) => (
                <article className="effect-card" key={tile.key}>
                  <button
                    className="effect-tile"
                    disabled={!canApply}
                    title={canApply ? undefined : 'Open an image to apply this filter.'}
                    aria-label={tile.title}
                    aria-description={
                      tile.shader || (tile.type && EFFECT_CATEGORY[tile.type] === 'Shaders')
                        ? 'Shader effect'
                        : undefined
                    }
                    onClick={() =>
                      tile.shader ? onChooseShader(tile.shader) : onChoose(tile.type!)
                    }
                  >
                    <img src={tile.thumbnail} alt="" width="384" height="384" />
                    <span className="effect-tile-copy">
                      <strong>
                        <ShaderName
                          name={tile.title}
                          shader={Boolean(
                            tile.shader || (tile.type && EFFECT_CATEGORY[tile.type] === 'Shaders'),
                          )}
                        />
                      </strong>
                      <span>{tile.description}</span>
                    </span>
                  </button>
                  <FavoriteStar
                    name={tile.title}
                    selected={favorites.has(tile.key)}
                    onClick={() => toggleFavorite(tile.kind, tile.id)}
                  />
                  {tile.shader && (
                    <div className="shader-card-footer">
                      <ShaderCredits shader={tile.shader.package} />
                      <button
                        type="button"
                        className="effect-delete shader-remove"
                        aria-label={`Remove ${tile.title} from library`}
                        title="Remove from this library. Embedded project and preset copies stay available."
                        onClick={() => onDeleteShader(tile.shader!)}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
            {!filteredEffects.length && (
              <p className="preset-empty">No effects match your search in {category}.</p>
            )}
          </div>
        </div>
      </div>
      <div
        role="tabpanel"
        id="catalog-panel-presets"
        aria-labelledby="catalog-tab-presets"
        hidden={tab !== 'presets'}
      >
        <div className="preset-toolbar">
          <select
            aria-label="Preset collection"
            value={presetSource}
            onChange={(event) => {
              setPresetSource(event.target.value);
              setChoice(null);
            }}
          >
            <option value="all">All presets</option>
            <option value="favorites">Favorites</option>
            <option value="built-in">Built-in</option>
            <option value="mine">My presets</option>
          </select>
          <input
            type="search"
            aria-label="Search presets"
            placeholder="Search presets…"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setChoice(null);
            }}
          />
          <button
            onClick={onImport}
            disabled={loading || Boolean(libraryError)}
            title="Import a saved preset file into your library. Your current stack stays as it is."
          >
            Import preset
          </button>
          <button
            className="primary-button"
            onClick={onSave}
            disabled={!canSave || loading || Boolean(libraryError)}
            title="Save the current effect stack, masks and seed to your preset library."
          >
            Save current stack
          </button>
        </div>
        {libraryError ? (
          <div className="preset-empty" role="alert">
            <p>{libraryError}</p>
            <button onClick={onRetry} disabled={loading}>
              Retry
            </button>
          </div>
        ) : loading ? (
          <p className="preset-empty" role="status">
            Loading presets…
          </p>
        ) : (
          <>
            <div className="preset-grid">
              {filtered.map((preset) => (
                <article className="preset-card" key={preset.id}>
                  <FavoriteStar
                    name={preset.name}
                    selected={favorites.has(favoriteKey('preset', preset.id))}
                    onClick={() => toggleFavorite('preset', preset.id)}
                  />
                  <button
                    className="preset-tile"
                    disabled={!canApply}
                    title={canApply ? undefined : 'Open an image to apply this preset.'}
                    aria-label={`Apply ${preset.name}`}
                    aria-description={
                      preset.effects.some(isShaderEffect) ? 'Contains shaders' : undefined
                    }
                    aria-expanded={choice?.preset.id === preset.id}
                    aria-controls={choice?.preset.id === preset.id ? 'preset-actions' : undefined}
                    onClick={(event) => {
                      if (choice?.preset.id === preset.id) {
                        dismissChoice();
                        return;
                      }
                      setChoice({
                        preset,
                        opener: event.currentTarget,
                        ...flyoutPosition(event.currentTarget),
                      });
                    }}
                  >
                    <img src={preset.thumbnail} alt="" width="384" height="384" />
                    <span className="effect-tile-copy">
                      <strong>
                        <ShaderName
                          name={preset.name}
                          shader={preset.effects.some(isShaderEffect)}
                          preset
                        />
                      </strong>
                      <span>
                        {preset.builtIn && (
                          <span className="builtin-preset-label">Built-in · </span>
                        )}
                        {preset.effects.length} {preset.effects.length === 1 ? 'effect' : 'effects'}
                      </span>
                      {preset.description && <span>{preset.description}</span>}
                    </span>
                  </button>
                  <div className="preset-card-actions">
                    <button
                      onClick={() => onExport(preset)}
                      aria-label={`Export preset ${preset.name}`}
                      title="Export this preset with its effects, masks, seed and thumbnail."
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="15"
                        height="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                      >
                        <path d="M12 3v12M8 7l4-4 4 4M5 14v7h14v-7" />
                      </svg>
                    </button>
                    {!preset.builtIn && (
                      <button
                        onClick={() => onRename(preset)}
                        aria-label={`Edit preset ${preset.name}`}
                        title="Edit preset name and thumbnail"
                      >
                        ✎
                      </button>
                    )}
                    {!preset.builtIn && (
                      <button
                        onClick={() => onDelete(preset)}
                        aria-label={`Delete preset ${preset.name}`}
                        title="Delete preset from your library"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="15"
                          height="15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                        </svg>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {!filtered.length && (
              <div className="preset-empty">
                <p>
                  {(
                    presetSource === 'mine'
                      ? presets.some((preset) => !preset.builtIn)
                      : presets.length
                  )
                    ? 'No presets match your search.'
                    : 'Your preset library is empty.'}
                </p>
                {!presets.length && (
                  <p>Save an effect stack or import a preset file to reuse it on another image.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {choice && (
        <div
          ref={flyout}
          popover="manual"
          id="preset-actions"
          className="preset-flyout"
          role="group"
          aria-label={`Apply ${choice.preset.name}`}
          style={{ left: choice.left, top: choice.top }}
        >
          <span className="preset-flyout-title">
            <ShaderName
              name={choice.preset.name}
              shader={choice.preset.effects.some(isShaderEffect)}
              preset
            />
          </span>
          {placements.map((placement) => (
            <div className="preset-choice" key={placement.value}>
              <button
                aria-describedby={`preset-tip-${placement.value}`}
                onClick={() => onApply(choice.preset, placement.value)}
              >
                {placement.label}
              </button>
              <span
                className="preset-choice-tooltip"
                role="tooltip"
                id={`preset-tip-${placement.value}`}
              >
                {placement.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </dialog>
  );
}

function FavoriteStar({
  name,
  selected,
  onClick,
}: {
  name: string;
  selected: boolean;
  onClick(): void;
}) {
  const label = `${selected ? 'Remove' : 'Add'} ${name} ${selected ? 'from' : 'to'} favorites`;
  return (
    <button
      type="button"
      className="favorite-star"
      aria-label={label}
      title={label}
      aria-pressed={selected}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        width="19"
        height="19"
        fill={selected ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z" />
      </svg>
    </button>
  );
}

function flyoutPosition(opener: HTMLButtonElement) {
  const bounds = opener.getBoundingClientRect();
  return {
    left: Math.max(16, Math.min(bounds.left, window.innerWidth - 280)),
    top: Math.max(16, Math.min(bounds.bottom + 6, window.innerHeight - 264)),
  };
}
