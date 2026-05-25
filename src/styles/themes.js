export const THEMES = {
    cozy: {
        id: 'cozy',
        name: 'Cozy',
        bg: '#F4ECE0',
        surface: '#FBF6EC',
        text: '#2B2620',
        textSecondary: '#7A6F60',
        accent: '#7E9078',
        accentSecondary: '#C97B5F',
        border: 'rgba(43,38,32,0.08)',
        readerBg: '#F4ECE0',
        readerText: '#2B2620',
    },
    sepia: {
        id: 'sepia',
        name: 'Sepia',
        bg: '#F4ECD8',
        surface: '#ede3ca',
        text: '#5b4636',
        textSecondary: '#8a7560',
        accent: '#C0813D',
        accentSecondary: '#C0813D',
        border: 'rgba(91,70,54,0.12)',
        readerBg: '#F4ECD8',
        readerText: '#5b4636',
    },
    light: {
        id: 'light',
        name: 'Paper',
        bg: '#FFFEF8',
        surface: '#ffffff',
        text: '#222222',
        textSecondary: '#6b6b80',
        accent: '#666666',
        accentSecondary: '#666666',
        border: 'rgba(0,0,0,0.08)',
        readerBg: '#FFFEF8',
        readerText: '#222222',
    },
    dark: {
        id: 'dark',
        name: 'Night',
        bg: '#1A1612',
        surface: '#231F1A',
        text: '#E8DFC8',
        textSecondary: '#A89D8A',
        accent: '#7E9078',
        accentSecondary: '#D69B5C',
        border: 'rgba(232,223,200,0.08)',
        readerBg: '#1A1612',
        readerText: '#E8DFC8',
    },
    ocean: {
        id: 'ocean',
        name: 'Ocean',
        bg: '#0d1b2a',
        surface: '#1b2838',
        text: '#c8d6e5',
        textSecondary: '#7f8fa6',
        accent: '#48dbfb',
        accentSecondary: '#48dbfb',
        border: 'rgba(72,219,251,0.1)',
        readerBg: '#0d1b2a',
        readerText: '#c8d6e5',
    },
    forest: {
        id: 'forest',
        name: 'Forest',
        bg: '#1a2e1a',
        surface: '#1e3a1e',
        text: '#c8e0c8',
        textSecondary: '#7fa67f',
        accent: '#5cfc7c',
        accentSecondary: '#5cfc7c',
        border: 'rgba(92,252,124,0.1)',
        readerBg: '#1a2e1a',
        readerText: '#c8e0c8',
    },
    amoled: {
        id: 'amoled',
        name: 'AMOLED',
        bg: '#000000',
        surface: '#0a0a0a',
        text: '#e0e0e0',
        textSecondary: '#888888',
        accent: '#7E9078',
        accentSecondary: '#C97B5F',
        border: 'rgba(255,255,255,0.06)',
        readerBg: '#000000',
        readerText: '#cccccc',
    },
};

export const FONTS = [
    { id: 'literata', name: 'Literata', family: "'Literata', serif" },
    { id: 'instrument-serif', name: 'Instrument Serif', family: "'Instrument Serif', Georgia, serif" },
    { id: 'lora', name: 'Lora', family: "'Lora', serif" },
    { id: 'merriweather', name: 'Merriweather', family: "'Merriweather', serif" },
    { id: 'source-serif', name: 'Source Serif', family: "'Source Serif 4', serif" },
    { id: 'crimson', name: 'Crimson Text', family: "'Crimson Text', serif" },
    { id: 'georgia', name: 'Georgia', family: "Georgia, serif" },
    { id: 'manrope', name: 'Manrope', family: "'Manrope', system-ui, sans-serif" },
    { id: 'inter', name: 'Inter', family: "'Inter', sans-serif" },
    { id: 'system', name: 'System UI', family: "system-ui, sans-serif" },
];

export const DEFAULT_SETTINGS = {
    theme: 'cozy',
    customTheme: null,
    font: 'literata',
    customFonts: [],
    fontSize: 18,
    lineHeight: 1.7,
    paragraphSpacing: 16,
    margins: 40,
    maxWidth: 720,
    textAlign: 'left',
    readingMode: 'paginated',
    readerBgImage: null,
    readerBgOpacity: 0.08,
    libraryView: 'grid',
    librarySortBy: 'lastReadAt',
    librarySortOrder: 'desc',
    dictionaryMode: 'word',
    ttsEngine: 'cloud',
    ttsRate: 1.0,
    ttsPitch: 1.0,
    ttsNarratorVoice: null,
    ttsHighlight: true,
    ttsAutoAdvance: true,
    ttsMultiVoice: true,
};

export function applyTheme(theme) {
    const root = document.documentElement;
    root.style.setProperty('--bg', theme.bg);
    root.style.setProperty('--surface', theme.surface);
    root.style.setProperty('--text', theme.text);
    root.style.setProperty('--text-secondary', theme.textSecondary);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-secondary', theme.accentSecondary || theme.accent);
    root.style.setProperty('--border', theme.border);
    root.style.setProperty('--reader-bg', theme.readerBg);
    root.style.setProperty('--reader-text', theme.readerText);

    const isDark = isThemeDark(theme);
    root.setAttribute('data-theme-mode', isDark ? 'dark' : 'light');
}

export function isThemeDark(theme) {
    const hex = theme.bg.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export function getTheme(id, customTheme) {
    if (id === 'custom' && customTheme) return customTheme;
    return THEMES[id] || THEMES.cozy;
}
