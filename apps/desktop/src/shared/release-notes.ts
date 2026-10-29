// Update this with each published version. In-app updates retain GitHub's exact notes too.
export const BUNDLED_RELEASE_NOTES = `Windows terminal updates now finish installing after the CLI exits. If you are upgrading from Windows 0.2.0, use Settings > Updates > Install & Update for this first update.

Linux AppImages now keep a separate extraction directory for each launch, so using the terminal alongside the desktop no longer removes the desktop's runtime. Extraction mode still uses APPIMAGE_EXTRACT_AND_RUN=1; remove the old NO_CLEANUP=1 workaround after updating.

Existing projects, presets, shaders and terminal paths are preserved. Unsigned macOS builds continue to download a verified ZIP for manual replacement through Finder.`;
