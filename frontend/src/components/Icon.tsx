// Набор иконок из эталонного прототипа (stroke 1.7, viewBox 24).
const PATHS = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  scale: <path d="M12 3v18M5 21h14M4 7h16M5 7 1.5 15h7L5 7ZM19 7l-3.5 8h7L19 7Z" />,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 12h8M8 16h8" /></>,
  star: <path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9Z" />,
  history: <path d="M3 10a9 9 0 1 1 1.7 7M3 4v6h6M12 7v5l3 2" />,
  position: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M9 5V3h6v2M8 13h2l2-4 2 7 2-3h1M10 20v2h4v-2" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  checkcircle: <><circle cx="12" cy="12" r="10" /><path d="m7 12 3 3 7-7" /></>,
  x: <path d="m6 6 12 12M6 18 18 6" />,
  more: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />,
  filter: <path d="M3 4h18l-7 8v8l-4-2v-6Z" />,
  bookmark: <path d="M6 3h12v19l-6-4-6 4Z" />,
  quote: <path d="M10 5C5 7 3 11 3 17h7v-7H5M21 5c-5 2-7 6-7 12h7v-7h-5" />,
  bulb: <path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0l-1 2H9Z" />,
  risk: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3v.1" /></>,
  question: <><circle cx="12" cy="12" r="10" /><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4v.1" /></>,
  chat: <><path d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-5 4v-4H3V4a1 1 0 0 1 1-1Z" /><path d="M7 10h.1M12 10h.1M17 10h.1" /></>,
  gavel: <path d="m13 3 8 8-3 3-8-8 3-3ZM12 8 4 16m-2 3 3-3 3 3-3 3M13 21h9" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  edit: <path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z" />,
  trash: <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
