# Adapted from pinned build-win64-mxe v8.18.7 container/base.Dockerfile.
# Builds the compiler/tooling too; does not use a prebuilt libvips/MXE image.
FROM docker.io/library/buildpack-deps:trixie@sha256:ffbfa3ee92287a5fa41c03118bfe9a75c095838bccbe1173322854b8f2387116
RUN apt-get update && apt-get install -qqy --no-install-recommends \
    autopoint bison build-essential flex gettext gperf intltool jq libtool-bin \
    libxml-parser-perl lzip p7zip-full python-is-python3 python3-mako ruby zip \
    gtk-update-icon-cache
COPY mxe /usr/local/mxe
COPY pkg /retained-pkg
WORKDIR /usr/local/mxe
# An archive has no Git metadata. This local commit is only for MXE diagnostics;
# the original upstream commit and archive hash are recorded in build-inputs.json.
RUN git init && git add . && git -c user.name=GLEECH -c user.email=build@localhost \
    commit -qm 'Retained MXE source archive for independent rebuild'
RUN --mount=type=cache,id=gleech-mxe-download,target=/usr/local/mxe/pkg \
    cp /retained-pkg/* pkg/ && \
    echo 'MXE_TARGETS := x86_64-pc-linux-gnu' > settings.mk && \
    make autotools cargo-c cc meson nasm pe-util JOBS=4 MXE_VERBOSE=true \
    MXE_TMP=/var/tmp MXE_PLUGIN_DIRS=plugins/llvm-mingw MXE_USE_CCACHE=
