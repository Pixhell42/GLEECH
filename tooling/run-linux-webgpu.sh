#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
app="$root/apps/desktop/release/linux-unpacked/gleech"
if [ ! -x "$app" ]; then
  echo 'Build the unpacked Linux app with pnpm pack:linux first.' >&2
  exit 1
fi
exec "$app" --ozone-platform=x11 --use-angle=vulkan \
  --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan "$@"
