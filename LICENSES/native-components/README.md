# Native dependency source and notice inventory

This directory retains original notices from the Windows libvips component
sources and the Rust source packages in librsvg's Cargo.lock. inventory.json
records each version, source archive SHA-256, retained notice path/hash and
published Rust license/author metadata.

The inventory is a source-graph superset. It includes test, build and other-target
Rust dependencies, not a claim that all 357 crates are compiled into the Windows
DLL. Original notice files are copied without editing. Canonical license texts
are identified separately; they do not invent copyright holders or replace the
source packages' declarations.

Eight source packages did not supply standalone notices. Their original
Cargo.toml license declarations are retained. Three other omissions were filled
from exact source commits; selectors also retains canonical MPL-2.0 terms.
The target-specific review in WINDOWS-ATTRIBUTION.md classifies seven of those
packages as excluded from the Windows LLVM library graph and selectors as included.
Pinned winapi root licenses and the original selectors source header are retained.
Five excluded crates have canonical MIT templates marked separately from their
publisher declarations; no missing copyright holders/years were invented.

Full source/build archives are kept separately from this source repository and
should accompany the reviewed binary release. A source bundle includes the
pinned Sharp/MXE/build repositories, all 28 version-matched native component
archives, all 357 checksum-pinned Rust crates, Cargo.lock and retrieval manifests.
The final bundle also retains fourteen compiler/build-tool source archives,
including LLVM, Rust and MinGW runtimes. Their supplemental notice paths and
hashes are in runtime-inventory.json; source hashes/recipes are recorded in
toolchain-source-manifest.json. Embedded GVDB/libnsgif notices are included too.
The independent source build and actual DLL compatibility checks passed; their
result is retained in rebuild-review.json. The completed
[source-bundle/notice review](SOURCE-BUNDLE-REVIEW.md) describes retained material,
upstream omissions and required release attachments. Source-graph evidence alone is not
compiler/link proof, and the runtime checks do not cover every library API.

Keep LICENSES byte-preserving in .gitattributes: notice SHA-256 checks must work
from Windows and Linux checkouts without line-ending conversion. Full packaged
CI verifies the native binary hashes and copied notices before an optional upload.
