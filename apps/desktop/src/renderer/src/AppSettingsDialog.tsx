import { useEffect, useRef, useState } from 'react';
import { APP_VERSION_LABEL } from '../../shared/branding';
import { unwrap } from '../../shared/image-api';
import type { UpdateState } from '../../shared/updates';
import type { FeedbackDraft, FeedbackKind } from '../../shared/feedback';
import type { ProjectState } from '@gleech/project-model';
import { CloseIcon } from './Icons';
import { SupportPanel } from './SupportPanel';
import { FeedbackPanel } from './FeedbackPanel';

export type SettingsSection = 'updates' | 'donate' | 'feedback' | 'community' | 'about';
const SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'updates', label: 'Updates' },
  { id: 'donate', label: 'Donate' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'community', label: 'Community' },
  { id: 'about', label: 'About' },
];

export function AppSettingsDialog({
  update,
  updateError,
  onUpdate,
  onInstall,
  project,
  feedbackDraft,
  onFeedbackChange,
  onFeedbackKind,
  onClose,
}: {
  update: UpdateState | null;
  updateError: string;
  onUpdate(state: UpdateState): void;
  onInstall(): void;
  project: ProjectState;
  feedbackDraft: FeedbackDraft;
  onFeedbackChange(draft: FeedbackDraft): void;
  onFeedbackKind(kind: FeedbackKind): void;
  onClose(): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<SettingsSection>('updates');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingAutomatic, setPendingAutomatic] = useState<boolean | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  useEffect(() => {
    const dialog = modal.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  async function run(operation: () => Promise<unknown>) {
    setError('');
    setPending(true);
    try {
      await operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'This action failed.');
    } finally {
      setPending(false);
    }
  }
  const checking = update?.phase === 'checking';
  return (
    <dialog
      ref={modal}
      className="stage-dialog app-settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!feedbackBusy) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="app-settings-heading">
        <h2 id="settings-title">Settings</h2>
        <button
          type="button"
          className="ib"
          aria-label="Close settings"
          disabled={feedbackBusy}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="app-settings-layout">
        <nav aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              disabled={feedbackBusy}
              onClick={() => {
                setSection(item.id);
                setError('');
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <section
          key={section}
          className="app-settings-content"
          aria-labelledby={`settings-${section}`}
        >
          <h3 id={`settings-${section}`}>{SECTIONS.find((item) => item.id === section)!.label}</h3>
          {section === 'updates' && (
            <>
              <p className="quiet">{APP_VERSION_LABEL}</p>
              <label className="app-settings-toggle">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Automatic updates"
                  checked={pendingAutomatic ?? update?.automatic ?? true}
                  disabled={!update || pending}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setPendingAutomatic(enabled);
                    void run(async () => {
                      try {
                        onUpdate(unwrap(await window.gleech.setAutomaticUpdates(enabled)));
                      } finally {
                        setPendingAutomatic(null);
                      }
                    });
                  }}
                />
                <span>
                  <strong>Automatic updates</strong>
                  <small>
                    Download new versions in the background and notify you when they’re ready.
                    Choose Install &amp; Update to install.
                  </small>
                </span>
              </label>
              <p className="quiet">
                You can check for updates manually even when automatic updates are off.
              </p>
              {update?.unavailableReason && (
                <p className="settings-notice">{update.unavailableReason}</p>
              )}
              {update?.installMode === 'finder' && (
                <p className="settings-notice">
                  Mac updates download automatically. Install &amp; Update saves your session, quits
                  GLEECH and shows the ZIP in Finder. Extract it, replace GLEECH.app and reopen it
                  to restore your project.
                </p>
              )}
              <div className="app-settings-actions">
                <button
                  type="button"
                  disabled={
                    pending ||
                    !update ||
                    checking ||
                    update.installMode === 'unavailable' ||
                    update.phase === 'downloading' ||
                    update.phase === 'installing'
                  }
                  onClick={() =>
                    void run(async () => onUpdate(unwrap(await window.gleech.checkForUpdates())))
                  }
                >
                  {checking ? 'Checking…' : 'Check for updates now'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => unwrap(await window.gleech.openSupportLink('releases')))
                  }
                >
                  View releases
                </button>
              </div>
              <p role="status">
                {update?.phase === 'idle' && update.checkedAt
                  ? 'You’re up to date.'
                  : update?.phase === 'downloading'
                    ? `Downloading ${update.release?.version} · ${Math.round(update.progress?.percent ?? 0)}%`
                    : update?.phase === 'ready'
                      ? `${update.release?.version} is downloaded and ready.`
                      : update?.release
                        ? `GLEECH ${update.release.version} is available.`
                        : update
                          ? 'Automatic checks run at startup and every six hours.'
                          : 'Loading update preferences…'}
              </p>
              {update?.release && (
                <button
                  type="button"
                  className="primary"
                  disabled={update.phase === 'installing' || pending}
                  onClick={onInstall}
                >
                  Install &amp; Update
                </button>
              )}
              {update?.checkedAt && (
                <p className="quiet">Last checked {new Date(update.checkedAt).toLocaleString()}</p>
              )}
              {(update?.error || updateError) && <p role="alert">{update?.error || updateError}</p>}
            </>
          )}
          {section === 'donate' && <SupportPanel />}
          {section === 'feedback' && (
            <FeedbackPanel
              draft={feedbackDraft}
              project={project}
              onChange={onFeedbackChange}
              onKind={onFeedbackKind}
              onBusyChange={setFeedbackBusy}
            />
          )}
          {section === 'community' && (
            <>
              <p>
                Join the GLEECH Discord community to share your work, trade techniques, get help and
                follow what’s being built next.
              </p>
              <button
                type="button"
                onClick={() =>
                  void run(async () => unwrap(await window.gleech.openSupportLink('discord')))
                }
              >
                Join the Discord community
              </button>
            </>
          )}
          {section === 'about' && (
            <>
              <p className="settings-about-mark">
                GLEECH<span>{APP_VERSION_LABEL}</span>
              </p>
              <p>
                A creative workstation for procedural glitches, image effects, shaders and animated
                timelines. Build effect stacks, experiment with variations and take the same
                projects into the CLI and TUI.
              </p>
              <div className="app-settings-actions">
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => unwrap(await window.gleech.openSupportLink('repository')))
                  }
                >
                  View GitHub repository
                </button>
                <button
                  type="button"
                  onClick={() => void run(async () => unwrap(await window.gleech.copyAppVersion()))}
                >
                  Copy version
                </button>
              </div>
              <h4>Licenses</h4>
              <p>
                GLEECH is MIT licensed. Its runtime, native libraries, models, shaders and bundled
                FFmpeg retain their own licenses and notices.
              </p>
              <div className="app-settings-actions">
                {(['gleech', 'notices', 'licenses'] as const).map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    onClick={() =>
                      void run(async () => unwrap(await window.gleech.openAppLicenses(kind)))
                    }
                  >
                    {kind === 'gleech'
                      ? 'GLEECH license'
                      : kind === 'notices'
                        ? 'Third-party notices'
                        : 'Bundled licenses'}
                  </button>
                ))}
              </div>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
    </dialog>
  );
}
