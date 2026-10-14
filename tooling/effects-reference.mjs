import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function moduleUrl(path) {
  const source = await readFile(resolve(root, path), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(result.outputText).toString('base64')}`;
}
const directionModelUrl = await moduleUrl('packages/project-model/src/direction-field.ts');
const advancedModelUrl = await moduleUrl('packages/project-model/src/advanced-shaders.ts');
const extensionCode = Buffer.from(
  (await moduleUrl('packages/project-model/src/set2-extensions.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./advanced-shaders'", `'${advancedModelUrl}'`);
const extensionUrl = 'data:text/javascript;base64,' + Buffer.from(extensionCode).toString('base64');
const glyphControlsUrl = await moduleUrl('packages/project-model/src/glyph-controls.ts');
const glyphFontUrl = await moduleUrl('packages/project-model/src/glyph-font.ts');
const shaderPackageUrl = await moduleUrl('packages/project-model/src/shader-package.ts');
const modelCode = Buffer.from(
  (await moduleUrl('packages/project-model/src/index.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./advanced-shaders'", `'${advancedModelUrl}'`)
  .replaceAll("'./set2-extensions'", `'${extensionUrl}'`)
  .replaceAll("'./direction-field'", `'${directionModelUrl}'`)
  .replaceAll("'./shader-package'", `'${shaderPackageUrl}'`)
  .replaceAll("'./glyph-controls'", `'${glyphControlsUrl}'`)
  .replaceAll("'./glyph-font'", `'${glyphFontUrl}'`);
export const modelUrl = `data:text/javascript;base64,${Buffer.from(modelCode).toString('base64')}`;
const directionCode = Buffer.from(
  (await moduleUrl('packages/effects/src/direction-field.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const directionUrl = `data:text/javascript;base64,${Buffer.from(directionCode).toString('base64')}`;
async function directionModule(path) {
  const code = Buffer.from((await moduleUrl(path)).split(',')[1], 'base64')
    .toString()
    .replaceAll('@gleech/project-model', modelUrl)
    .replaceAll("'./direction-field'", `'${directionUrl}'`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const fractalUrl = await moduleUrl('packages/effects/src/fractal.ts');
const fractalCode = Buffer.from(fractalUrl.split(',')[1], 'base64')
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const resolvedFractalUrl = `data:text/javascript;base64,${Buffer.from(fractalCode).toString('base64')}`;
const tilesUrl = await moduleUrl('packages/effects/src/shape-tiles.ts');
const tilesCode = Buffer.from(tilesUrl.split(',')[1], 'base64')
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const resolvedTilesUrl = `data:text/javascript;base64,${Buffer.from(tilesCode).toString('base64')}`;
const feedbackUrl = await moduleUrl('packages/effects/src/feedback.ts');
const pixelSortUrl = await directionModule('packages/effects/src/pixel-sort.ts');
const signalTearingUrl = await directionModule('packages/effects/src/signal-tearing.ts');
const blueNoiseUrl = await moduleUrl('packages/effects/src/blue-noise.ts');
const ditherCode = Buffer.from(
  (await moduleUrl('packages/effects/src/dither.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./blue-noise'", `'${blueNoiseUrl}'`);
const ditherUrl = `data:text/javascript;base64,${Buffer.from(ditherCode).toString('base64')}`;
const indexedCode = Buffer.from(
  (await moduleUrl('packages/effects/src/indexed-palette.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const indexedUrl = `data:text/javascript;base64,${Buffer.from(indexedCode).toString('base64')}`;
const chromaUrl = await moduleUrl('packages/effects/src/chroma-mosh.ts');
const compressionUrl = await moduleUrl('packages/effects/src/compression.ts');
const importedShadersCode = Buffer.from(
  (await moduleUrl('packages/effects/src/imported-shaders.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'@gleech/project-model'", `'${modelUrl}'`)
  .replaceAll("'@gleech/project-model/shader-package'", `'${shaderPackageUrl}'`);
const importedShadersUrl = `data:text/javascript;base64,${Buffer.from(importedShadersCode).toString('base64')}`;
const betaShadersCode = Buffer.from(
  (await moduleUrl('packages/effects/src/beta-shaders.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const betaShadersUrl =
  'data:text/javascript;base64,' + Buffer.from(betaShadersCode).toString('base64');
const referenceShadersCode = Buffer.from(
  (await moduleUrl('packages/effects/src/reference-shaders.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const referenceShadersUrl =
  'data:text/javascript;base64,' + Buffer.from(referenceShadersCode).toString('base64');
const set2ShadersCode = Buffer.from(
  (await moduleUrl('packages/effects/src/set2-shaders.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const set2ShadersUrl =
  'data:text/javascript;base64,' + Buffer.from(set2ShadersCode).toString('base64');
const advancedCpuUrl = await moduleUrl('packages/effects/src/set2-advanced-cpu.ts');
const advancedShaderCode = Buffer.from(
  (await moduleUrl('packages/effects/src/set2-advanced-shaders.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl)
  .replaceAll("'./set2-advanced-cpu'", `'${advancedCpuUrl}'`);
const advancedShaderUrl =
  'data:text/javascript;base64,' + Buffer.from(advancedShaderCode).toString('base64');
const builtinShadersCode = Buffer.from(
  (await moduleUrl('packages/effects/src/builtin-shaders.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl)
  .replaceAll("'./set2-shaders'", `'${set2ShadersUrl}'`)
  .replaceAll("'./set2-advanced-shaders'", `'${advancedShaderUrl}'`)
  .replaceAll("'./beta-shaders'", `'${betaShadersUrl}'`)
  .replaceAll("'./reference-shaders'", `'${referenceShadersUrl}'`);
const builtinShadersUrl =
  'data:text/javascript;base64,' + Buffer.from(builtinShadersCode).toString('base64');
const effectUrl = await moduleUrl('packages/effects/src/index.ts');
const gradientUrl = await moduleUrl('packages/effects/src/color-gradient.ts');
const gradientCode = Buffer.from(gradientUrl.split(',')[1], 'base64')
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const resolvedGradientUrl = `data:text/javascript;base64,${Buffer.from(gradientCode).toString('base64')}`;
const set2FiltersCode = Buffer.from(
  (await moduleUrl('packages/effects/src/set2-filters.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl)
  .replaceAll("'./direction-field'", `'${directionUrl}'`)
  .replaceAll("'./color-gradient'", `'${resolvedGradientUrl}'`);
const set2FiltersUrl =
  'data:text/javascript;base64,' + Buffer.from(set2FiltersCode).toString('base64');
const channelEchoCode = Buffer.from(
  (await moduleUrl('packages/effects/src/channel-echo.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./color-gradient'", `'${resolvedGradientUrl}'`);
const channelEchoUrl = `data:text/javascript;base64,${Buffer.from(channelEchoCode).toString('base64')}`;
const thresholdCode = Buffer.from(
  (await moduleUrl('packages/effects/src/threshold.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./color-gradient'", `'${resolvedGradientUrl}'`);
const thresholdUrl = `data:text/javascript;base64,${Buffer.from(thresholdCode).toString('base64')}`;
const glyphAlphabetUrl = await moduleUrl('packages/effects/src/glyph-alphabet.ts');
const glyphAtlasUrl = await moduleUrl('packages/effects/src/glyph-atlas.ts');
const fontCoverageCode = Buffer.from(
  (await moduleUrl('packages/effects/src/font-coverage.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const fontCoverageUrl = `data:text/javascript;base64,${Buffer.from(fontCoverageCode).toString('base64')}`;
const glyphCode = Buffer.from(
  (await moduleUrl('packages/effects/src/glyph.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl)
  .replaceAll("'./glyph-alphabet'", `'${glyphAlphabetUrl}'`)
  .replaceAll("'./font-coverage'", `'${fontCoverageUrl}'`)
  .replaceAll("'./glyph-atlas'", `'${glyphAtlasUrl}'`)
  .replaceAll("'./color-gradient'", `'${resolvedGradientUrl}'`);
const glyphUrl = `data:text/javascript;base64,${Buffer.from(glyphCode).toString('base64')}`;
const tonalUrl = await moduleUrl('packages/effects/src/tonal.ts');
const tonalCode = Buffer.from(tonalUrl.split(',')[1], 'base64')
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const resolvedTonalUrl = `data:text/javascript;base64,${Buffer.from(tonalCode).toString('base64')}`;
const glowUrl = await moduleUrl('packages/effects/src/glow.ts');
const softFieldUrl = await moduleUrl('packages/effects/src/soft-field.ts');
const bitDropoutCode = Buffer.from(
  (await moduleUrl('packages/effects/src/bit-dropout.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'@gleech/project-model'", `'${modelUrl}'`)
  .replaceAll("'./color-gradient'", `'${resolvedGradientUrl}'`);
const bitDropoutUrl = `data:text/javascript;base64,${Buffer.from(bitDropoutCode).toString('base64')}`;
const photoFinishingCode = Buffer.from(
  (await moduleUrl('packages/effects/src/photo-finishing.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./color-gradient'", `'${resolvedGradientUrl}'`)
  .replaceAll("'./soft-field'", `'${softFieldUrl}'`);
const photoFinishingUrl = `data:text/javascript;base64,${Buffer.from(photoFinishingCode).toString('base64')}`;
const crtCode = Buffer.from(
  (await moduleUrl('packages/effects/src/crt.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./glow'", `'${glowUrl}'`)
  .replaceAll("'./color-gradient'", `'${resolvedGradientUrl}'`);
const crtUrl = `data:text/javascript;base64,${Buffer.from(crtCode).toString('base64')}`;
const noiseUrl = await moduleUrl('packages/effects/src/noise.ts');
const blurUrl = await moduleUrl('packages/effects/src/blur.ts');
const paintedMaskCode = Buffer.from(
  (await moduleUrl('packages/effects/src/painted-mask.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const paintedMaskUrl =
  'data:text/javascript;base64,' + Buffer.from(paintedMaskCode).toString('base64');
const maskCacheCode = Buffer.from(
  (await moduleUrl('packages/effects/src/painted-mask-cache.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./painted-mask'", `'${paintedMaskUrl}'`);
const maskCacheUrl = 'data:text/javascript;base64,' + Buffer.from(maskCacheCode).toString('base64');
const stackCacheCode = Buffer.from(
  (await moduleUrl('packages/effects/src/preview-stack-cache.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl);
const stackCacheUrl =
  'data:text/javascript;base64,' + Buffer.from(stackCacheCode).toString('base64');
const depthUrl = await moduleUrl('packages/effects/src/depth-field.ts');
const depthCode = Buffer.from(depthUrl.split(',')[1], 'base64')
  .toString()
  .replaceAll('@gleech/project-model', modelUrl)
  .replaceAll("'./noise'", `'${noiseUrl}'`)
  .replaceAll("'./shape-tiles'", `'${resolvedTilesUrl}'`);
const resolvedDepthUrl = `data:text/javascript;base64,${Buffer.from(depthCode).toString('base64')}`;
const referenceFiltersCode = Buffer.from(
  (await moduleUrl('packages/effects/src/reference-filters.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll('@gleech/project-model', modelUrl)
  .replaceAll("'./depth-field'", `'${resolvedDepthUrl}'`)
  .replaceAll("'./glyph-alphabet'", `'${glyphAlphabetUrl}'`);
const referenceFiltersUrl =
  'data:text/javascript;base64,' + Buffer.from(referenceFiltersCode).toString('base64');
const applicationAnalysisCode = Buffer.from(
  (await moduleUrl('packages/effects/src/application-analysis.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'@gleech/project-model'", `'${modelUrl}'`)
  .replaceAll("'./depth-field'", `'${resolvedDepthUrl}'`);
const applicationAnalysisUrl = `data:text/javascript;base64,${Buffer.from(applicationAnalysisCode).toString('base64')}`;
const cutoutRefinementCode = Buffer.from(
  (await moduleUrl('packages/effects/src/cutout-refinement.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'@gleech/project-model'", `'${modelUrl}'`);
const cutoutRefinementUrl = `data:text/javascript;base64,${Buffer.from(cutoutRefinementCode).toString('base64')}`;
const spatialMoshUrl = await directionModule('packages/effects/src/spatial-mosh.ts');
const depthFinishingCode = Buffer.from(
  (await moduleUrl('packages/effects/src/depth-finishing.ts')).split(',')[1],
  'base64',
)
  .toString()
  .replaceAll("'./cutout-refinement'", `'${cutoutRefinementUrl}'`)
  .replaceAll("'./depth-field'", "'" + resolvedDepthUrl + "'")
  .replaceAll("'./color-gradient'", "'" + resolvedGradientUrl + "'");
const depthFinishingUrl =
  'data:text/javascript;base64,' + Buffer.from(depthFinishingCode).toString('base64');
const effectCode = Buffer.from(effectUrl.split(',')[1], 'base64')
  .toString()
  .replaceAll("'./direction-field'", `'${directionUrl}'`)
  .replaceAll("'./application-analysis'", `'${applicationAnalysisUrl}'`)
  .replaceAll("'./imported-shaders'", `'${importedShadersUrl}'`)
  .replaceAll("'./builtin-shaders'", `'${builtinShadersUrl}'`)
  .replaceAll("'./set2-advanced-shaders'", `'${advancedShaderUrl}'`)
  .replaceAll("'./reference-filters'", `'${referenceFiltersUrl}'`)
  .replaceAll("'./set2-filters'", `'${set2FiltersUrl}'`)
  .replaceAll('@gleech/project-model', modelUrl)
  .replaceAll("'./spatial-mosh'", `'${spatialMoshUrl}'`)
  .replaceAll("'./depth-finishing'", `'${depthFinishingUrl}'`)
  .replaceAll("'./depth-field'", `'${resolvedDepthUrl}'`)
  .replaceAll("'./feedback'", `'${feedbackUrl}'`)
  .replaceAll("'./compression'", `'${compressionUrl}'`)
  .replaceAll("'./chroma-mosh'", `'${chromaUrl}'`)
  .replaceAll("'./pixel-sort'", `'${pixelSortUrl}'`)
  .replaceAll("'./dither'", `'${ditherUrl}'`)
  .replaceAll("'./indexed-palette'", `'${indexedUrl}'`)
  .replaceAll("'./threshold'", `'${thresholdUrl}'`)
  .replaceAll("'./glyph'", `'${glyphUrl}'`)
  .replaceAll("'./glyph-atlas'", `'${glyphAtlasUrl}'`)
  .replaceAll("'./crt'", `'${crtUrl}'`)
  .replaceAll("'./glyph-alphabet'", `'${glyphAlphabetUrl}'`)
  .replaceAll("'./signal-tearing'", `'${signalTearingUrl}'`)
  .replaceAll("'./channel-echo'", `'${channelEchoUrl}'`)
  .replaceAll("'./bit-dropout'", `'${bitDropoutUrl}'`)
  .replaceAll("'./photo-finishing'", `'${photoFinishingUrl}'`)
  .replaceAll("'./fractal'", `'${resolvedFractalUrl}'`)
  .replaceAll("'./color-gradient'", `'${resolvedGradientUrl}'`)
  .replaceAll("'./tonal'", `'${resolvedTonalUrl}'`)
  .replaceAll("'./glow'", `'${glowUrl}'`)
  .replaceAll("'./noise'", `'${noiseUrl}'`)
  .replaceAll("'./blur'", `'${blurUrl}'`)
  .replaceAll("'./painted-mask'", `'${paintedMaskUrl}'`)
  .replaceAll("'./painted-mask-cache'", `'${maskCacheUrl}'`)
  .replaceAll("'./preview-stack-cache'", `'${stackCacheUrl}'`)
  .replaceAll("'./shape-tiles'", `'${resolvedTilesUrl}'`);
// Shared-library integration oracle; independent unit examples verify the algorithms.
export const {
  renderEffects,
  renderEffectsAsync,
  builtinShaderInvocation,
  PaintedMaskRasterizer,
  renderPaintedMask,
} = await import(`data:text/javascript;base64,${Buffer.from(effectCode).toString('base64')}`);

export const effectCount = Object.keys((await import(modelUrl)).EFFECT_DEFINITIONS).length;
export const {
  createEffect,
  createImportedShader,
  DEPTH_FIELD_KEYS,
  heightFieldParams,
  effectsNeedSubject,
  assertEffectPreset,
} = await import(modelUrl);
