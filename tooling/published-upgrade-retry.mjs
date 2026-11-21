import { setTimeout } from 'node:timers/promises';

export async function readGitHubRateLimit(response) {
  if (response.status !== 403 && response.status !== 429) return null;
  const retryAfter = response.headers.get('retry-after');
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  const message =
    response.status === 403 && retryAfter === null && remaining !== '0'
      ? (
          await response
            .clone()
            .json()
            .catch(() => null)
        )?.message
      : undefined;
  return { status: response.status, retryAfter, remaining, reset, message };
}

function rateLimitDelay(limit, retries, now) {
  if (
    !limit ||
    (limit.status !== 429 &&
      limit.retryAfter === null &&
      limit.remaining !== '0' &&
      !/\brate limit\b/i.test(limit.message ?? ''))
  )
    return null;
  const retryAfter = /^\d+$/.test(limit.retryAfter) ? Number(limit.retryAfter) * 1000 : -1;
  const reset =
    limit.remaining === '0' && /^\d+$/.test(limit.reset) ? Number(limit.reset) * 1000 - now : -1;
  if (retryAfter >= 0 || reset >= 0) return Math.max(retryAfter, reset) + 1000;
  return 60000 * 2 ** retries;
}

export function createGitHubRateLimitRetry({
  maxWaitMs,
  wait = setTimeout,
  now = Date.now,
  log = console.error,
}) {
  let remaining = maxWaitMs;
  return async (label, request, readLimit = readGitHubRateLimit) => {
    for (let retries = 0; ; retries++) {
      const result = await request();
      const limit = await readLimit(result);
      const delay = rateLimitDelay(limit, retries, now());
      if (delay === null) return result;
      if (retries >= 3 || delay > remaining)
        throw new Error(
          `GitHub API rate limit (HTTP ${limit.status}) for ${label} exceeded the retry budget. The next retry would need to wait ${Math.ceil(delay / 1000)}s.`,
        );
      remaining -= delay;
      log(
        `GitHub API rate limit (HTTP ${limit.status}) for ${label}. Retrying in ${Math.ceil(delay / 1000)}s (${retries + 1}/3).`,
      );
      await wait(delay);
    }
  };
}
