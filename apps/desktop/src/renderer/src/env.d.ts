import type { DesktopBridge } from '../../shared/image-api';

declare global {
  interface Window {
    gleech: DesktopBridge;
  }
}
