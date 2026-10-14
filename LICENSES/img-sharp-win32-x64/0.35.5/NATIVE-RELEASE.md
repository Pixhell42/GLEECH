# Windows native image dependencies

GLEECH uses @img/sharp-win32-x64 0.35.5. Its Apache-2.0 and
LGPL-3.0-or-later declaration does not replace the component licenses in
README.md and THIRD-PARTY-NOTICES.md. Exact component versions and original
binary hashes are retained in versions.json and native-binaries.json.

The libvips-42.dll used by the tested Windows package matches the official
libvips 8.18.7 Windows x64 web/static release byte for byte:
SHA-256 06dab07cc386748513337a31672b1d5269fbc770a14ff403080575665bf0813f.

## Source material collected — 2026-10-14

- Sharp v0.35.5: commit 51a990faa26ade5586a4934ac9673c98d8893326.
- sharp-libvips v1.3.4: commit ebb95f8add54eee8bed840e3fb587e4cbec857d7.
- build-win64-mxe v8.18.7: commit ef19ca09af2453d127453d677c849ccb37cf5694.
- MXE llvm-mingw-20260924 branch resolved to
  c36160b231e66e1cbe032ed54aef7617e8b259da for the retained source snapshot.
- All 28 reported native component versions match their recipes; every retained
  source archive matches the SHA-256 in those recipes.
- All 357 registry dependencies in librsvg's Cargo.lock have source archives
  matching their lockfile checksums. This includes build/test/other-target crates.

Source/build entry points:

- https://github.com/lovell/sharp/tree/51a990faa26ade5586a4934ac9673c98d8893326
- https://github.com/lovell/sharp-libvips/tree/ebb95f8add54eee8bed840e3fb587e4cbec857d7
- https://github.com/libvips/build-win64-mxe/tree/ef19ca09af2453d127453d677c849ccb37cf5694
- https://github.com/kleisauke/mxe/tree/c36160b231e66e1cbe032ed54aef7617e8b259da

The MXE commit is the resolved branch snapshot, not proof of the exact historical
OCI layer used upstream. For an independent rebuild, pin that checkout and use
build-win64-mxe's --without-prebuilt option instead of a moving latest image.
The [source-bundle review](../../native-components/SOURCE-BUNDLE-REVIEW.md)
records compiler/runtime and embedded-source boundaries. Fourteen additional
recipe-verified compiler/build-tool source archives are retained, including
LLVM, Rust and MinGW runtimes. Build OS/bootstrap downloads can still need
network access; this is not a fully offline Linux build environment.

## Notices

UPSTREAM-LGPL-2.1.txt is copied unchanged from the upstream Windows archive.
THIRD-PARTY-NOTICES.md is copied unchanged from sharp-libvips v1.3.4. The upstream
uses the later-version clauses for LGPLv3; LGPLv3/GPLv3 texts are retained under
LICENSES/gnu. LICENSES/native-components retains the source-package notices,
checksums and published license/author declarations.

Eight locked crates omitted standalone notice files: block 0.1.6,
malloc_buf 0.0.6, difflib 0.4.0, objc_id 0.1.1, objc-foundation 0.1.1,
selectors 0.40.0 and the two winapi Windows-GNU import-library crates 0.4.0.
Original declarations and source archives are retained; selectors also has the
canonical MPL-2.0 text. The [target-specific attribution review](../../native-components/WINDOWS-ATTRIBUTION.md)
now records seven as excluded from the Windows LLVM library graph and selectors
as included, with its original MPL source notice and complete source retained.
Pinned root licenses were recovered for both winapi crates. Five excluded MIT
crates still omit publisher notices; canonical templates are marked separately.
Source-graph resolution is not proof of the existing DLL's binary contents.

## Replacement test

The independent source rebuild completed on 2026-10-14. The pinned MXE/compiler
and web/static native-library build produced a real libvips-42.dll with SHA-256
4da1ef2fbf6d3fab69d6e0384220a212890c831df3c919ecac3df8cd537ac796.
Replacing the DLL in an isolated unpacked GLEECH copy passed startup, 4K CPU image
processing and PNG/JPEG/WebP/TIFF/Quick PNG exports, including metadata and legacy
project round-trip checks. The production originals were not replaced.
Build image IDs, input/SDK/DLL hashes and test-log digests are retained in
[rebuild-review.json](../../native-components/rebuild-review.json).

This is a compatibility rebuild using SOURCE_DATE_EPOCH=0 and the retained
toolchain recipes, not a byte-identical recreation of the historical upstream
OCI image. Test coverage does not assert compatibility for every library API.

### Earlier diagnostic replacement

An isolated unpacked app accepted a libvips DLL with its version diagnostic
string changed, preserving exports, calling conventions and executable
instructions. Startup, CPU image processing and five image export formats passed.
This demonstrates replacement is not blocked by an app integrity restriction;
it does not prove an independently rebuilt library is compatible.

The upstream static-ffi variant changes GLib linkage and failed startup with the
existing wrapper. Do not use it as an unqualified drop-in replacement. Keep
replacement libraries compatible with the wrapper's imports, architecture and
library ABI, or rebuild the wrapper/native addon from the retained Sharp source.

The DLLs/native addon are outside app.asar under:
resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib.
Use an isolated app copy for replacement testing. Never ship the diagnostic test
DLL: tooling/native-release-check.mjs rejects a binary whose hash differs from
the reviewed originals. The retained original binaries are unchanged.

## Release checks

After packaging:

    node tooling/native-release-check.mjs apps/desktop/release/win-unpacked

To verify a separately retained source bundle as well:

    node tooling/native-release-check.mjs apps/desktop/release/win-unpacked <source-bundle>

The source bundle must include all 403 original source/build archives and their
retrieval/checksum manifests. Publish it with the GLEECH application source at the
same binary release, rather than relying solely on moving upstream links.
The independent source rebuild and tested replacement result are now recorded.
[Rebuild instructions](../../../tooling/native-rebuild/README.md) are retained
with the source and inside the native source ZIP. The source-bundle and runtime
notice review is recorded separately. Verify the final chosen release commit,
source attachments, packaged notices and download links before binary publication;
successful compilation and compatibility tests are not a compliance certification.
