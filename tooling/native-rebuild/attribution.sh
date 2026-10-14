#!/bin/sh
# Run inside the pinned official Rust image, with the prepared context at /review.
# This resolves dependencies offline; it does not compile or prove binary contents.
set -eu
cd /review/librsvg
cargo --version > /evidence/toolchain.txt
rustc --version >> /evidence/toolchain.txt
rustc --print cfg --target x86_64-pc-windows-gnullvm >> /evidence/toolchain.txt
cargo tree --locked --offline --target x86_64-pc-windows-gnullvm \
  -p librsvg-c --features capi -e normal,build --prefix none --format '{p} {f}' \
  > /evidence/windows-library.txt
cargo tree --locked --offline --target x86_64-pc-windows-gnullvm \
  -p librsvg --features capi -e normal,build,dev --invert difflib \
  > /evidence/difflib-tests.txt
cargo tree --locked --offline --target x86_64-apple-darwin \
  -p librsvg-c --features capi -e normal,build --invert objc-foundation \
  > /evidence/objc-apple.txt
cargo tree --locked --offline --target x86_64-pc-windows-gnu \
  -p librsvg-c --features capi -e normal,build --invert winapi-x86_64-pc-windows-gnu \
  > /evidence/winapi-gnu.txt
