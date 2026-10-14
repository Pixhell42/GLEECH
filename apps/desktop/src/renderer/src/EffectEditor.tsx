import { DirectionFieldControls } from './DirectionFieldControls';
import {
  DIRECTION_KEYS,
  directionFieldParams,
  supportsDirectionField,
} from '@gleech/project-model';
import { PreviewBackdropControls } from './PreviewBackdropControls';
import type { PreviewBackdrop } from './preview-backdrop';
import { ApplicationControls } from './ApplicationControls';
import { InspectorSection } from './InspectorSections';
import { ShaderCredits } from './ShaderCredits';
import { DepthFieldControls } from './DepthFieldControls';
import { EmojiAtlas } from './EmojiAtlas';
import { GlyphFontControls } from './GlyphFontControls';
import { GLYPH_DEFAULTS } from '@gleech/project-model';
import { StarterMapPicker } from './StarterMapPicker';
import type { ImportedImage } from '../../shared/image-api';
import { InfoTooltip } from './InfoTooltip';
import { Fragment, useState } from 'react';
import { FractalExplorer } from './FractalExplorer';
import { ColorControl } from './ColorControl';
import { GradientStopEditor } from './GradientStopEditor';
import { GradientColorControl } from './GradientColorControl';
import { ToneCurveEditor } from './ToneCurveEditor';
import { BlurFieldEditor } from './BlurFieldEditor';
import {
  DEPTH_FIELD_KEYS,
  bitCrushDepths,
  CHANNELS,
  type Channel,
  usesHeightField,
  supportsLayerImage,
  type StageSnapshot,
  heightFieldParams,
  getEffectDefinition,
  isAdvancedShader,
  SHAPE_TILE_DEFAULTS,
  isTintEnabled,
  supportsSeedVariation,
  type EffectInstance,
  type LayerImage,
  type GlyphFontAtlas,
  type EffectApplication,
} from '@gleech/project-model';

interface Props {
  masterSeed?: number;
  backdrop: PreviewBackdrop;
  onBackdrop(value: PreviewBackdrop): void;
  effect: EffectInstance;
  effects: readonly EffectInstance[];
  image: ImportedImage | undefined;
  disabled: boolean;
  imageSize: { width: number; height: number };
  onChange(params: Readonly<Record<string, number | string>>): void;
  onGlyphFont(atlas: GlyphFontAtlas): void;
  onVary(): void;
  onChooseLayerImage(): void;
  onChooseVectorMap(id: string): void;
  snapshots: readonly StageSnapshot[];
  onChooseSnapshotImage(id: string): void;
  onDirectionChange(
    params: Readonly<Record<string, number | string>>,
    image: LayerImage | null,
  ): void;
  onFieldChange(params: Readonly<Record<string, number | string>>, image: LayerImage | null): void;
  onReset(): void;
  onApplication(application: Partial<EffectApplication>): void;
  beginGesture(): void;
  endGesture(): void;
}

