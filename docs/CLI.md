# Terminal CLI and TUI

GLEECH also runs in a terminal. `gleech` renders images headlessly for scripts
and batches, and `gleech tui` opens an interactive editor with a live preview.
Both use the desktop app's own project model, command history, presets and CPU
renderer, keeping effect semantics and portable `.gleech` projects shared
with the app. GPU output can vary slightly across devices and drivers.

## Run it

From a source checkout (Node.js 22.16.0, pnpm 10.11.1):

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

These launchers are included in builds containing the CLI/TUI feature.
Published 0.1.1 downloads predate it. The Windows launcher restores interactive
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
with repeatable `--shader <name|local file>` or press `t` in the TUI.
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

| Keys                      | Action                                              |
| ------------------------- | --------------------------------------------------- |
| `↑↓` `j k`                | select layer / parameter                            |
| `tab` `⏎` `esc`           | move between stack and inspector                    |
| `space`                   | toggle a layer                                      |
| `⇧↑ ⇧↓` `J K`             | move a layer                                        |
| `← →` (`⇧` for big steps) | adjust the selected parameter                       |
| `⏎` on a parameter        | type an exact value                                 |
| `⌫`                       | reset the parameter to its default                  |
| `a` / `p`                 | add an effect / apply a preset                      |
| `g` / `G`                 | roll a GLEECH / GLEECH options                      |
| `r` `l` `D` `d`           | reseed, lock, duplicate, delete a layer             |
| `u` `U` (`^z` `^y`)       | undo / redo                                         |
| `v` / `f`                 | compare with the original / focus preview           |
| `z` `Z` / `O`             | zoom, fit / open full res in your viewer            |
| `n` `[` `]`               | new, previous, next master seed                     |
| `e` / `s` `S` / `o`       | export / save (as) `.gleech` / open                 |
| `b` / `t`                 | Cycle Auto/GPU/CPU / add a local or library shader. |
| `?` / `q`                 | all keys / quit                                     |

The mouse works too: click layers and their on/off dots, click or drag sliders,
click choices to cycle them and scroll lists. Slider gestures group into one
Undo step, as they do in the app.

## Limits

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

`pnpm test:cli` builds and checks CPU workflows plus required WebGPU/WebGL2 shader
workflows. `node tooling/cli-check.mjs --cpu` runs the CPU lane;
`--require-gpu` exercises real shader compilation, mixed stacks and pixel-exact
project/preset round-trips. A positional packaged executable checks its bundled
CLI. Windows full CI includes both source and packaged checks in the matching
hosted/physical-GPU lanes. Mac/Linux interactive terminal behavior still needs
platform testing.
