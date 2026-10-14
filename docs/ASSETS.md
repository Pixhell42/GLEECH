# Asset provenance and release review

Reviewed 2026-10-14. The [checksum inventory](../assets/asset-inventory.json)
records 283 current media/sample files and three resource catalogs. Changes to
these assets need a new provenance review and updated hashes before release.
Dependency binaries/notices have separate inventories under LICENSES.

## Project-created resources

The approved G/BETA artwork, statue sample and initial effect illustrations were
generated for GLEECH during development. Effect/shader previews also include
renders of the approved sample through the app's algorithms. The retained artwork
was selected for inclusion by the maintainer. Generation prompts, discarded
concepts and outside reference materials remain in a private local archive.
AI-generated provenance is recorded without claiming unique/exclusive copyright.
[OpenAI's terms](https://openai.com/policies/terms-of-use/) describe output rights
between the user and OpenAI, subject to applicable law and third-party rights.

The forty depth maps and forty vector maps are original numerical fields generated
by project code; each has a catalog hash and a separate chooser thumbnail. The
29 starter presets are original recipes with generated previews. All ten embedded
map payloads match the retained starter PNGs; no installed font sheets or outside
shader packages are embedded in those presets.

Built-in shaders and the Prism Weave sample use original project implementations.
Checked shader sources contain project integration, seeded patterns and matching
CPU implementations. Outside visual references supplied during development are
not distributed as screenshots, videos or source snippets. The sample explicitly
declares MIT and GLEECH authorship; imported user shaders retain their own terms.

The built-in bitmap glyph repertoire, geometric pixel-emoji atlas and UI SVG icons
are defined in project source. No font files, system emoji bitmaps or third-party
icon package are included in the reviewed media set. Installed fonts remain
user-selected resources; this review does not grant rights to redistribute them.

Project-owned code and original resources are supplied under the project's MIT
terms to the extent the project holds those rights. This does not grant trademark
rights or relicense separately attributed assets.

## Separately attributed resources

The subject model is U2NETP by Xuebin Qin and contributors, distributed as ONNX by
rembg. Its exact model hash and Apache-2.0 license are retained in
[the model resources](../apps/desktop/resources/models/README.md).
The [upstream source](https://github.com/xuebinqin/U-2-Net) and
[ONNX distributor](https://github.com/danielgatis/rembg) are identified separately.

The NASA portrait in tooling/fixtures is used only for subject-detection tests.
[Scikit-image identifies it as public domain](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut).
Its source and credit are retained in [the fixture README](../tooling/fixtures/README.md);
it is not a desktop sample image and is not covered by an invented project copyright.

The three support QR images were provided by the maintainer for the displayed
payment accounts. They retain the payment services' marks. The project supplies
these functional donation destinations without claiming ownership of those
marks or granting a trademark license. Fork maintainers should review their
payment destinations when adapting the support panel.

## Maintaining the review

Run `pnpm assets:check` before publishing source or binaries. The check detects
changed hashes and media files absent from the reviewed inventory, validates map
catalogs and embedded preset map sources, and rejects unreviewed bundled fonts.
It verifies the recorded material; a matching checksum alone is not ownership
evidence. New artwork/models/fonts/shaders must identify their creator, exact
source, license and required credit before being added to the inventory.
