# Packaging-tool advisory review

Reviewed 2026-10-14 against the pinned Windows build configuration. Revisit this
assessment when dependencies, download options, proxy logging or CI permissions change.

## Dependencies and exposure

electron-builder/app-builder-lib 26.15.3 uses @electron/get 3.1.0, which brings in
Got 11.8.6 and its HTTP cache dependencies, plus global-agent 3.0.0 and Roarr 2.15.4.

- [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
  affects http-cache-semantics 4.2.0. The vulnerable stale-response reuse requires
  an HTTP response cache. Got's response cache is disabled by default, and GLEECH
  does not enable it in the builder configuration. Electron's downloaded-file
  cache is a different mechanism and is not this HTTP policy cache.
- [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
  affects sprintf-js 1.1.3 when a caller supplies an excessive numeric precision
  in a format string. In the inspected proxy logger, all fourteen logging calls
  use literal format strings; URLs and other values are context data. CI also
  explicitly disables Roarr logging with `ROARR_LOG: 'false'`.

The upstream advisories still list no patched releases. These packages remain
installed development dependencies; the review does not patch or suppress them.
The inspected packaged app excludes electron-builder, app-builder-lib,
http-cache-semantics and sprintf-js from its runtime archive. Production and
full audit results must still be reviewed independently for each release.

## Maintained safeguards

`pnpm build:tool:check`, included in `pnpm check`, verifies the reviewed dependency
versions, response-cache defaults, builder configuration, literal proxy log
formats and disabled CI logging. It fails when those assumptions change so an
upgrade cannot silently inherit the old assessment.

After packaging, also check runtime exclusion:

```powershell
node tooling/build-tool-review.mjs apps/desktop/release/win-unpacked
```

The check writes source digests and scope evidence to ignored
`test-results/build-tool-review.json`. It is a configuration/reachability check,
not a proof that arbitrary dependency code is safe.

Keep PR runners disposable, tokens read-only and checkout credentials absent.
Keep signing/publication separate from contributor code. Do not enable HTTP
response caching or pass untrusted strings as logging formats without reviewing
the advisories again. Local packaging runs should leave `ROARR_LOG` disabled.

## Upgrade decision

The currently published builder still declares @electron/get `^3.0.0`. Forcing
@electron/get 5.1.0 would switch its default downloader from Got to Fetch while
the builder supplies Got-specific timeout/agent options. A successful ordinary
download alone would not validate timeout, proxy and TLS behavior. No major
override or audit exclusion was introduced. Prefer a supported upstream migration
or a narrowly reviewed fix, followed by fresh download and Windows package tests.
