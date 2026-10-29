#!/bin/sh
set -eu
export SOURCE_DATE_EPOCH=1762560000
mkdir -p /out/relink /out/licenses
ulimit -c 0
for variant in before after; do
  clang -std=gnu99 -Wall -Wextra -Werror "/build/gleech-arguments-$variant.c" -o "/tmp/gleech-arguments-$variant"
done
if /tmp/gleech-arguments-before >/tmp/gleech-arguments-before.log 2>&1; then
  echo 'The original argument-copy bounds regression was not detected.' >&2
  exit 1
fi
/tmp/gleech-arguments-after
cd /build/src/runtime
clang -std=gnu99 -Os -D_FILE_OFFSET_BITS=64 -DGIT_COMMIT=\"gleech-private-extraction\" -ffunction-sections -fdata-sections -Wall -Werror -I/usr/local/include/squashfuse -I/usr/include/fuse3 -c runtime.c -o runtime.o
clang runtime.o -T data_sections.ld -Wl,--gc-sections -static -static-pie -lsquashfuse -lsquashfuse_ll -lzstd -lz -lfuse3 -lmimalloc -o /out/runtime-x64
strip --strip-debug --strip-unneeded /out/runtime-x64
printf 'AI\002' | dd of=/out/runtime-x64 bs=1 count=3 seek=8 conv=notrunc
cp runtime.o data_sections.ld /out/relink/
cp /usr/lib/libfuse3.a /usr/local/lib/libsquashfuse.a /usr/local/lib/libsquashfuse_ll.a /usr/lib/libzstd.a /usr/lib/libz.a /usr/lib/libmimalloc.a /out/relink/
cp /build/LICENSE /out/licenses/AppImage-runtime-MIT.txt
cp /build/gleech-notices/* /out/licenses/
cp /source-archives/fuse-*/LGPL2.txt /out/licenses/libfuse-LGPL-2.1.txt
cp /source-archives/squashfuse-*/LICENSE /out/licenses/squashfuse-BSD.txt
apk info -v > /out/build-packages.txt
cp /build/gleech-relink.sh /out/relink/relink.sh
tar -czf /out/source-and-relink.tar.gz -C /build src scripts patches LICENSE Dockerfile gleech-build.sh gleech-relink.sh gleech-arguments-before.c gleech-arguments-after.c -C / source-archives -C /out relink build-packages.txt
