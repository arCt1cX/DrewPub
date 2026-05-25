import React from 'react';

const Ic = ({ size = 20, stroke = 1.6, className, style, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0, ...style }}
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

export const IconSearch = (p) => <Ic {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Ic>;
export const IconPlus = (p) => <Ic {...p}><path d="M12 5v14M5 12h14" /></Ic>;
export const IconClose = (p) => <Ic {...p}><path d="M18 6 6 18M6 6l12 12" /></Ic>;
export const IconGrid = (p) => <Ic {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Ic>;
export const IconList = (p) => <Ic {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Ic>;
export const IconSettings = (p) => <Ic {...p}><path d="M4 6h10M4 12h7M4 18h13" /><circle cx="17" cy="6" r="2" /><circle cx="14" cy="12" r="2" /><circle cx="20" cy="18" r="2" /></Ic>;
export const IconMenu = (p) => <Ic {...p}><path d="M3 6h18M3 12h18M3 18h18" /></Ic>;
export const IconArrowLeft = (p) => <Ic {...p}><path d="m15 18-6-6 6-6" /></Ic>;
export const IconArrowRight = (p) => <Ic {...p}><path d="m9 18 6-6-6-6" /></Ic>;
export const IconArrowDown = (p) => <Ic {...p}><path d="m6 9 6 6 6-6" /></Ic>;
export const IconDownload = (p) => <Ic {...p}><path d="M12 4v12m0 0 4-4m-4 4-4-4M4 20h16" /></Ic>;
export const IconUpload = (p) => <Ic {...p}><path d="M12 20V8m0 0 4 4m-4-4-4 4M4 4h16" /></Ic>;
export const IconBook = (p) => <Ic {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M4 19.5V21h16" /></Ic>;
export const IconBookOpen = (p) => <Ic {...p}><path d="M12 7c-1.5-1.5-4-2-8-2v14c4 0 6.5.5 8 2M12 7c1.5-1.5 4-2 8-2v14c-4 0-6.5.5-8 2M12 7v14" /></Ic>;
export const IconTrash = (p) => <Ic {...p}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Ic>;
export const IconMore = (p) => <Ic {...p}><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></Ic>;
export const IconMoreH = (p) => <Ic {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></Ic>;
export const IconVolume = (p) => <Ic {...p}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19" fill="currentColor" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></Ic>;
export const IconHeadphones = (p) => <Ic {...p}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></Ic>;
export const IconCheck = (p) => <Ic {...p}><path d="m4 12 6 6L20 6" /></Ic>;
export const IconSun = (p) => <Ic {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></Ic>;
export const IconMoon = (p) => <Ic {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Ic>;
export const IconPlay = (p) => <Ic {...p}><path d="m6 4 14 8-14 8z" fill="currentColor" /></Ic>;
export const IconPause = (p) => <Ic {...p}><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /></Ic>;
export const IconSkipBack = (p) => <Ic {...p}><polygon points="19 20 9 12 19 4" fill="currentColor" /><line x1="5" y1="19" x2="5" y2="5" /></Ic>;
export const IconSkipForward = (p) => <Ic {...p}><polygon points="5 4 15 12 5 20" fill="currentColor" /><line x1="19" y1="5" x2="19" y2="19" /></Ic>;
export const IconImage = (p) => <Ic {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="m21 15-5-5L5 21" /></Ic>;
export const IconCloud = (p) => <Ic {...p}><path d="M18 18a4 4 0 0 0 0-8 6 6 0 0 0-11.6-1.5A4 4 0 0 0 6 18z" /></Ic>;
export const IconStar = (p) => <Ic {...p}><path d="m12 3 2.6 6.3L21 10l-5 4.4L17.5 21 12 17.3 6.5 21 8 14.4 3 10l6.4-.7z" /></Ic>;
export const IconGlobe = (p) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></Ic>;
export const IconAlignLeft = (p) => <Ic {...p}><path d="M3 6h18M3 12h12M3 18h15" /></Ic>;
export const IconAlignJustify = (p) => <Ic {...p}><path d="M3 6h18M3 12h18M3 18h18" /></Ic>;
export const IconType = (p) => <Ic {...p}><path d="M4 7V5h16v2M9 19h6M12 5v14" /></Ic>;
export const IconPalette = (p) => <Ic {...p}><path d="M12 22a10 10 0 1 1 10-10c0 2-2 3-4 3h-2a2 2 0 0 0-2 2v1c0 2-2 4-4 4h-2z" /><circle cx="7.5" cy="10.5" r="1" fill="currentColor" /><circle cx="12" cy="7" r="1" fill="currentColor" /><circle cx="16.5" cy="10.5" r="1" fill="currentColor" /></Ic>;
export const IconHighlighter = (p) => <Ic {...p}><path d="m9 11-6 6v3h3l6-6" /><path d="m17 3 4 4-9 9-4-4z" /></Ic>;
export const IconLanguages = (p) => <Ic {...p}><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1" /><path d="m22 22-5-10-5 10M14 18h6" /></Ic>;
export const IconFilter = (p) => <Ic {...p}><path d="M3 5h18M6 12h12M10 19h4" /></Ic>;
export const IconSort = (p) => <Ic {...p}><path d="M3 6h7M3 12h5M3 18h3M16 4v16M16 20l4-4M16 20l-4-4" /></Ic>;
export const IconHeart = (p) => <Ic {...p}><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" /></Ic>;
export const IconRefresh = (p) => <Ic {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></Ic>;
export const IconSparkles = (p) => <Ic {...p}><path d="M12 3v4M10 5h4M5 10v4M3 12h4M18 14v3M16.5 15.5h3" /><path d="m12 10 1.6 3.4L17 15l-3.4 1.6L12 20l-1.6-3.4L7 15l3.4-1.6z" /></Ic>;
export const IconMic = (p) => <Ic {...p}><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 19v3" /></Ic>;
export const IconBookmark = (p) => <Ic {...p}><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></Ic>;
