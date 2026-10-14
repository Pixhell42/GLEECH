ARG BASE_IMAGE=gleech-native-base:review
FROM ${BASE_IMAGE}
COPY upstream/build /data
COPY pkg /retained-pkg
COPY vendor /opt/rust-vendor
COPY vendor-config.toml /opt/vendor-config.toml
COPY build-inputs.json /opt/build-inputs.json
WORKDIR /usr/local/mxe
RUN patch -p1 -d /usr/share < /data/patches/libtool-2-fixes.patch
ENV SOURCE_DATE_EPOCH=0
RUN cp /data/settings/release.mk settings.mk
RUN --mount=type=cache,id=gleech-mxe-download,target=/usr/local/mxe/pkg \
    cp /retained-pkg/* pkg/ && \
    make gendef vips-web JOBS=4 MXE_TARGETS=x86_64-w64-mingw32.static \
    MXE_PLUGIN_DIRS='plugins/llvm-mingw /data /data/plugins/mozjpeg /data/plugins/zlib-ng /data/plugins/web-deps /data/plugins/proxy-libintl'
WORKDIR /data/packaging
ENTRYPOINT ["/bin/bash", "package.sh"]
