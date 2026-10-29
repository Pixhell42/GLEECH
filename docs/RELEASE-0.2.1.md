# GLEECH 0.2.1 release preparation

Status: candidate preparation; 0.2.1 has not been published. Windows remains a
beta and macOS/Linux remain experimental alphas. Packages are unsigned and macOS
builds are not notarized. The published 0.2.0 packages remain unchanged.

## Changes

- Windows CLI updates retain their detached helper until the terminal exits and
  installation completes. The approval and terminal-exit checks remain enforced.
- Linux AppImages use a private extraction directory per launch. Closing a CLI or
  duplicate desktop launch no longer removes another process's runtime. Cleanup
  removes each launch's own extraction directory after exit.
- The Linux launcher includes the argument-array bounds correction, descriptor
  limit correction, original notices, modified source and relinking materials.
- All targets retain the timeline, Settings and updater features from 0.2.0.

## Upgrade instructions

Save your work before installing. Preserve your user-data folder and app path.

- **Windows 0.2.0:** use Settings > Updates > Install & Update, or manually run
  the 0.2.1 installer over the existing per-user installation. The old CLI cannot
  reliably complete its own first upgrade. `gleech update --yes` is fixed in 0.2.1.
- **macOS 0.2.0:** download the verified ZIP for Intel or Apple Silicon, replace
  GLEECH.app at the same location in Applications, then reopen. Unsigned builds
  still use this manual replacement step.
- **Linux 0.2.0 without FUSE:** keep `APPIMAGE_EXTRACT_AND_RUN=1` and
  `NO_CLEANUP=1` while using the old image to update. After installing 0.2.1,
  remove `NO_CLEANUP=1` so each private extraction is cleaned up. Keep the same
  AppImage path to preserve installed terminal and MCP launchers.
- **0.1.2 on every platform:** the first upgrade is manual because those binaries
  do not contain an updater. Install the matching 0.2.1 package at the existing path.

## Known security issue

The candidate retains official Electron 45.1.0 (Node 24.22.1 and Chromium
156.0.8078.49). On October 29, 2026, the latest stable Electron still pins
BoringSSL revision `2ea3200c3a3ec176613ab7a0b9a4ffc6db846120` and its BoringSSL
patch list does not backport the fix for
[CVE-2026-35189](https://github.com/google/boringssl/blob/main/docs/advisories/2026-09-29.md).
The affected TLS certificate-verification paths remain reachable on all targets.
A crafted certificate can cause excessive memory allocation, terminate GLEECH
and lose unsaved work, including during shader imports or update checks.
Ordinary certificate rejection does not prevent the affected processing.

The renewed source review is complete. On October 29, 2026, the maintainer
explicitly accepted this disclosed risk for 0.2.1 only, including possible app
termination and unsaved-work loss. That clears the BoringSSL hold for this version;
package checks and final publication approval remain separate. Reassess before
the next release, when an official compatible runtime includes the fix, or if
severity, exploitation evidence or network/runtime inputs change.

Primary references: [Electron releases](https://github.com/electron/electron/releases),
[Electron runtime dependencies](https://github.com/electron/electron/blob/v45.1.0/DEPS),
[Chromium dependencies](https://github.com/chromium/chromium/blob/156.0.8078.49/DEPS),
[Electron BoringSSL patches](https://github.com/electron/electron/blob/v45.1.0/patches/boringssl/.patches).

## Release gates

- Build unmodified 0.2.1 packages on Windows x64, macOS arm64/x64 and Linux x64.
- Retain each exact package hash, generated update metadata and source inputs.
- Run installed-package and updater acceptance against those exact candidates,
  including the public 0.2.0 first hop and private next-version updater fixtures.
  Private instrumented 0.2.2 receivers must never be published.
- Review CI, source archives, native source/relinking materials, notices,
  provenance, checksums and all architecture-specific manifests.
- Resolve the BoringSSL hold and obtain final approval for the exact release plan
  before creating public tags or publishing platform releases.
- After publication, verify public downloads, asset digests and updater discovery.

Hosted acceptance uses CPU rendering and file-picker fixtures. Physical Mac/Linux
GPUs, SmartScreen/Gatekeeper prompts, notarization, Linux FUSE and Omarchy/Wayland
require separate verification; hosted extraction-mode results do not certify them.

## Candidate evidence

The installed-updater workflow retains uninstrumented 0.2.1 candidate packages
separately from reports. The candidate acts as the sender for future-update
checks; the instrumented private 0.2.2 receiver tests native installation,
checkpoint recovery and CLI handoff. A separate first-hop check installs the
exact public 0.2.0 package and updates to the retained 0.2.1 candidate.
Publication must use the retained, hash-verified candidates rather than rebuilds.
