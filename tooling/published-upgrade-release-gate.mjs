import { appendFile, readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import {
  comparePublishedVersions,
  publishedReleaseTargets,
  readyPublishedRelease,
  targets,
} from './published-upgrade-plan.mjs';

const { release } = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const version = /^(?:v|macos-alpha-|linux-omarchy-alpha-)(\d+\.\d+\.\d+)$/.exec(
  release?.tag_name,
)?.[1];

if (version && comparePublishedVersions(version, targets['win32-x64'].version) > 0)
  await checkPublication(version, release.id);
else console.log('No publication to test from the frozen 0.2.0 packages.');

async function fetchRelease(tag) {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(
    `https://api.github.com/repos/Pixhell42/GLEECH/releases/tags/${tag}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.timeout(15000),
    },
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
    ready = readyPublishedRelease(expected, await Promise.all(tags.map(fetchRelease)));
    if (ready) {
      // Only one of the platform publication events should start the native jobs.
      if (ready.releaseId !== eventReleaseId) {
        console.log(`The final platform publication for ${version} owns this test.`);
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
        await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
        console.log(`All four ${version} downloads are published and reachable.`);
        return;
      }
    }
    if (attempt < 11) await setTimeout(5000);
  }
  if (ready) throw new Error(`The published ${version} downloads did not become reachable.`);
  console.log(`The four-platform publication for ${version} is still incomplete.`);
}
