import { setTimeout } from 'node:timers/promises';
import {
  comparePublishedVersions,
  publishedReleaseTargets,
  readyPublishedRelease,
  targets,
} from './published-upgrade-plan.mjs';
import { createGitHubRateLimitRetry } from './published-upgrade-retry.mjs';

const retryGitHubApi = createGitHubRateLimitRetry({ maxWaitMs: 150000 });

const version = /^(?:v|macos-alpha-|linux-omarchy-alpha-)(\d+\.\d+\.\d+)$/.exec(
  process.env.PUBLISHED_RELEASE_TAG,
)?.[1];
const releaseId = Number(process.env.PUBLISHED_RELEASE_ID);

if (
  version &&
  Number.isSafeInteger(releaseId) &&
  releaseId > 0 &&
  comparePublishedVersions(version, targets['win32-x64'].version) > 0
)
  await checkPublication(version, releaseId);
else console.error('No publication to test from the frozen 0.2.0 packages.');

async function fetchRelease(tag) {
  const token = process.env.GITHUB_TOKEN;
  const url = `https://api.github.com/repos/Pixhell42/GLEECH/releases/tags/${encodeURIComponent(tag)}`;
  const response = await retryGitHubApi(`release metadata for ${tag}`, () =>
    fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    }),
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Could not read published release ${tag} (${response.status}).`);
  return response.json();
}

async function checkPublication(version, eventReleaseId) {
  const expected = publishedReleaseTargets(version);
  const tags = [...new Set(expected.map(({ tag }) => tag))];
  let ready;
  for (let attempt = 0; attempt < 12; attempt++) {
    const releases = [];
    for (const tag of tags) releases.push(await fetchRelease(tag));
    ready = readyPublishedRelease(expected, releases);
    if (ready) {
      // Only one of the platform publication events should start the native jobs.
      if (ready.releaseId !== eventReleaseId) {
        console.error(`The final platform publication for ${version} owns this test.`);
        return;
      }
      const live = await Promise.all(
        ready.downloads.map(async (url) => {
          const response = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(15000),
          }).catch(() => null);
          return response?.status === 200;
        }),
      );
      if (live.every(Boolean)) {
        console.log(`version=${version}`);
        console.error(`All four ${version} downloads are published and reachable.`);
        return;
      }
    }
    if (attempt < 11) await setTimeout(5000);
  }
  if (ready) throw new Error(`The published ${version} downloads did not become reachable.`);
  console.error(`The four-platform publication for ${version} is still incomplete.`);
}
