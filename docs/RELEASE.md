# Beta release checklist

## Current checkpoint

Windows x64 app/NSIS installer builds and packaged GPU/CPU image/mask workflows,
menus, version metadata, MCP profiles and bundled assets have passed. The user
confirmed installation and uninstallation on 2026-10-14. The refreshed support
panel has also passed packaged link/layout checks. These are development checks,
not a public release announcement.

Release validation uses the intended source commit, a frozen dependency install,
code checks, hosted Windows CI and packaged startup, image/export and MCP checks.
Keep the source manifest, secret-scan results, artifact checksums and native
source/notice review together in the maintainer's release record. Repository
visibility and release publication require a separate final maintainer decision.
Passing development checks does not publish a release.

## Before publication

- [ ] Review the clean source candidate, its file manifest and fresh one-commit history.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm check`, build and packaged checks
      from the intended release tree. Verify generated assets and documentation links.
- [ ] Require both the hosted full CI lane and the physical-GPU full lane to pass
      for the release tree. Preserve their result records; their combined command
      coverage must match the complete plan. Hosted CI alone does not validate GPU shaders.
- [ ] Run redacted secrets scans on the clean tree and all of its history. Inspect
      archives for local paths, private reference material, credentials and extra files.
- [x] Review ownership/provenance and credits for shipped artwork, shaders, fonts and maps.
      Preserve dependency, model, Electron/Chromium and native-library notices.
      The [asset review](ASSETS.md) records 283 media/sample files, three catalogs,
      all embedded preset maps, model/test-image credits and payment-mark boundaries.
      New or changed assets require updated provenance and hashes before release.
- [x] Review native-library corresponding-source/relinking materials before distributing
      binaries. MIT on GLEECH does not replace LGPL/native dependency terms.
      CI package uploads are opt-in; keep them off until this review is complete.
      Pinned source/build archives, original notices and an ABI-preserving
      replacement test are complete. The eight-package source-graph attribution
      review and independent source rebuild are recorded. The actual rebuilt DLL
      passed startup, 4K CPU image processing and all five export/metadata checks.
      The final source review added fourteen compiler/build-tool archives and
      runtime/embedded notices: 403 original archives in total. Five excluded
      crates' publisher notice omissions remain documented for the full source bundle.
      The [source-bundle review](../LICENSES/native-components/SOURCE-BUNDLE-REVIEW.md)
      records release delivery requirements; see also the
      [native release steps](../LICENSES/img-sharp-win32-x64/0.35.5/NATIVE-RELEASE.md).
- [x] Review production and full dependency advisories and record accepted scope
      or fixes. Revalidate intentional dependency changes.
      The two packaging advisories remain unpatched; maintained checks enforce
      the reviewed configuration in [the build-tool review](BUILD_TOOL_REVIEW.md).
- [ ] Choose the public repository/history transition and update any destination
      URLs or GitHub App installation required by that choice.
- [ ] Configure main/port/tag protections, Issues, private vulnerability reporting,
      PR/issue templates and public-contributor Actions approval/permissions.
- [x] Pin third-party Actions to verified immutable commits before public launch;
      retain readable version comments and review updates through PRs.
- [ ] Build from the exact release commit; choose version/tag, publish release notes,
      artifact hashes and supported OS/architecture labels. Review signing status.
      Attach the application and native source ZIPs on the same release page;
      verify all archive hashes, native binaries, copied notices and source links
      against that exact release. Material preparation does not publish a release.
- [ ] Test installed launch, shortcuts/icons, save/reopen/export, presets/shaders,
      masks, local MCP and uninstall without deleting artwork/projects unexpectedly.
- [ ] Publish source and binaries only after final review/approval.

## Dependency audit baseline — 2026-10-14

The production `pnpm audit --prod` scan reported zero known advisories.
The full audit found two unpatched transitive packaging-tool advisories:

- [http-cache-semantics](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), high,
  through electron-builder → app-builder-lib → @electron/get → got/cacheable-request.
- [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), moderate,
  through electron-builder → app-builder-lib → @electron/get → global-agent/roarr.

These are build-tool dependencies, not current production dependencies. The
advisories list no patched versions. Keep build/PR runners disposable, tokens
read-only and signing/publishing isolated. The reviewed reachability and ongoing
checks are recorded in [the build-tool review](BUILD_TOOL_REVIEW.md). Keep the
advisories visible and reassess changes; scan results age and are not a security guarantee.

## Known limitations

- Windows x64 only; Linux/macOS and other architectures are not released.
- Development installers are unsigned; no automatic updater/public publishing job.
- Still images only; Phase chooses a saved frame. Video/GIF animation, shader
  playback/export, animation tools and timeline editing are waiting for design.
- Built-in shaders have CPU fallback; imported WGSL/ISF needs WebGPU/WebGL2.
- Imported shader support is a bounded single-function/single-pass subset.
- Global drawing/blank layers, new polygon/Bezier tools, Image Size and Canvas Size
  are waiting for design; legacy saved drawing data retains render/storage compatibility.
- Subject masks estimate foreground locally and may need painted refinement.
- Large mixed stacks and full-resolution exports can take time; preview and GPU
  limits depend on hardware. Metadata can be removed by other editing/sharing tools.
- Native feedback needs GitHub sign-in. HTTP/hosted MCP is deferred.

## GitHub settings

Require PRs and passing validate on main, resolve conversations and block force
push/deletion. With a solo maintainer, do not require an unavailable second
reviewer. Protect shared port branches; add native required checks once reliable.
Restrict release-tag creation/modification, keep workflow PR tokens read-only and
require appropriate approval for outside contributors. Avoid persistent privileged
self-hosted runners for untrusted PRs. Port branches start from the clean main;
old private branches/tags are never merged into fresh public history.
