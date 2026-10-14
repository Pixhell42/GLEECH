# Native source bundle and notice review

Reviewed 2026-10-14 for GLEECH 0.1.0, Windows x64, Sharp 0.35.5 and the
libvips 8.18.7 web/static bundle. Application code remains MIT; the original
component terms retained here apply independently.

## Retained sources

The separately supplied native source archive has 403 checksum-verified original
archives: four pinned repositories, 28 reported native libraries, 357 locked
librsvg crates and 14 compiler/build-tool sources. Its manifests record versions,
retrieval URLs, hashes and sizes. Original source archives are complete, including
their notices, build files and vendored subcomponents. Application source includes
the pinned lockfile, original notices, build instructions and our preparation /
Docker / test scripts. The native ZIP also includes a copy of those rebuild scripts.

The toolchain source manifest adds LLVM 23.1.2, Rust nightly source from
2026-09-24 and MinGW-w64 commit 57b595039040eaa15bece85b7cc71d952281b269.
These were retrieved from the successful build's cache and verified against
the retained MXE recipes. LLVM's compiler-rt, libc++, libc++abi and libunwind,
Rust's standard library/compiler-builtins and their vendored dependencies, and
the MinGW CRT are retained in full. The other eleven archives are build tools;
their executables are not distributed in GLEECH. Rust compiler source commit:
6eeff9a52c3e35c4c4cbf5651f342dcd2191866f.

Compiler bootstrap downloads, Debian build packages and Cargo's own build-tool
dependencies can still require network access. This is a corresponding-library
source/rebuild package, not a fully offline copy of the entire Linux build OS.
Recipes verify source downloads; do not substitute moving source versions.

## Embedded source and runtime notices

`runtime-inventory.json` supplements the original 741-file notice inventory with
the exact runtime notices and source header acknowledgements retained from the
compiler archives, GVDB and libnsgif. These are copied into packaged
`resources/licenses` along with the existing notice tree. Inventories include
test/other-target notice supersets and do not assert every listed file is linked.

GLib's source tarball already contains GVDB at its recorded wrap revision
2b42fc75f09dbe1cd1057580b5782b08f2dcb400. The completed build log confirms its
reader/builder compiled into GIO. The retained web-build patches remove GRegex /
PCRE; no separate PCRE download is needed for this configuration. libnsgif's
complete source and MIT notice are inside the libvips tarball. Both embedded
components' own notices are now also retained outside their source archives.

Rust's generated `COPYRIGHT-library.html` is retained as supplementary build
evidence. Its out-of-tree section is empty in this build; it is not used as a
complete dependency inventory. Original standard-library / vendored dependency
notices, Unicode terms, REUSE declarations and source archives remain available.
LLVM runtime license files and referenced contributor credits are preserved.
MinGW's own CRT notice distinguishes public-domain and separately licensed code.

FreeType and IJG acknowledgements appear in the top-level third-party notices.
Cairo's original LGPL-2.1 / MPL-1.1 alternatives and source headers are preserved;
selectors' MPL-2.0 notice and complete source are preserved. No project-wide MIT
claim replaces these terms, and no original notice has been rewritten.

## Original source-package omissions

The [eight-package review](WINDOWS-ATTRIBUTION.md) records seven crates excluded
from the selected Windows library graph and selectors included. Both winapi
packages have exact upstream license recovery evidence. Five excluded MIT crates
lack publisher standalone copyright/license notices. The bundle retains their
published declarations and unmodified full sources. Separately labelled canonical
MIT templates leave placeholders intact; they are not invented publisher grants.
This known upstream omission is documented, not silently marked resolved.

## Replacement and release delivery

The [independent rebuild](rebuild-review.json) passed real DLL replacement tests
for startup, 4K CPU image processing and PNG/JPEG/WebP/TIFF/Quick PNG export with
metadata. The DLL is outside app.asar and replacement is not blocked by app
integrity checks. The original shipped DLL matches the official upstream SDK.
The retained compiler snapshot provides a compatible independent rebuild, not
proof of the original historical OCI layer or a byte-identical recreation.

For each binary release, attach the application source and native source ZIPs
on the **same release page**, with SHA-256 checksums and the versioned notices.
Point release notes at those exact attachments, not just moving upstream URLs.
Include the retained build scripts and replacement instructions. Recheck source
links after the repository transition and keep source downloads available for
each supported binary release. Publishing binaries without these reviewed
attachments has not been approved by this preparation work.

Before publication, build from the exact chosen release commit, run the native
release material check against both the unpacked app and source bundle, verify
Electron/Chromium and model notices, and inspect the final source ZIP / fresh
history. Repeat this review when native dependencies or target variants change.
Successful source and compatibility tests do not certify legal compliance.
