import React, { useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { FONTS, THEMES, getTheme } from '../styles/themes';
import './SettingsPanel.css';

export default function SettingsPanel({ onClose }) {
    const { settings, updateSetting, updateMultipleSettings } = useSettings();
    const fontInputRef = useRef(null);
    const bgInputRef = useRef(null);

    // All fonts: built-in + custom
    const allFonts = [...FONTS, ...(settings.customFonts || [])];
    const currentFont = allFonts.find(f => f.id === settings.font) || FONTS[0];

    const handleCustomThemeChange = (field, value) => {
        const current = settings.customTheme || { ...THEMES.dark, id: 'custom', name: 'Custom' };
        const updated = { ...current, [field]: value };
        updateMultipleSettings({ theme: 'custom', customTheme: updated });
    };

    // ── Custom Font Upload ────────────────────────────────
    const handleFontUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const name = file.name.replace(/\.(ttf|otf|woff|woff2)$/i, '');
        const familyName = `CustomFont-${name}`;
        const id = `custom-${Date.now()}`;

        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const dataUrl = reader.result;
                // Register with FontFace API
                const face = new FontFace(familyName, `url(${dataUrl})`);
                await face.load();
                document.fonts.add(face);

                const newFont = { id, name, family: familyName, dataUrl };
                const updatedFonts = [...(settings.customFonts || []), newFont];
                await updateSetting('customFonts', updatedFonts);
                await updateSetting('font', id);
            };
            reader.readAsDataURL(file);
        } catch (err) {
            console.error('Failed to load font:', err);
        }

        // Clear input so same file can be re-selected
        e.target.value = '';
    };

    const handleRemoveCustomFont = async (fontId) => {
        const updatedFonts = (settings.customFonts || []).filter(f => f.id !== fontId);
        await updateSetting('customFonts', updatedFonts);
        if (settings.font === fontId) {
            await updateSetting('font', 'literata');
        }
    };

    // ── Background Image Upload ───────────────────────────
    const handleBgUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            updateSetting('readerBgImage', reader.result);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    return (
        <>
            <div className="overlay" onClick={onClose} />
            <div className="settings-panel glass-strong animate-slide-in-up">
                <div className="settings-header">
                    <h2 className="settings-title">Reading Settings</h2>
                    <button className="btn-icon" onClick={onClose}>✕</button>
                </div>

                <div className="settings-body">
                    {/* ─── Reading Mode ────────────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Reading Mode</h3>
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${settings.readingMode === 'paginated' ? 'active' : ''}`}
                                onClick={() => updateSetting('readingMode', 'paginated')}
                            >
                                📖 Paginated
                            </button>
                            <button
                                className={`toggle-btn ${settings.readingMode === 'scroll' ? 'active' : ''}`}
                                onClick={() => updateSetting('readingMode', 'scroll')}
                            >
                                📜 Scroll
                            </button>
                        </div>
                    </section>

                    {/* ─── Font ────────────────────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Font</h3>
                        <div className="font-grid">
                            {allFonts.map(font => (
                                <div key={font.id} className="font-btn-wrapper">
                                    <button
                                        className={`font-btn ${settings.font === font.id ? 'active' : ''}`}
                                        style={{ fontFamily: font.family }}
                                        onClick={() => updateSetting('font', font.id)}
                                    >
                                        {font.name}
                                    </button>
                                    {font.id.startsWith('custom-') && (
                                        <button
                                            className="font-delete-btn"
                                            onClick={(e) => { e.stopPropagation(); handleRemoveCustomFont(font.id); }}
                                            title="Remove font"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            ))}
                            {/* Upload font button */}
                            <button
                                className="font-btn font-upload-btn"
                                onClick={() => fontInputRef.current?.click()}
                            >
                                + Font
                            </button>
                            <input
                                ref={fontInputRef}
                                type="file"
                                accept=".ttf,.otf,.woff,.woff2"
                                style={{ display: 'none' }}
                                onChange={handleFontUpload}
                            />
                        </div>
                    </section>

                    {/* ─── Typography Controls ─────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Typography</h3>

                        <div className="slider-row">
                            <span className="slider-label">Size</span>
                            <input
                                type="range"
                                min="12"
                                max="32"
                                step="1"
                                value={settings.fontSize}
                                onChange={e => updateSetting('fontSize', Number(e.target.value))}
                            />
                            <span className="slider-value">{settings.fontSize}px</span>
                        </div>

                        <div className="slider-row">
                            <span className="slider-label">Line Height</span>
                            <input
                                type="range"
                                min="1.0"
                                max="2.5"
                                step="0.1"
                                value={settings.lineHeight}
                                onChange={e => updateSetting('lineHeight', Number(e.target.value))}
                            />
                            <span className="slider-value">{settings.lineHeight}</span>
                        </div>

                        <div className="slider-row">
                            <span className="slider-label">Paragraph</span>
                            <input
                                type="range"
                                min="0"
                                max="40"
                                step="2"
                                value={settings.paragraphSpacing}
                                onChange={e => updateSetting('paragraphSpacing', Number(e.target.value))}
                            />
                            <span className="slider-value">{settings.paragraphSpacing}px</span>
                        </div>

                        <div className="slider-row">
                            <span className="slider-label">Margins</span>
                            <input
                                type="range"
                                min="8"
                                max="80"
                                step="4"
                                value={settings.margins}
                                onChange={e => updateSetting('margins', Number(e.target.value))}
                            />
                            <span className="slider-value">{settings.margins}px</span>
                        </div>

                        <div className="slider-row">
                            <span className="slider-label">Max Width</span>
                            <input
                                type="range"
                                min="400"
                                max="1200"
                                step="20"
                                value={settings.maxWidth}
                                onChange={e => updateSetting('maxWidth', Number(e.target.value))}
                            />
                            <span className="slider-value">{settings.maxWidth}px</span>
                        </div>
                    </section>

                    {/* ─── Text Alignment ──────────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Text Alignment</h3>
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${settings.textAlign === 'left' ? 'active' : ''}`}
                                onClick={() => updateSetting('textAlign', 'left')}
                            >
                                ≡ Left
                            </button>
                            <button
                                className={`toggle-btn ${settings.textAlign === 'justify' ? 'active' : ''}`}
                                onClick={() => updateSetting('textAlign', 'justify')}
                            >
                                ≣ Justified
                            </button>
                        </div>
                    </section>

                    {/* ─── Dictionary Mode ──────────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Dictionary Translation</h3>
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${settings.dictionaryMode === 'word' ? 'active' : ''}`}
                                onClick={() => updateSetting('dictionaryMode', 'word')}
                            >
                                Word Only
                            </button>
                            <button
                                className={`toggle-btn ${settings.dictionaryMode === 'sentence' ? 'active' : ''}`}
                                onClick={() => updateSetting('dictionaryMode', 'sentence')}
                            >
                                Full Sentence
                            </button>
                        </div>
                    </section>

                    {/* ─── Text-to-Speech ────────────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Text-to-Speech</h3>

                        {/* Engine selector */}
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${(settings.ttsEngine || 'cloud') === 'cloud' ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsEngine', 'cloud')}
                            >
                                ☁️ Cloud
                            </button>
                            <button
                                className={`toggle-btn ${(settings.ttsEngine) === 'system' ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsEngine', 'system')}
                            >
                                🗣 System
                            </button>
                        </div>

                        {(settings.ttsEngine || 'cloud') === 'cloud' && (
                            <div className="tts-kokoro-info">
                                <span className="slider-label" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                    ☁️ Microsoft Edge Neural voices — multi-character, natural prosody (requires internet)
                                </span>
                            </div>
                        )}

                        {settings.ttsEngine === 'system' && (
                            <div className="tts-kokoro-info">
                                <span className="slider-label" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                    🗣 Uses your device's built-in speech engine — works offline
                                </span>
                            </div>
                        )}

                        {/* Speed */}
                        <div className="slider-row">
                            <span className="slider-label">Speed</span>
                            <input
                                type="range"
                                min="0.5"
                                max="2.0"
                                step="0.1"
                                value={settings.ttsRate || 1.0}
                                onChange={e => updateSetting('ttsRate', Number(e.target.value))}
                            />
                            <span className="slider-value">{(settings.ttsRate || 1.0).toFixed(1)}x</span>
                        </div>

                        {/* Pitch (system engine only) */}
                        {(settings.ttsEngine) === 'system' && (
                            <div className="slider-row">
                                <span className="slider-label">Pitch</span>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="2.0"
                                    step="0.1"
                                    value={settings.ttsPitch || 1.0}
                                    onChange={e => updateSetting('ttsPitch', Number(e.target.value))}
                                />
                                <span className="slider-value">{(settings.ttsPitch || 1.0).toFixed(1)}</span>
                            </div>
                        )}

                        {/* Multi-voice toggle */}
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${settings.ttsMultiVoice !== false ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsMultiVoice', true)}
                            >
                                🎭 Character Voices
                            </button>
                            <button
                                className={`toggle-btn ${settings.ttsMultiVoice === false ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsMultiVoice', false)}
                            >
                                🗣 Single Voice
                            </button>
                        </div>

                        {/* Highlight toggle */}
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${settings.ttsHighlight !== false ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsHighlight', true)}
                            >
                                ✨ Highlight On
                            </button>
                            <button
                                className={`toggle-btn ${settings.ttsHighlight === false ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsHighlight', false)}
                            >
                                Highlight Off
                            </button>
                        </div>

                        {/* Auto-advance toggle */}
                        <div className="toggle-group">
                            <button
                                className={`toggle-btn ${settings.ttsAutoAdvance !== false ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsAutoAdvance', true)}
                            >
                                📖 Auto-Advance
                            </button>
                            <button
                                className={`toggle-btn ${settings.ttsAutoAdvance === false ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsAutoAdvance', false)}
                            >
                                ⏹ Manual
                            </button>
                        </div>
                    </section>

                    {/* ─── Background Image ───────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Background Image</h3>
                        <div className="bg-image-controls">
                            {settings.readerBgImage ? (
                                <div className="bg-preview-row">
                                    <div
                                        className="bg-preview-thumb"
                                        style={{ backgroundImage: `url(${settings.readerBgImage})` }}
                                    />
                                    <button
                                        className="toggle-btn"
                                        onClick={() => bgInputRef.current?.click()}
                                    >
                                        Change
                                    </button>
                                    <button
                                        className="toggle-btn"
                                        onClick={() => updateSetting('readerBgImage', null)}
                                    >
                                        ✕ Remove
                                    </button>
                                </div>
                            ) : (
                                <button
                                    className="toggle-btn"
                                    onClick={() => bgInputRef.current?.click()}
                                >
                                    🖼️ Choose Image
                                </button>
                            )}
                            <input
                                ref={bgInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={handleBgUpload}
                            />
                            {settings.readerBgImage && (
                                <div className="slider-row">
                                    <span className="slider-label">Opacity</span>
                                    <input
                                        type="range"
                                        min="0.02"
                                        max="0.3"
                                        step="0.01"
                                        value={settings.readerBgOpacity}
                                        onChange={e => updateSetting('readerBgOpacity', Number(e.target.value))}
                                    />
                                    <span className="slider-value">{Math.round(settings.readerBgOpacity * 100)}%</span>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* ─── Themes ──────────────────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Theme</h3>
                        <div className="theme-grid">
                            {Object.values(THEMES).map(theme => (
                                <button
                                    key={theme.id}
                                    className={`theme-btn ${settings.theme === theme.id ? 'active' : ''}`}
                                    onClick={() => updateSetting('theme', theme.id)}
                                >
                                    <div
                                        className="theme-preview"
                                        style={{
                                            background: theme.bg,
                                            borderColor: settings.theme === theme.id ? theme.accent : 'transparent',
                                        }}
                                    >
                                        <div className="theme-preview-line" style={{ background: theme.text, opacity: 0.6 }} />
                                        <div className="theme-preview-line short" style={{ background: theme.text, opacity: 0.4 }} />
                                        <div className="theme-preview-dot" style={{ background: theme.accent }} />
                                    </div>
                                    <span className="theme-name">{theme.name}</span>
                                </button>
                            ))}
                            {/* Custom theme button */}
                            <button
                                className={`theme-btn ${settings.theme === 'custom' ? 'active' : ''}`}
                                onClick={() => {
                                    const base = settings.customTheme || { ...THEMES.dark, id: 'custom', name: 'Custom' };
                                    updateMultipleSettings({ theme: 'custom', customTheme: base });
                                }}
                            >
                                <div
                                    className="theme-preview custom-preview"
                                    style={{
                                        background: settings.customTheme?.bg || '#1a1a2e',
                                        borderColor: settings.theme === 'custom' ? (settings.customTheme?.accent || '#7c5cfc') : 'transparent',
                                    }}
                                >
                                    <span style={{ fontSize: '16px' }}>🎨</span>
                                </div>
                                <span className="theme-name">Custom</span>
                            </button>
                        </div>
                    </section>

                    {/* ─── Custom Theme Editor ─────────────── */}
                    {settings.theme === 'custom' && (
                        <section className="settings-section custom-theme-editor animate-fade-in-up">
                            <h3 className="section-label">Custom Theme</h3>
                            <div className="color-row">
                                <span className="color-label">Background</span>
                                <input
                                    type="color"
                                    value={settings.customTheme?.readerBg || '#1a1a2e'}
                                    onChange={e => {
                                        handleCustomThemeChange('bg', e.target.value);
                                        handleCustomThemeChange('readerBg', e.target.value);
                                    }}
                                />
                            </div>
                            <div className="color-row">
                                <span className="color-label">Text</span>
                                <input
                                    type="color"
                                    value={settings.customTheme?.readerText || '#d4d4d4'}
                                    onChange={e => {
                                        handleCustomThemeChange('text', e.target.value);
                                        handleCustomThemeChange('readerText', e.target.value);
                                    }}
                                />
                            </div>
                            <div className="color-row">
                                <span className="color-label">Accent</span>
                                <input
                                    type="color"
                                    value={settings.customTheme?.accent || '#7c5cfc'}
                                    onChange={e => handleCustomThemeChange('accent', e.target.value)}
                                />
                            </div>
                            <div className="color-row">
                                <span className="color-label">Surface</span>
                                <input
                                    type="color"
                                    value={settings.customTheme?.surface || '#16213e'}
                                    onChange={e => handleCustomThemeChange('surface', e.target.value)}
                                />
                            </div>
                        </section>
                    )}

                    {/* ─── Preview ─────────────────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">Preview</h3>
                        <div
                            className="text-preview"
                            style={{
                                fontFamily: currentFont.family,
                                fontSize: settings.fontSize + 'px',
                                lineHeight: settings.lineHeight,
                                textAlign: settings.textAlign,
                                background: getTheme(settings.theme, settings.customTheme).readerBg,
                                color: getTheme(settings.theme, settings.customTheme).readerText,
                                padding: Math.min(settings.margins, 24) + 'px',
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                        >
                            {settings.readerBgImage && (
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    backgroundImage: `url(${settings.readerBgImage})`,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                    opacity: settings.readerBgOpacity,
                                    pointerEvents: 'none',
                                }} />
                            )}
                            <span style={{ position: 'relative', zIndex: 1 }}>
                                The quick brown fox jumps over the lazy dog. Typography is the art and technique of arranging type to make written language legible, readable, and appealing.
                            </span>
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}
