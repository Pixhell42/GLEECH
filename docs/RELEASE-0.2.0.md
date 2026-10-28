# GLEECH 0.2.0 release candidate

This release is in preparation. Windows remains a beta; macOS and Linux remain
experimental alphas. Packages are unsigned, and macOS builds are not notarized.
Publication requires final maintainer approval after the gates below pass.

## What changes from 0.1.2

The 0.2.0 candidate brings the completed desktop, CLI/TUI and platform work into
one source tree for Windows x64, macOS arm64/x64 and Linux x64. Rebuild every
package from this tree; earlier candidate binaries do not contain all these changes.

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

Prepare these application artifacts with their build manifests and SHA256 sums:

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

## Maintainer gates

- [ ] **Embedded runtime security:** official Electron 45.1.0 passes all six retained
      runtime probe groups on Windows x64. Verify the actual packaged executable on
      every target, retain provider/source evidence and the per-target reports.
      Electron 44.10.0 still fails the V8 JSON regression and is not the release pin.
      See the [current runtime review](RELEASE.md#official-electron-runtime--2026-10-28).
      That review still finds BoringSSL's CVE-2026-35189 fix missing from the
      linked provider. Publication stays on hold for an upstream fix or a reviewed
      applicability decision; the temporary custom patch is excluded.
- [ ] Freeze the integrated main and synchronized native port candidate commits;
      use the same application changes and Electron pin on every platform. Record
      each binary's actual source commit/tree. Build source
      ZIPs from tracked files at those commits, without local reference material.
- [ ] Frozen install, `pnpm check`, production build and production/full audits.
- [ ] Exact-candidate hosted Windows full lane and physical-GPU full lane;
      retain results covering the complete CI plan, including packaged CLI/MCP.
- [ ] Native macOS arm64 and x64 ZIP and Linux AppImage checks, including CLI,
      terminal launchers, timeline/media codecs, local MCP and packaged FFmpeg.
      Hosted CPU checks do not certify physical Mac/Linux GPU hardware.
- [ ] Inspect packages, source ZIPs, notices and secrets-scan results. Deliver
      application source, native corresponding source/build materials and FFmpeg
      corresponding source on each platform's release page. Revalidate pinned hashes
      and keep build provenance, native source instructions and artifact checksums.
- [ ] Installed launch, save/reopen/export and uninstall checks for the intended
      packages; confirm terminal setup and `t` / `Shift+T` behavior interactively.
- [ ] Final maintainer approval of release notes, source commits, signing status,
      tags and attachments. No release is published by preparing these materials.
