// Minimal monochrome line icons (EasyAgents DS — no emoji in chrome).
// 16-grid, 1.4px stroke, currentColor so they inherit text color.

import type { JSX } from "react";

const P = {
  folder: <path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.6 1.6h6.4a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.2Z" />,
  folderOpen: (
    <>
      <path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.6 1.6h5.4a1 1 0 0 1 1 1v1H4l-2.2 6.4V4.2Z" opacity=".35" />
      <path d="M1.8 13.2 4 6.8h10.4l-2 6.4H1.8Z" />
    </>
  ),
  file: (
    <>
      <path d="M4 1.8h5.2L12 4.6v9.6H4V1.8Z" />
      <path d="M9 1.8v3h3" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  play: <path d="M6 4.3 11.6 8 6 11.7V4.3Z" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  plus: <path d="M8 3v10M3 8h10" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.6" />
      <path d="m10.4 10.4 3.6 3.6" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" />
    </>
  ),
  shield: <path d="M8 1.6 13 3.5v4.1c0 3.4-2.4 5.4-5 6.5-2.6-1.1-5-3.1-5-6.5V3.5L8 1.6Z" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3" />
    </>
  ),
  moon: <path d="M13.2 9.7A5.8 5.8 0 1 1 6.3 2.8a4.6 4.6 0 0 0 6.9 6.9Z" />,
  chart: <path d="M2.2 13.8h11.6M4.6 13.8V9.4M8 13.8V6.2M11.4 13.8V3.4" />,
  split: (
    <>
      <rect x="1.8" y="2.6" width="5.4" height="10.8" rx="1" />
      <rect x="8.8" y="2.6" width="5.4" height="10.8" rx="1" />
    </>
  ),
  tabs: (
    <>
      <path d="M1.8 5.4V4a1 1 0 0 1 1-1h3.6a1 1 0 0 1 1 1v1.4" />
      <rect x="1.8" y="5.4" width="12.4" height="7.8" rx="1" />
    </>
  ),
  undo: <path d="M6.2 3.6 2.8 7l3.4 3.4M2.8 7h6.4a4 4 0 0 1 4 4v1.4" />,
  redo: <path d="m9.8 3.6 3.4 3.4-3.4 3.4M13.2 7H6.8a4 4 0 0 0-4 4v1.4" />,
  wrap: <path d="M2.4 3.8h11.2M2.4 8h8.2a2.4 2.4 0 0 1 0 4.8H8.4m0 0 1.6-1.6M8.4 12.8l1.6 1.6M2.4 12.8h3.2" />,
  trash: (
    <>
      <path d="M2.8 4.4h10.4M6.4 4.4V2.8h3.2v1.6M4.4 4.4l.6 9.2h6l.6-9.2" />
      <path d="M6.8 7v4M9.2 7v4" />
    </>
  ),
  key: (
    <>
      <circle cx="4.8" cy="8" r="2.6" />
      <path d="M7.4 8h6.2m-1.8 0v2.4M9.6 8v1.8" />
    </>
  ),
  chevronRight: <path d="m6 3.6 4.4 4.4L6 12.4" />,
  chevronDown: <path d="m3.6 6 4.4 4.4L12.4 6" />,
  refresh: <path d="M13.4 8.8a5.5 5.5 0 1 1-1-4.2M13.4 2.6v3.2h-3.2" />,
  external: (
    <>
      <path d="M6.4 3.2H3.6a1 1 0 0 0-1 1v8.2a1 1 0 0 0 1 1h8.2a1 1 0 0 0 1-1V9.6" />
      <path d="M9.6 2.4h4v4M13.2 2.8 7.6 8.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c2.3 2 2.3 10.4 0 12.4-2.3-2-2.3-10.4 0-12.4Z" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.4" r="2.7" />
      <path d="M2.8 13.6a5.4 4.8 0 0 1 10.4 0" />
    </>
  ),
  plug: (
    <>
      <path d="M5.6 2.4v3M10.4 2.4v3M4 5.4h8v1.8a4 4 0 0 1-8 0V5.4ZM8 11.2v2.4" />
    </>
  ),
  sparkles: (
    <>
      <path d="M7 2.2 8.1 5l2.8 1.1L8.1 7.2 7 10 5.9 7.2 3.1 6.1 5.9 5 7 2.2Z" />
      <path d="m12 9.6.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7.7-1.7Z" />
    </>
  ),
  network: (
    <>
      <circle cx="3.4" cy="8" r="1.8" />
      <circle cx="12.6" cy="3.6" r="1.8" />
      <circle cx="12.6" cy="12.4" r="1.8" />
      <path d="M5 7.2l6-2.8M5 8.8l6 2.8" />
    </>
  ),
  thought: <path d="M3 8h.01M8 8h.01M13 8h.01" strokeWidth="2.6" />,
  book: <path d="M8 3.4c-1.6-1-4.2-1-5.8 0v9.4c1.6-1 4.2-1 5.8 0 1.6-1 4.2-1 5.8 0V3.4c-1.6-1-4.2-1-5.8 0Zm0 0v9.4" />,
  bug: (
    <>
      <circle cx="8" cy="9.2" r="3.6" />
      <path d="M6.2 6 4.8 4M9.8 6l1.4-2M4.4 9.2H2.2M13.8 9.2h-2.2M5 11.6l-1.6 1.6M11 11.6l1.6 1.6" />
    </>
  ),
  flask: <path d="M6.6 2.2h2.8M7 2.2v4.2L3.4 12a1.2 1.2 0 0 0 1 1.8h7.2a1.2 1.2 0 0 0 1-1.8L9 6.4V2.2" />,
  note: (
    <>
      <path d="M3.2 1.8h9.6v12.4H3.2V1.8Z" />
      <path d="M5.4 5h5.2M5.4 8h5.2M5.4 11h3.2" />
    </>
  ),
  robot: (
    <>
      <rect x="3.2" y="5.2" width="9.6" height="7.6" rx="1.4" />
      <path d="M8 5.2V2.8M6 9h.01M10 9h.01" />
      <circle cx="8" cy="2.2" r=".9" />
    </>
  ),
  question: <path d="M5.8 5.6a2.2 2.2 0 1 1 3.1 2.6c-.7.4-.9.8-.9 1.6M8 12.4h.01" />,
  stop: <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1" />,
  send: <path d="M2.4 8h10.4M9.4 4.4 13 8l-3.6 3.6" />,
  check: <path d="m3.2 8.6 3.2 3.2 6.4-7.6" />,
} as const;

export type IconName = keyof typeof P;

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}

/** The EasyAgents mark: violet rounded square with a dot (Design.pdf logo). */
export function LogoMark({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="1" width="14" height="14" rx="4" fill="var(--ds-brand-700)" />
      <circle cx="7.4" cy="8.4" r="3" fill="none" stroke="#fff" strokeWidth="1.5" />
      <circle cx="11.4" cy="4.6" r="1.1" fill="#fff" />
    </svg>
  );
}
