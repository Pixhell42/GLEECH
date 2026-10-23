import { useEffect, useState } from 'react';
import { unwrap } from '../../shared/image-api';
import { BugIcon, IdeaIcon } from './Icons';
import type { ProjectState } from '@gleech/project-model';
import { feedbackStack } from '../../shared/feedback';
import type {
  FeedbackDraft,
  FeedbackKind,
  FeedbackReceipt,
  FeedbackSignIn,
  FeedbackStatus,
} from '../../shared/feedback';

const FEEDBACK_TABS: readonly { kind: FeedbackKind; label: string }[] = [
  { kind: 'bug', label: 'Bug Report' },
  { kind: 'feature', label: 'Feature Request' },
];

export function FeedbackPanel({
  draft,
  project,
  onChange,
  onKind,
  onBusyChange,
}: {
  draft: FeedbackDraft;
  project: ProjectState;
  onChange(draft: FeedbackDraft): void;
  onKind(kind: FeedbackKind): void;
  onBusyChange(busy: boolean): void;
}) {
  const [connection, setConnection] = useState<FeedbackStatus | null>(null);
  const [signIn, setSignIn] = useState<FeedbackSignIn | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<FeedbackReceipt | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const bug = draft.kind === 'bug';
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => {
    let active = true;
    void window.gleech
      .feedbackStatus()
      .then((result) => {
        if (active) setConnection(unwrap(result));
      })
      .catch(() => {
        if (active) setError('Could not load GitHub sign-in.');
      });
    return () => {
      active = false;
      void window.gleech.cancelFeedbackSignIn();
    };
  }, []);
  useEffect(() => {
    if (!signIn) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = unwrap(await window.gleech.pollFeedbackSignIn());
        if (!active) return;
        if (result.state === 'connected') {
          setConnection({ configured: true, login: result.login });
          setSignIn(null);
          setNotice('Connected to GitHub');
        } else timer = setTimeout(() => void poll(), result.retryAfterMs);
      } catch (failure) {
        if (active) {
          setError(failure instanceof Error ? failure.message : 'GitHub sign-in failed.');
          setSignIn(null);
        }
      }
    };
    timer = setTimeout(() => void poll(), signIn.retryAfterMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [signIn]);
  const connect = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const code = unwrap(await window.gleech.startFeedbackSignIn());
      setSignIn(code);
      unwrap(await window.gleech.openFeedbackSignIn());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start GitHub sign-in.');
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const report = { ...draft };
      if (!bug) delete report.stack;
      setReceipt(unwrap(await window.gleech.submitFeedback(report)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not submit your report.');
      try {
        setConnection(unwrap(await window.gleech.feedbackStatus()));
      } catch {
        /* Keep the form for retry. */
      }
    } finally {
      setBusy(false);
    }
  };
  const update = (key: 'title' | 'description' | 'context' | 'expected', value: string) => {
    onChange({ ...draft, [key]: value, requestId: crypto.randomUUID() });
  };
  return (
    <div className="feedback-panel" role="region" aria-label="Feedback form">
      <div className="feedback-header">
        <h4 className="visually-hidden">{bug ? 'Bug Report' : 'Feature Request'}</h4>
        <div className="feedback-tabs" role="tablist" aria-label="Feedback type">
          {FEEDBACK_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              id={`feedback-tab-${tab.kind}`}
              aria-selected={draft.kind === tab.kind}
              aria-controls="feedback-panel"
              tabIndex={draft.kind === tab.kind ? 0 : -1}
              disabled={busy}
              onClick={() => {
                if (draft.kind === tab.kind) return;
                setReceipt(null);
                setError('');
                setNotice('');
                onKind(tab.kind);
              }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault();
                const next = tab.kind === 'bug' ? 'feature' : 'bug';
                setReceipt(null);
                setError('');
                setNotice('');
                onKind(next);
                window.document.getElementById(`feedback-tab-${next}`)?.focus();
              }}
            >
              {tab.kind === 'bug' ? <BugIcon /> : <IdeaIcon />}
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div id="feedback-panel" role="tabpanel" aria-labelledby={`feedback-tab-${draft.kind}`}>
        {receipt ? (
          <>
            <p role="status">
              {bug ? 'Bug report' : 'Feature request'} submitted as #{receipt.number}. Thank you!
            </p>
            <div className="stage-dialog-actions">
              <button
                onClick={() =>
                  void window.gleech
                    .openFeedbackIssue(receipt.number)
                    .then((result) => unwrap(result))
                    .catch(() => setError('Could not open the issue.'))
                }
              >
                View on GitHub
              </button>
              <button onClick={() => setReceipt(null)}>Done</button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && connection?.login) void submit();
            }}
          >
            <div className="feedback-connection">
              {connection?.login ? (
                <>
                  <span>
                    Signed in as <strong>{connection.login}</strong>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        unwrap(await window.gleech.signOutFeedback());
                        setConnection({ configured: true, login: null });
                      } catch (failure) {
                        setError(
                          failure instanceof Error ? failure.message : 'Could not sign out.',
                        );
                      }
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : signIn ? (
                <>
                  <p>Enter this code on GitHub to connect GLEECH:</p>
                  <code>{signIn.userCode}</code>
                  <div className="feedback-signin-actions">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          unwrap(await window.gleech.copyFeedbackSignInCode());
                          setNotice('Copied sign-in code');
                        } catch {
                          setError('Could not copy the sign-in code.');
                        }
                      }}
                    >
                      Copy Code
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void window.gleech
                          .openFeedbackSignIn()
                          .then((result) => unwrap(result))
                          .catch(() => setError('Could not open GitHub sign-in.'))
                      }
                    >
                      Open GitHub Sign-in
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void window.gleech.cancelFeedbackSignIn();
                        setSignIn(null);
                      }}
                    >
                      Cancel Sign-in
                    </button>
                  </div>
                  <p className="quiet">Waiting for authorization…</p>
                </>
              ) : (
                <>
                  <span>
                    {connection === null
                      ? 'Loading GitHub connection…'
                      : connection.configured
                        ? 'Connect GitHub to submit from GLEECH.'
                        : 'GitHub sign-in is not configured for this build yet.'}
                  </span>
                  <button
                    type="button"
                    disabled={busy || !connection?.configured}
                    onClick={() => void connect()}
                  >
                    Sign in with GitHub
                  </button>
                </>
              )}
            </div>
            <label>
              {bug ? 'Summary' : 'Idea'}
              <input
                aria-label="Report title"
                required
                maxLength={200}
                value={draft.title}
                disabled={busy}
                placeholder={bug ? 'Short description of the issue' : 'What would you like to see?'}
                onChange={(e) => update('title', e.target.value)}
              />
            </label>
            <label>
              {bug ? 'What happened?' : 'How would you use it?'}
              <textarea
                aria-label="Report description"
                required
                maxLength={10000}
                rows={4}
                value={draft.description}
                disabled={busy}
                placeholder={
                  bug
                    ? 'Describe the issue, what you expected, and how to reproduce it…'
                    : 'What problem would this solve?'
                }
                onChange={(e) => update('description', e.target.value)}
              />
            </label>
            <details className="feedback-extra">
              <summary>Additional details (optional)</summary>
              <label>
                {bug ? 'Steps to reproduce' : 'Problem or use case'}
                <textarea
                  aria-label={bug ? 'Steps to reproduce' : 'Problem or use case'}
                  maxLength={6000}
                  rows={3}
                  value={draft.context}
                  disabled={busy}
                  onChange={(e) => update('context', e.target.value)}
                />
              </label>
              <label>
                {bug ? 'Expected behavior' : 'Suggested behavior'}
                <textarea
                  aria-label={bug ? 'Expected behavior' : 'Suggested behavior'}
                  maxLength={6000}
                  rows={3}
                  value={draft.expected}
                  disabled={busy}
                  onChange={(e) => update('expected', e.target.value)}
                />
              </label>
            </details>
            {bug && (
              <label className="feedback-attach">
                <input
                  type="checkbox"
                  aria-label="Attach effect stack and seed"
                  disabled={busy || (!project.source && !draft.stack)}
                  checked={Boolean(draft.stack)}
                  onChange={(event) => {
                    const rest = { ...draft };
                    delete rest.stack;
                    onChange({
                      ...rest,
                      requestId: crypto.randomUUID(),
                      ...(event.target.checked ? { stack: feedbackStack(project) } : {}),
                    });
                  }}
                />
                Attach effect stack and seed
              </label>
            )}
            {bug && draft.stack && (
              <p className="quiet">
                {draft.stack.effects.length} effects · seed {draft.stack.seed}. Includes settings,
                without image assets or painted strokes.
              </p>
            )}
            <p className="quiet">App and operating system details are included with your report.</p>
            <div className="stage-dialog-actions">
              <button
                className="primary-button"
                type="submit"
                aria-label="Submit to GitHub"
                disabled={busy || !connection?.login}
              >
                {busy ? 'Working…' : bug ? 'Send Report' : 'Send Request'}
              </button>
            </div>
          </form>
        )}
      </div>
      {error && (
        <p className="feedback-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
