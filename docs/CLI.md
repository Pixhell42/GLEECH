# Terminal CLI and TUI

GLEECH also runs in a terminal. `gleech` renders images and timelines for scripts
and batches, and `gleech tui` opens an interactive editor with a live preview.
Both use the desktop app's own project model, command history, presets and CPU
renderer, keeping effect semantics and portable `.gleech` projects shared
with the app. GPU output can vary slightly across devices and drivers.

## Run it

From a source checkout (Node.js 22.23.4, pnpm 10.11.1):

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm cli --help
pnpm cli tui photo.jpg
```

`pnpm build` also builds the CLI. Packaged builds include it with GLEECH's
embedded runtime; no separate Node.js install is needed:

### Install the terminal command

Run the command for your package once, without administrator privileges:

- **Windows (PowerShell):** `& "<install folder>\resources\cli\gleech.cmd" install-cli`
- **macOS:** `"/Applications/GLEECH.app/Contents/Resources/cli/gleech" install-cli`
- **Linux AppImage:** `./GLEECH-<version>-linux-x86_64.AppImage --cli install-cli`
- **Linux unpacked:** `./resources/cli/gleech install-cli`

On Linux, make the AppImage executable first with `chmod +x <file>.AppImage`.
The AppImage also accepts direct commands: `./GLEECH.AppImage --cli tui photo.jpg`.
It uses the app's embedded runtime with the mount kept alive for the terminal
session; no extraction or Node installation is needed. On systems without FUSE,
prefix the install command with `APPIMAGE_EXTRACT_AND_RUN=1`. The installed launcher keeps extraction output separate from CLI output, including JSON and interactive terminal rendering. Direct scripted no-FUSE invocations can use `GLEECH_CLI_RESTORE_STDOUT=1 ./GLEECH.AppImage --cli <command> 3>&1 >/dev/null` alongside that environment variable.

Close and reopen your terminal application after installation, then run
`gleech --help` or `gleech tui sample`. Windows adds a managed launcher in
`%LOCALAPPDATA%\GLEECH\bin` and adds that directory to the current user's PATH.
macOS/Linux install `~/.local/bin/gleech` and a marked PATH block in the user's
shell startup files (Bash, Zsh or Fish, plus the POSIX login profile). Existing
commands are never overwritten, and unrelated shell settings are preserved.

Run `gleech uninstall-cli` before moving or uninstalling the app. Run
`install-cli` again after moving or replacing it at a different path. AppImage
launchers point to the original image file rather than a temporary mount.
Setup is explicit: ordinary desktop launches never change PATH.

The 0.1.2 packages introduced these launchers; 0.2.0 adds shared timeline exports
and TUI timeline playback and export. The Windows launcher restores interactive
console input without a separate Node installation. Native terminal behavior
still varies by host.

## Rendering modes and imported shaders

- **Auto** (default): use the shared background GPU renderer for shader stacks;
  CPU-only effects run directly. Built-in shaders can fall back to CPU.
- **GPU**: require available GPU shader backends and report failures.
- **CPU**: no GPU helper. Built-in shaders use their CPU implementations.

Use `--renderer auto|gpu|cpu` or `GLEECH_RENDERER`. The TUI's `b` key
cycles the mode and refreshes its preview. `gleech info --json` reports WebGPU
and WebGL2 availability; `--renderer cpu` skips probing.

Imported WGSL and supported single-pass ISF shaders run through the desktop's
WebGPU and WebGL2 implementations. They remain embedded in projects/presets,
including original creator/license metadata. Browse `gleech shaders`; add one
with repeatable `--shader <name|local file>` or press `Shift+T` in the TUI.
Raw imports use the same parser/subset as the desktop. No URL fetching is added.

```sh
pnpm cli render sample --shader apps/desktop/resources/shaders/prism-weave.gleech-shader --renderer gpu -o prism.png
pnpm cli tui project.gleech --renderer auto
```

An imported shader that cannot run fails the render. To deliberately bypass it
on CPU, pass `--skip-unsupported-shaders`; the output includes a warning.

The helper stays alive throughout a batch or TUI session, uses an isolated
profile, and closes when the session ends. It does not open or modify a running
desktop project. GPU availability still depends on OS, drivers and hardware.

## Commands

| Command                   | What it does                                                     |
| ------------------------- | ---------------------------------------------------------------- |
| `gleech tui [file]`       | Interactive editor. `gleech` alone (in a terminal) opens it too. |
| `gleech render <inputs…>` | Render images, folders or `.gleech` projects to files.           |
| `gleech gleech [input]`   | Roll random GLEECH stacks, reproducible by seed.                 |
| `gleech vary <input>`     | Render close/medium/distant variations of a stack.               |
| `gleech effects [search]` | Browse the effect catalog by category.                           |
| `gleech effect <id>`      | Parameters, units, ranges and defaults for one effect.           |
| `gleech presets [search]` | Built-in presets and your personal preset library.               |
| `gleech inspect <file>`   | The layer stack of a `.gleech` project or preset.                |
| `gleech shaders [search]` | Browse bundled and personal imported shaders with credits.       |
| `gleech info`             | Runtime, codec, resources and terminal capabilities.             |

Every command has `--help`. Listing, inspection and render commands accept
`--json` for scripts. Use `sample` as an input to try the bundled statue image.

### Rendering

```sh
gleech render photo.jpg -p signal-burn                      # → photo-gleech.png
gleech render shots/ -p "liquid glass" -o out/ -f webp -q 85
gleech render photo.png -e "pixel-sort:amount=70%,direction=90" -e crt --show
gleech render project.gleech -o final.tiff
gleech render photo.jpg -p prism-garden --save-project photo.gleech --save-preset mine.gleechpreset
```

- `-p, --preset` accepts a built-in name or slug, a preset from your library, or a
  `.gleechpreset` file. Repeat it to stack presets; `--place` sets how the first one
  lands (`replace`, `above`, `below`, `merge`), matching the app.
- `-e, --effect type[:key=value,…]` adds an effect on top. Types can be IDs
  (`pixel-sort`) or titles (`"Pixel Sorting"`). Values use the inspector's units:
  `60%`, `45`, `vertical`, `#ff3366`. Application keys work too
  (`coverage=50%`, `region=subject`). `gleech effect <id> --all` lists every key.
