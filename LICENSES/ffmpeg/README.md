# Bundled FFmpeg

GLEECH distributes FFmpeg 9.0.2 as a separate executable from the pinned
NevermindNilas/TAS-FFMPEG v9.0.2 release. This GPL-2.0-or-later build includes
x264 and x265. GLEECH does not link against its libraries. GLEECH's own source
remains MIT; FFmpeg and its dependencies retain their separate terms.

The exact binary/source URLs, sizes and SHA-256 checksums for Windows x64,
Linux x64 and macOS x64/arm64 are recorded in `bundle.json` beside this file
in GLEECH's source repository, and in `GLEECH-FFMPEG.json` in packaged apps.

Every packaged app includes:

- `ffmpeg/bin/`: FFmpeg and ffprobe, with their Windows runtime DLLs;
- `ffmpeg/lib/`: the matching libraries and platform runtime links;
- `ffmpeg/licenses/`: the original upstream notices for every component;
- `ffmpeg/share/tas-ffmpeg/`: the exact configuration and build records;
- `ffmpeg/manifest.json`: upstream runtime checksums and dependency identity;
- `ffmpeg/sources/tas-ffmpeg-9.0.2-corresponding-source.tar.xz`: the complete
  corresponding source, including FFmpeg, x264, x265, the other dependencies,
  source revisions, build scripts, flags and build environment definitions.

These paths are relative to `resources/` on Windows and Linux, or
`GLEECH.app/Contents/Resources/` on macOS. The source archive is provided with
every copy, rather than relying only on a third-party download or written offer.
Upstream release: https://github.com/NevermindNilas/TAS-FFMPEG/releases/tag/v9.0.2
FFmpeg: https://ffmpeg.org/ · https://ffmpeg.org/legal.html

GLEECH does not modify FFmpeg or its shared libraries. Upstream original
license and copyright notices are retained verbatim. The retained notice
inventory includes build tools and other-target components, as upstream documents.
The Windows notices, original manifest and configure command are also retained
under `LICENSES/ffmpeg/9.0.2/` in this repository.

To rebuild, extract the source archive, read its README and use the included
`build/scripts/` and `build/versions.lock` on the appropriate platform.
"Locate ffmpeg…" selects an external executable without modifying this bundle.
Clearing the selection, or a missing/unusable selection, falls back to the
bundled executable, then PATH.
