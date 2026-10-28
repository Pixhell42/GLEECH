# GLEECH 0.2.0

Published October 28, 2026. Windows remains a beta; macOS and Linux remain
experimental alphas. Packages are unsigned, and macOS builds are not notarized.
Installed-package acceptance and final maintainer publication approval are complete.

- [Windows x64 beta](https://github.com/Pixhell42/GLEECH/releases/tag/v0.2.0)
- [macOS alpha: Apple Silicon and Intel](https://github.com/Pixhell42/GLEECH/releases/tag/macos-alpha-0.2.0)
- [Linux x64 / Omarchy alpha](https://github.com/Pixhell42/GLEECH/releases/tag/linux-omarchy-alpha-0.2.0)

## What changes from 0.1.2

GLEECH 0.2.0 brings the completed desktop, CLI/TUI and platform work into one
application baseline for Windows x64, macOS arm64/x64 and Linux x64. The release
packages share the reviewed application/dependency inputs. Later source changes
affect validation tooling only; build manifests retain the actual binary commits.

- **Settings and updates:** desktop and terminal Settings collect update controls,
  support links, feedback, community and version information. GitHub update
  downloads support session recovery and once-per-version patch notes. CLI/TUI
  update commands use the same installer engine. See [automatic updates](AUTOMATIC-UPDATES.md)
  for installation requirements and platform behavior.
- **Video playback and file opening:** improved native playback and frame handling,
  a shared Open File action for images, projects and video, and packaged file-opening
  checks. Compact LFO waveform icons make modulation choices easier to scan.
- **Export memory and recovery:** desktop, CLI and TUI expose RAM-budget checks,
  one-frame and compatible tiled processing, output-resolution processing and
  segmented movie exports. Keep completed parts and resume interrupted renders
  after their project/media/settings checks pass. See [memory and recovery](TIMELINE.md#memory-and-recovery).

- **Desktop timelines:** animate effect controls with keyframes, easing and
  Bezier curves, audio analysis and LFOs. Scrub external video, mix audio, set
  effect ranges and animated seeds, and export movies, GIFs, PNG sequences and
  flip books. Still images and saved projects continue to work in Image mode.
- **Shared timeline runner:** desktop, CLI and TUI evaluate the same saved
  keys, modulation, active ranges and seeds at the original project times.
- **CLI timeline exports:** `gleech render animation.gleech --timeline -o movie.mp4`
  exports H.264 MP4 with audio. GIF and PNG sequences, whole/work/In-Out ranges,
  custom frame rates and reduced-width drafts are also supported. JSON results,
  cancellation and safe output replacement work for scripted exports.
- **TUI timelines:** `gleech tui animation.gleech` opens a silent live preview.
  Press `t` to switch image/timeline modes, focus the timeline with Tab to play
  or scrub, set ranges and export MP4, GIF or PNG. `Shift+T` opens Add Shader.
  Keyframe/modulator authoring, media attachment, duration and project FPS
  editing still use the desktop app.
- **Bundled FFmpeg:** all four desktop packages include the pinned FFmpeg build
  and terminal launchers. Desktop, CLI/TUI and local MCP use the embedded runtime;
  users do not need to install Node.js or FFmpeg separately.
- **Toolchain updates:** Node.js 22.23.4 for development/CI, Vite 7.3.7 and official
  Electron 45.1.0, embedding Node.js 24.22.1 and Chromium 156.0.8078.49.
  The temporary custom Electron backport is retired. Runtime probes now run
  against development and packaged executables; see the [runtime review](RELEASE.md#official-electron-runtime--2026-10-28).

External video and audio are referenced by path, rather than embedded in
`.gleech` projects. Keep those files available when moving a project between
machines. GPU features depend on the device and driver; imported WGSL/ISF
shaders require their supported GPU backends.

## Packages and terminal setup

Each release page includes its application artifacts, build manifests, updater
metadata, application/native/FFmpeg source materials and SHA-256 checksums:

- Windows x64: `GLEECH-0.2.0-x64-setup.exe` (NSIS).
- Apple Silicon: `GLEECH-0.2.0-mac-arm64.zip`.
- Intel Mac: `GLEECH-0.2.0-mac-x64.zip`.
- Linux x64: `GLEECH-0.2.0-linux-x86_64.AppImage`.

After installing the app at a stable path, install the terminal command once:

```powershell
# Windows PowerShell
& "<install folder>\resources\cli\gleech.cmd" install-cli
```

```sh
# macOS: extract the matching ZIP and copy GLEECH.app to Applications first.
"/Applications/GLEECH.app/Contents/Resources/cli/gleech" install-cli

# Linux
chmod +x GLEECH-0.2.0-linux-x86_64.AppImage
./GLEECH-0.2.0-linux-x86_64.AppImage --cli install-cli
```

For Linux without FUSE, prefix the launch/setup command with
`APPIMAGE_EXTRACT_AND_RUN=1`. Reopen the terminal after setup, then try:

```sh
gleech --version
gleech tui sample
gleech render animation.gleech --timeline -o movie.mp4
gleech render animation.gleech --timeline -o loop.gif --fps 15
gleech render animation.gleech --timeline -f png -o frames/
```

Run `gleech uninstall-cli` before moving or uninstalling the app. See the
[CLI/TUI guide](CLI.md), [timeline guide](TIMELINE.md), [Mac setup](MACOS.md),
[Linux setup](LINUX.md) and [known issues](KNOWN_ISSUES.md).

## Known security issue

Electron 45.1.0 includes BoringSSL code affected by
[CVE-2026-35189](https://github.com/google/boringssl/blob/main/docs/advisories/2026-09-29.md),
a low-severity certificate-processing denial of service. A crafted certificate
encountered during an HTTPS operation could exhaust memory, close GLEECH and lose
unsaved work. This can affect URL shader imports and network features such as
update checks. Local-file workflows avoid direct certificate processing;
automatic checks may still run. The upstream fix is not included in this release.
The maintainer accepted this disclosed risk for 0.2.0 only.

## Validation and provenance

- All six runtime probe groups passed on each of the four packaged targets.
- Frozen install, builds, formatting/lint/type checks, 2,157 unit tests and
  50 CI-policy tests passed. The production dependency audit reports zero
  advisories; the reviewed build-only `http-cache-semantics` finding remains.
- The full release plan passed all 291 hosted and 24 physical Windows GPU commands.
- Installed acceptance passed 28 automated lifecycle groups covering installation,
  project save/restart/export, masks, presets, all 74 local MCP tools, shader
  workflows, terminal setup/removal and uninstall preservation of artwork/profiles.
  Windows additionally passed eight normal-mode native-dialog, GPU-export,
  restart, Settings, shortcut and uninstall observations.
- All 2,057 tracked source files were verified against Git blobs, including one
  declared CMD line-ending conversion. Native review verified 403 source/build
  archives and 842 packaged notices. Redacted source/history scans found no leaks.
- The final validation-tooling JavaScript CodeQL job succeeded and uploaded its
  results, but GitHub timed out processing the upload and the aggregate check
  remained neutral. The preceding scan was clean; only test/job time budgets
  changed afterward. No check bypass or suppression was used.

macOS/Linux acceptance uses isolated smoke profiles and file-picker fixtures.
Physical Mac/Linux GPU hardware, SmartScreen/Gatekeeper download approval, Mac
notarization, Linux FUSE and Omarchy/Wayland are not certified by these tests.
Linux passed with the documented AppImage extraction fallback under Xvfb.
Installed terminal setup on Mac/Linux exercises isolated Bash profiles; other
shell profiles retain their existing unit-test coverage.

All three release tags point to `54a121703968804b93d8fa2be4d9a43801a728d5`.
The source ZIP uses `aac84caf2c0f18bd12ff305ea80d73d8652c3eed` with the same
tree. Actual binary build commits and package hashes are retained in each
release's build manifests and `SOURCE-PROVENANCE.json`. The maintainer approved
the disclosed exception and final publication; the temporary custom Electron
backport remains excluded.
