# Starter vector maps

Forty original 2D vector fields, shipped as opaque RGB PNGs at 2048 × 2048.
Use **Starter Maps** in compatible Direction Field controls or Motion Transfer. The chooser includes search,
categories and directional thumbnails. Selecting a starter sets Red / Green
vectors encoding and centers the map at 100% scale with zero rotation. Travel,
axis inversions, edge mode, opacity and masks remain adjustable.

Red encodes horizontal motion; green encodes vertical motion. Byte **128** means
exactly zero, **0** means -1 and **255** means +1. Positive horizontal motion moves
right; positive vertical motion moves down. Negative values use `(byte - 128) /
128`, positive values use `(byte - 128) / 127`. Blue is always 128 and is ignored
by the vector decoder. These are sRGB byte values, not a linear-light color map.
Keep the PNGs unchanged when importing; color grading and JPEG compression change
the encoded vectors.

The collection spans uniform/radial flow, vortices and spirals, shear/saddle/checker
geometry, waves/ripples, soft turbulence/curl/overlapping eddies, and cellular or
broken-block motion. The organic fields are synthetic seeded mathematical fields.
They are not motion estimated from video or photographs.

Rebuild deterministically with `node tooling/generate-vector-maps.mjs`. Numeric
maps evaluate directly at 2048px. Each component is independently clamped to
[-1, 1]. `catalog.json` records names, categories, descriptions and SHA-256 hashes.
The 192 × 192 `-thumb.png` files add white arrows over the encoded colors for
browsing; **only the full PNGs are used for rendering**, with no arrows or labels
in their vector data. Mid-gray represents no motion; the colors indicate signed
component values, not a rainbow angle legend.

Selected maps embed in projects, snapshots and portable presets. A receiving
machine needs no external file or starter library. The maps can also be imported
from disk via **Choose vector map…**. Scale, position and rotation use the existing
Motion Transfer controls; rotating a map rotates its vector directions too.
Outside-map samples are neutral. Vector Corruption continues to generate its
own seeded cell field. These original resources may be used in GLEECH projects
and presets.
