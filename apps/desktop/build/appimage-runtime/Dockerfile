FROM alpine:3.21@sha256:ee16d92f96db08d9d2d07da48555a27f3a69d8f0759021dbc601195ed0d2b5bd AS build
RUN apk add --no-cache bash alpine-sdk util-linux file autoconf automake libtool xz eudev-dev gettext-dev linux-headers meson clang musl-dev=1.2.5-r12 mimalloc2-dev=2.1.7-r0 zstd-dev=1.5.6-r2 zstd-static=1.5.6-r2 zlib-dev=1.3.2-r1 zlib-static=1.3.2-r1
COPY . /build
WORKDIR /build
RUN bash scripts/common/install-dependencies.sh
RUN sh gleech-build.sh
FROM scratch
COPY --from=build /out/ /
