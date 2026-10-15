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
adds an AppImage build target. This is experimental x64 support; ARM64 and other
Linux distributions have not been validated. Public distribution still needs
release and binary-redistribution review.

Sharp's versioned libvips shared objects must be unpacked beside its native
binding, so electron-builder explicitly unpacks `node_modules/@img/**`.
Packaging includes the Linux ONNX runtime and excludes Windows/macOS binaries.

## Local MCP

Open **MCP · AI control**, choose a mode and copy the client configuration from
that running build. The server uses the app's embedded runtime and a private
Unix socket. Linux client instructions use home-directory paths. MCP is Off at
launch; file operations retain the existing approved-folder rules.

## Native verification

Run these from the project directory with the pinned Node runtime, inside the
logged-in graphical session:

```sh
pnpm check
node tooling/smoke.mjs apps/desktop/release/linux-unpacked/gleech
GLEECH_TEST_NATIVE_FRAMES=1 node tooling/mcp-check.mjs apps/desktop/release/linux-unpacked/gleech --cpu
GLEECH_TEST_NATIVE_FRAMES=1 node tooling/mcp-check.mjs apps/desktop/release/linux-unpacked/gleech
GLEECH_TEST_NATIVE_FRAMES=1 node tooling/mcp-clients-check.mjs apps/desktop/release/linux-unpacked/gleech
```

The existing native-frame test option keeps isolated test windows compositing;
without it, hidden-window captures can stall under Hyprland. It does not replace
rendering or relax pixel assertions. GPU availability depends on the adapter and
driver; retain a separate CPU fallback result. Normal application launches do
not use this test option or Playwright's launch flags.
