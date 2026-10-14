import { describe, expect, it, vi } from 'vitest';
import { createFeedbackService } from './feedback-service';
import type { FeedbackAuth } from './feedback-auth-store';
import { feedbackIssue, validateFeedback, type FeedbackDraft } from '../shared/feedback';
import { feedbackStack } from '../shared/feedback';
import { createEffect, createProject } from '@gleech/project-model';

const environment = { version: '0.1.0', platform: 'win32 10', electron: '44', chromium: '152' };
const draft: FeedbackDraft = {
  requestId: '12345678-abcd-4abc-8abc-123456789abc',
  kind: 'bug',
  title: 'Preview problem',
  description: 'The preview is blank.',
  context: 'Open sample',
  expected: 'See image',
};
const issue = {
  number: 42,
  html_url: 'https://github.com/Pixhell42/GLEECH/issues/42',
  body: feedbackIssue(draft, environment).body,
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function fixture(connected = false, clientId = 'public-client-id') {
  let time = 1000000;
  let saved: FeedbackAuth | null = connected
    ? { token: 'fixture-token', login: 'Tester', expiresAt: time + 28800000 }
    : null;
  const store = {
    load: vi.fn(async () => saved),
    save: vi.fn(async (value: FeedbackAuth) => {
      saved = value;
    }),
    clear: vi.fn(async () => {
      saved = null;
    }),
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    throw new Error('Unexpected network request');
  });
  const service = createFeedbackService({ clientId, environment, store, fetch, now: () => time });
  return {
    service,
    store,
    fetch,
    advance: (ms = 5000) => {
      time += ms;
    },
  };
}
async function start(f: ReturnType<typeof fixture>) {
  f.fetch.mockResolvedValueOnce(
    response({
      device_code: 'private-device-code',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }),
  );
  const code = await f.service.startSignIn();
  expect(code).toEqual({ userCode: 'ABCD-EFGH', expiresAt: 1900000, retryAfterMs: 5000 });
  expect(JSON.stringify(code)).not.toContain('private-device-code');
  return code;
}

describe('native feedback validation', () => {
  it('includes opted-in stack settings without embedded project assets', () => {
    const effect = createEffect('motion-mosh', 'diagnostic');
    const project = {
      ...createProject('Diagnostic'),
      masterSeed: 456,
      effects: [
        {
          ...effect,
          image: { png: 'private-image-pixels', source: { name: 'C:/private/image.png' } },
          paintedMask: { strokes: ['private-stroke-data'] },
        },
      ],
    } as unknown as Parameters<typeof feedbackStack>[0];
    const stack = feedbackStack(project);
    const result = feedbackIssue({ ...draft, stack }, environment);
    expect(result.body).toContain('Effect stack and seed');
    expect(result.body).toContain('"seed": 456');
    expect(result.body).toContain('"type": "motion-mosh"');
    expect(result.body).not.toContain('private-');
    expect(result.body).not.toContain('C:/');
    expect(feedbackIssue(draft, environment).body).not.toContain('Effect stack and seed');
    expect(validateFeedback({ ...draft, stack: { ...stack, token: 'secret' } }).stack).toEqual(
      stack,
    );
  });
  it('rejects oversized or malformed stack attachments', () => {
    const stack = feedbackStack({
      ...createProject('Diagnostic'),
      effects: [createEffect('motion-mosh', 'diagnostic')],
    });
    for (const value of [
      null,
      { ...stack, seed: -1 },
      { ...stack, effects: Array(101).fill(stack.effects[0]) },
      { ...stack, effects: [{ ...stack.effects[0], params: { test: Infinity } }] },
      {
        ...stack,
        effects: [
          { ...stack.effects[0], application: { region: 'all', coverage: 2, softness: 0 } },
        ],
      },
    ])
      expect(() => validateFeedback({ ...draft, stack: value })).toThrow();
  });
  it('builds distinct bug/feature sections and environment details', () => {
    expect(feedbackIssue(draft, environment)).toEqual({
      title: '[Bug] Preview problem',
      body: expect.stringContaining('### Steps to reproduce\n\nOpen sample'),
    });
    const feature = feedbackIssue(
      { ...draft, kind: 'feature', context: '', expected: 'Add controls' },
      environment,
    );
    expect(feature.title).toBe('[Feature] Preview problem');
    expect(feature.body).toContain('### Suggested behavior\n\nAdd controls');
    expect(feature.body).not.toContain('Steps to reproduce');
    expect(feature.body).toContain('GLEECH 0.1.0 (beta)\nOS: win32 10');
    const bug = feedbackIssue(
      { ...draft, context: '', expected: '', version: 'user-supplied-version' },
      { ...environment, version: '2.3.4' },
    );
    expect(bug.body).toContain('GLEECH 2.3.4 (beta)\nOS: win32 10');
    expect(bug.body).not.toContain('user-supplied-version');
  });
  it('bounds input, strips extra properties and rejects invalid forms', () => {
    expect(validateFeedback({ ...draft, title: ' Preview problem ', token: 'bad' })).toEqual(draft);
    for (const value of [
      null,
      {},
      { ...draft, title: ' ' },
      { ...draft, description: '' },
      { ...draft, context: '\0' },
      { ...draft, title: 'a'.repeat(201) },
      { ...draft, kind: 'other' },
      { ...draft, requestId: 'not-uuid' },
    ])
      expect(() => validateFeedback(value)).toThrow();
  });
});

