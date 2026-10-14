import { SUPPORT_REPOSITORY, SUPPORT_REPOSITORY_SLUG } from '../shared/support';
import {
  feedbackIssue,
  validateFeedback,
  type FeedbackEnvironment,
  type FeedbackReceipt,
  type FeedbackSignIn,
  type FeedbackSignInProgress,
  type FeedbackStatus,
} from '../shared/feedback';
import type { FeedbackAuth, FeedbackAuthStore } from './feedback-auth-store';

export function createFeedbackService(options: {
  clientId: string;
  environment: FeedbackEnvironment;
  store: FeedbackAuthStore;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const request: typeof fetch = (...args) => (options.fetch ?? globalThis.fetch)(...args);
  const now = options.now ?? Date.now;
  const clientId = options.clientId.trim();
  const api = `https://api.github.com/repos/${SUPPORT_REPOSITORY_SLUG}`;
  let auth: FeedbackAuth | null = null;
  let loaded: Promise<void> | undefined;
  let flow: {
    code: string;
    userCode: string;
    expiresAt: number;
    interval: number;
    nextPoll: number;
    controller: AbortController;
  } | null = null;
  let polling = false;
  let submitting = false;
  const receipts = new Map<string, { fingerprint: string; receipt: FeedbackReceipt }>();
  const uncertain = new Map<string, { fingerprint: string; since: string }>();
  const ready = () =>
    (loaded ??= options.store.load().then((value) => {
      auth = value;
    }));
  const validAuth = async () => {
    await ready();
    if (auth && auth.expiresAt <= now() + 60000) {
      await options.store.clear();
      auth = null;
    }
    return auth;
  };
  const cancelSignIn = () => {
    flow?.controller.abort();
    flow = null;
  };
  async function json(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<{ response: Response; data: Record<string, unknown> }> {
    const response = await request(url, {
      ...init,
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024)
      throw new Error('GitHub returned an unexpectedly large response.');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('GitHub returned an invalid response.');
    }
    if (!data || typeof data !== 'object') throw new Error('GitHub returned an invalid response.');
    return { response, data: data as Record<string, unknown> };
  }
  const headers = (token: string) => ({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'GLEECH feedback',
  });
  const postForm = (values: Record<string, string>): RequestInit => ({
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'GLEECH feedback',
    },
    body: new URLSearchParams(values).toString(),
  });
  function receipt(data: Record<string, unknown>): FeedbackReceipt {
    if (
      !Number.isSafeInteger(data.number) ||
      Number(data.number) <= 0 ||
      data.html_url !== `${SUPPORT_REPOSITORY}/issues/${data.number}`
    )
      throw new Error('Could not verify the submitted GitHub issue.');
    return { number: Number(data.number) };
  }
  return {
    async status(): Promise<FeedbackStatus> {
      return { configured: Boolean(clientId), login: (await validAuth())?.login ?? null };
    },
    async startSignIn(): Promise<FeedbackSignIn> {
      await ready();
      if (!clientId) throw new Error('GitHub sign-in is not configured for this build yet.');
      cancelSignIn();
      const controller = new AbortController();
      const pending = {
        code: '',
        userCode: '',
        expiresAt: 0,
        interval: 5000,
        nextPoll: 0,
        controller,
      };
      flow = pending;
      try {
        const { response, data } = await json(
          'https://github.com/login/device/code',
          postForm({ client_id: clientId }),
          controller.signal,
        );
        if (flow !== pending) throw new Error('Sign-in canceled.');
        if (
          !response.ok ||
          typeof data.device_code !== 'string' ||
          typeof data.user_code !== 'string' ||
          data.verification_uri !== 'https://github.com/login/device' ||
          typeof data.expires_in !== 'number' ||
          data.expires_in <= 0 ||
          data.expires_in > 3600
        )
          throw new Error(
            'Could not start GitHub sign-in. Check the Client ID and device-flow setting.',
          );
        pending.code = data.device_code;
        pending.userCode = data.user_code;
        pending.expiresAt = now() + data.expires_in * 1000;
        pending.interval =
          typeof data.interval === 'number' ? Math.max(5000, data.interval * 1000) : 5000;
        pending.nextPoll = now() + pending.interval;
        return {
          userCode: pending.userCode,
          expiresAt: pending.expiresAt,
          retryAfterMs: pending.interval,
        };
      } catch (error) {
        if (flow === pending) cancelSignIn();
        throw error;
      }
    },
    cancelSignIn,
    async pollSignIn(): Promise<FeedbackSignInProgress> {
      const active = flow;
      if (!active || !active.code) throw new Error('Start GitHub sign-in again.');
      if (active.expiresAt <= now()) {
        cancelSignIn();
        throw new Error('The GitHub sign-in code expired. Try again.');
      }
      if (polling || active.nextPoll > now())
        return { state: 'pending', retryAfterMs: Math.max(1000, active.nextPoll - now()) };
      polling = true;
      active.nextPoll = now() + active.interval;
      try {
        const { response, data } = await json(
          'https://github.com/login/oauth/access_token',
          postForm({
            client_id: clientId,
            device_code: active.code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
          active.controller.signal,
        );
        if (flow !== active) throw new Error('Sign-in canceled.');
        if (data.error === 'authorization_pending')
          return { state: 'pending', retryAfterMs: active.interval };
        if (data.error === 'slow_down') {
          active.interval += 5000;
          active.nextPoll = now() + active.interval;
          return { state: 'pending', retryAfterMs: active.interval };
        }
        if (data.error === 'access_denied') {
          cancelSignIn();
          throw new Error('GitHub authorization was declined.');
        }
        if (data.error === 'expired_token') {
          cancelSignIn();
          throw new Error('The GitHub sign-in code expired. Try again.');
        }
        if (
          !response.ok ||
          typeof data.access_token !== 'string' ||
          !data.access_token ||
          data.access_token.length > 2048
        )
          throw new Error('GitHub sign-in did not complete. Try again.');
        const identity = await json(
          'https://api.github.com/user',
          { headers: headers(data.access_token) },
          active.controller.signal,
        );
        if (flow !== active) throw new Error('Sign-in canceled.');
        if (
          !identity.response.ok ||
          typeof identity.data.login !== 'string' ||
          !/^[a-zA-Z0-9-]{1,39}$/.test(identity.data.login)
        )
          throw new Error('Could not verify your GitHub account.');
        const expires =
          typeof data.expires_in === 'number' && data.expires_in > 0
            ? Math.min(data.expires_in, 28800)
            : 28800;
        const next = {
          token: data.access_token,
          login: identity.data.login,
          expiresAt: now() + expires * 1000,
        };
        await options.store.save(next);
        if (flow !== active) {
          await options.store.clear();
          throw new Error('Sign-in canceled.');
        }
        auth = next;
        cancelSignIn();
        return { state: 'connected', login: next.login };
      } finally {
        polling = false;
      }
    },
    async copySignInCode(): Promise<string> {
      if (!flow?.userCode) throw new Error('Start GitHub sign-in first.');
      return flow.userCode;
    },
    canOpenSignIn(): boolean {
      return Boolean(flow?.code);
    },
    async signOut() {
      if (submitting) throw new Error('Wait for your report to finish submitting.');
      cancelSignIn();
      await ready();
      await options.store.clear();
      auth = null;
      receipts.clear();
      uncertain.clear();
    },
    async submit(value: unknown): Promise<FeedbackReceipt> {
      const draft = validateFeedback(value);
      const issue = feedbackIssue(draft, options.environment);
      const fingerprint = JSON.stringify(issue);
      const previous = receipts.get(draft.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error('This report changed. Start a new submission.');
        return previous.receipt;
      }
      if (submitting) throw new Error('A report is already being submitted.');
      const account = await validAuth();
      if (!account) throw new Error('Sign in to GitHub to submit your report.');
      if (submitting) throw new Error('A report is already being submitted.');
      submitting = true;
      const priorAttempt = uncertain.get(draft.requestId);
      const since = priorAttempt?.since ?? new Date(now() - 60000).toISOString();
      const reconcile = async () => {
        const url = `${api}/issues?creator=${encodeURIComponent(account.login)}&state=all&per_page=100&since=${encodeURIComponent(since)}`;
        const { response, data } = await json(url, { headers: headers(account.token) });
        if (!response.ok || !Array.isArray(data)) return null;
        const found = data.find(
          (item: Record<string, unknown>) =>
            typeof item.body === 'string' &&
            item.body.includes(`<!-- gleech-feedback:${draft.requestId} -->`),
        );
        return found ? receipt(found) : null;
      };
      try {
        if (priorAttempt) {
          if (priorAttempt.fingerprint !== fingerprint)
            throw new Error('This report changed. Start a new submission.');
          const recovered = await reconcile();
          if (!recovered)
            throw new Error(
              'Could not confirm the earlier submission. Check GitHub before sending another report.',
            );
          receipts.set(draft.requestId, { fingerprint, receipt: recovered });
          uncertain.delete(draft.requestId);
          return recovered;
        }
        let reply: Awaited<ReturnType<typeof json>>;
        uncertain.set(draft.requestId, { fingerprint, since });
        try {
          reply = await json(`${api}/issues`, {
            method: 'POST',
            headers: { ...headers(account.token), 'Content-Type': 'application/json' },
            body: JSON.stringify(issue),
          });
        } catch {
          const recovered = await reconcile().catch(() => null);
          if (recovered) {
            receipts.set(draft.requestId, { fingerprint, receipt: recovered });
            uncertain.delete(draft.requestId);
            return recovered;
          }
          throw new Error(
            'Connection interrupted. Your report may have reached GitHub; retry to check its status without sending it again.',
          );
        }
        if (reply.response.status === 401) {
          uncertain.delete(draft.requestId);
          await options.store.clear();
          auth = null;
          throw new Error('GitHub sign-in expired. Sign in again to submit.');
        }
        if (reply.response.status === 403 || reply.response.status === 404) {
          uncertain.delete(draft.requestId);
          throw new Error(
            'This GitHub account or GLEECH app cannot create issues in the reporting repository. Check repository access and Issues permission.',
          );
        }
        if (reply.response.status === 422 || reply.response.status === 429) {
          uncertain.delete(draft.requestId);
          throw new Error('GitHub could not accept the report. Check the form or try again later.');
        }
        if (reply.response.status !== 201)
          throw new Error('GitHub could not confirm submission. Retry to check its status.');
        const result = receipt(reply.data);
        receipts.set(draft.requestId, { fingerprint, receipt: result });
        uncertain.delete(draft.requestId);
        if (receipts.size > 32) receipts.delete(receipts.keys().next().value!);
        return result;
      } finally {
        submitting = false;
      }
    },
  };
}
