import { useCallback, useEffect, useRef, useState } from 'react';
import { unwrap } from '../../shared/image-api';
import type { UpdateState } from '../../shared/updates';
import { CloseIcon } from './Icons';

function UpdateModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose(): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = modal.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={modal}
      className="stage-dialog update-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" className="ib" aria-label="Close update dialog" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {children}
    </dialog>
  );
}

const bytes = (value: number) => `${(value / 1024 ** 2).toFixed(1)} MB`;

export function UpdateUi({
  state,
  onState,
  onInstall,
  progressOpen,
  onProgressOpen,
  modalBlocked,
}: {
  state: UpdateState | null;
  onState(state: UpdateState): void;
  onInstall(): Promise<void>;
  progressOpen: boolean;
  onProgressOpen(open: boolean): void;
  modalBlocked: boolean;
}) {
  const [intent, setIntent] = useState(false);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const installing = useRef(false);
  const previousOpen = useRef(false);
  const begin = useCallback(() => {
    setError('');
    setPreparing(false);
    setIntent(true);
    installing.current = false;
    if (state && !['downloading', 'ready', 'installing'].includes(state.phase))
      void window.gleech
        .downloadUpdate()
        .then((result) => onState(unwrap(result)))
        .catch((failure) =>
          setError(failure instanceof Error ? failure.message : 'Could not download the update.'),
        );
  }, [state, onState]);
  useEffect(() => {
    if (progressOpen && !previousOpen.current) begin();
    previousOpen.current = progressOpen;
  }, [progressOpen, begin]);
  useEffect(() => {
    if (!progressOpen || !intent || state?.phase !== 'ready' || installing.current) return;
    installing.current = true;
    setPreparing(true);
    void onInstall().catch((failure) => {
      setIntent(false);
      installing.current = false;
      setPreparing(false);
      setError(
        failure instanceof Error ? failure.message : 'Could not prepare GLEECH for the update.',
      );
    });
  }, [progressOpen, intent, state?.phase, onInstall]);
  const close = () => {
    if (state?.phase === 'installing' || (preparing && state?.phase !== 'error')) return;
    setIntent(false);
    onProgressOpen(false);
  };
  const dismissNotes = () => {
    if (state?.whatsNew)
      void window.gleech
        .acknowledgeReleaseNotes(state.whatsNew.version)
        .then((result) => onState(unwrap(result)))
        .catch((failure) => setError(String(failure)));
  };
  const notify =
    state?.automatic &&
    state.release &&
    state.dismissedVersion !== state.release.version &&
    !['idle', 'checking', 'installing'].includes(state.phase);
  return (
    <>
      {notify && !progressOpen && (
        <aside className="update-notification" role="status" aria-label="Software update">
          <button
            type="button"
            className="ib update-dismiss"
            aria-label="Dismiss update notification"
            onClick={() =>
              void window.gleech
                .dismissUpdate()
                .then((result) => onState(unwrap(result)))
                .catch((failure) => setError(String(failure)))
            }
          >
            <CloseIcon />
          </button>
          <strong>GLEECH {state.release!.version} is available</strong>
          <p>
            {state.phase === 'downloading'
              ? `Downloading in the background · ${Math.round(state.progress?.percent ?? 0)}%`
              : state.phase === 'ready'
                ? 'Downloaded and ready to install.'
                : 'A new version is ready to download.'}
          </p>
          <button type="button" className="primary" onClick={() => onProgressOpen(true)}>
            Install &amp; Update
          </button>
          {error && <p role="alert">{error}</p>}
        </aside>
      )}
      {progressOpen && state && (
        <UpdateModal
          title={`Update GLEECH${state.release ? ` to ${state.release.version}` : ''}`}
          onClose={close}
        >
          <p>
            {state.phase === 'installing'
              ? 'Saving your session and preparing to restart…'
              : state.phase === 'ready'
                ? 'Download verified. Preparing your project for the update…'
                : state.phase === 'error'
                  ? 'The update could not be completed.'
                  : 'Downloading and verifying the new version…'}
          </p>
          <progress
            aria-label="Update download progress"
            value={state.progress?.percent ?? 0}
            max={100}
          />
          <div className="update-progress-numbers">
            <strong>{Math.round(state.progress?.percent ?? 0)}%</strong>
            <span>
              {state.progress
                ? `${bytes(state.progress.transferred)} / ${bytes(state.progress.total)}`
                : 'Starting download…'}
            </span>
          </div>
          {state.progress && state.progress.bytesPerSecond > 0 && (
            <p className="quiet">{bytes(state.progress.bytesPerSecond)}/s</p>
          )}
          <p className="quiet">
            Your current project, including unsaved edits, will reopen after the update. Existing
            presets, shaders, recent files and paths are kept.
          </p>
          {state.installMode === 'finder' && (
            <p className="settings-notice">
              GLEECH will quit and select the verified ZIP in Finder. Extract it, replace GLEECH.app
              and reopen the app. Your working project will be restored.
            </p>
          )}
          {(error || state.error) && <p role="alert">{error || state.error}</p>}
          <div className="app-settings-actions">
            {(error || state.phase === 'error') && (
              <button type="button" onClick={begin}>
                Try again
              </button>
            )}
            <button
              type="button"
              disabled={state.phase === 'installing' || (preparing && state.phase !== 'error')}
              onClick={close}
            >
              {state.phase === 'downloading' ? 'Continue in background' : 'Close'}
            </button>
          </div>
        </UpdateModal>
      )}
      {state?.whatsNew && !progressOpen && !modalBlocked && (
        <UpdateModal
          title={`What’s new in GLEECH ${state.whatsNew.version}`}
          onClose={dismissNotes}
        >
          <div className="update-release-notes">{state.whatsNew.notes}</div>
          {error && <p role="alert">{error}</p>}
          <button type="button" className="primary" onClick={dismissNotes}>
            Let’s create
          </button>
        </UpdateModal>
      )}
    </>
  );
}
