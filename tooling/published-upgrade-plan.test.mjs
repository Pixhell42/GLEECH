import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishedReleaseTargets,
  readyPublishedRelease,
  selectPublishedUpgrade,
  targets,
} from './published-upgrade-plan.mjs';
import { createGitHubRateLimitRetry } from './published-upgrade-retry.mjs';
import { formatPublishedUpgradeSummary } from './published-upgrade-summary.mjs';

const sha256 = 'a'.repeat(64);
const release = (tag, archives, fields = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: true,
  published_at: '2026-11-21T22:01:47Z',
  assets: archives.map((name) => ({ name, digest: 'sha256:' + sha256 })),
  ...fields,
});

test('selects the newest published package independently for each native target', () => {
  const releases = [
    release('v0.2.9', ['GLEECH-0.2.9-x64-setup.exe']),
    release('macos-alpha-0.2.9', ['GLEECH-0.2.9-mac-arm64.zip', 'GLEECH-0.2.9-mac-x64.zip']),
    release('v0.2.10', ['GLEECH-0.2.10-x64-setup.exe', 'GLEECH-0.2.10-mac-arm64.zip']),
    release('linux-omarchy-alpha-0.2.11', ['GLEECH-0.2.11-linux-x86_64.AppImage']),
    release('v0.2.12', ['GLEECH-0.2.12-x64-setup.exe'], { draft: true }),
    release('v0.2.13', ['GLEECH-0.2.13-mac-x64.zip'], { published_at: null }),
  ];
  const expected = {
    'win32-x64': ['0.2.10', 'v0.2.10'],
    'darwin-arm64': ['0.2.10', 'v0.2.10'],
    'darwin-x64': ['0.2.9', 'macos-alpha-0.2.9'],
    'linux-x64': ['0.2.11', 'linux-omarchy-alpha-0.2.11'],
  };
  for (const [target, [version, tag]] of Object.entries(expected)) {
    const source = targets[target];
    assert.deepEqual(selectPublishedUpgrade(releases, source), {
      version,
      tag,
      archive: source.archive.replace(source.version, version),
      sha256,
    });
  }
});

test('rejects a newer package without a SHA-256 digest instead of selecting an older one', () => {
  const releases = [
    release('v0.2.3', ['GLEECH-0.2.3-x64-setup.exe']),
    release('v0.2.4', [], { assets: [{ name: 'GLEECH-0.2.4-x64-setup.exe', digest: null }] }),
  ];
  assert.throws(
    () => selectPublishedUpgrade(releases, targets['win32-x64']),
    /GLEECH-0\.2\.4-x64-setup\.exe has no valid SHA-256 digest/,
  );
});

test('requires an upgrade beyond the frozen starting release', () => {
  const source = targets['linux-x64'];
  assert.throws(
    () => selectPublishedUpgrade([release(source.tag, [source.archive])], source),
    /No newer published package/,
  );
});

const publication = (version) =>
  Object.entries(Object.groupBy(publishedReleaseTargets(version), ({ tag }) => tag)).map(
    ([tag, packages], index) =>
      release(tag, [], {
        id: index + 1,
        assets: packages.flatMap(({ archive, manifest }) =>
          [archive, manifest].map((name) => ({
            name,
            state: 'uploaded',
            size: 123,
            digest: `sha256:${sha256}`,
            browser_download_url: `https://github.com/Pixhell42/GLEECH/releases/download/${tag}/${name}`,
          })),
        ),
      }),
  );

test('requires all four checksummed downloads and manifests for a single version', () => {
  const expected = publishedReleaseTargets('0.2.4');
  const releases = publication('0.2.4');
  assert.equal(readyPublishedRelease(expected, releases.slice(0, 2)), null);
  assert.equal(readyPublishedRelease(expected, publication('0.2.5')), null);
  const mac = releases.find(({ tag_name }) => tag_name === 'macos-alpha-0.2.4');
  const intel = mac.assets.find(({ name }) => name === 'GLEECH-0.2.4-mac-x64.zip');
  intel.state = 'starter';
  assert.equal(readyPublishedRelease(expected, releases), null);
  intel.state = 'uploaded';
  const manifest = mac.assets.find(({ name }) => name === 'latest-x64-mac.yml');
  manifest.digest = null;
  assert.equal(readyPublishedRelease(expected, releases), null);
  manifest.digest = `sha256:${sha256}`;
  mac.draft = true;
  assert.equal(readyPublishedRelease(expected, releases), null);
});

test('the last platform publication owns the complete matrix regardless of publish order', () => {
  const expected = publishedReleaseTargets('0.2.4');
  const releases = publication('0.2.4');
  for (const last of releases) {
    const others = releases.filter(({ id }) => id !== last.id);
    const ready = readyPublishedRelease(expected, [
      { ...last, published_at: '2026-11-21T22:01:49Z' },
      ...others,
    ]);
    assert.equal(ready.releaseId, last.id);
    assert.deepEqual(
      ready.downloads,
      expected.map(
        ({ tag, archive }) =>
          `https://github.com/Pixhell42/GLEECH/releases/download/${tag}/${archive}`,
      ),
    );
  }
  assert.equal(readyPublishedRelease(expected, [...releases].reverse()).releaseId, 3);
});

const quotaResponse = (status, headers = {}, message = 'Forbidden') =>
  Response.json({ message }, { status, headers });

