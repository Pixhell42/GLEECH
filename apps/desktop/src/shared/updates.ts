export interface UpdateRelease {
  version: string;
  notes: string;
  url: string;
  tag: string;
  asset: string;
  downloadUrl: string;
  bytes: number;
  sha256: string;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateState {
  revision: number;
  currentVersion: string;
  automatic: boolean;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  release: UpdateRelease | null;
  progress: UpdateProgress | null;
  checkedAt: string | null;
  error: string | null;
  dismissedVersion: string | null;
  installMode: 'native' | 'finder' | 'unavailable';
  unavailableReason: string | null;
  whatsNew: { version: string; notes: string } | null;
}

export interface UpdatePreferences {
  automatic: boolean;
  dismissedVersion: string | null;
  lastSeenVersion: string;
  pendingNotes: { version: string; notes: string } | null;
}

export interface UpdateSessionOptions {
  dirty: boolean;
  mode: 'image' | 'timeline';
  playhead: number;
}

export type RestoredUpdateSession = Omit<import('./image-api').OpenedProject, 'document'> & {
  document: import('./image-api').ProjectDocument | null;
  sessionId: string;
  dirty: boolean;
  mode: 'image' | 'timeline';
  playhead: number;
};
