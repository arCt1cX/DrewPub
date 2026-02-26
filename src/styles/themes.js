export const THEMES = {
    dark: {
        id: 'dark',
        name: 'Dark',
        bg: '#1a1a2e',
        surface: '#16213e',
        text: '#e0e0e0',
        textSecondary: '#a0a0b0',
        accent: '#7c5cfc',
        border: 'rgba(255,255,255,0.08)',
        readerBg: '#1a1a2e',
        readerText: '#d4d4d4',
    },
    amoled: {
        id: 'amoled',
        name: 'AMOLED',
        bg: '#000000',
        surface: '#0a0a0a',
        text: '#e0e0e0',
        textSecondary: '#888888',
        accent: '#7c5cfc',
        border: 'rgba(255,255,255,0.06)',
        readerBg: '#000000',
        readerText: '#cccccc',
    },
    sepia: {
        id: 'sepia',
        name: 'Sepia',
        bg: '#f4ecd8',
        surface: '#ede3ca',
        text: '#5b4636',
        textSecondary: '#8a7560',
        accent: '#c0813d',
        border: 'rgba(91,70,54,0.12)',
        readerBg: '#f4ecd8',
        readerText: '#5b4636',
    },
    light: {
        id: 'light',
        name: 'Light',
        bg: '#f8f9fa',
        surface: '#ffffff',
        text: '#1a1a2e',
        textSecondary: '#6b6b80',
        accent: '#6c4ce0',
        border: 'rgba(0,0,0,0.08)',
        readerBg: '#ffffff',
        readerText: '#2a2a2a',
    },
    ocean: {
        id: 'ocean',
        name: 'Ocean',
        bg: '#0d1b2a',
        surface: '#1b2838',
        text: '#c8d6e5',
        textSecondary: '#7f8fa6',
        accent: '#48dbfb',
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
        border: 'rgba(92,252,124,0.1)',
        readerBg: '#1a2e1a',
        readerText: '#c8e0c8',
    }
};

export const FONTS = [
    { id: 'custom', name: 'Custom Font', family: "'CustomUserFont', sans-serif" },
    { id: 'inter', name: 'Inter', family: "'Inter', sans-serif" },
    { id: 'literata', name: 'Literata', family: "'Literata', serif" },
    { id: 'merriweather', name: 'Merriweather', family: "'Merriweather', serif" },
    { id: 'lora', name: 'Lora', family: "'Lora', serif" },
    { id: 'source-serif', name: 'Source Serif', family: "'Source Serif 4', serif" },
    { id: 'roboto-slab', name: 'Roboto Slab', family: "'Roboto Slab', serif" },
    { id: 'crimson', name: 'Crimson Text', family: "'Crimson Text', serif" },
    { id: 'georgia', name: 'Georgia', family: "Georgia, serif" },
    { id: 'system', name: 'System UI', family: "system-ui, sans-serif" },
];

export const DEFAULT_SETTINGS = {
    theme: 'dark',
    customTheme: null,
    customFontId: null,
    customBgId: null,
    font: 'literata',
    fontSize: 18,
    lineHeight: 1.7,
    paragraphSpacing: 16,
    margins: 40,
    maxWidth: 720,
    textAlign: 'left',
    readingMode: 'paginated', // 'paginated' | 'scroll'
    libraryView: 'grid', // 'grid' | 'list'
    librarySortBy: 'lastReadAt', // 'title' | 'author' | 'lastReadAt'
    librarySortOrder: 'desc',
};

export function applyTheme(theme) {
    const root = document.documentElement;
    root.style.setProperty('--bg', theme.bg);
    root.style.setProperty('--surface', theme.surface);
    root.style.setProperty('--text', theme.text);
    root.style.setProperty('--text-secondary', theme.textSecondary);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--border', theme.border);
    root.style.setProperty('--reader-bg', theme.readerBg);
    root.style.setProperty('--reader-text', theme.readerText);
}

export function getTheme(id, customTheme) {
    if (id === 'custom' && customTheme) return customTheme;
    return THEMES[id] || THEMES.dark;
}