export function EffectEditor({
  masterSeed = 0,
  backdrop,
  onBackdrop,
  effect,
  effects,
  image,
  disabled,
  imageSize,
  onChange,
  onGlyphFont,
  onVary,
  onChooseLayerImage,
  onChooseVectorMap,
  snapshots,
  onChooseSnapshotImage,
  onFieldChange,
  onDirectionChange,
  onReset,
  onApplication,
  beginGesture,
  endGesture,
}: Props) {
  const [exploring, setExploring] = useState(false);
  const [vectorPicker, setVectorPicker] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel>('red');
  // Keep conditional controls mounted until a slider gesture finishes so the
  // scrollable inspector cannot shrink and move the track away from the pointer.
  const [sliderLayout, setSliderLayout] = useState<EffectInstance | null>(null);
  const layoutEffect = sliderLayout?.instanceId === effect.instanceId ? sliderLayout : effect;
  const baseDefinition = getEffectDefinition(effect);
  const definition =
    effect.type === 'blur'
      ? {
          ...baseDefinition,
          parameters: Object.fromEntries(
            Object.entries(baseDefinition.parameters).map(([key, control]) => [
              key,
              {
                ...control,
                label:
                  key === 'radius' && effect.params.style === 'motion'
                    ? 'Distance'
                    : key === 'radius' && effect.params.style === 'box'
                      ? 'Size'
                      : control.label,
              },
            ]),
          ),
        }
      : baseDefinition;
  const params = (
    effect.type === 'bit-crush'
      ? {
          ...effect.params,
          ...Object.fromEntries(
            ['redBits', 'greenBits', 'blueBits', 'alphaBits'].map((key, index) => [
              key,
              bitCrushDepths(effect.params)[index]!,
            ]),
          ),
        }
      : effect.params
  ) as Readonly<Record<string, number | string>>;
  const showFinishingControl = (key: string) => {
    const extraParams = layoutEffect.params as Readonly<Record<string, number | string>>;
    if (
      layoutEffect.type === 'system-crash' &&
      [
        'anchorDensity',
        'connectorStyle',
        'annotationLabels',
        'overlayFrames',
        'overlayWidth',
      ].includes(key)
    )
      return layoutEffect.params.annotations === 'on';
    if (layoutEffect.type === 'system-crash' && key === 'labelText')
      return (
        layoutEffect.params.annotations === 'on' && layoutEffect.params.annotationLabels !== 'off'
      );
    if (
      layoutEffect.type === 'terminal-wireframe' &&
      ['rightAngleBias', 'channelSeparation'].includes(key)
    )
      return layoutEffect.params.traceStyle === 'circuit';
    if (layoutEffect.type === 'shader-signal-collapse') {
      const slab = extraParams.treatment !== undefined && extraParams.treatment !== 'folded';
      if (
        [
          'sourceMix',
          'slabSize',
          'slabLevels',
          'stripeWidth',
          'slabRoughness',
          'slabDropout',
          'slabTravel',
          'stripeAngle',
        ].includes(key)
      )
        return slab;
      if (['collapse', 'stretch', 'static', 'dropout', 'ribbons', 'travel'].includes(key))
        return !slab;
    }
    if (
      layoutEffect.type === 'shader-diffraction' &&
      ['sourceMix', 'fanSpread', 'rayLength', 'gratingFrequency'].includes(key)
    )
      return extraParams.treatment === 'projector';
    if (layoutEffect.type === 'shader-diffraction' && ['variant', 'accent'].includes(key))
      return extraParams.treatment !== 'projector';
    if (
      layoutEffect.type === 'block-corruption' &&
      ['replacementColor', 'patternScale'].includes(key)
    )
      return (layoutEffect.params.replacement ?? 'source') !== 'source';
    if (layoutEffect.type === 'led-matrix' && key === 'patternFrequency')
      return layoutEffect.params.brightnessSource === 'pattern';
    if (isAdvancedShader(layoutEffect)) {
      if (
        ['shader-contour-melt', 'shader-filament-flow'].includes(layoutEffect.type) &&
        ['patternColor', 'backgroundColor'].includes(key)
      )
        return false;
      if (
        [
          'orbRadius',
          'primitive',
          'objectCount',
          'objectSize',
          'scatter',
          'scatterX',
          'scatterY',
          'objectRotation',
          'cameraYaw',
          'cameraPitch',
          'geometry',
          'slices',
          'spacing',
        ].includes(key)
      )
        return layoutEffect.params.objects === 'on';
      if (layoutEffect.type === 'shader-mandelbrot-slices' && key === 'thickness')
        return layoutEffect.params.objects === 'on';
      if (layoutEffect.type === 'shader-mandelbrot-slices' && key === 'lighting')
        return layoutEffect.params.objects === 'on';
      if (
        layoutEffect.type === 'shader-mandelbrot-slices' &&
        ['patternColor', 'colorMix', 'sourceMix'].includes(key)
      )
        return layoutEffect.params.style !== 'image';
      if (layoutEffect.type === 'shader-bead-weave' && key === 'ringWidth')
        return layoutEffect.params.style === 'rings';
    }
    if (layoutEffect.type === 'granular-echo' && key === 'particleColor')
      return layoutEffect.params.colorSource === 'chosen';
    if (layoutEffect.type === 'pigment-drag' && key === 'pigmentColor')
      return layoutEffect.params.colorMix > 0;
    if (layoutEffect.type === 'shader-truchet-mosaic') {
      if (key === 'arcWidth') return layoutEffect.params.style !== 'dots';
      if (['dotSize', 'dotDensity'].includes(key)) return layoutEffect.params.style !== 'arcs';
    }
    if (layoutEffect.type === 'pixel-stretch') {
      if (key === 'axis') return layoutEffect.params.style !== 'radial';
      if (key === 'originX')
        return (
          (layoutEffect.params.protectedRadius ?? 0) > 0 ||
          layoutEffect.params.style === 'radial' ||
          (layoutEffect.params.style === 'bands' && layoutEffect.params.axis === 'horizontal')
        );
      if (key === 'originY')
        return (
          (layoutEffect.params.protectedRadius ?? 0) > 0 ||
          layoutEffect.params.style === 'radial' ||
          (layoutEffect.params.style === 'bands' && layoutEffect.params.axis === 'vertical')
        );
    }
    if (layoutEffect.type === 'led-matrix' && key === 'ledColor')
      return layoutEffect.params.coloring === 'chosen';
    if (
      layoutEffect.type === 'reference-mosh' &&
      ['placement', 'referenceX', 'referenceY'].includes(key)
    )
      return false;
    if ((DIRECTION_KEYS as readonly string[]).includes(key)) {
      const source = directionFieldParams(layoutEffect.params).directionSource;
      if (key === 'directionSource') return true;
      if (source === 'native') return false;
      if (key === 'directionTwist') return source === 'spiral';
      if (key === 'directionSeed') return source === 'flow';
      if (['directionX', 'directionY', 'directionScale'].includes(key) && source === 'linear')
        return false;
      if (
        key === 'directionRotation' &&
        ['radial', 'toward', 'circular', 'spiral', 'perspective'].includes(source)
      )
        return false;
      return true;
    }
    if (
      layoutEffect.type === 'motion-transfer' &&
      directionFieldParams(layoutEffect.params).directionSource !== 'native' &&
      [
        'encoding',
        'direction',
        'mapScale',
        'mapX',
        'mapY',
        'mapRotation',
        'invertX',
        'invertY',
      ].includes(key)
    )
      return false;
    if (layoutEffect.type === 'vector-corruption' && key === 'quantization')
      return layoutEffect.params.operation === 'quantize';
    if (
      layoutEffect.type === 'reference-mosh' &&
      ['travel', 'direction', 'edgeHandling'].includes(key)
    )
      return layoutEffect.params.style === 'drag';
    if (layoutEffect.type === 'motion-transfer' && key === 'direction')
      return layoutEffect.params.encoding === 'luma';
    if (layoutEffect.type === 'depth-parallax') {
      if (['cameraX', 'cameraY'].includes(key)) return layoutEffect.params.style !== 'push-pull';
      if (['strength', 'nearStrength', 'farStrength', 'centerX', 'centerY'].includes(key))
        return layoutEffect.params.style === 'push-pull';
      if (['bands', 'scatter'].includes(key)) return layoutEffect.params.style === 'tearing';
    }
    if (layoutEffect.type === 'cutout') {
      if (['near', 'far'].includes(key)) return layoutEffect.params.mode !== 'subject';
      if (key === 'subjectThreshold') return layoutEffect.params.mode !== 'depth';
      if (key === 'combine') return layoutEffect.params.mode === 'hybrid';
    }
    if (layoutEffect.type === 'bit-damage') {
      if (['lowBit', 'highBit'].includes(key)) return layoutEffect.params.bitSelection !== 'custom';
      if (key === 'bitMask') return layoutEffect.params.bitSelection === 'custom';
      if (['swapBitA', 'swapBitB'].includes(key))
        return layoutEffect.params.visualize === 'off' && layoutEffect.params.operation === 'swap';
      if (key === 'operand')
        return (
          layoutEffect.params.visualize === 'off' &&
          ['xor', 'and', 'or'].includes(layoutEffect.params.operation)
        );
      if (key === 'sourceChannel')
        return (
          layoutEffect.params.visualize === 'off' && layoutEffect.params.operation === 'crossfeed'
        );
      if (key === 'probability') return layoutEffect.params.visualize === 'off';
      if (key === 'shift')
        return (
          layoutEffect.params.visualize === 'off' &&
          ['shift', 'rotate'].includes(layoutEffect.params.operation)
        );
      if (key === 'operation') return layoutEffect.params.visualize === 'off';
    }
    if (layoutEffect.type === 'freeze-dropout') {
      if (key === 'holdAge') return layoutEffect.params.style === 'freeze';
      if (key === 'scatter') return layoutEffect.params.style === 'duplicate';
      if (['steps', 'travel', 'direction', 'edgeHandling'].includes(key))
        return ['freeze', 'duplicate'].includes(layoutEffect.params.style);
      if (key === 'clearAlpha') return layoutEffect.params.style === 'blank';
      if (key === 'dropoutColor')
        return layoutEffect.params.style === 'blank' && layoutEffect.params.clearAlpha === 'off';
    }
    if (layoutEffect.type === 'detail') {
      if (['radius', 'threshold'].includes(key)) return layoutEffect.params.sharpen !== 0;
      if (key === 'clarityRadius') return layoutEffect.params.clarity !== 0;
    }
    if (layoutEffect.type === 'channel-transform') {
      const channel = CHANNELS.find((c) => key.startsWith(c));
      if (channel) return channel === editingChannel;
    }
    if (layoutEffect.type === 'temporal-echo') {
      if (key === 'echoColor') return layoutEffect.params.style === 'silhouette';
      if (key === 'channelStart') return layoutEffect.params.style === 'color-separated';
      if (key === 'edgeHandling') return layoutEffect.params.clipCopies === 'off';
    }
    if (layoutEffect.type === 'crt') {
      if (['phosphorStrength', 'phosphorPitch', 'phosphorWidth', 'phosphorGain'].includes(key))
        return layoutEffect.params.phosphor !== 'off';
      if (['fieldOrder', 'fieldSize', 'fieldOffsetX', 'fieldOffsetY'].includes(key))
        return layoutEffect.params.fieldBlend > 0;
      if (['bloomRadius', 'bloomThreshold', 'bloomColorMix'].includes(key))
        return layoutEffect.params.bloom > 0;
      if (key === 'glowColor')
        return layoutEffect.params.bloom > 0 && layoutEffect.params.bloomColorMix > 0;
    }
    if (layoutEffect.type === 'glyph') {
      if (key === 'fontSource')
        return !['emoji', 'braille', 'blocks'].includes(layoutEffect.params.style);
      if (key === 'threshold') return ['braille', 'blocks'].includes(layoutEffect.params.style);
      if (key === 'glyphSet') return layoutEffect.params.style === 'custom-set';
      if (key === 'text') return layoutEffect.params.style === 'custom-text';
      if (key === 'coloring') return layoutEffect.params.style !== 'emoji';
      if (key.startsWith('emoji'))
        return (
          layoutEffect.params.style === 'emoji' &&
          (key !== 'emojiSet' || layoutEffect.params.emojiPalette === 'custom')
        );
      if (key === 'foregroundColor')
        return (
          (layoutEffect.params.colorFalloff === 'on' &&
            layoutEffect.params.colorSource === 'chosen') ||
          (layoutEffect.params.style === 'emoji'
            ? ['monochrome', 'palette'].includes(layoutEffect.params.emojiColors ?? 'native')
            : layoutEffect.params.coloring === 'custom')
        );
      if (key === 'falloffColor')
        return (
          layoutEffect.params.colorFalloff === 'on' && layoutEffect.params.colorSource === 'chosen'
        );
      if (key.startsWith('size') && key !== 'sizeFalloff')
        return (
          layoutEffect.params.sizeFalloff === 'on' &&
          (!['sizeCenterX', 'sizeCenterY'].includes(key) ||
            ['radial', 'square'].includes(layoutEffect.params.sizeDirection ?? 'horizontal'))
        );
      if (['colorFalloffCenterX', 'colorFalloffCenterY'].includes(key))
        return (
          layoutEffect.params.colorFalloff === 'on' &&
          ['radial', 'square'].includes(layoutEffect.params.colorDirection ?? 'horizontal')
        );
      if (
        key.startsWith('color') &&
        key !== 'colorFalloff' &&
        key !== 'coloring' &&
        key !== 'color' &&
        ![
          'colorMode',
          'colorEnd',
          'colorStops',
          'colorAngle',
          'colorCenterX',
          'colorCenterY',
          'colorSpan',
        ].includes(key)
      )
        return (
          layoutEffect.params.colorFalloff === 'on' &&
          (!['colorFrom', 'colorTo'].includes(key) || layoutEffect.params.colorSource !== 'chosen')
        );
    }
    if (layoutEffect.type === 'indexed-palette') {
      if (['paletteStart', 'paletteEnd'].includes(key))
        return layoutEffect.params.palette === 'custom';
      if (key === 'driftSize') return layoutEffect.params.drift > 0;
    }
    if (layoutEffect.type === 'threshold') {
      if (key === 'levels') return layoutEffect.params.style === 'bitmap';
      if (key === 'localRadius') return layoutEffect.params.local === 'on';
      if (['edgeEmphasis', 'dirt', 'dirtSize'].includes(key))
        return layoutEffect.params.style === 'photocopy';
    }
    if (layoutEffect.type === 'dither') {
      if (['rampStart', 'rampEnd'].includes(key)) return layoutEffect.params.coloring === 'ramp';
      if (key === 'scan')
        return ['floyd-steinberg', 'atkinson', 'sierra', 'jarvis', 'corrupted'].includes(
          layoutEffect.params.algorithm,
        );
      if (
        [
          'skippedCells',
          'errorDisplacement',
          'randomDirection',
          'blockInterruptions',
          'blockSize',
          'channelDivergence',
        ].includes(key)
      )
        return (
          layoutEffect.params.algorithm === 'corrupted' &&
          (key !== 'channelDivergence' || layoutEffect.params.coloring === 'rgb')
        );
    }
    if ((DEPTH_FIELD_KEYS as readonly string[]).includes(key)) {
      if (!usesHeightField(layoutEffect)) return false;
      const source = heightFieldParams(layoutEffect.params).fieldSource;
      if (key === 'fieldSeed') return false;
      if (key === 'fieldShape') return source === 'shapes';
      if (['fieldDetail', 'fieldRoughness'].includes(key))
        return ['perlin', 'simplex', 'value', 'voronoi'].includes(source);
      if (['fieldScale', 'fieldX', 'fieldY'].includes(key)) return source !== 'brightness';
      if (key === 'fieldRotation') return !['brightness', 'radial'].includes(source);
    }
    if (layoutEffect.type === 'signal-tearing') {
      if (key === 'burstLength') return layoutEffect.params.style === 'bursts';
      if (key === 'fieldInfluence') return layoutEffect.params.fieldEnabled === 'on';
    }
    if (
      layoutEffect.type === 'recursive-space' &&
      ['fieldRepetition', 'fieldImageScale', 'fieldDistortion'].includes(key)
    )
      return layoutEffect.params.fieldEnabled === 'on';
    if (layoutEffect.type === 'depth-field') {
      const operation = layoutEffect.params.operation;
      if (['strength', 'direction'].includes(key))
        return ['displace', 'contours'].includes(operation);
      if (['contourCount', 'contourOffset'].includes(key))
        return ['contours', 'terraces'].includes(operation);
      if (['contourWidth', 'contourSoftness', 'fieldColor'].includes(key))
        return operation === 'contours';
      if (key === 'terraceBevel') return operation === 'terraces';
      if (['lightAngle', 'relief', 'lightElevation', 'ambient', 'highlights'].includes(key))
        return ['relief', 'terraces'].includes(operation);
    }
    if (layoutEffect.type === 'chroma-mosh') {
      if (key === 'density') return layoutEffect.params.style !== 'smear';
      if (['persistence', 'samples'].includes(key)) return layoutEffect.params.style === 'trails';
    }
    if (layoutEffect.type === 'feedback-bloom' && key === 'direction')
      return layoutEffect.params.style === 'melt';
    if (
      layoutEffect.type === 'compression-breakup' &&
      ['damageMode', 'damageStrength'].includes(key)
    )
      return layoutEffect.params.damageDensity > 0;
    if (layoutEffect.type === 'noise-grain') {
      const procedural = ['perlin', 'simplex', 'voronoi', 'value'].includes(
        layoutEffect.params.style,
      );
      if (['scale', 'detail', 'roughness', 'variant'].includes(key)) return procedural;
      if (key === 'size') return !procedural && layoutEffect.params.style !== 'scan';
      if (key === 'density') return ['speckle', 'salt-pepper'].includes(layoutEffect.params.style);
      if (key === 'balance') return layoutEffect.params.style === 'salt-pepper';
      if (key.startsWith('scan')) return layoutEffect.params.style === 'scan';
      if (['clumping', 'tonalResponse'].includes(key)) return layoutEffect.params.style === 'film';
      if (key === 'cellular') return layoutEffect.params.style === 'voronoi';
      if (key === 'noiseColor') return layoutEffect.params.coloring === 'ramp';
    }
    if (layoutEffect.type === 'blur') {
      const style = layoutEffect.params.style;
      if (key.startsWith('point')) return false;
      const controls: Record<string, string[]> = {
        radius: [
          'gaussian',
          'motion',
          'lens',
          'surface',
          'box',
          'grainy',
          'shape',
          'background',
          'tilt-shift',
          'smart',
          'depth',
        ],
        angle: ['motion', 'tilt-shift'],
        aspect: ['box', 'lens', 'shape'],
        centerX: ['radial', 'spin', 'zoom'],
        centerY: ['radial', 'spin', 'zoom'],
        travel: ['radial', 'spin', 'zoom'],
        radialBalance: ['radial'],
        sides: ['lens', ...(layoutEffect.params.shape === 'polygon' ? ['shape'] : [])],
        apertureRotation: [
          'lens',
          ...(!['circle', 'ring'].includes(layoutEffect.params.shape) ? ['shape'] : []),
        ],
        highlights: ['lens'],
        threshold: ['surface'],
        sensitivity: ['smart'],
        preservation: ['smart'],
        density: ['grainy'],
        shape: ['shape'],
        maskSoftness: ['background'],
        refinement: ['background'],
        position: ['tilt-shift'],
        width: ['tilt-shift'],
        falloff: ['tilt-shift'],
        nearBlur: ['depth'],
        farBlur: ['depth'],
        focusPosition: ['depth'],
        focusRange: ['depth'],
        focusFalloff: ['depth'],
      };
      if (controls[key]) return controls[key].includes(style);
    }
    return true;
  };
  const shapeTiles =
    layoutEffect.type === 'shapes' ? { ...SHAPE_TILE_DEFAULTS, ...layoutEffect.params } : null;
  const showTonalControl = (key: string) => {
    if (layoutEffect.type !== 'levels-curves') return true;
    if (['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite'].includes(key))
      return layoutEffect.params.mode === 'levels';
    if (key.startsWith('curve') || key === 'interpolation')
      return layoutEffect.params.mode === 'curves';
    return true;
  };
  const tiled = shapeTiles?.layout === 'tiled';
  const shapeRotates = shapeTiles && !['circle', 'ring'].includes(shapeTiles.shape);
  const polygon = shapeTiles?.shape === 'polygon';
  const progresses =
    tiled &&
    ((shapeRotates && ['linear', 'graduated'].includes(shapeTiles.rotationStyle)) ||
      (polygon && ['linear', 'graduated'].includes(shapeTiles.polygonStyle)));
  const showShapeControl = (key: string) => {
    if (!shapeTiles || !Object.hasOwn(SHAPE_TILE_DEFAULTS, key) || key === 'layout') return true;
    if (key === 'startSides') return polygon;
    if (!tiled) return false;
    if (['endSides', 'polygonStyle'].includes(key)) return polygon;
    if (['rotationStyle', 'endRotation'].includes(key)) return shapeRotates;
    if (key.startsWith('progression')) return progresses;
    if (key === 'radialRepeats') return shapeTiles.tilePattern === 'radial';
    return true;
  };
  const errorAngle = effect.type === 'scanlines' ? (effect.params.rotation * Math.PI) / 180 : 0;
  const errorNormalX =
    effect.type === 'scanlines' && effect.params.style === 'grille'
      ? Math.cos(errorAngle)
      : -Math.sin(errorAngle);
  const errorNormalY =
    effect.type === 'scanlines' && effect.params.style === 'grille'
      ? Math.sin(errorAngle)
      : Math.cos(errorAngle);
  const seeded = supportsSeedVariation(layoutEffect);
  const visibleParameters = Object.entries(definition.parameters).filter(
    ([key, control]) =>
      !control.colorSource &&
      (effect.type !== 'spatial-crush' ||
        ((key !== 'jitter' || effect.params.sampling === 'dirty-nearest') &&
          (!['corruption', 'edgeHandling'].includes(key) ||
            effect.params.sampling === 'corrupted'))) &&
      (effect.type !== 'bit-crush' ||
        ((key !== 'bits' || effect.params.linkRGB !== 'off') &&
          (!['redBits', 'greenBits', 'blueBits'].includes(key) ||
            effect.params.linkRGB === 'off'))) &&
      (effect.type !== 'solid' ||
        ((key !== 'fillColor' || ['color', 'gradient'].includes(effect.params.content)) &&
          (key !== 'placement' || ['source', 'image'].includes(effect.params.content)))) &&
      (effect.type !== 'mandelbrot' || !['centerReal', 'centerImaginary'].includes(key)) &&
      showShapeControl(key) &&
      showTonalControl(key) &&
      showFinishingControl(key),
  );
  const groups = [
    {
      title: 'Blending',
      entries: visibleParameters.filter(([key]) =>
        ['amount', 'opacity', 'blendMode'].includes(key),
      ),
    },
    {
      title: 'Tint',
      entries: visibleParameters.filter(
        ([key, control]) => key.startsWith('tint') || control.label.startsWith('Tint'),
      ),
    },
    {
      title: effect.type === 'motion-mosh' ? 'Blocks & motion' : 'Effect settings',
      entries: visibleParameters.filter(
        ([key, control]) =>
          !['amount', 'opacity', 'blendMode'].includes(key) &&
          !key.startsWith('tint') &&
          !control.label.startsWith('Tint'),
      ),
    },
  ].filter((group) => group.entries.length > 0);
  return (
    <section
      className="effect-detail"
      aria-label={`${definition.title} controls`}
      data-effect-id={effect.instanceId}
      onPointerDown={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'range')
          setSliderLayout(effect);
      }}
      onPointerUp={() => setSliderLayout(null)}
      onPointerCancel={() => setSliderLayout(null)}
      onBlur={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'range')
          setSliderLayout(null);
      }}
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLInputElement &&
          event.target.type === 'range' &&
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
          setSliderLayout((previous) => previous ?? effect);
      }}
      onKeyUp={() => setSliderLayout(null)}
    >
      <div className="selected-effect-heading">
        <div>
          <div className="panel-heading">{definition.title}</div>
          <small>
            Effect{' '}
            {effects.length - effects.findIndex((entry) => entry.instanceId === effect.instanceId)}{' '}
            of {effects.length}
          </small>
        </div>
        <button
          aria-label="Reset controls"
          disabled={disabled}
          onClick={() => {
            endGesture();
            onReset();
          }}
        >
          Reset
        </button>
      </div>
      {effect.type === 'shader-import' && <ShaderCredits shader={effect.shader} />}
      {supportsLayerImage(effect) &&
        (effect.type !== 'motion-transfer' ||
          directionFieldParams(effect.params).directionSource === 'native') &&
        (effect.type !== 'solid' || effect.params.content === 'image') && (
          <div className="solid-image-control">
            <InspectorSection
              sectionId="input-image"
              title="Input image"
              headingClassName="input-image-heading"
              help={
                <InfoTooltip
                  label="Input image"
                  text="Images are embedded in projects and presets. Saved stages are copied as frozen rendered images; later edits do not change this input."
                />
              }
            >
              {effect.image && <img src={effect.image.png} alt="Effect input image" />}
              <button type="button" disabled={disabled} onClick={onChooseLayerImage}>
                {effect.type === 'motion-transfer'
                  ? effect.image
                    ? 'Change vector map…'
                    : 'Choose vector map…'
                  : effect.image
                    ? 'Change image…'
                    : 'Choose image…'}
              </button>
              {effect.type === 'motion-transfer' && (
                <>
                  <button type="button" disabled={disabled} onClick={() => setVectorPicker(true)}>
                    Starter vector maps…
                  </button>
                  {vectorPicker && (
                    <StarterMapPicker
                      kind="vector"
                      onChoose={(id) => {
                        setVectorPicker(false);
                        onChooseVectorMap(id);
                      }}
                      onClose={() => setVectorPicker(false)}
                    />
                  )}
                </>
              )}
              <div className="effect-control">
                {effect.type === 'reference-mosh' && (
                  <select
                    aria-label="Reference saved stage"
                    disabled={disabled || snapshots.length === 0}
                    value=""
                    onChange={(event) => {
                      if (event.target.value) onChooseSnapshotImage(event.target.value);
                    }}
                  >
                    <option value="">Copy a saved stage…</option>
                    {snapshots.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="quiet">
                {effect.image
                  ? `${effect.image.source.name} · ${effect.image.source.width} × ${effect.image.source.height}`
                  : effect.type === 'motion-transfer'
                    ? 'Choose a vector or grayscale displacement map. Red / Green uses 128 as neutral; transparency contributes no displacement.'
                    : effect.type === 'window-fragments' || effect.type === 'micro-collage'
                      ? 'Uses the current image. Choose an optional reference to sample different content.'
                      : 'Choose an image or copy a saved stage to activate this effect.'}
              </p>
              {effect.type === 'reference-mosh' &&
                ['placement', 'referenceX', 'referenceY'].map((key) => {
                  const control = definition.parameters[key]!;
                  return (
                    <div
                      className="effect-control"
                      key={key}
                      data-settings-kind="parameter"
                      data-settings-key={key}
                    >
                      <span
                        className={
                          control.kind === 'number' ? 'numeric-control-heading' : undefined
                        }
                      >
                        <span className="control-title">
                          {control.label}{' '}
                          <InfoTooltip label={control.label} text={control.description} />
                        </span>
                        {control.kind === 'number' && (
                          <output>{Number(params[key] ?? control.default).toFixed(1)}%</output>
                        )}
                      </span>
                      {control.kind === 'choice' ? (
                        <select
                          aria-label={control.label}
                          disabled={disabled}
                          value={String(params[key] ?? control.default)}
                          onChange={(e) => {
                            endGesture();
                            onChange({ [key]: e.target.value });
                          }}
                        >
                          {control.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : control.kind === 'number' ? (
                        <input
                          type="range"
                          aria-label={control.label}
                          disabled={disabled}
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          value={Number(params[key] ?? control.default)}
                          onChange={(e) => onChange({ [key]: e.target.valueAsNumber })}
                        />
                      ) : null}
                    </div>
                  );
                })}
            </InspectorSection>
          </div>
        )}
      {usesHeightField(effect) && (
        <DepthFieldControls
          effect={effect}
          effects={effects}
          image={image}
          disabled={disabled}
          onChange={onChange}
          endGesture={endGesture}
          onFieldChange={onFieldChange}
        />
      )}
      {effect.type === 'blur' && effect.params.style === 'field' && (
        <BlurFieldEditor
          key={effect.instanceId}
          effect={effect}
          disabled={disabled}
          imageSize={imageSize}
          onChange={onChange}
          beginGesture={beginGesture}
          endGesture={endGesture}
        />
      )}
      {effect.type === 'levels-curves' && effect.params.mode === 'curves' && (
        <ToneCurveEditor
          effect={effect}
          disabled={disabled}
          onChange={onChange}
          beginGesture={beginGesture}
          endGesture={endGesture}
        />
      )}
      {effect.type === 'glyph' && effect.params.style === 'emoji' && (
        <EmojiAtlas
          disabled={disabled}
          onAdd={(character) => {
            endGesture();
            const current = effect.params.emojiSet ?? GLYPH_DEFAULTS.emojiSet;
            onChange({ emojiPalette: 'custom', emojiSet: (current + character).slice(0, 128) });
          }}
        />
      )}
      {effect.type === 'gradient-map' && (
        <GradientStopEditor
          key={effect.instanceId}
          colorKey="shadows"
          label="Gradient Map tonal ramp"
          start={effect.params.shadows}
          end={effect.params.highlights}
          params={params}
          disabled={disabled}
          onChange={onChange}
          beginGesture={beginGesture}
          endGesture={endGesture}
        />
      )}
      {((effect.type === 'indexed-palette' && effect.params.palette === 'custom') ||
        (effect.type === 'dither' && effect.params.coloring === 'ramp')) && (
        <GradientStopEditor
          key={effect.instanceId}
          colorKey={effect.type === 'indexed-palette' ? 'paletteStart' : 'rampStart'}
          label={effect.type === 'indexed-palette' ? 'Custom palette ramp' : 'Dither color ramp'}
          start={
            effect.type === 'indexed-palette' ? effect.params.paletteStart : effect.params.rampStart
          }
          end={effect.type === 'indexed-palette' ? effect.params.paletteEnd : effect.params.rampEnd}
          params={params}
          disabled={disabled}
          onChange={onChange}
          beginGesture={beginGesture}
          endGesture={endGesture}
        />
      )}
      {(effect.type === 'mandelbrot' || effect.type === 'shader-mandelbrot-slices') && (
        <button
          disabled={disabled}
          className="explore-fractal"
          onClick={() => {
            endGesture();
            setExploring(true);
          }}
        >
          Explore fractal…
        </button>
      )}
      {(effect.type === 'mandelbrot' || effect.type === 'shader-mandelbrot-slices') &&
        exploring && (
          <FractalExplorer
            key={effect.instanceId}
            effect={effect}
            imageSize={imageSize}
            masterSeed={masterSeed}
            onChange={onChange}
            beginGesture={beginGesture}
            endGesture={endGesture}
            onClose={() => setExploring(false)}
          />
        )}
      <ApplicationControls
        effect={effect}
        effects={effects}
        image={image}
        disabled={disabled}
        onChange={onApplication}
        beginGesture={beginGesture}
        endGesture={endGesture}
      />
      {groups.map((group) => (
        <InspectorSection
          key={group.title}
          title={group.title}
          sectionId={
            group.title === 'Blending'
              ? 'blending'
              : group.title === 'Tint'
                ? 'tint'
                : `effect:${effect.type}:settings`
          }
        >
          <div className="control-card">
            {group.entries.map(([key, control]) =>
              control.kind === 'stops' ? null : (
                <Fragment
                  key={
                    effect.type === 'channel-transform' && key === `${editingChannel}X`
                      ? 'editing-channel-controls'
                      : key
                  }
                >
                  {key === 'directionSource' && supportsDirectionField(effect) && (
                    <DirectionFieldControls
                      effect={effect}
                      effects={effects}
                      image={image}
                      disabled={disabled}
                      onFieldChange={onDirectionChange}
                      onChange={(params) => {
                        endGesture();
                        onChange(params);
                      }}
                    />
                  )}
                  {effect.type === 'channel-transform' && key === `${editingChannel}X` && (
                    <label className="effect-control">
                      <span className="control-title">
                        Editing channel{' '}
                        <InfoTooltip
                          label="Editing channel"
                          text="Choose which channel's saved controls to edit. Switching this selector leaves the image and other channels unchanged."
                        />
                      </span>
                      <select
                        aria-label="Editing channel"
                        disabled={disabled}
                        value={editingChannel}
                        onChange={(event) => {
                          endGesture();
                          setEditingChannel(event.target.value as Channel);
                        }}
                      >
                        {CHANNELS.map((c) => (
                          <option key={c} value={c}>
                            {c[0]!.toUpperCase() + c.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div
                    className={`effect-control control-${control.kind}`}
                    key={key}
                    data-settings-kind="parameter"
                    data-settings-key={key}
                  >
                    {key === 'outputAlignment' && (
                      <div className="output-placement-heading panel-heading">Output placement</div>
                    )}
                    <span
                      className={control.kind === 'number' ? 'numeric-control-heading' : undefined}
                    >
                      <span className="control-title">
                        {control.label}{' '}
                        <InfoTooltip label={control.label} text={control.description} />
                      </span>
                      {control.kind === 'number' && (
                        <output>
                          {control.unit === 'percent'
                            ? `${Math.round(Number(params[key] ?? control.default) * 100)}%`
                            : control.unit === 'bits'
                              ? `${Number(params[key] ?? control.default)} ${Number(params[key] ?? control.default) === 1 ? 'bit' : 'bits'}`
                              : control.unit === 'count'
                                ? String(Number(params[key] ?? control.default))
                                : control.unit === 'multiplier'
                                  ? `${Number(params[key] ?? control.default).toFixed(2)}×`
                                  : control.unit === 'degrees'
                                    ? `${Number(Number(params[key] ?? control.default).toFixed(2))}°`
                                    : control.unit === 'cycles'
                                      ? `${Number(params[key] ?? control.default)} ${Number(params[key] ?? control.default) === 1 ? 'cycle' : 'cycles'}`
                                      : control.unit === 'coordinate'
                                        ? Number(params[key] ?? control.default).toFixed(
                                            effect.type === 'shader-mandelbrot-slices' ? 5 : 3,
                                          )
                                        : `${Number(params[key] ?? control.default).toFixed(1)}%`}
                        </output>
                      )}
                    </span>
                    {key === 'bitMask' && effect.type === 'bit-damage' ? (
                      <div
                        className="bit-plane-picker"
                        role="group"
                        aria-label="Selected bit planes"
                      >
                        {Array.from({ length: 8 }, (_, index) => 7 - index).map((bit) => (
                          <label key={bit}>
                            <input
                              type="checkbox"
                              aria-label={`Bit ${bit}`}
                              disabled={disabled}
                              checked={Boolean((effect.params.bitMask ?? 255) & (1 << bit))}
                              onChange={() => {
                                endGesture();
                                onChange({ bitMask: (effect.params.bitMask ?? 255) ^ (1 << bit) });
                              }}
                            />
                            {bit}
                          </label>
                        ))}
                      </div>
                    ) : key === 'tintEnabled' || key === 'linkRGB' ? (
                      <label className="tint-toggle">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={key === 'linkRGB' ? 'Link RGB depths' : 'Tint'}
                          disabled={disabled}
                          checked={
                            key === 'linkRGB'
                              ? effect.type === 'bit-crush' && effect.params.linkRGB !== 'off'
                              : isTintEnabled(effect.params)
                          }
                          onChange={(event) => {
                            endGesture();
                            onChange({ [key]: event.target.checked ? 'on' : 'off' });
                          }}
                        />
                        <span>
                          {(
                            key === 'linkRGB'
                              ? effect.type === 'bit-crush' && effect.params.linkRGB !== 'off'
                              : isTintEnabled(effect.params)
                          )
                            ? 'On'
                            : 'Off'}
                        </span>
                      </label>
                    ) : control.kind === 'choice' ? (
                      <select
                        aria-label={control.label}
                        value={String(params[key] ?? control.default)}
                        disabled={
                          disabled ||
                          (key === 'edgeHandling' &&
                            (effect.type === 'shapes' || effect.type === 'mandelbrot') &&
                            !['distort', 'weave'].includes(effect.params.operation)) ||
                          (effect.type === 'mandelbrot' &&
                            key === 'weaveMirror' &&
                            effect.params.operation !== 'weave') ||
                          (effect.type === 'scanlines' &&
                            key === 'field' &&
                            effect.params.style !== 'interlaced') ||
                          (effect.type === 'scanlines' &&
                            key === 'edgeHandling' &&
                            (!['jitter', 'sync-loss', 'tear'].includes(
                              effect.params.signalError ?? 'none',
                            ) ||
                              (effect.params.errorStrength ?? 0.35) === 0))
                        }
                        onChange={(event) => {
                          endGesture();
                          onChange({
                            [key]: event.target.value,
                            ...(effect.type === 'mandelbrot' && key === 'formula'
                              ? {
                                  centerReal: event.target.value === 'julia' ? 0 : -0.5,
                                  centerImaginary: 0,
                                  zoom: 1,
                                }
                              : {}),
                          });
                        }}
                      >
                        {control.options
                          .filter(
                            (option) =>
                              effect.type !== 'solid' ||
                              key !== 'content' ||
                              option.value !== 'drawing' ||
                              params[key] === 'drawing',
                          )
                          .map((option) => (
                            <option
                              key={option.value}
                              value={option.value}
                              disabled={
                                effect.type === 'solid' &&
                                key === 'content' &&
                                option.value === 'drawing'
                              }
                            >
                              {option.label}
                            </option>
                          ))}
                      </select>
                    ) : control.kind === 'text' ? (
                      <input
                        type="text"
                        aria-label={control.label}
                        value={String(params[key] ?? control.default)}
                        maxLength={control.maxLength}
                        disabled={disabled}
                        onFocus={beginGesture}
                        onChange={(event) => onChange({ [key]: event.target.value })}
                        onBlur={endGesture}
                      />
                    ) : control.kind === 'color' ? (
                      control.gradient ? (
                        <GradientColorControl
                          key={`${effect.instanceId}:${key}`}
                          colorKey={key}
                          label={control.label}
                          value={String(params[key] ?? control.default)}
                          gradient={control.gradient}
                          params={
                            effect.type === 'solid'
                              ? {
                                  ...params,
                                  fillColorMode:
                                    effect.params.content === 'gradient' ? 'gradient' : 'solid',
                                }
                              : params
                          }
                          hideMode={effect.type === 'solid'}
                          parameters={definition.parameters}
                          disabled={
                            disabled ||
                            (effect.type === 'shapes' &&
                              key === 'shapeColor' &&
                              effect.params.operation !== 'overlay') ||
                            (effect.type === 'mandelbrot' &&
                              key === 'outsideColor' &&
                              effect.params.operation !== 'texture')
                          }
                          beginGesture={beginGesture}
                          endGesture={endGesture}
                          onChange={onChange}
                        />
                      ) : (
                        <ColorControl
                          key={`${effect.instanceId}:${key}`}
                          label={control.label}
                          value={String(params[key] ?? control.default)}
                          disabled={
                            disabled ||
                            (effect.type === 'shapes' &&
                              key === 'shapeColor' &&
                              effect.params.operation !== 'overlay') ||
                            (effect.type === 'mandelbrot' &&
                              ['outsideColor', 'insideColor'].includes(key) &&
                              effect.params.operation !== 'texture')
                          }
                          beginGesture={beginGesture}
                          endGesture={endGesture}
                          onChange={(color) => onChange({ [key]: color })}
                        />
                      )
                    ) : (
                      <input
                        type="range"
                        aria-label={control.label}
                        min={
                          effect.type === 'mandelbrot' && key === 'zoom'
                            ? Math.log2(control.min)
                            : (effect.type === 'levels-curves' || effect.type === 'threshold') &&
                                key === 'inputWhite'
                              ? Math.max(control.min, effect.params.inputBlack + 0.01)
                              : control.min
                        }
                        max={
                          effect.type === 'mandelbrot' && key === 'zoom'
                            ? Math.log2(control.max)
                            : (effect.type === 'levels-curves' || effect.type === 'threshold') &&
                                key === 'inputBlack'
                              ? Math.min(control.max, effect.params.inputWhite - 0.01)
                              : control.max
                        }
                        step={effect.type === 'mandelbrot' && key === 'zoom' ? 0.01 : control.step}
                        value={
                          effect.type === 'mandelbrot' && key === 'zoom'
                            ? Math.log2(Number(params[key] ?? control.default))
                            : Number(params[key] ?? control.default)
                        }
                        disabled={
                          disabled ||
                          (((effect.type === 'indexed-palette' &&
                            effect.params.dither === 'none') ||
                            (effect.type === 'dither' && effect.params.algorithm === 'none')) &&
                            key === 'ditherStrength') ||
                          (key === 'tintStrength' && !isTintEnabled(effect.params)) ||
                          (effect.type === 'recursive-space' &&
                            ['twist', 'symmetry'].includes(key) &&
                            effect.params.style === 'tunnel') ||
                          (effect.type === 'shapes' &&
                            ((key === 'ringThickness' && effect.params.shape !== 'ring') ||
                              (key === 'endRotation' && shapeTiles?.rotationStyle === 'uniform') ||
                              (key === 'endSides' && shapeTiles?.polygonStyle === 'uniform') ||
                              (key === 'progressionX' &&
                                ['top-bottom', 'bottom-top'].includes(
                                  shapeTiles?.progressionField ?? '',
                                )) ||
                              (key === 'progressionY' &&
                                ['left-right', 'right-left'].includes(
                                  shapeTiles?.progressionField ?? '',
                                )) ||
                              (['distortionScale', 'twist'].includes(key) &&
                                effect.params.operation !== 'distort') ||
                              (key === 'rotation' &&
                                ['circle', 'ring'].includes(effect.params.shape)))) ||
                          (effect.type === 'mandelbrot' &&
                            ((['paletteCycles', 'paletteOffset'].includes(key) &&
                              effect.params.operation !== 'texture') ||
                              (['weaveScale', 'weaveRotation', 'abstraction'].includes(key) &&
                                effect.params.operation !== 'weave') ||
                              (['juliaReal', 'juliaImaginary'].includes(key) &&
                                effect.params.formula !== 'julia') ||
                              (key === 'distortion' && effect.params.operation !== 'distort'))) ||
                          (effect.type === 'bit-crush' &&
                            key === 'ditherAmount' &&
                            effect.params.dither === 'none') ||
                          (effect.type === 'scanlines' &&
                            ((key === 'glowSize' && (effect.params.glow ?? 0) === 0) ||
                              (['errorStrength', 'errorPositionX', 'errorPositionY'].includes(
                                key,
                              ) &&
                                (effect.params.signalError ?? 'none') === 'none') ||
                              (key === 'errorPositionX' &&
                                ((effect.params.errorStrength ?? 0.35) === 0 ||
                                  Math.abs(errorNormalX) < 1e-12)) ||
                              (key === 'errorPositionY' &&
                                ((effect.params.errorStrength ?? 0.35) === 0 ||
                                  Math.abs(errorNormalY) < 1e-12)))) ||
                          (effect.type === 'mirroring' &&
                            ((key === 'positionX' && effect.params.axis === 'horizontal') ||
                              (key === 'positionY' && effect.params.axis === 'vertical') ||
                              (key === 'rotation' && effect.params.axis !== 'angled')))
                        }
                        onPointerDown={(event) => {
                          // Finish the previous control's blur before starting this drag.
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
                        onChange={(event) =>
                          onChange({
                            [key]:
                              effect.type === 'mandelbrot' && key === 'zoom'
                                ? 2 ** event.target.valueAsNumber
                                : event.target.valueAsNumber,
                          })
                        }
                      />
                    )}
                  </div>
                  {key === 'fontSource' &&
                    effect.type === 'glyph' &&
                    effect.params.fontSource === 'installed' && (
                      <GlyphFontControls
                        key={effect.instanceId}
                        effect={effect}
                        disabled={disabled}
                        onApply={onGlyphFont}
                      />
                    )}
                </Fragment>
              ),
            )}
          </div>
        </InspectorSection>
      ))}
      {effect.type === 'cutout' && (
        <PreviewBackdropControls value={backdrop} onChange={onBackdrop} disabled={disabled} />
      )}
      <div className="effect-detail-actions">
        {seeded && (
          <button
            disabled={disabled}
            onClick={onVary}
            title={`Try a new seeded pattern for this effect. Current pattern: ${effect.seedOffset}. Undo restores the previous pattern.`}
          >
            New pattern
          </button>
        )}
      </div>
    </section>
  );
}
