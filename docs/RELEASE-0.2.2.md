# GLEECH 0.2.2

Published November 21, 2026. Windows x64 is a beta. macOS and Linux are
experimental alphas. The packages are unsigned, and the macOS apps lack notarization.

## Downloads

- [Windows x64 installer](https://github.com/Pixhell42/GLEECH/releases/download/v0.2.2/GLEECH-0.2.2-x64-setup.exe) · [Windows release page](https://github.com/Pixhell42/GLEECH/releases/tag/v0.2.2)
- [macOS Apple Silicon ZIP](https://github.com/Pixhell42/GLEECH/releases/download/macos-alpha-0.2.2/GLEECH-0.2.2-mac-arm64.zip)
- [macOS Intel ZIP](https://github.com/Pixhell42/GLEECH/releases/download/macos-alpha-0.2.2/GLEECH-0.2.2-mac-x64.zip)
- [Linux x64 AppImage](https://github.com/Pixhell42/GLEECH/releases/download/linux-omarchy-alpha-0.2.2/GLEECH-0.2.2-linux-x86_64.AppImage) · [Linux release page](https://github.com/Pixhell42/GLEECH/releases/tag/linux-omarchy-alpha-0.2.2)

The release pages include SHA-256 checksums, update manifests, GLEECH source,
native dependency sources and FFmpeg corresponding source. The Linux release
also includes AppImage runtime source and relinking materials. Both macOS ZIPs
are on the [macOS release page](https://github.com/Pixhell42/GLEECH/releases/tag/macos-alpha-0.2.2).

## Changes

- Electron 45.4.1 includes Chromium 156.0.8078.100 and Node.js 24.22.3 with
  November security fixes. [Electron release](https://releases.electronjs.org/release/v45.4.1)
- Updated Hono and `@hono/node-server` clear seven npm advisories in local MCP
  dependencies. Development and CI use Node.js 22.23.5 and pnpm 10.34.9.
- The updater rejects invalid cached installer filenames, and desktop startup
  avoids a warning from registering too many window-close listeners.
- The Linux AppImage launcher links zlib 1.4.

## Upgrade instructions

Save your work before installing. Keep your existing app path and user-data folder.

- **Windows x64** — From 0.2.1, use **Settings → Updates → Install & Update**, run
  `gleech update --yes` after closing the desktop, or run the 0.2.2 installer over
  your existing per-user installation. From 0.2.0, use the desktop updater or the
  installer for the first hop. [Windows 0.2.0 updater behavior](AUTOMATIC-UPDATES.md#windows-cli-in-020)
- **macOS** — Use the verified ZIP for your architecture. Quit GLEECH, replace
  `GLEECH.app` at the same location in Applications, and reopen it. The in-app
  and terminal update commands can download and verify the ZIP for manual replacement.
- **Linux x64** — From 0.2.1, use **Settings → Updates → Install & Update** or
  `gleech update --yes`. For manual replacement, keep the same AppImage path and
  make the new file executable. Without FUSE, use `APPIMAGE_EXTRACT_AND_RUN=1`
  and leave `NO_CLEANUP` unset after upgrading.
  [Linux 0.2.0 extraction workaround](AUTOMATIC-UPDATES.md#linux-without-fuse)
- **0.1.2 on any platform** — Download the matching 0.2.2 package and install it
  manually at the existing app path. [Manual upgrade steps](AUTOMATIC-UPDATES.md#upgrading-from-012)

## Known security issue

Electron 45.4.1 still includes the BoringSSL code affected by CVE-2026-35189 on
all four targets. TLS certificate verification can allocate excessive memory,
terminate GLEECH and cause loss of unsaved work. Update checks and shader imports
from a URL use the affected path. Save your work before using these features.
[BoringSSL advisory](https://github.com/google/boringssl/blob/main/docs/advisories/2026-09-29.md)

The maintainer accepted the disclosed risk for 0.2.2. The runtime pins BoringSSL
revision `2ea3200c3a3ec176613ab7a0b9a4ffc6db846120`, which predates the upstream fix.
[Chromium dependency pin](https://github.com/chromium/chromium/blob/156.0.8078.100/DEPS) · [Electron’s BoringSSL patches](https://github.com/electron/electron/tree/v45.4.1/patches/boringssl)

## Validation

Across the four targets, the published packages passed 28 installed lifecycle
checks and 55 updater checks. Each target passed six embedded-runtime probe
groups. The exact public 0.2.1 packages were used to test upgrades to each 0.2.2
candidate. A private 0.2.3 receiver exercised the next upgrade. The release
passed 291 hosted Windows checks, 24 physical Windows GPU checks and CodeQL.
[Installed-updater acceptance](https://github.com/Pixhell42/GLEECH/actions/runs/44920454853) · [Updater retests](https://github.com/Pixhell42/GLEECH/actions/runs/44925607172) · [Hosted Windows checks](https://github.com/Pixhell42/GLEECH/actions/runs/44920448885)

After publication, all 45 attachments were checked against their hashes.
The public updater found 0.2.2 and the matching download for each of the four targets.
