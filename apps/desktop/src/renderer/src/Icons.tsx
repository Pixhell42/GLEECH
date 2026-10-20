import type { ReactNode } from 'react';

// One stroke icon set for the toolbar and panels: 24px grid, round caps, currentColor.
function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export const DiceIcon = () => (
  <Icon size={15}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <circle cx="9" cy="9" r="0.9" fill="currentColor" />
    <circle cx="15" cy="9" r="0.9" fill="currentColor" />
    <circle cx="9" cy="15" r="0.9" fill="currentColor" />
    <circle cx="15" cy="15" r="0.9" fill="currentColor" />
  </Icon>
);

export const SparkleIcon = () => (
  <Icon size={15}>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
    <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Icon>
);

export const HeartIcon = () => (
  <Icon>
    <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
  </Icon>
);

export const FlagIcon = () => (
  <Icon>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon size={15}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const RefreshIcon = () => (
  <Icon size={15}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v4h-4" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12M10 11v6M14 11v6" />
  </Icon>
);

export const MaskIcon = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 4v16M12 8h4m-4 4h4m-4 4h4" />
  </Icon>
);
export const EyeIcon = ({ open }: { open: boolean }) => (
  <Icon>
    {open ? (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M3 10s3 6 9 6 9-6 9-6M5 14l-2 3m6-1-1 4m7-4 1 4m3-6 2 3" />
      </>
    )}
  </Icon>
);
export const StagesIcon = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="4" rx="1" />
    <path d="M4 12h16M4 16h16M4 20h16" />
  </Icon>
);
export const CameraIcon = () => (
  <Icon>
    <path d="M3 7h5l2-3h4l2 3h5v13H3z" />
    <circle cx="12" cy="13" r="4" />
  </Icon>
);
export const BakeIcon = () => (
  <Icon>
    <path d="M4 12h16m-6-6 6 6-6 6M4 5v14" />
  </Icon>
);
export const FitIcon = () => (
  <Icon>
    <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
export const BugIcon = () => (
  <Icon size={14}>
    <rect x="7" y="7" width="10" height="13" rx="5" />
    <path d="M9 3l3 4 3-4M3 10h4m10 0h4M3 16h4m10 0h4M12 7v13" />
  </Icon>
);
export const IdeaIcon = () => (
  <Icon size={14}>
    <path d="M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7zM9 20h6" />
  </Icon>
);

// Timeline and render icons. Transport glyphs are filled, like media controls.
function Solid({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ImageModeIcon = () => (
  <Icon size={14}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="m3.5 16 5-5 4 4 3-3 5 5" />
  </Icon>
);

export const TimelineModeIcon = () => (
  <Icon size={14}>
    <path d="M4 7h16M4 12h10M4 17h13" />
    <path d="M17 10v4" className="icon-accent" />
  </Icon>
);

export const PlayIcon = () => (
  <Solid>
    <path d="M7 4.5v15l12.5-7.5z" />
  </Solid>
);

export const PauseIcon = () => (
  <Solid>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Solid>
);

export const GoToStartIcon = () => (
  <Solid>
    <path d="M6 5h2v14H6zM19 5v14L9 12z" />
  </Solid>
);

export const GoToEndIcon = () => (
  <Solid>
    <path d="M16 5h2v14h-2zM5 5v14l10-7z" />
  </Solid>
);

export const PreviousKeyIcon = () => (
  <Solid>
    <path d="M15 5v14L6 12z" />
    <path d="M18 9l3 3-3 3-3-3z" opacity=".55" />
  </Solid>
);

export const NextKeyIcon = () => (
  <Solid>
    <path d="M9 5v14l9-7z" />
    <path d="M6 9l3 3-3 3-3-3z" opacity=".55" />
  </Solid>
);

export const StepBackIcon = () => (
  <Solid>
    <path d="M7 6h2v12H7zM18 6v12l-8-6z" />
  </Solid>
);

export const StepForwardIcon = () => (
  <Solid>
    <path d="M15 6h2v12h-2zM6 6v12l8-6z" />
  </Solid>
);

export const LoopIcon = () => (
  <Icon size={15}>
    <path d="M17 3l3 3-3 3" />
    <path d="M4 12V9a3 3 0 0 1 3-3h13" />
    <path d="M7 21l-3-3 3-3" />
    <path d="M20 12v3a3 3 0 0 1-3 3H4" />
  </Icon>
);

export const SnapIcon = () => (
  <Icon size={15}>
    <path d="M6 4v7a6 6 0 0 0 12 0V4" />
    <path d="M6 8h3M15 8h3" />
  </Icon>
);

export const FitWidthIcon = () => (
  <Icon size={14}>
    <path d="M3 12h18" />
    <path d="M7 8l-4 4 4 4M17 8l4 4-4 4" />
  </Icon>
);

export const RenderIcon = () => (
  <Icon size={14}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 9h18M3 15h18M8 5v4M16 5v4M8 15v4M16 15v4" />
  </Icon>
);

export const VideoIcon = () => (
  <Icon size={14}>
    <rect x="3" y="6" width="13" height="12" rx="2.5" />
    <path d="m16 10 5-3v10l-5-3" />
  </Icon>
);

export const WaveformIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
  </Icon>
);

export const SpeakerIcon = ({ muted = false, size = 14 }: { muted?: boolean; size?: number }) => (
  <Icon size={size}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {muted ? (
      <path d="m16 9.5 5 5m0-5-5 5" />
    ) : (
      <>
        <path d="M15.5 9a4 4 0 0 1 0 6" />
        <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
      </>
    )}
  </Icon>
);

export const SineIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" />
  </Icon>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon size={12}>
    <path d={open ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} />
  </Icon>
);

export const PopupChevronIcon = () => (
  <Icon size={9}>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </Icon>
);

export const LockIcon = ({ locked }: { locked: boolean }) => (
  <Icon size={14}>
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path d={locked ? 'M8 10V6a4 4 0 0 1 8 0v4' : 'M8 10V6a4 4 0 0 1 8 0'} />
    <path d="M12 14v3" />
  </Icon>
);

export const SeedIcon = () => (
  <Icon size={14}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <circle cx="9" cy="9" r="0.9" fill="currentColor" />
    <circle cx="15" cy="15" r="0.9" fill="currentColor" />
  </Icon>
);

export const EaseLinearIcon = () => (
  <Icon size={15}>
    <path d="M5 19 19 5" />
  </Icon>
);

export const EaseInOutIcon = () => (
  <Icon size={15}>
    <path d="M5 19c7 0 7-14 14-14" />
  </Icon>
);

export const EaseHoldIcon = () => (
  <Icon size={15}>
    <path d="M5 19h7V5h7" />
  </Icon>
);

export const FolderIcon = () => (
  <Icon size={14}>
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Icon>
);

export const SequenceIcon = () => (
  <Icon size={14}>
    <rect x="7" y="7" width="13" height="13" rx="2" />
    <path d="M4 16V6a2 2 0 0 1 2-2h10" />
  </Icon>
);

/** Keyframe diamond: outline when animated without a key here, solid at a key. */
export const DiamondIcon = ({ filled, size = 12 }: { filled: boolean; size?: number }) => (
  <svg
    className="ui-icon keyframe-diamond-icon"
    width={size}
    height={size}
    viewBox="0 0 12 12"
    aria-hidden="true"
  >
    {filled ? (
      <path d="M6 .8 11.2 6 6 11.2.8 6z" fill="currentColor" />
    ) : (
      <path d="M6 1.5 10.5 6 6 10.5 1.5 6z" fill="none" stroke="currentColor" strokeWidth="1.4" />
    )}
  </svg>
);

export const TriangleLeftIcon = () => (
  <svg className="ui-icon" width="8" height="10" viewBox="0 0 8 10" aria-hidden="true">
    <path d="M6 0v10L0 5z" fill="currentColor" />
  </svg>
);

export const TriangleRightIcon = () => (
  <svg className="ui-icon" width="8" height="10" viewBox="0 0 8 10" aria-hidden="true">
    <path d="M2 0v10l6-5z" fill="currentColor" />
  </svg>
);
