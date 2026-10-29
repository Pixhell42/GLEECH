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

## Upgrading from 0.1.2

0.1.2 does not contain the built-in desktop or terminal updater. Its first upgrade
to 0.2.0 is manual; publishing update metadata cannot add the missing updater to
an already installed 0.1.2 binary. The automatic-update behavior described here
starts with 0.2.0.

Save your work and close GLEECH and its terminal tools, then download the matching
0.2.0 package from the [release pages](RELEASE-0.2.0.md).

- **Windows:** run the new NSIS installer over the existing per-user installation
  at the same location. An uninstall is not needed for this upgrade.
- **macOS:** extract the correct Intel or Apple Silicon ZIP and replace the old
  `GLEECH.app` at its existing location in Applications. Keep the same app path.
- **Linux:** replace the old AppImage's contents at its existing path and make it
  executable. Keeping the old filename is supported, even if it includes `0.1.2`;
  the running version will be 0.2.0. Without FUSE, retain the documented
  `APPIMAGE_EXTRACT_AND_RUN=1` launch option.

Keep the existing user-data folder, projects and source media. Existing terminal
launchers point at the app's location: retaining that path avoids reinstalling
the command. If you instead move or rename the app/AppImage, rerun `install-cli`
from its new location and update any MCP client command paths you configured.
See [terminal setup](CLI.md) for the platform commands.

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

### Windows CLI in 0.2.0

The development fix detaches the updater helper while retaining its IPC approval
and terminal-exit gate. It requires a new package; it does not alter public 0.2.0.

Installed acceptance found that `gleech update --yes` can report a verified
download without completing installation after the terminal exits. For the
published Windows 0.2.0 package, use **Settings > Updates > Install & Update**
instead; the native desktop installation, relaunch and unsaved-session recovery
passed. Check the version after reopening. A verified download message alone
does not confirm that the new version is installed.

Release metadata cannot repair the updater inside an existing binary. A future
Windows package needs its own CLI handoff fix and installed acceptance; the
desktop updater can deliver that replacement package.

### Linux without FUSE

Development packages use a source-built AppImage runtime that creates a private
extraction directory per launch and removes it after that launch exits. They do
not require `NO_CLEANUP=1`. Runtime provenance, original notices, modified source
and relinking materials are included under `resources/appimage-runtime-notices`.
After installing a fixed release, remove `NO_CLEANUP=1` from its launch environment
so that these private extraction directories are removed automatically.
The following workaround remains necessary for the unchanged public 0.2.0 image.

The `APPIMAGE_EXTRACT_AND_RUN=1` fallback shares an extracted runtime between
launches of the same AppImage. In the published 0.2.0 package, running the CLI
while the desktop is open can remove that runtime on CLI exit, including the
desktop's `app-update.yml`. This can prevent the desktop updater from downloading
an update. This mode does not have an unconditional updater acceptance pass.

For extraction-mode desktop **and** terminal launches, set both environment
variables before starting GLEECH:

```sh
export APPIMAGE_EXTRACT_AND_RUN=1
export NO_CLEANUP=1
```

Close GLEECH and restart it with these variables if another launch has already
removed its runtime. The [AppImage documentation](https://docs.appimage.org/user-guide/troubleshooting/fuse.html#extract-and-run-type-2-appimages)
describes `NO_CLEANUP=1`: it retains the extraction cache, so it uses temporary disk
space until you remove the cache while all related processes are closed. This
workaround does not certify FUSE mounts or an Omarchy/Wayland desktop session.

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

0.2.0 is published with the disclosed, maintainer-accepted BoringSSL exception;
see the [release notes](RELEASE-0.2.0.md#known-security-issue). Future releases still
require their own review and final publication approval. Packaging commands
explicitly use `--publish never`; building does not publish a release.

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

The **Installed built-in updater acceptance** workflow exercises private sender
and receiver packages from the current application source on Windows x64, Apple
Silicon, Intel Mac and Linux x64 using normal default profiles. Private versions
0.2.1 and 0.2.2 are test fixtures and are never published. The sender contains the
real fixes without inspection code; the receiver adds inspection receipts and
fixture discovery routing. The workflow also installs the unchanged public 0.2.0
package and tests its desktop repair path to the fixed receiver.
Release discovery and downloads use loopback transport. The updater controllers,
integrity checks, recovery checkpoints and native install/quit paths remain real.
Mac replacement follows the manual ZIP flow above. Fixed Linux packages must
retain the desktop's files during CLI and duplicate desktop launches, complete
desktop and terminal updates, and clean up their private extraction directories
with `NO_CLEANUP` unset. The historical 0.2.0 failure reports remain separate.

The checks cover invalid release/manifest rejection, interrupted automatic
downloads, digest failure and retry, desktop and CLI installation, unsaved timeline
recovery, presets/preferences, original Save binding and matching exported pixels.
Reports retain sender/receiver hashes and known issues. CPU rendering, recorded
Finder selection and full downloads are used; physical GPUs, OS download prompts,
FUSE/Wayland and differential-download optimization require separate checks.
Every future release must still pass its package and metadata checks; this test
does not certify an unbuilt future version.