describe('GitHub device sign-in', () => {
  it('leaves unconfigured builds editable without attempting network sign-in', async () => {
    const f = fixture(false, '');
    expect(await f.service.status()).toEqual({ configured: false, login: null });
    await expect(f.service.startSignIn()).rejects.toThrow('not configured');
    await expect(f.service.submit(draft)).rejects.toThrow('Sign in');
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('enforces polling interval and slow_down before storing a verified identity', async () => {
    const f = fixture();
    await start(f);
    expect(await f.service.copySignInCode()).toBe('ABCD-EFGH');
    expect(await f.service.pollSignIn()).toEqual({ state: 'pending', retryAfterMs: 5000 });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    f.advance();
    f.fetch.mockResolvedValueOnce(response({ error: 'authorization_pending' }));
    expect(await f.service.pollSignIn()).toEqual({ state: 'pending', retryAfterMs: 5000 });
    f.advance();
    f.fetch.mockResolvedValueOnce(response({ error: 'slow_down' }));
    expect(await f.service.pollSignIn()).toEqual({ state: 'pending', retryAfterMs: 10000 });
    f.advance();
    expect(await f.service.pollSignIn()).toEqual({ state: 'pending', retryAfterMs: 5000 });
    f.advance();
    f.fetch.mockResolvedValueOnce(response({ access_token: 'fixture-token', expires_in: 999999 }));
    f.fetch.mockResolvedValueOnce(response({ login: 'Tester' }));
    expect(await f.service.pollSignIn()).toEqual({ state: 'connected', login: 'Tester' });
    expect(await f.service.status()).toEqual({ configured: true, login: 'Tester' });
    expect(f.store.save).toHaveBeenCalledWith({
      token: 'fixture-token',
      login: 'Tester',
      expiresAt: 29820000,
    });
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://github.com/login/device/code',
      'https://github.com/login/oauth/access_token',
      'https://github.com/login/oauth/access_token',
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
    ]);
    expect(f.fetch.mock.calls[3]![1]!.body).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code',
    );
    await f.service.signOut();
    expect(f.store.clear).toHaveBeenCalled();
    expect(await f.service.status()).toEqual({ configured: true, login: null });
  });
  it.each(['access_denied', 'expired_token'])(
    'handles %s without saving credentials',
    async (error) => {
      const f = fixture();
      await start(f);
      f.advance();
      f.fetch.mockResolvedValueOnce(response({ error }));
      await expect(f.service.pollSignIn()).rejects.toThrow(
        error === 'access_denied' ? 'declined' : 'expired',
      );
      expect(f.service.canOpenSignIn()).toBe(false);
      expect(f.store.save).not.toHaveBeenCalled();
    },
  );
  it('expires a code locally and invalidates canceled authorizations', async () => {
    const f = fixture();
    await start(f);
    f.advance(900000);
    await expect(f.service.pollSignIn()).rejects.toThrow('expired');
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const g = fixture();
    await start(g);
    g.advance();
    let release!: (value: Response) => void;
    g.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = g.service.pollSignIn();
    g.service.cancelSignIn();
    release(response({ access_token: 'canceled-token' }));
    await expect(pending).rejects.toThrow('canceled');
    expect(g.store.save).not.toHaveBeenCalled();
    await expect(g.service.copySignInCode()).rejects.toThrow('Start');
  });
  it('rejects unexpected verification destinations and unverified accounts', async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(
      response({
        device_code: 'x',
        user_code: 'x',
        expires_in: 900,
        verification_uri: 'https://attacker.example',
      }),
    );
    await expect(f.service.startSignIn()).rejects.toThrow('Could not start');
    await start(f);
    f.advance();
    f.fetch.mockResolvedValueOnce(response({ access_token: 'fixture-token' }));
    f.fetch.mockResolvedValueOnce(response({ login: '../other' }));
    await expect(f.service.pollSignIn()).rejects.toThrow('verify');
    expect(f.store.save).not.toHaveBeenCalled();
  });
  it('clears expired saved credentials', async () => {
    const f = fixture(true);
    f.advance(28800000);
    expect((await f.service.status()).login).toBeNull();
    expect(f.store.clear).toHaveBeenCalledTimes(1);
  });
});

