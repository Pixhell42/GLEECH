import { chmod, copyFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

// AppRun continues to launch "gleech"; only terminal invocations take the Node path.
// The real Electron binary stays beside its resources for GPU and MCP subprocesses.
export default async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;
  if (electronPlatformName === 'linux') {
    await rename(join(appOutDir, 'gleech'), join(appOutDir, 'gleech-bin'));
    await copyFile(join(appOutDir, 'resources/cli/linux-entry'), join(appOutDir, 'gleech'));
    await chmod(join(appOutDir, 'gleech'), 0o755);
  }
  if (electronPlatformName !== 'win32') {
    const resources =
      electronPlatformName === 'darwin'
        ? join(appOutDir, 'GLEECH.app/Contents/Resources')
        : join(appOutDir, 'resources');
    await chmod(join(resources, 'cli/gleech'), 0o755);
  }
}
