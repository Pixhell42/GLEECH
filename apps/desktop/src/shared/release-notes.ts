// Update this with each published version. In-app updates retain GitHub's exact notes too.
export const BUNDLED_RELEASE_NOTES = `This update brings newer Electron, Chromium and Node.js security fixes, updates local MCP dependencies, and fixes a desktop startup warning. The app also rejects invalid cached installer filenames.

The documented BoringSSL certificate-processing issue (CVE-2026-35189) remains in this Electron build. It can terminate GLEECH and lose unsaved work. Save your work before checking for updates or importing shaders from a URL.

Windows and Linux can update from Settings or the terminal. macOS downloads a verified ZIP for manual replacement through Finder.`;
