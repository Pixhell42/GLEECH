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
