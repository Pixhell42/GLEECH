# Contributing to GLEECH

Read the [user guide](docs/USER_GUIDE.md), [architecture](docs/ARCHITECTURE.md)
and [shared roadmap](docs/ROADMAP.md). Windows x64 is currently supported.

## Changes

1. Open an issue for a substantial feature or compatibility change.
2. Create a focused feature/fix branch; Codex-created branches use `codex/`.
3. Keep shared packages independent of Electron/React and native services behind typed IPC.
4. Run `pnpm check` and `pnpm build`. Add meaningful regression coverage for changed behavior.
5. Run smoke/UI checks for Electron/preload/renderer changes, image/export checks
   for rendering changes and package checks for dependency/packaging changes.
6. Describe the problem, resulting behavior, validation and material limitations in the PR.

Preserve recipe determinism, alpha, stable IDs, original-resolution exports and
grouped history. Validate untrusted files/inputs and retain old format compatibility
or reject unsupported versions explicitly. Regenerate CPU/GPU kernels together.
Do not weaken checks to hide assertion failures; distinguish wall-clock test
timeouts from correctness and include evidence for scheduling changes.

Only commit intentional source, required deliverable assets and maintained docs.
Keep generated bundles, dependencies, caches, test outputs and personal files out
of Git. Include `pnpm-lock.yaml` with intentional dependency changes. No source
reviews, generation prompts, private references or local review boards belong
in the public checkout. Disclose new assets/dependencies and retain license notices.

Project-owned changes are contributed under [MIT](LICENSE). You must have the
rights to contribute your code/assets; third-party content keeps its own terms.
Report security issues privately through [SECURITY.md](SECURITY.md).

## Linux AppImage packaging

Build Linux x64 AppImages on a native Linux x64 host with Docker available to the
build user, including a running Docker daemon. The before-pack hook builds the
pinned AppImage launcher in an isolated Alpine container and caches it under
`test-results/appimage-runtime/`. Docker is a build dependency; running GLEECH
does not require Docker.

The runtime build checks argument forwarding and retains original notices,
modified source and relinking materials in `resources/appimage-runtime-notices/`.
It verifies that the source archive contains the files needed by its Docker build
and relink script. Preserve that directory when redistributing Linux packages.