- `--seed` sets the master seed. `--max-size` renders a reduced draft that keeps
  field and pattern placement aligned with the full image.
- Outputs never replace existing files unless you pass `-y/--overwrite`.

### Timeline exports

Use `--timeline` with one saved `.gleech` project to export its animation through
the shared desktop/terminal timeline runner:

```sh
gleech render animation.gleech --timeline -o movie.mp4
gleech render animation.gleech --timeline -o loop.gif --fps 15
gleech render animation.gleech --timeline -f png -o frames/
gleech render animation.gleech --timeline --range work --width 960 -o draft.mp4
gleech render animation.gleech --timeline --start 1.5 --end 4 --fps 24 -o segment.mp4 --json
```

MP4 uses H.264, the timeline's frame rate and the source dimensions (rounded to
even pixels). GIF defaults to 15 FPS and at most 480 pixels wide; its available
rates are 10, 12, 15, 24 and 30. PNG sequences contain 8-bit frames at the
timeline's rate, named `<project>_0001.png` onward in a dedicated output folder.
Choose PNG sequences explicitly with `-f png`; otherwise `.mp4`/`.gif` select
the format, with MP4 as the default. Without `-o`, exports go beside the project.

`--range whole|work|inout` selects the full timeline, work area or saved In/Out
points. The default is `whole`; `--start` and `--end` override its boundaries in
timeline seconds (start inclusive, end exclusive). Keys, active ranges,
modulators and animated seeds evaluate at those original timeline times.
`--width` preserves the source aspect ratio. MP4/PNG accept `--fps` from 1–240.

