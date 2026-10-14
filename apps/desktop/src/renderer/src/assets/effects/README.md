# Effect picker thumbnails

Bundled effect tiles are opaque 384 × 384 WebP images. Treatments should remain
recognizable at small tile sizes and use the shipped statue sample or procedural
outputs. Keep filenames aligned with the effect type IDs in the picker.

Some early tiles were generated with imagegen using the shipped statue sample.
Later tiles render the actual GLEECH algorithms. Source reviews, generation
prompts and extracted reference artwork are kept outside the repository.

To regenerate the original shader tiles, run
`node tooling/shader-thumbnails.mjs`. Additional suites use
`node tooling/generate-reference-thumbnails.mjs` and
`node tooling/generate-set2-thumbnails.mjs`. These scripts use implemented
GLEECH effects and the sample at `apps/desktop/resources/presets/statue.png`;
they do not require external reference videos or review documents.

Built-in preset thumbnails live in the preset resources. Run
`node tooling/generate-builtin-presets.mjs` to regenerate their rendered
previews. Keep preset IDs, recipes and embedded assets compatible when updating
the catalog.

After changing tiles, build and run the relevant library checks to verify that
all registered effects and presets have thumbnails, render properly and remain
available in packaged builds. See [Windows development](../../../../../../../docs/DEVELOPMENT.md).
