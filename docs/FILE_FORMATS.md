# Projects, presets and exported metadata

## Editable projects

`.gleech` uses the `GLEECH02` signature, a 32-bit little-endian JSON recipe length,
a JSON document, then image/subject-mask payloads. The document includes a
renderer version, application metadata, validated project state and an asset
directory with lengths and SHA-256 hashes. Data includes source/origin images,
effect stacks, masks, snapshots/baked sources and embedded attachments.

Projects that have opened Timeline mode add a `timeline` (frame rate, duration,
work area, In/Out, loop, seed track, markers, tempo, and optional video clip and
audio track) and effects may add `animation` (keyframes and modulators per
control key, with times in seconds) and `activeRange`. Video clips and audio tracks
are referenced by file path, not embedded; the clip's `posterId` and `posterTime`
name the source image made from one of its frames and that frame's time. The
audio analysis (band energy, peaks, beats and tempo) is embedded so renders stay
deterministic. Older GLEECH
releases ignore these fields and open such projects as stills.

Limits: 300 MiB file, 32 MiB JSON recipe, 128 megapixels across project sources.
Subject masks are bounded to 1024 per dimension with byte coverage. Missing,
truncated, unsupported or hash-invalid data is rejected. GLEECH01 legacy projects
are migrated on read; later saves use the current format. Application metadata
is optional when reading older saves.

## Portable presets

`.gleechpreset` is UTF-8 JSON with `format: gleech-preset`, schema/renderer
versions, application metadata and a portable recipe. The maximum file size is
16 MiB. Recipes carry seed, effects, thumbnail/source choice, optional masks,
embedded PNG fields/images, shader packages and glyph sheets. They exclude
project history and project paths. Imports assign fresh user-library identity;
built-in recipes use reserved IDs and are not changed in place.

## Shaders and fields

`.gleech-shader` is a validated native shader package; supported raw WGSL/ISF
imports are converted into an embedded package. See [SHADER_PACKAGES.md](SHADER_PACKAGES.md).
Projects/presets retain package code and supplied credits so they do not depend
on the original file or library entry. Installed fonts use embedded raster glyph
coverage sheets, not embedded font binaries.

Layer/depth/vector images embed PNG bytes and validated image dimensions/IDs.
Bundled scalar maps are 2048×2048 8-bit grayscale, white high/near and black
low/far. Vector maps use red for X, green for Y, with 128 neutral; blue is ignored.
Byte values below 128 normalize by 128, above by 127. Use full maps, not chooser
thumbnails, for numerical data. Image decoding is bounded to 64 megapixels and
32768 pixels per dimension; GPU limits may be lower.

## Exports and attribution

PNG and TIFF preserve RGBA losslessly. WebP preserves alpha with selectable image
quality. JPEG uses a white background and no alpha. Exports always use the edited
full-resolution result; preview resolution/comparison state does not select the
export pixels.

Saved projects and portable presets record `application.name`, `version`,
`developerUrl` and `repositoryUrl`. PNG/JPEG/WebP/TIFF exports use XMP CreatorTool
plus GLEECH Application, Version, DeveloperURL and RepositoryURL fields. Current
URLs are https://x.com/pixhell and https://github.com/Pixhell42/GLEECH. Quick PNG
also includes metadata. These identify the writing software, not the artwork's
author/copyright. Clipboard and internal asset PNGs use their existing encoding
path; other software may remove exported metadata.

Effect behavior and data schemas are versioned separately from the app release.
Older platform builds must reject unsupported versions explicitly rather than
silently pretending to reproduce newer recipes.
