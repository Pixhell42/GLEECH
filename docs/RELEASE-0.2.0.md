# GLEECH 0.2.0 release candidate

This release is in preparation. Windows remains a beta; macOS and Linux remain
experimental alphas. Packages are unsigned, and macOS builds are not notarized.
Publication requires final maintainer approval after the gates below pass.

## What changes from 0.1.2

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
- **Toolchain updates:** Node.js 22.23.4 for development/CI, Vite 7.3.7 and
  Electron 44.9.3. Electron's embedded Node security review remains open below.

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

- [ ] **Embedded runtime security:** verify a stable Electron release covers the
      October 21 Node.js security batch, including CVE-2026-105482. Electron 44.9.3's
      loopback DNS NUL-validation probe still reproduces the missing fix. The
      [runtime review](RELEASE.md#runtime-security-review--2026-10-21) records the
      evidence. Do not describe this candidate as fully patched or publish it while
      this hold remains unresolved.
- [ ] Freeze the Windows/main and native port candidate commits, preserve port
      differences and record each binary's actual source commit/tree. Build source
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
