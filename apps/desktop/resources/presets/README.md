# Starter presets and sample image

`statue.png` is GLEECH's original AI-generated unfiltered 768×768 sample artwork.
It is available through Try sample image / Library → Open sample image and is
used to render preset previews. It contains no baked-in image effects.

`built-in.json` contains 29 validated starter recipes and embedded thumbnails.
Reserved built-in IDs cannot be edited/deleted in place. Apply a recipe, save
a personal copy or export a portable preset. Imported maps/shaders in a recipe
remain embedded for portability. Several recipes include one or more shaders.

Rebuild catalog thumbnails with `node tooling/generate-builtin-presets.mjs`.
Review resulting appearances and preserve existing IDs when extending the library.
Generation prompts and design/source reviews are maintained privately, not shipped.
