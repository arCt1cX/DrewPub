import React, { useRef, useState, useEffect } from 'react';
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

    const [systemVoices, setSystemVoices] = useState([]);

    // Load system voices on mount
    useEffect(() => {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            // Filter for English by default or all if none
            const english = voices.filter(v => v.lang.startsWith('en'));
            setSystemVoices(english.length > 0 ? english : voices);
        };
        loadVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }, []);

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
                        </div>
                    </section>

                    {/* ─── Text-to-Speech ──────────────────── */}
                    <section className="settings-section">
                        <h3 className="section-label">🔊 Text-to-Speech (System Voices)</h3>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            Uses your device's voices. On iPad, download "Siri" or "Enhanced" voices in Accessibility settings for best quality.
                        </p>
                        <div className="tts-setting-row">
                            <span className="slider-label">Narrator</span>
                            <select
                                className="tts-voice-select"
                                value={settings.ttsNarratorVoice || ''}
                                onChange={e => updateSetting('ttsNarratorVoice', e.target.value)}
                            >
                                <option value="">Default System Voice</option>
                                {systemVoices.map(v => (
                                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                                ))}
                            </select>
                        </div>
                        <div className="tts-setting-row">
                            <span className="slider-label">Male Voice</span>
                            <select
                                className="tts-voice-select"
                                value={settings.ttsMaleVoice || ''}
                                onChange={e => updateSetting('ttsMaleVoice', e.target.value)}
                            >
                                <option value="">Default System Voice</option>
                                {systemVoices.map(v => (
                                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                                ))}
                            </select>
                        </div>
                        <div className="tts-setting-row">
                            <span className="slider-label">Female Voice</span>
                            <select
                                className="tts-voice-select"
                                value={settings.ttsFemaleVoice || ''}
                                onChange={e => updateSetting('ttsFemaleVoice', e.target.value)}
                            >
                                <option value="">Default System Voice</option>
                                {systemVoices.map(v => (
                                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                                ))}
                            </select>
                        </div>
                        <div className="slider-row">
                            <span className="slider-label">Speed</span>
                            <input
                                type="range"
                                min="0.5"
                                max="2.0"
                                step="0.25"
                                value={settings.ttsSpeed || 1.0}
                                onChange={e => updateSetting('ttsSpeed', Number(e.target.value))}
                            />
                            <span className="slider-value">{settings.ttsSpeed || 1.0}x</span>
                        </div>
                        <div className="tts-setting-row">
                            <span className="slider-label">Auto-advance</span>
                            <button
                                className={`toggle-btn ${settings.ttsAutoAdvance ? 'active' : ''}`}
                                onClick={() => updateSetting('ttsAutoAdvance', !settings.ttsAutoAdvance)}
                            >
                                {settings.ttsAutoAdvance ? 'ON' : 'OFF'}
                            </button>
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
                        </div>
                    </section>

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
                                padding: '24px',
                            }}
                        >
                            The quick brown fox jumps over the lazy dog. Typography for your audiobook.
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
}
