/** Thin, 1.5px-stroke glyphs in the SF Symbols spirit. */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconAperture = () => (
  <svg {...base} className="toolbar__mark" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v7M20.8 8.5l-6.1 3.5M20.8 15.5H13.7M12 21v-7M3.2 15.5l6.1-3.5M3.2 8.5h7.1" />
  </svg>
);

export const IconUpload = () => (
  <svg {...base} className="dropzone__icon" aria-hidden>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M3.5 15v3a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-3" />
  </svg>
);

export const IconCompare = () => (
  <svg {...base} aria-hidden>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M12 4.5v15" />
    <path d="M7 10.5h2M7 13.5h2" />
  </svg>
);

export const IconReset = () => (
  <svg {...base} aria-hidden>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5V10H9" />
  </svg>
);

export const IconExport = () => (
  <svg {...base} aria-hidden>
    <path d="M12 3.5v11m0-11L8 7.5M12 3.5l4 4" />
    <path d="M4.5 14.5v3.5a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3.5" />
  </svg>
);

export const IconNew = () => (
  <svg {...base} aria-hidden>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="M12 9.5v5M9.5 12h5" />
  </svg>
);

export const IconSun = () => (
  <svg {...base} aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
  </svg>
);

export const IconMoon = () => (
  <svg {...base} aria-hidden>
    <path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a7 7 0 0 0 9.5 9.5Z" />
  </svg>
);

export const IconPlay = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M7.5 4.9c0-.9 1-1.4 1.7-.9l9.2 6.2c.7.5.7 1.5 0 2l-9.2 6.2c-.7.5-1.7 0-1.7-.9V4.9Z" />
  </svg>
);

export const IconPause = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <rect x="6.5" y="4.5" width="4" height="15" rx="1.4" />
    <rect x="13.5" y="4.5" width="4" height="15" rx="1.4" />
  </svg>
);

export const IconChevron = ({ className }: { className?: string }) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M9 5.5 15.5 12 9 18.5" />
  </svg>
);

export const IconCaret = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 16.5 3.5 7.5h17L12 16.5Z" />
  </svg>
);

export const IconInfo = () => (
  <svg {...base} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.6" />
  </svg>
);

export const IconWarn = () => (
  <svg {...base} aria-hidden>
    <path d="M10.6 3.9 2.4 18a1.6 1.6 0 0 0 1.4 2.4h16.4A1.6 1.6 0 0 0 21.6 18L13.4 3.9a1.6 1.6 0 0 0-2.8 0Z" />
    <path d="M12 9.5v4M12 17.2v.6" />
  </svg>
);
