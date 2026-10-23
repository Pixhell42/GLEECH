# Settings and application updates

Open **Settings** from the hamburger menu. Updates is the first section; Donate,
Feedback, Community and About bring together the existing support links, GitHub
feedback flow, Discord community, version information and license documents.
Donate contains the payment choices, QR codes and support links directly in Settings.
Feedback contains the bug/feature tabs, GitHub sign-in and report form. Drafts survive
switching sections and reopening Settings; neither screen opens another app modal.

The TUI exposes the corresponding text controls with `,` or `F2`: Updates,
Donate, Feedback, Community and About. It shares release discovery, supports
default-on automatic update notices, manual checks, dismissal and patch notes,
and opens support/community links and GitHub feedback forms in the browser.
Terminal preferences use their own `tui-updates.json` file to avoid concurrent
desktop/TUI preference writes. Installation stays with the desktop updater or
the release page; save terminal work before installing. See [CLI/TUI settings](CLI.md#settings-and-updates).

Automatic updates are on by default. Installed builds check the public
`Pixhell42/GLEECH` GitHub releases after startup and every six hours. They download
eligible new versions in the background and show a dismissible notification in
the lower-left corner. **Install & Update** opens progress and applies the verified
download after checkpointing the working project. Closing progress before the
checkpoint starts leaves the download running without installing.

Turning automatic updates off stops automatic checks, background downloads and
notifications. **Check for updates now** remains available in installed builds;
manual downloads and installation still work. Dismissing a notification hides
that version while leaving it accessible in Settings.

## Platform behavior

- **Windows:** installed per-user NSIS builds update through electron-updater,
  then reopen. Unpacked test builds cannot update an existing installation.
- **Linux:** the original AppImage updates in place and reopens. Its filename and
  path stay stable, including versioned filenames, so installed CLI/TUI launchers
  and MCP command paths continue working. The replacement is staged in the same
  directory and renamed atomically. Package-managed and extracted copies need a
  manual update.
- **macOS:** these unsigned builds download the architecture-matching ZIP. Install
  saves the session, quits GLEECH and selects the verified ZIP in Finder. Extract
  it, replace GLEECH.app at the same location, then reopen. Fully automatic macOS
  installation requires signed application bundles; signing checks are not bypassed.

Development and smoke-test processes never download or install real updates.
Automatic checks only select newer versions, the matching platform/architecture,
and releases that include that architecture's update metadata and GitHub asset
SHA256 digest. Draft releases are ignored. Beta/alpha builds may use prerelease
releases with matching assets. Stable builds ignore prereleases. Same-version
development builds do not replace one another through the updater.

## Project and preference retention

The app ID, product name and existing user-data directory remain unchanged. NSIS
does not remove user data. Existing presets, shader imports, recents, FFmpeg
configuration, export permissions, UI preferences and terminal setup stay in place.

Update files are restricted to direct children of the locally configured data,
installation and download directories. Recovery/settings reads and AppImage
replacement reject symlinked files. Custom data folders and AppImage filenames,
including paths with spaces and Unicode, remain supported.

Immediately before installing, GLEECH stops playback and writes a separate,
embedded `.gleech` recovery checkpoint in `userData/update-recovery`, including
the working effect stack, images, snapshots, timeline, unsaved state and original
document binding. It does not overwrite the user's saved project. An active
operation or render queue blocks installation. A checkpoint failure prevents
installation and leaves the running app open.

The next launch reopens that checkpoint and restores Image/Timeline mode and the
playhead. Unsaved edits remain unsaved, and Save still targets the original file.
The checkpoint is acknowledged only after the renderer has loaded it successfully.
A failed restore retains the recovery data. Video/audio files remain external
references at their original paths, as with ordinary project saves.

The What's New dialog uses the downloaded release's plain-text notes when present,
or the version's bundled notes. Acknowledgement is recorded per installed version.
Update `shared/release-notes.ts` with each release for offline/manual installs.

## Publishing requirements

This feature branch does not publish releases or alter the staged 0.2.0 candidates.
Packaging commands explicitly use `--publish never`. The existing Electron security
publication hold remains in effect.

Each platform's release must attach the binary and its generated update manifest:

- Windows x64: `latest-x64.yml` and `GLEECH-<version>-x64-setup.exe`.
- Mac arm64: `latest-arm64-mac.yml` and `GLEECH-<version>-mac-arm64.zip`.
- Mac Intel: `latest-x64-mac.yml` and `GLEECH-<version>-mac-x64.zip`.
- Linux x64: `latest-x64-linux.yml` and `GLEECH-<version>-linux-x86_64.AppImage`.

Attach generated `.blockmap` files when present, together with the existing source,
notices, provenance and checksum release materials. Separate architecture channels
avoid one Mac job replacing the other architecture's metadata. Keep metadata and
binaries on the same GitHub release, and do not edit generated manifest hashes.
The GitHub asset digest must be present. Windows/Linux validate the manifest's
version, filename, size and SHA512, then independently check the GitHub SHA256;
Mac downloads check the size and GitHub SHA256 before revealing the ZIP.

Run `node tooling/update-package-check.mjs <resources> <release-directory>` against
the actual artifacts inside the build workspace before publication. The verifier
resolves symlinks and rejects paths outside the workspace or the selected artifact
directory. Mac and Linux CI retain update metadata
alongside their packages and exercise the settings/recovery UI with isolated data.

## Development checks

`pnpm test:updates` exercises settings navigation, support/license links, all five
LFO shape icons, persisted opt-out, notification dismissal, progress, checkpointing,
original-file retention, restart recovery and once-per-version release notes.
Its network and installer are fixtures; it never installs a release or changes
the user's normal data. Pass an unpacked executable to `tooling/updates-check.mjs`
to run the same flow against packaged code. Native install/relaunch acceptance
still requires real installed test machines before public release.
