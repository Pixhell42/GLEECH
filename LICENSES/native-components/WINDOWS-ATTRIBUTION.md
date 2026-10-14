# Eight-package Windows attribution review

Reviewed 2026-10-14 using the checksum-pinned librsvg 2.63.2 sources and Cargo.lock.
The exact MXE recipe selects x86_64-pc-windows-gnullvm, builds librsvg-c with capi,
and disables tests, pixbuf and rsvg-convert. Offline Cargo resolution identifies
one of the eight packages in the normal/build dependency graph: selectors 0.40.0.
This is source-graph evidence. The independent build subsequently compiled librsvg
and libvips successfully; the rebuilt DLL passed the compatibility checks recorded
in rebuild-review.json. The graph alone does not prove the original DLL's contents.

The repeatable commands are in [the native rebuild tooling](../../tooling/native-rebuild/README.md).
The official Rust review image is digest-pinned:
`rust@sha256:81015672d6939b0265f09adf96d5de125482bb1330106076956b0518e74edc90`.
It runs Cargo/rustc 1.99.0 with no network, using the complete retained crate set.
This resolver toolchain is separate from the pinned nightly compiler being rebuilt
by MXE. Evidence and checksums are in eight-package-review.json and target-review/.

## Included package

**selectors 0.40.0** is a normal librsvg dependency. Its published Cargo.toml names
The Servo Project Developers and MPL-2.0. Its Rust files carry the MPL Exhibit A
notice, which is retained verbatim as UPSTREAM-SOURCE-NOTICE.txt. The complete,
unchanged crate source and canonical MPL-2.0 text are retained. The source header
does not name an additional copyright holder; none was invented.

When distributing the executable, make its MPL-covered source available and tell
recipients how to obtain it. Preserve the existing source notices. These are the
requirements in [MPL sections 3.1, 3.2 and 3.4](https://www.mozilla.org/en-US/MPL/2.0/).
The native source bundle must accompany the final release with a clear source link;
GLEECH's MIT license does not replace these terms.

## Excluded packages

- **block 0.1.6, malloc_buf 0.0.6, objc_id 0.1.1 and objc-foundation 0.1.1**:
  the Objective-C subtree is reached through locale_config's macOS-only dependency.
  It is absent from the Windows graph. Published author: Steven Sheldon; MIT.
- **difflib 0.4.0**: reached through predicates in librsvg's dev-dependencies.
  The C-library build disables tests. Published author: Dima Kudosh; MIT.
- **winapi-i686-pc-windows-gnu 0.4.0**: selected only for the exact i686 GNU target,
  which is not the Windows x64 LLVM target.
- **winapi-x86_64-pc-windows-gnu 0.4.0**: selected only for the exact x86_64 GNU target.
  Gnullvm reports target_env=gnu, but does not match an exact GNU target triple.

Both winapi source archives contain original copyright/license headers despite
omitting standalone license files. Their root MIT/Apache texts were recovered from
[upstream commit 9497609](https://github.com/retep998/winapi-rs/tree/9497609ef44cc9bcd16cd2411c0ee6ccaf5483aa).
Cargo.toml.orig, src/lib.rs and build.rs for both packages match that commit byte
for byte. Original source headers and root license holders/years are preserved.
Upstream later fixed the omitted license packaging; that later change was not
substituted for the published crate source.

## Source-bundle omissions

The other five excluded crates declare MIT but supply no standalone license or
copyright notice in the inspected archive. Their original Cargo.toml declarations,
author metadata and complete checksum-pinned sources are retained. CANONICAL-MIT.txt
is explicitly the [SPDX MIT template](https://spdx.org/licenses/MIT.html), including
its unfilled holder/year placeholders; it is not represented as a publisher notice.
Do not substitute a guessed copyright notice or attribute GLEECH's copyright to
these sources. The omission remains documented for source-bundle redistribution.

The target review classifies all eight packages and resolves the notice handling
for the Windows library's included package. It does not claim that all 357 locked
crates are compiled into libvips or that a resolver graph proves an existing DLL's
binary contents. Recheck this review for another OS, target, feature set or version.
