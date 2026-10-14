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
