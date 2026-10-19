# Development and verification

## Supported baseline

Windows x64, Node.js 22.16.0 (`.node-version`), pnpm 10.11.1 (`packageManager`).
Use PowerShell. The current Electron/React/Sharp/ONNX Runtime versions are pinned
in the workspace manifests and `pnpm-lock.yaml`. Packaged apps include their runtime.
Sharp and ONNX Runtime use Windows prebuilt binaries; the standard checkout does
not need a native compiler or an external inference service.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` watches source. `pnpm build` builds main/preload/renderer and the bundled
MCP server and terminal CLI/TUI. `pnpm start` launches the last build, so rebuild after source changes.

## Checks

```powershell
pnpm check
pnpm build
node tooling/smoke.mjs
node tooling/image-check.mjs
node tooling/image-check.mjs --cpu
```

`check` runs publication-content and build-tool scope checks, Prettier, ESLint, all workspace types,
Vitest and the Windows/Mac CI-plan tests. CPU-heavy unit tests use one worker in CI
and at most four locally. Exhaustive render/variation sweeps use independently
timed cases. Avoid interpreting a timeout as an image correctness assertion.

Each `test:*` script in root `package.json` defines a maintained integration
suite. Most rebuild first; when running several suites, build once and invoke
their `node tooling/...` commands directly. Test scripts use isolated profiles;
test artifacts and logs stay under ignored `test-results/`.

Useful focused suites include `test:editing`, `test:project`, `test:presets`,
`test:preset-transfer`, `test:snapshots`, `test:painted-mask`, `test:sliders`,
`test:set2`, `test:beta-ui`, `test:menu`, `test:support`, `test:file-metadata`,
`test:mcp`, `test:mcp-clients` and `test:github-feedback`. Check the current script
names/flags in the root manifest before invoking an unfamiliar suite.
Feedback tests mock GitHub; they do not submit live reports.

## Windows packaging

```powershell
pnpm pack:win
# Or build an installer and its unpacked app in one operation:
pnpm dist:win
```

Output: `apps/desktop/release/win-unpacked/GLEECH.exe` and
`GLEECH-<version>-x64-setup.exe`. Keep the unpacked directory intact. The installer
is per-user, supports choosing a directory and is currently unsigned. Do not
install/uninstall it automatically during general verification; use an explicit
hands-on installation check or an isolated target machine.

```powershell
node tooling/smoke.mjs apps/desktop/release/win-unpacked/GLEECH.exe
node tooling/image-check.mjs apps/desktop/release/win-unpacked/GLEECH.exe
node tooling/image-check.mjs apps/desktop/release/win-unpacked/GLEECH.exe --cpu
node tooling/painted-mask-check.mjs apps/desktop/release/win-unpacked/GLEECH.exe --cpu
node tooling/support-check.mjs apps/desktop/release/win-unpacked/GLEECH.exe --cpu
node tooling/file-metadata-check.mjs apps/desktop/release/win-unpacked/GLEECH.exe --cpu
node tooling/mcp-clients-check.mjs apps/desktop/release/win-unpacked/GLEECH.exe
```

Some renderer benchmarks are development-only. See script argument handling
before passing an executable; do not invent packaged support for those tools.

## macOS packaging

For experimental native Intel and Apple Silicon packaging and verification, see
[macOS development](MACOS.md). Run `pnpm pack:mac` or `pnpm dist:mac` with native
Node.js on the target architecture; the Intel subject-detection runtime is pinned
separately from Windows and Apple Silicon.

## CI

Routine PRs/main pushes run static/unit checks followed by one build and the
essential smoke/image/editing/project/preset-transfer/MCP/UI-color/CLI workflows.
Core image checks use CPU so hosted runners need no promised hardware GPU.
Docs-only changes retain static/unit checks but skip desktop build/integration.
Code and quick desktop jobs each allow 60 minutes. The final `validate` check
requires the code checks and the selected desktop suite to succeed; skipped,
cancelled or failed required jobs cannot produce a passing validation result.
A canceled workflow skips the final gate instead of launching another job that
fails solely because its dependencies were canceled. Genuine failures still run
the gate and fail validation.

Actions → Windows development checks → Run workflow → **full** runs supported
development and packaged integration scripts across twelve shards, with at most
six running at once. Each shard builds/packages once and allows 120 minutes.
The complete plan is distributed exactly once across the shards, retaining
all script flags and supported executable variants.
Hosted full runs select `--lane hosted`: CPU and adapter-independent workflows.
Checks that deliberately require WebGPU/imported GPU programs run separately on
a physical GPU with the same built app and unpacked package:

```powershell
node tooling/windows-ci.mjs full --lane gpu --packaged apps/desktop/release/win-unpacked/GLEECH.exe
```

Both lanes are release requirements. Archive their result files and verify their
source commit matches the intended release tree. A hosted green check alone does
not prove GPU acceptance. The complete plan (default `--lane all`) retains every
original command, including strict shader checks. CI-plan tests require the two
lanes to partition that plan exactly once and keep a CPU counterpart for every
GPU-only workflow. Physical GPU pixel assertions are unchanged; software GPU
emulation is not substituted for physical-adapter validation.

On hosted CI, the shared test launcher keeps isolated smoke windows transparent,
nonactivating and outside the taskbar so Chromium delivers native compositor
frames. They ignore desktop mouse input; Playwright still drives the real UI.
This avoids the 1 Hz frame delivery seen after canvas resizing in hidden windows.
Production launches are unchanged. To use the same test-only mode locally, set
`$env:GLEECH_TEST_NATIVE_FRAMES='1'` before running checks. Without that opt-in,
local smoke windows remain hidden. Window/frame behavior is never mocked.

Publishing a release tag does not start another CI run. Complete hosted full
validation and physical-GPU acceptance for the intended release tree before
publishing; retain the results with the release artifacts. Full validation is
selected only through **Run workflow → suite: full**. Manual runs default to
quick even when targeting a tag; the ref name never selects the suite.

Quick mode stops at its first integration failure. Full mode records failures and continues the
remaining checks; every shard must pass the final validation gate. This reports
multiple failures without repeatedly waiting through the same prefix of tests.
Per-shard failure diagnostics expire after three
days. Package upload is off by default. For an explicit manual full run, enable
**upload_package** only after reviewing binary
redistribution requirements; uploaded package artifacts expire after seven days.
These are development artifacts, not an automatic public release/publishing pipeline.

PR checks use disposable GitHub-hosted Windows runners, a read-only token and a
checkout that does not persist credentials. Keep signing keys, release tokens
and protected deployment environments out of this workflow. Review outside
contributors before approving their runs; do not switch these checks to
`pull_request_target` to execute contributor code with elevated permissions.

## Assets and generated code

Approved icon sources live under `assets/branding/`. `node tooling/build-icon.mjs`
and `--beta` rebuild PNG/ICO resources. `APP_IS_BETA` in shared branding controls
the UI/window marker; stable packaging also requires updating the three icon
paths in `electron-builder.yml`.

`generate-depth-maps.mjs` and `generate-vector-maps.mjs` rebuild numerical map
assets; use the script's supported subset flags when preserving existing IDs.
`generate-builtin-presets.mjs` rebuilds preset recipes/thumbnails. Generated
shader kernels come from the maintained `.kernel` source and its generator;
regenerate their CPU/GPU forms together. Commit intentional deliverable assets
and generated source required by builds; exclude bundles, caches and personal files.

## Version and data

The desktop package version supplies the menu label and file metadata. Reports
include the running app version automatically. Keep root/workspace versioning
consistent when preparing a release, and tag only the validated release commit.
Data formats have their own schema/effect versions; changing the app version does
not change their contracts. See [file formats](FILE_FORMATS.md).

## Public preparation

Use [the release checklist](RELEASE.md). Private development history is not a
publication source: prepare a reviewed clean snapshot with fresh history. Keep
source reviews, generation prompts, local boards, personal projects and secrets
outside published files. `public:content:check --history` supplements a redacted
secrets scan; it is not a complete security certification. See [security policy](../SECURITY.md).

`node tooling/prepare-public-snapshot.mjs public-release/candidate` copies only
reviewed tracked/new source paths into a new ignored directory, verifies every
file hash and writes a manifest beside it. Existing targets are refused. Git
history, remotes, dependencies and output are not copied. Initialize fresh history
and perform a clean install/check/build in that candidate before deciding how to
publish it; this helper never pushes or changes repository visibility.
