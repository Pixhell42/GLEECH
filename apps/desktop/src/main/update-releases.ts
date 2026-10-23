import { SUPPORT_REPOSITORY, SUPPORT_REPOSITORY_SLUG } from '../shared/support';
import type { UpdateRelease } from '../shared/updates';

export function compareReleaseVersions(a: string, b: string): number {
  const parse = (version: string) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid update version.');
    const parts = version.split('.').map(Number);
    if (parts.some((part) => !Number.isSafeInteger(part)))
      throw new Error('Invalid update version.');
    return parts;
  };
  const left = parse(a),
    right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}

export function updateChannel(arch: string): string {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported update architecture.');
  return `latest-${arch}`;
}

export function selectUpdateRelease(
  value: unknown,
  currentVersion: string,
  platform: string,
  arch: string,
  allowPrerelease: boolean,
): UpdateRelease | null {
  if (!Array.isArray(value)) throw new Error('GitHub returned an invalid release list.');
  const suffix =
    platform === 'win32'
      ? `${arch}-setup.exe`
      : platform === 'darwin'
        ? `mac-${arch}.zip`
        : `linux-${arch === 'x64' ? 'x86_64' : arch}.AppImage`;
  const manifest = `${updateChannel(arch)}${platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux' : ''}.yml`;
  const candidates: UpdateRelease[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const release = entry as Record<string, unknown>;
    if (
      release.draft !== false ||
      (release.prerelease && !allowPrerelease) ||
      !Array.isArray(release.assets) ||
      typeof release.tag_name !== 'string' ||
      !/^[\w.-]+$/.test(release.tag_name)
    )
      continue;
    const assets = release.assets.filter((asset): asset is Record<string, unknown> =>
      Boolean(asset && typeof asset === 'object'),
    );
    if (!assets.some((asset) => asset.name === manifest)) continue;
    for (const asset of assets) {
      if (
        typeof asset.name !== 'string' ||
        !asset.name.startsWith('GLEECH-') ||
        !asset.name.endsWith(`-${suffix}`)
      )
        continue;
      const version = asset.name.slice(7, -suffix.length - 1);
      if (!/^\d+\.\d+\.\d+$/.test(version) || compareReleaseVersions(version, currentVersion) <= 0)
        continue;
      const downloadUrl = `${SUPPORT_REPOSITORY}/releases/download/${release.tag_name}/${asset.name}`;
      if (
        asset.browser_download_url !== downloadUrl ||
        typeof asset.size !== 'number' ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        asset.size > 4 * 1024 ** 3 ||
        typeof asset.digest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
      )
        continue;
      candidates.push({
        version,
        tag: release.tag_name,
        asset: asset.name,
        downloadUrl,
        bytes: asset.size,
        sha256: asset.digest.slice(7),
        url: `${SUPPORT_REPOSITORY}/releases/tag/${release.tag_name}`,
        notes:
          typeof release.body === 'string'
            ? release.body.slice(0, 50000)
            : 'See the GitHub release for details.',
      });
    }
  }
  return candidates.sort((a, b) => compareReleaseVersions(b.version, a.version))[0] ?? null;
}

export async function discoverUpdate(
  version: string,
  platform: string,
  arch: string,
  beta: boolean,
  signal?: AbortSignal,
): Promise<UpdateRelease | null> {
  const response = await fetch(
    `https://api.github.com/repos/${SUPPORT_REPOSITORY_SLUG}/releases?per_page=100`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GLEECH-Update-Check',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 429
        ? 'GitHub’s update limit was reached. Please try again later.'
        : `Could not check GitHub releases (${response.status}).`,
    );
  const body = await response.text();
  if (body.length > 8 * 1024 * 1024) throw new Error('GitHub returned an oversized release list.');
  return selectUpdateRelease(JSON.parse(body), version, platform, arch, beta);
}
