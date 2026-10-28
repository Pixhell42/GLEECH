// Immutable inputs for the reviewed 0.2.0 candidates. Never rebuild during acceptance.
export const candidate = {
  version: '0.2.0',
  appsTree: '261c8d69c20eb3d4a60fe79cb206fc986f2bc309',
  packagesTree: '68607f2b86bfd8120ac46d7f274437ddc8dffa1f',
  lockBlob: 'fdef65702114be06366969ecaad8958b77ae04d4',
};
export const targets = {
  'darwin-arm64': {
    archive: 'GLEECH-0.2.0-mac-arm64.zip',
    sha256: '454968354ba1b6272192af1bb693708e906a036c32fb32e352b9cc129ad7d878',
    artifactId: 12825604752,
    artifactSHA256: 'c1abf4af49b5677be185d413f942d7aee29fe960a5df9f5ed33f15cd1fdb06a9',
  },
  'darwin-x64': {
    archive: 'GLEECH-0.2.0-mac-x64.zip',
    sha256: '47d2639aca0757550b6829f4dd71864b5b90b91e4f207d1513e7704583717dc8',
    artifactId: 12827651680,
    artifactSHA256: 'e2623e537fd2cdf550737512c6de4a1e4faccc75335df6e795634a3f670abbe5',
  },
  'linux-x64': {
    archive: 'GLEECH-0.2.0-linux-x86_64.AppImage',
    sha256: '7e91e6f4da2465262fbafca8588e5641b79b8d854f2402fcb3a0ad54321fb773',
    artifactId: 12827614711,
    artifactSHA256: '56149884c5b8620e3231a71f777b97e36879293d07f2f17fecaf7f2994e26cd0',
  },
  'win32-x64': {
    archive: 'GLEECH-0.2.0-x64-setup.exe',
    sha256: 'b6b0ce4110e0cc1d401cd974a2e25570d0f701998dd53e1bef37a31de9626b81',
  },
};