Video projects decode their external clip, holding its final frame when the
timeline outlasts it. MP4 mixes the audible audio track and the clip's own sound,
with saved track levels and mute state. Use `--no-audio` for silent MP4; GIF and
PNG sequences are always silent. Audio-driven effects use the project's saved
analysis even with `--no-audio`. External media must still exist; relative paths
resolve beside the project. Missing clips fail clearly instead of rendering
their poster image.

The same `--renderer`, shader and stack options work for timeline frames. Native
Sharp is required; movies, GIFs and video sources also need FFmpeg. The CLI reads
the desktop's FFmpeg selection, then tries the bundled copy and PATH. PNG
sequences from still sources work without FFmpeg.

Progress goes to stderr; `--json` writes the result to stdout, including frame
count, range, dimensions, backends, warnings and output size. Ctrl+C cancels with
exit code 130 and removes temporary output. Existing output is preserved until
encoding succeeds. `-y` replaces a movie or a complete frame sequence; sequence
replacement requires a dedicated folder containing only that project's numbered
PNGs. Folders containing unrelated files are refused.

Timeline mode accepts one project at a time. Still-only options such as
`--quality`, `--show`, `--max-size` and `--save-preset` are rejected. Ordinary
`render project.gleech` continues to export the base still stack.

### GLEECH rolls and variations

```sh
gleech gleech photo.jpg -n 9 --sheet sheet.png -o rolls/
gleech gleech photo.jpg --seed 3735928559 -c gleeched --show
gleech vary photo.jpg -p prism-garden -o vars/ --sheet vars.png
```

Each roll prints its seed and a command to reproduce it. `--save-preset` writes a
`.gleechpreset` beside every roll so a favourite can be imported into the app.

## The TUI

The editor has the app's layout: the stack on the left, the live preview in the
middle and the inspector on the right. A fast draft re-renders as you edit; when
you pause, terminals that can show images get a sharp render at the preview's
real pixel size. While you edit, kitty and iTerm2-style terminals receive the
small draft and scale it themselves, and sixel terminals show half-blocks, so
every step stays live. Exports always render the full-resolution image.

### Terminals

GLEECH asks the terminal what it supports when the TUI starts (kitty graphics
query, DA1 for sixel, XTWINOPS for the cell size) and combines the answer with
known terminal IDs:

