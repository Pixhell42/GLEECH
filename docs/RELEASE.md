# Beta release checklist

## Current checkpoint

Version 0.2.0 is being prepared for Windows x64, macOS arm64/x64 and Linux x64,
including the bundled CLI/TUI and FFmpeg. The
[candidate notes and remaining gates](RELEASE-0.2.0.md) track this preparation.
Publication is on hold pending verified coverage of the October 21 Node.js
security fixes in a stable Electron runtime; see the runtime review below.

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

- [ ] Review the clean source candidate and its file manifest against the intended
      public branch. Retain the existing public history and platform-specific changes.
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
- [x] The public repository is `Pixhell42/GLEECH`; release links use that destination.
      Preserve its public history and keep private reference material excluded.
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

## Runtime security review — 2026-10-21

The build/CI Node.js baseline is 22.23.4, including the workspace engine minimum
and all workflows that read `.node-version`. This is the
[October 21 security release](https://nodejs.org/en/blog/release/v22.23.4/),
covering DNS input validation, TLS hostname checks, Brotli decoding, HTTP agent
handling, snapshot randomness and the permission model.

Packaged desktop, CLI/TUI and MCP processes use Electron's embedded Node.js,
independently of the build machine's Node. Electron is pinned to
[44.9.3](https://releases.electronjs.org/release/v44.9.3), which includes upstream
Chromium/V8 fixes and still reports Node.js 24.22.0. Its tagged source also
contains a
[Node TLS certificate-blocklist backport](https://github.com/electron/electron/blob/v44.9.3/patches/node/tls_reject_chains_containing_blocked_public_keys.patch)
that rejects chains containing blocked public keys.

This does **not** establish coverage of every fix in
[Node.js 24.22.1](https://nodejs.org/en/blog/release/v24.22.1/). A loopback-only
`dns.Resolver.resolve4` probe with an embedded NUL confirms that standalone
22.23.4 rejects the name synchronously with `ERR_INVALID_ARG_VALUE`, while
Electron 44.9.3 still attempts DNS resolution. The DNS input-validation fix
(CVE-2026-105482) therefore remains outstanding in this embedded runtime.
Electron's public release notes and tagged Node patch list did not confirm the
other October 21 Node fixes. Recheck upstream release/backport evidence before
publication; the toolchain update alone does not close embedded-runtime review.

The production npm audit on this dependency set reports zero advisories; it
does not audit Electron's embedded Node/Chromium. The initial full audit also
identified Vite 7.3.6 development-tool advisories, addressed by the follow-up
below. The two packaging-tool advisories reviewed later remain outstanding.

## Vite security update — 2026-10-22

Vite is pinned to [7.3.7](https://github.com/vitejs/vite/releases/tag/v7.3.7),
with matching lockfile resolutions for the desktop build, React plugin,
Electron build tooling and Vitest. A frozen-lockfile install succeeds, and the
full dependency audit no longer reports the five Vite advisories identified
during the Node/Electron review.

The follow-up production audit reports zero advisories. The full audit reports
only the existing packaging-tool findings: high-severity `http-cache-semantics`
and moderate-severity `sprintf-js`, neither with a published patched version.

## MCP dependency security updates — 2026-10-24

The production audit began reporting newly indexed advisories in transitive MCP
SDK dependencies. The lockfile now selects `body-parser` 2.4.0 and `fast-uri`
3.1.9 within the existing compatible dependency ranges; `body-parser` also brings
`qs` 6.16.1. No MCP SDK or application version was changed.

- [body-parser security advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828):
  compressed request bodies with trailing bytes could terminate the process.
- [fast-uri 3.1.9 security release](https://github.com/fastify/fast-uri/releases/tag/v3.1.9):
  fixes four URI parsing and normalization advisories.

The follow-up `pnpm audit --prod` reports zero known vulnerabilities. This does
not change the outstanding Electron embedded-runtime review above.

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

- Windows x64 beta, with separate experimental macOS Intel/Apple Silicon and Linux x64 alphas.
- Development installers are unsigned. Automatic updates require supported
  installed release builds; public release publishing remains manual.
- Timeline mode animates controls and renders video, GIFs and sequences. FFmpeg
  is bundled for all release targets; an explicit user selection or PATH can also
  supply it. Clips and audio tracks are referenced by path, not embedded in projects.
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
