import { useEffect, useState } from 'react';

export function WindowControls({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = window.gleech.onWindowStateChanged((state) => {
      changed = true;
      if (active) setMaximized(state.maximized);
    });
    void window.gleech.windowState().then(
      (state) => {
        if (active && !changed) setMaximized(state.maximized);
      },
      () => {
        if (active) onError('Could not read the window state.');
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [onError]);

  const run = (action: () => Promise<void>) => {
    void action().catch(() => onError('Could not change the window state.'));
  };
  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => run(() => window.gleech.minimizeWindow())}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1 6.5h10" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => run(() => window.gleech.toggleMaximizeWindow())}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          {maximized ? <path d="M3.5 3.5v-2h7v7h-2m-7-5h7v7h-7z" /> : <path d="M1.5 1.5h9v9h-9z" />}
        </svg>
      </button>
      <button
        type="button"
        className="window-close"
        aria-label="Close window"
        title="Close"
        onClick={onClose}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m1.5 1.5 9 9m0-9-9 9" />
        </svg>
      </button>
    </div>
  );
}
