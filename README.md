# GLEECH

It's not broken. It's just a GLEECH.

GLEECH is a desktop image editor for procedural corruption, distortion
and stylization. Stack filters and shaders, paint masks, explore variations and
keep your work editable in portable projects.

## Beta status

Windows x64 is the supported development and testing target. An experimental
macOS build for Intel and Apple Silicon and an experimental Linux x64 build
include local MCP support. This is a
still-image editor. Video/GIF animation, shader playback/export, animation tools
and timeline editing are planned and waiting for design.

The current library contains **109 built-in effects**, including **46 original
shaders**, **29 starter presets**, **40 depth maps** and **40 vector maps**.
Imported shaders are additional library entries. See the [effect inventory](docs/EFFECTS.md).

## Run the app

Download a Windows package from [Releases](https://github.com/Pixhell42/GLEECH/releases)
when a release is published. Development installers are unsigned. An unpacked
build can be run through `GLEECH.exe` with its accompanying folders intact.
Packaged builds include their runtime; Node.js and pnpm are only needed to build
from source. GPU features depend on your graphics hardware and driver.

Start with **Try sample image**, or **Library → Open sample image** in the
hamburger menu. Open your own image, drag one onto the canvas, or paste with Ctrl+V.
Use the plus icon in the Effects panel to browse filters and presets.

The [user guide](docs/USER_GUIDE.md) covers effects, masks, presets, snapshots,
exports and local AI control. [Known limitations](docs/RELEASE.md#known-limitations)
describe the beta's current boundaries.

See [Known Issues](docs/KNOWN_ISSUES.md) for current bugs and areas being tuned.

## Build from source

### macOS (Intel and Apple Silicon)

The experimental macOS build targets the build machine's architecture and includes local MCP over a Unix socket.
Use Node.js **22.16.0** and pnpm **10.11.1**, then:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm pack:mac
# Intel:
open apps/desktop/release/mac/GLEECH.app
# Apple Silicon: open apps/desktop/release/mac-arm64/GLEECH.app
```

Copy `GLEECH.app` to `~/Applications` for a stable launcher/MCP path. The app
contains its own runtime. This local build is unsigned and not notarized.
`pnpm dist:mac` also creates a ZIP. Build with native Node.js on each architecture;
see [Mac setup](docs/MACOS.md) for runtime differences and verification.

Open **MCP · AI control**, choose a control mode, and copy the configuration for
your client. MCP starts Off on every launch. See [Mac setup and Resolve workflow](docs/MACOS.md).

### Linux x64

Use Node.js **22.16.0** and pnpm **10.11.1**:

```sh
pnpm install --frozen-lockfile
pnpm pack:linux
./apps/desktop/release/linux-unpacked/gleech
```

Keep the unpacked directory intact. See [Linux setup](docs/LINUX.md) for Omarchy,
native testing and the current portability limits.

### Windows

Use Windows PowerShell, Node.js **22.16.0** and pnpm **10.11.1**.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Useful commands:

- `pnpm check` — publication-content check, formatting, lint, types, unit tests and CI-plan checks.
- `pnpm build` and `pnpm start` — build and run the desktop app.
- `pnpm pack:win` — create an unpacked Windows app.
- `pnpm dist:win` — create the Windows app and development NSIS installer.

Build output is under `apps/desktop/out/`; packages are under
`apps/desktop/release/`. These generated files are excluded from Git.
See [development instructions](docs/DEVELOPMENT.md) for verification commands.

## Local MCP

Open **MCP · AI control** in the hamburger menu. Choose permissions, select your
client and copy its configuration or connection-help prompt. GLEECH must stay
open. The bundled stdio server controls the active project through the same
editing and rendering engine as the UI. See [MCP setup](docs/MCP.md).
HTTP transport and hosted/cloud integrations are deferred.

## Community and contributions

- [Discord Community](https://discord.gg/b7Mq8fjvk)
- [Bug reports](https://github.com/Pixhell42/GLEECH/issues) and feature requests through GitHub or the native Feedback panel.
- [Contributing](CONTRIBUTING.md), and [security reporting](SECURITY.md).
- [Shared product roadmap](docs/ROADMAP.md) for Windows, Linux and macOS.

## License and credits

GLEECH's project-owned source is licensed under [MIT](LICENSE). Third-party
dependencies and the bundled subject-detection model retain their own terms;
see [third-party notices](THIRD_PARTY_NOTICES.md). Shader imports preserve supplied
creator and license metadata; importing a file does not grant redistribution rights.
