import desktopPackage from '../../package.json';

// Temporary release marker. See docs/DEVELOPMENT.md before the stable release.
export const APP_IS_BETA = true;
export const APP_VERSION = desktopPackage.version;
export const APP_VERSION_LABEL = `GLEECH${APP_IS_BETA ? ' BETA' : ''} · v${APP_VERSION}`;
export const APP_ICON_FILE = APP_IS_BETA ? 'icon-beta.png' : 'icon.png';
