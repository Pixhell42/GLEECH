# Starter depth maps

Forty original scalar depth/height maps for GLEECH. Each is an opaque, 8-bit
grayscale PNG at 2048 × 2048. White means high/near; black means low/far. Invert in
the editor to reverse that convention. These maps manufacture artistic depth;
they do not estimate the scene depth of a photograph.

The collection includes simple ramps, soft surfaces, layered noise/clouds,
geometric structures, rounded surfaces, architectural depth and recursive terraces.
The second twenty add diagonal/split ramps, pillows, fabric, braided ribbons,
spiral folds, warped cumulus, billows, canyons, craters, dunes, diamond facets,
radial fans, chevrons, triangular panels, a ribbed capsule, crossed vaults,
switchback stairs, terraced islands and Truchet channels. The original twenty
files, IDs and catalog entries are unchanged.
`catalog.json` records names, categories, suggested uses and SHA-256 hashes.
The `-thumb.png` companions are 192 × 192 previews for the in-app chooser.

Rebuild deterministically with `node tooling/generate-depth-maps.mjs`. Analytic
surfaces render directly at 2048px. The original five organic fields evaluate the
existing seeded noise engine at 512px and interpolate to 2048px for continuous
soft slopes. All second-collection fields evaluate at the full 2048px resolution,
with floating-point heights normalized before 8-bit quantization.
Use `node tooling/generate-depth-maps.mjs --new-only` to regenerate only the second
twenty and their catalog entries while preserving the original files.
Pixels encode height alone, with no painted lighting, text, ambient occlusion or
shadows. These project-created resources ship with GLEECH and may be used in its
projects and portable presets.

Use **Starter maps…** in Depth Field, Blur's Depth Field style, or field-enabled
Recursive Space. **Import map…** accepts PNG, JPEG and WebP images. Color images
are interpreted through luminance multiplied by alpha; grayscale PNGs give the
most predictable values. Selected maps are embedded in projects, snapshots and
presets, so a receiving machine does not need the original file or starter library.

Imported fields stretch proportionally across the canvas at 100% Field scale.
Field X/Y, scale and rotation reposition the map; samples outside it extend the
edge values. Invert, Normalize, Contrast, Smoothing, Near/Far and falloff remain
available. Rendering retains a field grid up to 2048px on its longer canvas side.
Higher-resolution imported files remain embedded but are sampled at that limit.
The image pipeline converts maps to 8-bit sRGB values; it does not preserve 16-bit
height precision. Existing project/preset size limits still apply.
