# Third-party notices and asset credits

GLEECH's project-owned source is MIT-licensed. This does not change third-party
terms or establish rights for user-imported artwork/shaders/fonts.

## Runtime dependencies

### Linux AppImage launcher runtime after 0.2.0

New Linux builds compile the MIT-licensed AppImage type-2 runtime from pinned
upstream commit `fedfad51acc2860b2916a1eef32ba4a500ff31ef`, with GLEECH's change
to allocate a separate extraction directory per invocation. This is an AppImage
launcher change; the Electron runtime is unchanged. Original notices for the
statically linked musl, libfuse, squashfuse, zstd, zlib and mimalloc components,
the modified source, libfuse source and patches, runtime object, link archives,
relink instructions and build-package record accompany Linux packages under
`resources/appimage-runtime-notices/`. Keep this material with redistributed
packages. `source-and-relink.tar.gz` contains the modified runtime and relinking
materials; the build uses the pinned Alpine image in
`apps/desktop/build/appimage-runtime/Dockerfile`.

### FFmpeg executable

Packaged apps include FFmpeg 9.0.2 from the pinned TAS-FFMPEG v9.0.2 release,
licensed GPL-2.0-or-later and built with the x264 and x265 software encoders.
GLEECH launches it as a separate process; it does not link FFmpeg into GLEECH.
Original component notices, build records and the complete corresponding-source
archive accompany the executable under `resources/ffmpeg/` (inside
`Contents/Resources/` on macOS). See [the FFmpeg bundle record](LICENSES/ffmpeg/README.md)
and [pinned download checksums](LICENSES/ffmpeg/bundle.json). These terms are
separate from GLEECH's MIT license. Preserve the entire bundle when distributing
the app; the source archive must not be removed to reduce package size.

### JavaScript and native dependencies

Application updates use electron-updater 6.8.9 (MIT) and its retained JavaScript
dependencies. Original package notices are included in LICENSES. lazy-val 1.0.5
declares MIT terms but omits a standalone license in both its npm package and
matching source commit; its original metadata and the omission record are retained
under LICENSES/lazy-val/1.0.5.

The pinned production package inventory, SPDX declarations, upstream homepages
and retained notice paths are in [LICENSES/dependencies.json](LICENSES/dependencies.json).
Original license/notice texts are preserved in LICENSES and copied into the
apps' resources/licenses directory. Mac builds also retain a native-package
notice inventory under resources/mac-native-notices; see [Mac packaging](docs/MACOS.md)
for the libvips npm notice omission and the version-matched retained upstream texts.
This inventory is a dependency
superset, not a claim that every HTTP adapter is used by the local stdio server.

React, MCP SDK, Zod and ONNX Runtime use MIT terms. Sharp uses Apache-2.0; its
Windows native bundle includes LGPL and other independently licensed libraries.
See the retained sharp bundle README, versions.json and LICENSE under
LICENSES/img-sharp-win32-x64/0.35.5. GNU LGPLv3 and its incorporated GPLv3 license
texts are retained in LICENSES/gnu. That native directory also retains the
upstream Windows LGPLv2.1 text, versioned third-party notices and
[verified binary provenance/release steps](LICENSES/img-sharp-win32-x64/0.35.5/NATIVE-RELEASE.md).
The [native source-bundle review](LICENSES/native-components/SOURCE-BUNDLE-REVIEW.md)
records corresponding sources, compiler/runtime notices and replacement tests.
Each binary release must include the reviewed source attachments; do not interpret
this inventory alone as a redistribution-compliance certification.
Original native/Rust source-package notices and their checksum inventory are
retained under [LICENSES/native-components](LICENSES/native-components/README.md).
This includes build/test/other-target sources, rather than only the Windows runtime graph.
LLVM, Rust standard-library and MinGW runtime notices, along with embedded GVDB
and libnsgif notices, are retained in the supplemental runtime inventory.

Required acknowledgements for the bundled font and JPEG libraries:

Portions of this software are copyright © 2026 The FreeType Project
(https://freetype.org). All rights reserved.

This software is based in part on the work of the Independent JPEG Group.
Its complete original README.ijg and the mozjpeg/libjpeg-turbo license terms are
retained under LICENSES/native-components/mozjpeg/0826579.

ONNX Runtime 1.30.0's upstream MIT license and third-party notices are retained
under LICENSES/onnxruntime/1.30.0. Intel macOS subject detection uses the
`onnxruntime-node-macos-x64` npm alias of ONNX Runtime 1.22.0; its upstream MIT
license and third-party notices are retained under LICENSES/onnxruntime/1.22.0.
Electron 44.5.1's MIT license is retained under
LICENSES/electron/44.5.1; preserve LICENSE.electron.txt and LICENSES.chromium.html
alongside the packaged runtime. Chromium's notices describe its own components.

## Subject model

The bundled u2netp.onnx is the U²-Net salient-object model by Xuebin Qin and
contributors, distributed in ONNX form by rembg. It retains Apache-2.0 terms in
apps/desktop/resources/models/U2NET-LICENSE.txt. Source, distribution URL and
verified model hash are in that directory's README. Inference runs locally.

## Project artwork and numerical maps

The [asset provenance review](docs/ASSETS.md) and
[checksum inventory](assets/asset-inventory.json) cover the current media,
catalogs, embedded preset maps and separately attributed resources. The NASA
test portrait is public-domain material credited in tooling/fixtures/README.md.
Maintainer-supplied support QR images retain the payment services' marks;
project MIT terms do not grant ownership or trademark rights to those marks.

The approved G/BETA icon artwork, statue sample and some effect illustrations
were generated for GLEECH using AI image-generation tools. Other thumbnails are
renders of the app's own effects. This is original project material, not a
bundled gallery of third-party shader screenshots. Unselected concepts,
generation prompts and private reference reviews are excluded from the public
candidate. Asset provenance/rights are reviewed independently of software SPDX
metadata; do not attribute exported user artwork to GLEECH.

The forty scalar depth maps and forty vector maps are original numerical fields
generated by project code. Full numerical PNGs and their catalog hashes are
separate from browsing thumbnails. The built-in shader programs and Prism Weave
sample are original GLEECH code; the sample declares MIT.

Installed font files are not bundled. Glyph Renderer embeds generated coverage
sheets for portability; users remain responsible for the fonts/artwork they use.
Shader imports preserve supplied creator/source/license data and do not confer
redistribution permission. No Shadertoy source library is bundled by default.

## Maintaining notices

When changing dependencies or native binaries, regenerate/review the license
inventory, retain copyright/notice texts and reassess source obligations. When
adding outside artwork/shaders/models, document their exact source and terms
before distribution. Do not overwrite third-party licenses with MIT.
