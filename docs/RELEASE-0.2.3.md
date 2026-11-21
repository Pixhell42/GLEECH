# GLEECH 0.2.3

Windows x64 is a beta. macOS and Linux are experimental alphas. All packages
are unsigned, and the macOS builds lack notarization.

## Downloads

- [Windows x64 installer](https://github.com/Pixhell42/GLEECH/releases/download/v0.2.3/GLEECH-0.2.3-x64-setup.exe)
- [macOS Apple Silicon ZIP](https://github.com/Pixhell42/GLEECH/releases/download/macos-alpha-0.2.3/GLEECH-0.2.3-mac-arm64.zip)
- [macOS Intel ZIP](https://github.com/Pixhell42/GLEECH/releases/download/macos-alpha-0.2.3/GLEECH-0.2.3-mac-x64.zip)
- [Linux x64 AppImage](https://github.com/Pixhell42/GLEECH/releases/download/linux-omarchy-alpha-0.2.3/GLEECH-0.2.3-linux-x86_64.AppImage)

The release pages include checksums, updater manifests, GLEECH source, native
dependency sources, and FFmpeg corresponding source. The Linux page also includes
AppImage launcher source and relinking materials.
[Windows](https://github.com/Pixhell42/GLEECH/releases/tag/v0.2.3) · [macOS](https://github.com/Pixhell42/GLEECH/releases/tag/macos-alpha-0.2.3) · [Linux](https://github.com/Pixhell42/GLEECH/releases/tag/linux-omarchy-alpha-0.2.3)

## Security and runtime

GLEECH 0.2.3 fixes BoringSSL CVE-2026-35189. The issue could terminate GLEECH
during TLS certificate verification and cause loss of unsaved work. Update checks
and shader imports from a URL used the affected path. Chromium 160.0.8168.0 pins
BoringSSL revision `26584e7a10cc0ffa4df14f4eb7f90e5b44b37ffe`, which includes the upstream fix.
[BoringSSL advisory](https://github.com/google/boringssl/blob/main/docs/advisories/2026-09-29.md) · [Chromium dependency pin](https://chromium.googlesource.com/chromium/src/+/refs/tags/160.0.8168.0/DEPS) · [BoringSSL source comparison](https://github.com/google/boringssl/compare/9b639f5b3b086508c03f6a4a1792e4a6043777ac...26584e7a10cc0ffa4df14f4eb7f90e5b44b37ffe)

The app ships with **Electron 46.0.0-alpha.12**, which is a prerelease runtime
and may have compatibility or stability issues. It includes Node.js 26.13.1.
GitHub sign-in now uses Electron's asynchronous credential storage. Existing
encrypted credentials can be read through the new API. Linux requires an
available desktop keyring for GitHub sign-in.
[Electron release](https://releases.electronjs.org/release/v46.0.0-alpha.12) · [Electron credential storage](https://github.com/electron/electron/blob/v46.0.0-alpha.12/docs/api/safe-storage.md)

## Upgrade instructions

Save your work and keep your existing installation path and user-data folder.

- **Windows x64** — From 0.2.2, choose **Settings → Updates → Install & Update**,
  run `gleech update --yes` after closing the desktop app, or run the new
  installer over your existing per-user installation.
- **macOS** — Download the ZIP for your architecture. Settings and the terminal
  updater can download and verify it. Quit GLEECH, replace `GLEECH.app` at its
  existing location in Applications, and reopen it.
- **Linux x64** — From 0.2.2, choose **Settings → Updates → Install & Update** or
  run `gleech update --yes`. If replacing the AppImage manually, keep its path
  and make the new file executable. Without FUSE, use `APPIMAGE_EXTRACT_AND_RUN=1`
  and leave `NO_CLEANUP` unset.
- **0.1.2 on any platform** — Download the matching 0.2.3 package and install it
  manually. [Manual upgrade steps](AUTOMATIC-UPDATES.md#upgrading-from-012)

## Validation

The four release packages passed 28 installed lifecycle checks and 55 updater
checks, including an upgrade from each exact public 0.2.2 package. Each target
passed six embedded runtime check groups. macOS uses manual app replacement.
The Linux runner used AppImage extraction under Xvfb and verified that GitHub
sign-in requires a keyring. The Windows release checks also included a full
hosted suite and testing on a physical GPU.
[Native package and updater validation](https://github.com/Pixhell42/GLEECH/actions/runs/44945398612) · [Hosted Windows shards 1–11](https://github.com/Pixhell42/GLEECH/actions/runs/44945397048) · [Hosted Windows shard 12 retry](https://github.com/Pixhell42/GLEECH/actions/runs/44953250695)
