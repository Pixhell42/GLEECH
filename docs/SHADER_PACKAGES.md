# Shader imports and package contract

## User flow

Choose Add Shader from the Library menu or Effects library. Import a local
native `.gleech-shader` package or supported WGSL/ISF source, fetch a direct
public HTTPS file, or paste source copied from a page. Review the preview,
controls and supplied author/license metadata before saving the library entry.
The importer does not scrape arbitrary HTML pages for shader code.

Creator names link to their supplied HTTPS profile/source. Hover the creator for
license/package details. The trash icon removes the library entry; existing
projects and presets retain their embedded copies. Search/favorites and S badges
work for imported shaders and presets containing them. Importing does not grant
permission to redistribute someone else's code.

## Native JSON package

The version-one package has `format: gleech-shader`, schemaVersion, stable id,
semantic version, name/description, authors, sourceUrl, license expression/text,
image/generator kind, language, entryPoint, source and controls. Validation
rejects unknown fields, duplicate/reserved keys and invalid finite defaults/ranges.
Metadata limits are 256 KiB per package, 64 KiB source, 32 controls, eight authors
and 32 options per choice. Credit URLs require HTTPS without embedded credentials.

Numbers declare range, step, default and display units; choices declare distinct
numeric shader codes; colors use six-digit RGB. Controls occupy aligned vec4
slots in declaration order: numbers/choices use x, colors use RGB and alpha 1.
Custom recipe keys use the shader_ prefix. GLEECH owns Opacity, Tint, Phase, seed,
blending, procedural/painted masks and lock/history behavior.

## WGSL execution

Supply one `fn gleechShade(context: GleechShaderContext) -> vec4f` function.
The context supplies normalized uv, output position, current resolution, full
reference dimensions, source RGBA, looping phase and deterministic seed.
`gleechControl(index)` accesses a declared slot; `gleechSample(uv)` samples the
incoming image with alpha-aware bilinear interpolation and extended edges.
Output is sanitized to finite [0,1] RGBA before shared composition.

The first runtime policy permits at most 4 KiB executable code and 96 calls,
without loops, arrays or owned GPU resources. The larger metadata source limit
does not relax executable policy. Imported WGSL requires WebGPU and has no
automatic CPU implementation. Actual GPU compiler errors are shown on failure.
The shipped Prism Weave example is original GLEECH code under MIT.

## ISF subset

Supported raw single-pass ISF uses its JSON header to define image/generator
inputs and float, bool, long-choice and color controls. Execution uses WebGL2,
with isf_FragNormCoord, gl_FragColor and IMG_SIZE/PIXEL/NORM_PIXEL/THIS helpers.
RENDERSIZE describes full image dimensions; sampling is alpha-aware bilinear.

ISF executable code permits at most 4 KiB and 128 calls. Pass targets, external
textures, persistent buffers, audio/events, loops and owned resources are
unsupported. Only a supported version directive is accepted. TIME represents
the saved Phase × 2π; frame/delta/pass inputs are fixed. There is no playback.
ISF requires WebGL2; it can coexist with WGSL effects in one stack.

## URLs, portability and licensing

URL imports accept public HTTPS files without credentials or custom ports.
GitHub blob URLs are converted to raw files. Requests apply size/time/redirect
limits and public-address checks with pinned DNS; HTML pages are rejected.
Fetching is done by the native process, not shader code. Arbitrary Shadertoy
adapters and multipass/external resources remain deferred.

Missing author/license fields remain Unknown author / LicenseRef-Unspecified;
the app does not invent rights. Supplied metadata and license text are retained
when the package is saved, copied, duplicated, stored in a project or exported
in a preset. Different package versions can coexist. Built-in original shaders
have supported CPU fallbacks; arbitrary imported shaders do not. Disable an
unsupported imported effect to render the remaining stack on a CPU-only device.

Painted masks are applied after shader generation. Optional pattern attachment
can follow a retained mask frame; new polygon/Bezier drawing tools remain
unavailable and are waiting for design while saved geometry retains compatibility.

Source contracts: `packages/project-model/src/shader-package.ts`, native
`shader-fetch.ts`, and renderer-core import implementations. Verification:
`test:shader-import`, `test:shader-paste` and `test:isf`.