describe('native issue submission', () => {
  it('posts once, keeps tokens private and returns a verified receipt', async () => {
    const f = fixture(true);
    f.fetch.mockResolvedValueOnce(response(issue, 201));
    expect(await f.service.submit(draft)).toEqual({ number: 42 });
    expect(await f.service.submit(draft)).toEqual({ number: 42 });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = f.fetch.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/Pixhell42/GLEECH/issues');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(feedbackIssue(draft, environment));
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
    expect(JSON.stringify(await f.service.status())).not.toContain('fixture-token');
    await expect(f.service.submit({ ...draft, title: 'Changed' })).rejects.toThrow('changed');
  });
  it('blocks concurrent POSTs and sign-out during submission', async () => {
    const f = fixture(true);
    await f.service.status();
    let release!: (value: Response) => void;
    f.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = f.service.submit(draft);
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1));
    await expect(f.service.submit(draft)).rejects.toThrow('already');
    await expect(f.service.signOut()).rejects.toThrow('Wait');
    release(response(issue, 201));
    expect(await first).toEqual({ number: 42 });
  });
  it('recovers an interrupted response without repeating POST', async () => {
    const f = fixture(true);
    f.fetch.mockRejectedValueOnce(new Error('Network dropped'));
    f.fetch.mockResolvedValueOnce(response([issue]));
    expect(await f.service.submit(draft)).toEqual({ number: 42 });
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('reconciles uncertain retries and refuses to send a second issue', async () => {
    const f = fixture(true);
    f.fetch.mockRejectedValueOnce(new Error('Network dropped'));
    f.fetch.mockResolvedValueOnce(response([]));
    await expect(f.service.submit(draft)).rejects.toThrow('may have reached');
    f.fetch.mockResolvedValueOnce(response([]));
    await expect(f.service.submit(draft)).rejects.toThrow('earlier submission');
    f.fetch.mockResolvedValueOnce(response([issue]));
    expect(await f.service.submit(draft)).toEqual({ number: 42 });
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it.each([401, 403, 404, 422, 429])(
    'handles HTTP %s while preserving the draft for retry',
    async (status) => {
      const f = fixture(true);
      f.fetch.mockResolvedValueOnce(response({}, status));
      await expect(f.service.submit(draft)).rejects.toThrow();
      if (status === 401) {
        expect(f.store.clear).toHaveBeenCalled();
        expect((await f.service.status()).login).toBeNull();
      } else {
        f.fetch.mockResolvedValueOnce(response(issue, 201));
        expect(await f.service.submit(draft)).toEqual({ number: 42 });
      }
      expect(draft.description).toBe('The preview is blank.');
    },
  );
  it('refuses an unverified success URL and checks status before retry', async () => {
    const f = fixture(true);
    f.fetch.mockResolvedValueOnce(
      response({ ...issue, html_url: 'https://other.example/42' }, 201),
    );
    await expect(f.service.submit(draft)).rejects.toThrow('verify');
    f.fetch.mockResolvedValueOnce(response([issue]));
    expect(await f.service.submit(draft)).toEqual({ number: 42 });
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
