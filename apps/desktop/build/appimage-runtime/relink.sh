#!/bin/sh
# In the recorded Alpine build environment, put a modified libfuse3.a in this
# directory, then run this script. runtime.o contains the MIT runtime, not libfuse.
set -eu
cd "$(dirname "$0")"
clang runtime.o -T data_sections.ld -Wl,--gc-sections -static -static-pie -L. -lsquashfuse -lsquashfuse_ll -lzstd -lz -lfuse3 -lmimalloc -o runtime-x64
printf 'AI\002' | dd of=runtime-x64 bs=1 count=3 seek=8 conv=notrunc