test('waits for GitHub retry and reset headers, then returns the real successful response', async () => {
  const waits = [];
  const retries = [];
  const retry = createGitHubRateLimitRetry({
    maxWaitMs: 180000,
    now: () => 100000,
    wait: async (delay) => waits.push(delay),
    log: () => {},
    onRetry: (event) => retries.push(event),
  });
  const success = Response.json({ assets: [] });
  const responses = [
    quotaResponse(403, {
      'retry-after': '15',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '130',
    }),
    quotaResponse(429, { 'retry-after': '5' }),
    success,
  ];
  assert.equal(await retry('release metadata', async () => responses.shift()), success);
  assert.deepEqual(waits, [31000, 6000]);
  assert.deepEqual(retries, [
    { label: 'release metadata', status: 403, delayMs: 31000, attempt: 1 },
    { label: 'release metadata', status: 429, delayMs: 6000, attempt: 2 },
  ]);
});

test('backs off for an observed updater rate limit and stops after three retries', async () => {
  const waits = [];
  const retry = createGitHubRateLimitRetry({
    maxWaitMs: 900000,
    wait: async (delay) => waits.push(delay),
    log: () => {},
  });
  const rejected = { phase: 'error' };
  const observed = {
    status: 403,
    retryAfter: null,
    remaining: '55',
    reset: null,
    message: 'You have exceeded a secondary rate limit.',
  };
  let checks = 0;
  await assert.rejects(
    retry(
      'installed updater',
      async () => {
        checks++;
        return rejected;
      },
      (result) => (result === rejected ? observed : null),
    ),
    /HTTP 403.*exceeded the retry budget/,
  );
  assert.equal(checks, 4);
  assert.deepEqual(waits, [60000, 120000, 240000]);
});

test('shares a bounded wait budget and leaves ordinary API and test failures alone', async () => {
  const waits = [];
  const retry = createGitHubRateLimitRetry({
    maxWaitMs: 60000,
    wait: async (delay) => waits.push(delay),
    log: () => {},
  });
  const responses = [quotaResponse(429, { 'retry-after': '40' }), Response.json({})];
  await retry('first release request', async () => responses.shift());
  await assert.rejects(
    retry('later release request', async () => quotaResponse(429, { 'retry-after': '30' })),
    /next retry would need to wait 31s/,
  );
  const forbidden = quotaResponse(403);
  assert.equal(await retry('forbidden release metadata', async () => forbidden), forbidden);
  assert.deepEqual(await forbidden.json(), { message: 'Forbidden' });
  const failure = new Error('SHA-256 mismatch');
  await assert.rejects(
    retry('check failure', async () => {
      throw failure;
    }),
    failure,
  );
  assert.deepEqual(waits, [41000]);
});

test('summarizes tested versions, verified SHA-256 digests and recorded retries', () => {
  const manifestDigest = 'b'.repeat(64);
  const upgradeDigest = 'c'.repeat(64);
  const summary = formatPublishedUpgradeSummary('darwin-arm64', {
    target: 'darwin-arm64',
    originalRuntime: { version: '0.2.0' },
    currentRuntime: { version: '0.2.3' },
    complete: true,
    checks: Array(8).fill({ passed: true }),
    checksums: {
      originalInstaller: { actual: sha256, expected: sha256 },
      manifest: { actual: `sha256:${manifestDigest}`, expected: `sha256:${manifestDigest}` },
      upgradeInstaller: { actual: upgradeDigest, expected: upgradeDigest },
    },
    rateLimitRetries: [
      { label: 'installed 0.2.0 updater discovery', status: 403, delayMs: 358000, attempt: 1 },
    ],
  });
  assert.ok(summary.includes('**Result** Passed · 8 checks passed'));
  assert.ok(summary.includes('**Versions tested** `0.2.0` → `0.2.3`'));
  assert.ok(summary.includes(`| Starting installer | Passed | \`${sha256}\` |`));
  assert.ok(summary.includes(`| Updater manifest | Passed | \`${manifestDigest}\` |`));
  assert.ok(
    summary.includes(
      `| Upgrade installer (verified by the updater) | Passed | \`${upgradeDigest}\` |`,
    ),
  );
  assert.ok(summary.includes('**GitHub API rate-limit retries** 1'));
  assert.ok(
    summary.includes('installed 0.2.0 updater discovery · HTTP 403 · 358 s wait · retry 1/3'),
  );
});

test('distinguishes failed and unverified checks and handles missing native reports', () => {
  const summary = formatPublishedUpgradeSummary('linux-x64', {
    target: 'linux-x64',
    originalRuntime: { version: '0.2.0' },
    to: '0.2.3',
    complete: false,
    finishedAt: '2026-11-21T00:00:00Z',
    checks: [],
    checksums: { manifest: { actual: 'b'.repeat(64), expected: sha256 } },
    rateLimitRetries: [],
  });
  assert.ok(summary.includes('**Result** Failed · 0 checks passed'));
  assert.ok(summary.includes('**Versions tested** `0.2.0` → Not reached'));
  assert.ok(summary.includes('**Selected upgrade** `0.2.3`'));
  assert.ok(summary.includes('| Updater manifest | Failed |'));
  assert.ok(summary.includes('| Upgrade installer (verified by the updater) | Not verified |'));
  assert.ok(summary.includes('**GitHub API rate-limit retries** 0'));
  assert.match(
    formatPublishedUpgradeSummary('win32-x64', null),
    /No native test report was produced/,
  );
});
