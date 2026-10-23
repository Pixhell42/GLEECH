# GLEECH on macOS

The experimental macOS build targets Intel or Apple Silicon, matching the native
Node.js architecture. Use Node.js 22.23.4 and pnpm 10.11.1:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm pack:mac
# Intel:
open apps/desktop/release/mac/GLEECH.app
# Apple Silicon: open apps/desktop/release/mac-arm64/GLEECH.app
```

Copy the app to `~/Applications` before configuring an MCP client, so rebuilding
or moving the checkout does not change the launcher. No separate Node runtime
is needed by the installed app or its MCP server. Packages are local, unsigned,
and not notarized; this is not a public macOS release.

`pnpm dist:mac` creates `GLEECH-<version>-mac-x64.zip` on Intel or
`GLEECH-<version>-mac-arm64.zip` on Apple Silicon. Build on each native architecture
with a fresh dependency installation so Sharp and Electron match the target.

Intel subject detection uses the pinned `onnxruntime-node-macos-x64` alias of
ONNX Runtime 1.22.0 because newer npm releases omit Darwin x64 binaries. Windows
and Apple Silicon continue using 1.30.0. The alias loads only for Intel inference;
both versions use the same bundled model and CPU execution provider. Its
install-only proxy helper shares the existing pinned global-agent 4.1.3 dependency.
The older runtime's license and notices are retained under `LICENSES/onnxruntime/1.22.0`.
Its install-only ZIP helper is overridden to the existing patched adm-zip 0.6.1.

## Separate alpha builds

The **macOS alpha builds** Actions workflow builds separate Apple Silicon
(`arm64`) and Intel (`x64`) ZIPs from the same source commit. It runs on native
macOS 15 runners, installs dependencies from the frozen lockfile, checks production
advisories, and verifies the packaged app before uploading artifacts. Run it
manually from **Actions → macOS alpha builds → Run workflow**. Relevant packaging
pull requests also run it automatically.

Each artifact contains the ZIP, a SHA-256 checksum and a build record naming its
source commit and architecture. Download the artifact matching the Mac's processor,
extract the artifact and then the GLEECH ZIP, and copy `GLEECH.app` to `~/Applications`.
These are unsigned, unnotarized test builds; the workflow does not publish a release.

The packages retain original licenses and a native-package notice inventory in
`Contents/Resources/mac-native-notices`. The libvips npm packages omit original notice texts; their complete component
version lists must match the retained source-review baseline before the collector
uses checked-in original upstream notices in `Contents/Resources/licenses`.
The generated inventory records each source archive and verifies every retained
notice hash. The selected ONNX runtime also uses retained upstream LICENSE and
ThirdPartyNotices texts, checked against hashes verified from the corresponding
official ONNX version tags. This notice check does not replace native binary/source compatibility
or redistribution review for a public Mac release.
The build checks verify their hashes, native executable architecture, Sharp image
processing, CPU subject inference and ZIP integrity. Packaged smoke, image, MCP and
client-configuration tests run before artifact upload. Hosted CPU checks complement
the contributor's physical Intel/Apple Silicon GPU testing; they do not certify
GPU performance, vendor client login flows or the broader native UI checklist.

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

## Settings and terminal support

The Settings feature branch includes the same inline Donate/Feedback screens,
responsive QR views, LFO waveform icons and version notes as Windows. On these
unsigned Mac builds, updates download the matching Intel or Apple Silicon ZIP;
Install & Update saves the working session, quits and reveals the ZIP in Finder
for replacement of the app. See [application updates](AUTOMATIC-UPDATES.md).

The packaged CLI/TUI shares the terminal Settings panel (`,` or F2), update
checks, support/community links, browser feedback forms and bundled license
documents. Saved LFO shapes continue to play and export through the shared
timeline runner. Native CI runs the packaged update, donation and feedback
checks on both Mac architectures. These changes remain separate from the
previously frozen release candidates until integrated and revalidated.

## Verification

```sh
pnpm check
# Intel; use release/mac-arm64 on Apple Silicon.
gleech_executable=apps/desktop/release/mac/GLEECH.app/Contents/MacOS/GLEECH
node tooling/smoke.mjs "$gleech_executable"
node tooling/image-check.mjs "$gleech_executable"
node tooling/image-check.mjs "$gleech_executable" --cpu
node tooling/mcp-check.mjs "$gleech_executable"
node tooling/mcp-check.mjs "$gleech_executable" --cpu
node tooling/mcp-clients-check.mjs "$gleech_executable"
```

Tests use isolated app profiles under `test-results/`. GPU and CPU results are
separate; successful packaging alone does not verify rendering or MCP.

Validated on an Intel Xeon W-3245 Mac Pro with macOS 26.6.2 on 2026-10-15:
native x86_64 packaging, packaged smoke, image import/effects/clipboard/lossless
export on AMD WebGPU and forced CPU, GPU device-loss recovery, all 62 MCP tools
on both rendering backends (including subject detection), and all eight MCP
client launcher/configuration profiles. Vendor UI/login flows and the broader
native UI/release checklist still need separate validation.