| Terminal                            | Preview                             |
| ----------------------------------- | ----------------------------------- |
| Windows Terminal 1.22+              | sixel images                        |
| Warp (macOS, Linux)                 | iTerm2 inline images                |
| iTerm2, WezTerm                     | iTerm2 inline images                |
| kitty, Ghostty                      | kitty graphics                      |
| foot, Konsole, xterm (sixel builds) | sixel images, when advertised       |
| Alacritty (Omarchy's default)       | truecolor half-blocks               |
| macOS Terminal                      | half-blocks; truecolor on macOS 26+ |
| tmux, screen, Zellij, anything else | half-blocks                         |

Override detection with `GLEECH_GRAPHICS=kitty|iterm|sixel|blocks` and the cell
size with `GLEECH_CELL=10x20` (pixels) if a terminal answers incorrectly. The
header shows the mode in use; `?` shows the detected terminal. Warp on Windows
falls back to half-blocks unless its DA1 reply advertises sixel.

### Zoom

`z` cycles fit → 1:1 → 2:1 → 4:1 and `Z` returns to fit; the mouse wheel over the
preview does the same. Zoomed views render the full-resolution image, so 1:1
shows every exported pixel. Drag the preview to pan, or press `f` for focus
mode (panels hidden) and pan with the arrow keys. `O` renders the full image and
opens it in your system's image viewer.

| Keys                      | Action                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `↑↓` `j k`                | select layer / parameter                                    |
| `tab` `⏎` `esc`           | move between stack and inspector                            |
| `space`                   | toggle a layer                                              |
| `⇧↑ ⇧↓` `J K`             | move a layer                                                |
| `← →` (`⇧` for big steps) | adjust the selected parameter                               |
| `⏎` on a parameter        | type an exact value                                         |
| `⌫`                       | reset the parameter to its default                          |
| `a` / `p`                 | add an effect / apply a preset                              |
| `g` / `G`                 | roll a GLEECH / GLEECH options                              |
| `r` `l` `D` `d`           | reseed, lock, duplicate, delete a layer                     |
| `u` `U` (`^z` `^y`)       | undo / redo                                                 |
| `v` / `f`                 | compare with the original / focus preview                   |
| `z` `Z` / `O`             | zoom, fit / open full res in your viewer                    |
| `n` `[` `]`               | new, previous, next master seed                             |
| `e` / `s` `S` / `o`       | export / save (as) `.gleech` / open                         |
| `b` / `Shift+T`           | Cycle Auto/GPU/CPU / add a local or library shader.         |
| `t`                       | Switch image / timeline mode; create a timeline if needed.  |
| `?` / `q`                 | all keys / quit                                             |
| `,` / `F2`                | Settings: updates, donations, feedback, community and About |

The mouse works too: click layers and their on/off dots, click or drag sliders,
click choices to cycle them and scroll lists. Slider gestures group into one
Undo step, as they do in the app.

### Timelines

Open a saved timeline with `gleech tui animation.gleech`. The TUI opens in
timeline mode and evaluates saved keys, active ranges, modulation and animated
seeds through the same runner as desktop and CLI exports. External video clips
stream through FFmpeg and hold their last frame after the clip ends.

Press `t` (without Shift) to switch between image and timeline mode. On an image
without a timeline, `t` creates a default timeline that you can undo or save. Use `tab` to
cycle between stack, inspector and timeline; the footer shows the focused
panel's controls. With the timeline focused:

- `space` plays or pauses; `← →` step one frame, `⇧← ⇧→` step one second.
- `home` / `end` seek to the first / last frame; `g` enters a time in seconds.
  Click or drag the timeline rail to scrub, or scroll over it to step frames.
- `i` / `o` set In / Out, including the displayed frame at Out. `w` copies
  In / Out to the work area; `W` clears it. `r` cycles the available ranges and
  `L` toggles looping. Playback follows the selected range.

Playback is silent and samples exact project frames at up to 15 FPS. Complex
stacks may play more slowly. Seeking and playback leave project history alone;
range and loop edits support undo. The rail shows markers and the selected
effect's saved keyframes.

In timeline mode, `e` opens export settings for MP4, GIF or a PNG sequence.
Choose the range, FPS, width, audio and output path with arrows / `tab`, then
press Enter on Render. MP4 can include the saved audio track and clip sound;
GIF and PNG are silent. Exports use the chosen FPS at full output resolution.
Existing output requires a second Enter to replace; Escape cancels an active
export and preserves prior output. `E` exports the current frame as an image,
and `O` opens that frame at full resolution in your image viewer. Switch to
image mode with `t` to preview or export the base image stack. `Shift+T` opens
Add Shader in either mode.

### Settings and updates

Press `,` or `F2` in either image or timeline mode to open Settings. Use `1`–`5`
or the up/down arrows to select Updates, Donate, Feedback, Community or About.
Tab or the right arrow moves into the actions; Enter activates one. Page Up/Down
scrolls longer content, and Escape returns to the project. Settings pauses
timeline playback without changing the project or playhead.

Terminal update notifications are on by default. The TUI shares the desktop's
GitHub release selection rules, checks after startup and every six hours, and
supports manual checks, per-version dismissal and What's New notes. Its toggle
is independent of desktop updates and is stored in `tui-updates.json` alongside
the desktop user data. `GLEECH_USER_DATA` isolates it for tests or a separate
terminal profile. It does not change presets, shader libraries or recent files.

Interactive CLI commands also show available-update notices on stderr. Checks are
cached for six hours, with a short timeout and offline retry backoff. Pipes, JSON,
CI, help and version output remain quiet. CLI notices honor the terminal Settings
toggle and dismissed version. Set `GLEECH_NO_UPDATE_NOTIFIER=1` to suppress notices
for individual commands or a shell profile. Explicit checks work with notices off.

Run `gleech update` to check, download, verify and install the release, including
its CLI and TUI. It asks for confirmation first; `--yes` approves installation
in scripts. `gleech update --check` only checks, and `--check --json` returns a
machine-readable result. `gleech update --help` documents these options.

In the TUI, choose **Settings → Updates → Install & Update…**. Confirm the update,
then save, discard or cancel if there are unsaved changes. Download progress is
shown in the TUI; Escape cancels. Failures leave the current session available.
After verification, the TUI restores the terminal and exits before installation.
Run `gleech` again when installation finishes; reopen your saved project as usual.

Save and close other GLEECH sessions before updating. Installation is blocked
while the desktop app or another updater is open. Both terminal interfaces use
the desktop's release selection, integrity checks and installer engine. Windows
requires the installed NSIS build. Linux replaces the original AppImage at its
existing path, preserving terminal launchers. macOS reveals the verified ZIP in
Finder for app replacement at the existing location. Development and unpacked
test builds cannot overwrite an installed release. Presets, shaders, recent files,
configured paths and terminal preferences remain in the existing user data folder.

Donate exposes the same payment destinations and support links;
Feedback opens the bug/feature form in your browser for review and submission.
Community opens Discord, and About includes the version, repository and bundled
license documents. QR codes and waveform buttons remain desktop UI. Saved LFOs
of all five shapes continue to play and export through the shared timeline runner.

## Limits

- Creating and editing keyframes, modulators, clip/audio attachments, timeline
  duration and project FPS still require the desktop app. The TUI plays and
  exports saved animation and edits playback ranges; its preview is silent.
- CPU fallback applies to built-in effects. Imported shaders require their GPU
  backend or explicit skipping. Unsupported imported shader programs fail clearly.
- Reading JPEG/WebP and writing JPEG/WebP/TIFF, the JPEG Recompression effect and
  subject detection use the app's native codecs (Sharp and ONNX Runtime). Without
  them, the CLI still reads and writes PNG with a built-in codec. `gleech info`
  shows what is available. The PNG fallback supports non-interlaced images,
  assumes sRGB and does not perform ICC profile conversion.
- Subject-based masks detect the subject on first use, like the app, and saved
  projects keep the detected mask.
- Colors follow `NO_COLOR`/`FORCE_COLOR`. The TUI needs at least 72×20 cells.
  `--show` uses the same image protocols as the TUI, without querying the terminal.
- Sixel is limited to 256 colors per frame, so Windows Terminal previews use a
  dithered palette; kitty and iTerm2 images are full color. With a dialog open,
  kitty previews switch to half-blocks because kitty draws images above text.

## Verification

Prepare the pinned FFmpeg bundle with `pnpm ffmpeg:prepare` before media checks.
`pnpm test:cli` builds and checks CPU workflows plus required WebGPU/WebGL2 shader
workflows. `node tooling/cli-check.mjs --cpu` runs the CPU lane;
Add `--require-ffmpeg` to require MP4/GIF, external clip and audio export checks;
PNG timeline checks always run. `--require-gpu` exercises real shader compilation, animated timelines, mixed stacks and pixel-exact
project/preset round-trips. A positional packaged executable checks its bundled
CLI. Windows full CI includes both source and packaged checks in the matching
hosted/physical-GPU lanes. Mac/Linux interactive terminal behavior still needs
platform testing.
