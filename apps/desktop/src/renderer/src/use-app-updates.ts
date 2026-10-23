import { useCallback, useEffect, useState } from 'react';
import { unwrap } from '../../shared/image-api';
import type { UpdateState } from '../../shared/updates';

export function useAppUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  const applyState = useCallback(
    (next: UpdateState) =>
      setState((current) => (!current || next.revision >= current.revision ? next : current)),
    [],
  );
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true,
      changed = false;
    const stop = window.gleech.onUpdateStateChanged((next) => {
      changed = true;
      if (active) {
        applyState(next);
        setError('');
      }
    });
    void window.gleech
      .updateState()
      .then((result) => {
        if (active && !changed) applyState(unwrap(result));
      })
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : 'Could not load update settings.');
      });
    return () => {
      active = false;
      stop();
    };
  }, [applyState]);
  return { state, setState: applyState, error };
}
