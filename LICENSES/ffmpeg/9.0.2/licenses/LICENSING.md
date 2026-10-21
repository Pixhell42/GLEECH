# Licensing of these FFmpeg binaries

**Effective licence: GNU General Public License, version 2 or later
(`GPL-2.0-or-later`).**

These binaries were built from FFmpeg 9.0.2 (git tag `n9.0.2`,
commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`) with `--enable-gpl`, and they statically link
**x264** (commit `0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee`) and **x265** (`4.2`), both of which
are GPL. Linking them makes the whole work GPL.

`--enable-version3` was deliberately **not** used, so the result stays at
"GPL v2 **or later**" rather than being forced up to GPLv3. That is the more
permissive position: GPLv2-or-later can be combined with GPLv2-only code,
GPLv3 cannot. FFmpeg's `configure` only requires `--enable-version3` for the
libraries in its `EXTERNAL_LIBRARY_VERSION3_LIST` (gmp, libaribb24,
liblensfun, libopencore-amrnb, libopencore-amrwb, libvo-amrwbenc, mbedtls,
rkmpp) and we enable none of them. For the same reason no OpenSSL ≥ 3.0 is
linked — FFmpeg's configure refuses that combination under GPLv2.

`--enable-nonfree` was **never** used. A nonfree build would be
undistributable.

## What this obliges you to do if you redistribute these binaries

1. **Pass on this licence text.** Everything in this `licenses/` directory
   must travel with the binaries.
2. **Provide the corresponding source.** See the offer below.

## Written offer of source code

The complete corresponding source for these binaries — the unmodified FFmpeg
release tarball, the exact commit of every third-party library linked into
them, and the complete build system used to produce them (`versions.lock`,
`flags/`, `scripts/`, `docker/`, `.github/`) — is published as
`tas-ffmpeg-9.0.2-corresponding-source.tar.xz` alongside these
binaries in the same release, and is available for as long as these binaries
are distributed.

No patches are applied to FFmpeg or to any dependency. The literal
`./configure` command line used for each platform is included in that archive
and also at `share/tas-ffmpeg/configure-command.txt` inside this one.

## Components and their licences

| Component | Licence | Text |
|---|---|---|
| FFmpeg (libav*, ffmpeg, ffprobe) | LGPL-2.1-or-later, **upgraded to GPL-2.0-or-later** by `--enable-gpl` | `ffmpeg/` |
| x264 | GPL-2.0 | `x264/` |
| x265 | GPL-2.0 | `x265/` |
| dav1d | BSD-2-Clause | `dav1d/` |
| SVT-AV1 | BSD-3-Clause-Clear + Alliance for Open Media Patent License 1.0 | `svt-av1/` |
| libaom | BSD-2-Clause + Alliance for Open Media Patent License 1.0 | `aom/` |
| libvpx | BSD-3-Clause + additional IP rights grant | `libvpx/` |
| libopus | BSD-3-Clause | `opus/` |
| LAME (libmp3lame) | LGPL-2.1-or-later | `lame/` |
| libogg | BSD-3-Clause | `ogg/` |
| libvorbis | BSD-3-Clause | `vorbis/` |
| libwebp | BSD-3-Clause | `libwebp/` |
| FreeType | dual FreeType Licence (FTL) **or** GPL-2.0-or-later — we take **GPL-2.0-or-later**, because the FTL is GPLv3-compatible but not GPLv2-compatible | `freetype/` |
| HarfBuzz | MIT (Old MIT) | `harfbuzz/` |
| FriBidi | LGPL-2.1-or-later | `fribidi/` |
| libass | ISC | `libass/` |
| zimg | WTFPL | `zimg/` |
| zlib | zlib licence | `zlib/` |
| libvmaf | BSD-2-Clause-Patent | `vmaf/` |
| bzip2 *(Windows + Linux)* | BSD-style (bzip2-1.0.6 licence) | `bzip2/` |
| xz / liblzma *(Windows + Linux)* | 0BSD (public-domain-equivalent) for liblzma | `xz/` |
| GNU libiconv *(Windows only)* | LGPL-2.1-or-later — the **library** only; the GPL `iconv` command-line program is neither built nor shipped | `libiconv/` |
| GnuTLS *(Linux only)* | LGPL-2.1-or-later | `gnutls/` |
| Nettle *(Linux only)* | dual LGPL-3.0-or-later **or** GPL-2.0-or-later — we take **GPL-2.0-or-later** | `nettle/` |
| GMP *(Linux only)* | dual LGPL-3.0-or-later **or** GPL-2.0-or-later — we take **GPL-2.0-or-later** | `gmp/` |
| Intel oneVPL dispatcher (libvpl) | MIT | `libvpl/` |
| AMD AMF headers | MIT | `AMF/` |
| nv-codec-headers | MIT | `nv-codec-headers/` |
| Vulkan-Headers *(Windows + Linux)* | `Apache-2.0 OR MIT` (per-file SPDX) — we take **MIT** | `Vulkan-Headers/` |
| SPIRV-Headers *(Windows + Linux)* | MIT-style (Khronos) | `SPIRV-Headers/` |
| glslang *(Windows + Linux, build tool)* | BSD-3-Clause / Apache-2.0 / MIT mix — see its `LICENSE.txt`. Nothing of glslang is linked; it compiles FFmpeg's own GLSL shaders to the SPIR-V embedded in the libraries | `glslang/` |
| libva *(linux/x86_64 only)* | MIT — built, then replaced by an Implib.so stub; no libva code is linked into the binaries, only the generated trampolines | `libva/` |
| libdrm *(linux/x86_64 only)* | MIT — a build-time prerequisite of libva, linked as a static archive that nothing references, so no libdrm code reaches the binaries | `libdrm/` |
| Implib.so *(linux/x86_64 only)* | MIT | `Implib.so/` |

Every entry above is permissive or GPL-compatible, so the combined work is
distributable under GPL-2.0-or-later. Nothing here is nonfree.

**On the platform annotations.** `licenses/` in every archive contains the
licence text of **every** component in the table, including ones that
platform does not link. That is deliberate — see `licenses/README.txt` — and
the annotations above say which are actually linked where.

**On nv-codec-headers.** It ships no standalone licence file upstream; each
header carries its own MIT-style notice, and they are not all identical. The
`nv-codec-headers/LICENSE.txt` in this archive reproduces every one of them
verbatim, extracted from the headers at the pinned commit.

**On the table itself.** The set of components is derived from
`versions.lock` at package time (`scripts/lib/common.sh`, `lock_dep_keys`),
not from this table, and packaging **fails** if any pinned component has no
licence text. So this table can fall behind the archive, but the archive can
no longer fall behind the pins.

**On the dual-licensed pair.** GMP and Nettle are each offered under
*either* LGPLv3+ *or* GPLv2+. Taking the GPLv2-or-later arm is what keeps
these binaries at GPL-2.0-or-later; taking the LGPLv3 arm would drag the
combined work up to GPLv3 by the back door, which is the exact outcome
`--enable-version3` was avoided to prevent. This is a licence *election*, not
a build flag — it is recorded here because it is the only place it can be.

**On the Vulkan components.** Every Vulkan header compiled into these
binaries is marked `SPDX-License-Identifier: Apache-2.0 OR MIT`. Apache-2.0
alone is not GPLv2-compatible, so the MIT arm is the one taken — like the
GMP/Nettle election above, this is what keeps the work at
GPL-2.0-or-later. glslang is a compiler, not a library: the SPIR-V it emits
is a translation of FFmpeg's own LGPL shader sources. Its source is in the
corresponding-source archive anyway, because its output is in the binaries.

**On LibreSSL.** It is often assumed that libtls is the GPL-friendly TLS
option. FFmpeg disagrees: `configure:7449-7450` ends `--enable-libtls` with
`die "ERROR: LibreSSL is incompatible with the gpl"`. GnuTLS is the only
backend FFmpeg 9.0.2 will accept in a GPL build on Linux.

**On FreeType's dual licence.** FreeType is offered under either the FreeType
Licence (FTL) or GPL-2.0-or-later. The FTL is GPLv3-compatible but *not*
GPLv2-compatible, so taking FreeType under the FTL inside a GPL-2.0-or-later
work would be a conflict. We take it under its GPL-2.0-or-later option, which
is why these binaries remain GPL-2.0-or-later and are not pushed to GPLv3.
Both licence texts ship in `freetype/`.

**On subtitle rendering.** libass, FreeType, HarfBuzz and FriBidi are present
so that subtitles can be BURNED IN (`subtitles=`, `ass`) and so `drawtext`
works. Subtitle passthrough and transcoding — `mov_text`, `webvtt`, `ass`,
`subrip`, `text` — are native FFmpeg codecs and involve none of them.

## Note on system components

MediaFoundation (Windows), Schannel (Windows), VideoToolbox / AudioToolbox /
SecureTransport (macOS), and VAAPI (Linux) are used through the operating
system's own interfaces. NVENC/NVDEC/CUVID and AMF are reached through
header-only stubs (`nv-codec-headers`, `AMF`) that `dlopen`/`LoadLibrary` the
vendor driver at runtime; no NVIDIA or AMD binary is redistributed here.
Vulkan works the same way: the Vulkan loader (`vulkan-1.dll` /
`libvulkan.so.1`) belongs to the user's GPU driver or OS and is opened at
runtime; it is neither linked nor shipped.

**On libva and libdrm.** VAAPI is genuinely a system component here, not a
bundled one, and unusually so. `libva` is built from the pinned source purely
so that [Implib.so](https://github.com/yugr/Implib.so) can generate a static
archive of trampolines from it; the built `libva.so.2` and `libva-drm.so.2`
are then **deleted**, and what ships is the trampolines, which `dlopen` *the
user's own* `libva.so.2` on first use. `libdrm` is required to configure
libva at all and is linked as a static archive that no shipped object
references. Both are listed above, and their complete source is in the
corresponding-source archive, because they are pinned inputs — not because
their code is in the binaries.

`versions.lock` in this directory records the exact pin for every component.
