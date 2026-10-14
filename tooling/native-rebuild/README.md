# Independent Windows native rebuild

This reproduces the web/static libvips 8.18.7 build using the retained MXE and
build-win64-mxe sources. It compiles the compiler/tooling and native libraries;
it does not download a prebuilt libvips/MXE image. Allow substantial disk space
and time. Docker must be running in Linux-container mode. Python 3.12+ is required
for safe archive extraction. Keep the installed app and its original DLLs intact.

Run `python tooling/native-rebuild/test_prepare.py` to check the extractor's path,
link and overwrite boundaries before preparing a build.

Prepare a new ignored workspace from the complete source bundle:

```powershell
python tooling/prepare-native-rebuild.py <source-bundle> test-results/native-rebuild
pwsh -NoProfile -File tooling/native-rebuild/run.ps1 -Context C:\path\to\GLEECH\test-results\native-rebuild
```

The runner builds both images, packages a new SDK and copies the current unpacked
GLEECH app into the isolated workspace. It replaces only that copy's libvips DLL
and runs startup, CPU image processing and five export/metadata checks. Build and
test logs plus result.json remain in the context. It never changes the installed
app or accepts a new production binary hash. Build the ordinary unpacked package
first with `pnpm pack:win`. Run the wrapper in Windows PowerShell 7 with Node and
the workspace dependencies available. A successful source build with failed app
tests is recorded as failed, rather than counted as a completed rebuild review.
Each context allows one controller at a time. An exclusive OS lease rejects a
duplicate before it can overwrite logs/status or start another Docker build.
The lock file can remain after a run; the OS releases its lease when the controller
exits. The runner also checks a recorded active controller PID for older runs.

The base image is digest-pinned. MXE recipes verify additional compiler and build
tool downloads; Debian packages still use the base distribution's repositories.
The retained 28 library and 14 compiler/build-tool archives seed MXE's download
cache in both build stages. All 403 retained source archives are verified before
extraction. Librsvg's 357 locked
Rust crates are verified and expanded into a Cargo directory source. No library
version is upgraded. This is a compatibility rebuild, not a bit-identical rebuild:
SOURCE_DATE_EPOCH is explicitly zero and compiler/tool packages may differ from
the historical upstream OCI image. Local changes are recorded in build-inputs.json.
The source bundle also supplies embedded GVDB inside GLib and libnsgif inside
libvips. Rust's full source includes its standard-library vendor dependencies.
Compiler bootstrapping, Debian packages and Cargo build-tool dependencies may
still access the network. Retaining the runtime/library sources does not make
the entire Linux build OS an offline distribution.

For packaging, mount a **new** output directory at /data/packaging, copy the pinned
upstream packaging scripts there, and run gleech-native:review with these variables:
PKGS=vips-web, MXE_TARGETS=x86_64-w64-mingw32.static, FFI_COMPAT=false,
JPEG_IMPL=mozjpeg, HEVC=false, DEBUG=false, ZLIB_NG=true.
Preserve logs, Docker image IDs, compiler versions, recipe patches and output hashes.
Test the actual DLL in an isolated unpacked GLEECH copy before accepting the rebuild.
Never replace production hashes with an untested output.

## Repeat the eight-package target review

Use the official Rust image digest recorded in
[the attribution review](../../LICENSES/native-components/WINDOWS-ATTRIBUTION.md).
Mount the prepared context read-only at /review and a new evidence directory at
/evidence. Run `sh /review/attribution.sh` with `--network=none`. The script resolves
the C library's normal/build dependencies, plus separate explanatory Apple,
GNU-target and test paths. It does not run third-party build scripts.

The C library uses librsvg-c with capi, tests/pixbuf/rsvg-convert disabled, on
x86_64-pc-windows-gnullvm. The GNU import-library crates are gated on the exact
GNU target triple; gnullvm's `target_env=gnu` does not make that exact triple match.
Recheck graph/features after an upstream source or recipe change.
