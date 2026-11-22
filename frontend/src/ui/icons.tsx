import type { ComponentChildren } from "preact";

function Icon({ children, size = 18 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const CalendarIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);
export const ChevronDown = () => (
  <Icon size={14}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const CloseIcon = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const CheckIcon = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <path d="m5 12 5 5 9-10" stroke-width="2.6" />
  </Icon>
);
export const MenuIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);
export const DrawIcon = () => (
  <Icon>
    <path d="M5 7 12 4l7 4-2 9-8 3z" />
    <circle cx="5" cy="7" r="1.6" fill="currentColor" />
    <circle cx="12" cy="4" r="1.6" fill="currentColor" />
    <circle cx="19" cy="8" r="1.6" fill="currentColor" />
    <circle cx="17" cy="17" r="1.6" fill="currentColor" />
    <circle cx="9" cy="20" r="1.6" fill="currentColor" />
  </Icon>
);
export const HomeIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);
export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
  </Icon>
);
export const BackIcon = () => (
  <Icon>
    <path d="m14 6-6 6 6 6" />
  </Icon>
);
export const TableIcon = () => (
  <Icon size={16}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18M3 14.5h18M9 5v14" />
  </Icon>
);
export const ChartIcon = () => (
  <Icon size={16}>
    <path d="M4 19h16M5 15l4-5 4 3 6-8" />
  </Icon>
);
