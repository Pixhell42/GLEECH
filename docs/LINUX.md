# Experimental Linux x64 build

Build with Node.js 22.16.0 and pnpm 10.11.1. On Omarchy with mise:

```sh
mise install node@22.16.0
mise exec node@22.16.0 -- corepack enable
mise exec node@22.16.0 -- corepack pnpm install --frozen-lockfile
mise exec node@22.16.0 -- corepack pnpm pack:linux
./apps/desktop/release/linux-unpacked/gleech
```

The unpacked directory contains the runtime and must remain intact. `dist:linux`
builds a portable AppImage in `apps/desktop/release/`. This is experimental x64 support; ARM64 and other
Linux distributions have not been validated. Public packages are experimental
alphas and retain original third-party notices and the reviewed native sources.

Sharp's versioned libvips shared objects must be unpacked beside its native
binding, so electron-builder explicitly unpacks `node_modules/@img/**`.
Packaging includes the Linux ONNX runtime and excludes Windows/macOS binaries.
The Intel-only Mac alias is excluded entirely. Original native-package notices
and the source-backed libvips notice inventory are included in
`resources/linux-native-notices`; retained upstream texts are in `resources/licenses`.
The complete native component version list must match the reviewed source bundle.

## Alpha builds

The **Linux Omarchy alpha build** Actions workflow builds a native x64 AppImage
on Ubuntu 22.04, checks production advisories and source/code checks, verifies
packaged Sharp and CPU subject inference, and runs image/MCP/client tests under
a virtual display. It also exercises the actual AppImage and saved MCP settings
across a restart. Hosted tests use CPU rendering; they do not certify Omarchy's
GPU drivers or replace the contributor's physical Omarchy results.

Each successful artifact contains the AppImage, `linux-build-x64.json` and its
SHA-256 checksum. Run manually from Actions or through a packaging pull request.
The workflow uses read-only permissions and does not publish releases.

## AppImage

```sh
pnpm dist:linux
chmod +x apps/desktop/release/GLEECH-*-linux-x86_64.AppImage
./apps/desktop/release/GLEECH-*-linux-x86_64.AppImage
```

Omarchy's `fuse2` package supplies the FUSE library required by this AppImage
runtime. Keep the executable bit when copying the file. For the optional GPU
mode, pass the same three Vulkan flags listed below directly to the AppImage.

AppImages mount at a different temporary path on each launch. MCP configurations
therefore use a private, stable `mcp-appimage/runtime` link under the app's user-data
directory. Enabling MCP refreshes it to the current mounted runtime; copied
client settings survive subsequent launches. The app must remain open and MCP
still starts Off. This does not grant file or clipboard access.

## Local MCP

Open **MCP · AI control**, choose a mode and copy the client configuration from
that running build. The server uses the app's embedded runtime and a private
Unix socket. Linux client instructions use home-directory paths. MCP is Off at
launch; file operations retain the existing approved-folder rules.

GitHub sign-in for native bug reports and feature requests requires a supported
desktop keyring (GNOME Secret Service or KWallet). GLEECH refuses to store tokens
when Electron selects its `basic_text` fallback or cannot identify a secure
backend. Enable your desktop keyring before signing in; core editing and local
MCP do not require GitHub sign-in.

## Native verification

Run these from the project directory with the pinned Node runtime, inside the
logged-in graphical session:

```sh
pnpm check
node tooling/smoke.mjs apps/desktop/release/linux-unpacked/gleech
GLEECH_TEST_NATIVE_FRAMES=1 node tooling/mcp-check.mjs apps/desktop/release/linux-unpacked/gleech --cpu
GLEECH_TEST_NATIVE_FRAMES=1 node tooling/mcp-check.mjs tooling/run-linux-webgpu.sh
GLEECH_TEST_NATIVE_FRAMES=1 node tooling/mcp-clients-check.mjs apps/desktop/release/linux-unpacked/gleech
GLEECH_TEST_NATIVE_FRAMES=1 node tooling/appimage-check.mjs apps/desktop/release/GLEECH-*-linux-x86_64.AppImage
```

The existing native-frame test option keeps isolated test windows compositing;
without it, hidden-window captures can stall under Hyprland. It does not replace
rendering or relax pixel assertions. GPU availability depends on the adapter and
driver; retain a separate CPU fallback result. Normal application launches do
not use this test option or Playwright's launch flags.

### Timeline and media

The native Linux job runs both complete desktop timeline suites against the
actual AppImage under a virtual display before uploading it. FFmpeg is required,
so media tests cannot silently skip. The suites exercise animation and undo,
curves, transport, seeded frames, ranges, GIF/MP4 and PNG sequence exports,
video/audio import, audio-driven controls, project reload and media paths with
spaces and Unicode. Each run records its packaged runtime and rendering backend.

```sh
# Native CPU fallback in a graphical session:
node tooling/timeline-check.mjs apps/desktop/release/linux-unpacked/gleech --cpu --require-ffmpeg
node tooling/timeline-media-check.mjs apps/desktop/release/linux-unpacked/gleech --cpu --require-ffmpeg
# The opt-in Vulkan launcher on a physical, supported GPU:
node tooling/timeline-check.mjs tooling/run-linux-webgpu.sh --require-webgpu --require-ffmpeg
node tooling/timeline-media-check.mjs tooling/run-linux-webgpu.sh --require-webgpu --require-ffmpeg
```

To test a delivered package, substitute its AppImage path for the executable.
`--require-webgpu` rejects CPU fallback; hosted CPU checks do not certify a
particular Omarchy compositor or GPU driver.

## Optional Vulkan / WebGPU launch

The default Chromium launch may not expose a WebGPU adapter on Linux even when
OpenGL acceleration works. On the tested Omarchy dev / AMD GCN-4 configuration,
the optional launcher enables a real hardware WebGPU adapter:

```sh
./tooling/run-linux-webgpu.sh
```

This uses XWayland under Hyprland. It does not require `--enable-unsafe-webgpu`,
`--ignore-gpu-blocklist`, a sandbox override, or system driver changes. Treat it
as an opt-in launch mode; it is not a promise for all Linux adapters. Check the
actual adapter and image output on the target machine. Use `--disable-gpu` for
CPU fallback. Built-in effects have CPU implementations; imported WGSL shaders
require a working WebGPU adapter.

The launcher sets `--ozone-platform=x11`, `--use-angle=vulkan` and
`--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan`. A native compute
probe identified AMD GCN-4 with `isFallbackAdapter=false` and correct readback;
the full MCP GPU suite then passed, including imported WGSL rendering and exports.
The CPU counterpart passed separately. These are bounded tests on the stated
hardware, not long-duration driver or hardware qualification.
