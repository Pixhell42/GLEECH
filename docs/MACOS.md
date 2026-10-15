# GLEECH on macOS

The experimental macOS build targets Apple Silicon. Use Node.js 22.16.0 and pnpm 10.11.1:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm pack:mac
open apps/desktop/release/mac-arm64/GLEECH.app
```

Copy the app to `~/Applications` before configuring an MCP client, so rebuilding
or moving the checkout does not change the launcher. No separate Node runtime
is needed by the installed app or its MCP server. Packages are local, unsigned,
and not notarized; this is not a public macOS release or Intel compatibility claim.

## Agent connection

1. Launch GLEECH and open an image or use **Try sample image**.
2. In the hamburger menu, open **MCP · AI control**.
3. Choose **Edit** for reversible edits. Choose **Full Control** and approve
   specific Import, Project and Export folders when file operations are needed.
4. Select your MCP client, copy its configuration and merge the `gleech` entry
   into that client's settings. The Mac destination is shown in the panel.
5. Run **Test Connection**, close the panel, and reconnect your client.

MCP starts Off at each launch. Keep GLEECH open and re-enable the required mode
before reconnecting. Configuration contains paths, not the connection token.
The app uses authenticated local IPC, without an HTTP service or an API key.

## Still images for DaVinci Resolve

Use GLEECH to prepare backgrounds, textures, overlays, title treatments, or
paired clean/glitched images. Export PNGs into a dedicated folder approved in
GLEECH. Resolve can import those images and handle animation and transitions
on its timeline or in Fusion. GLEECH does not need to render video for this workflow.

For an agent, a useful starting request is:

> Inspect the project and effect parameters. Create three variations of this
> still image for a glitch transition, keeping the source dimensions and subject
> recognizable. Show previews, then export the chosen PNGs to the approved export
> folder. Preserve an editable GLEECH project. Import the selected images into
> Resolve and animate them only after inspecting the target timeline.

Read `get_project_state` before changing layers, use returned instance IDs and
revisions, and use `get_effect_parameters` instead of guessing parameter names.
GLEECH and Resolve have separate MCP servers; the agent coordinates their files.

## Verification

```sh
pnpm check
node tooling/smoke.mjs apps/desktop/release/mac-arm64/GLEECH.app/Contents/MacOS/GLEECH
node tooling/mcp-check.mjs apps/desktop/release/mac-arm64/GLEECH.app/Contents/MacOS/GLEECH
node tooling/mcp-check.mjs apps/desktop/release/mac-arm64/GLEECH.app/Contents/MacOS/GLEECH --cpu
node tooling/mcp-clients-check.mjs apps/desktop/release/mac-arm64/GLEECH.app/Contents/MacOS/GLEECH
```

Tests use isolated app profiles under `test-results/`. GPU and CPU results are
separate; successful packaging alone does not verify rendering or MCP.
