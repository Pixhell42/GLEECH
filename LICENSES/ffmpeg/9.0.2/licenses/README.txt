Licences shipped with tas-ffmpeg 9.0.2 (windows/x86_64)
============================================================

This directory contains the licence text of EVERY third-party component
pinned in versions.lock -- which is a SUPERSET of what this particular
binary links. The set is deliberately not pruned per platform: an
over-inclusive licence directory is harmless, an under-inclusive one is a
distribution violation, and pruning would mean maintaining a second list
that can drift out of step with the build.

Components that are NOT linked on every platform:

  gnutls, gmp, nettle   Linux only. Windows uses Schannel and macOS uses
                        SecureTransport, both supplied by the OS.
  libiconv              Windows only. glibc and macOS's libSystem provide
                        iconv themselves.
  bzip2, xz             Windows and Linux only. macOS provides both in
                        /usr/lib.
  libvpl (oneVPL), AMF  Windows and Linux x86_64 only. No aarch64 or macOS
                        runtime exists.
  nv-codec-headers      Everywhere except macOS.
  Vulkan-Headers,       Windows and Linux only. Header-only; the Vulkan
  SPIRV-Headers         loader is the user's own, opened at runtime.
  glslang               Windows and Linux only, and never linked: a build
                        tool that compiles FFmpeg's shaders to SPIR-V.

For the authoritative list of what THIS binary contains, read
  ../share/tas-ffmpeg/configure-command.txt   (the literal ./configure line)
  ../share/tas-ffmpeg/config.h                (the resulting feature set)
or run  bin/ffmpeg -version  and read its "configuration:" line.

The effective licence of the binaries, and the written offer of complete
corresponding source, are in LICENSING.md beside this file.
