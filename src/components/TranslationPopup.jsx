import React, { useEffect, useState } from 'react';

export default function TranslationPopup({ text, position, onClose }) {
    const [translation, setTranslation] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!text) return;

        let isMounted = true;
        setLoading(true);
        setError(false);

        const fetchTranslation = async () => {
            try {
                // Free MyMemory API for EN -> IT
                const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|it`);
                const data = await res.json();

                if (isMounted) {
                    if (data && data.responseData && data.responseData.translatedText) {
                        setTranslation(data.responseData.translatedText);
                    } else {
                        setError(true);
                    }
                }
            } catch (err) {
                console.error("Translation fail:", err);
                if (isMounted) setError(true);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchTranslation();

        return () => { isMounted = false; };
    }, [text]);

    if (!text) return null;

    // Determine position to keep it on screen
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let left = position.x || windowWidth / 2;
    let top = position.y || windowHeight / 2;

    // Adjust if too close to edges
    const popupWidth = 280;
    const popupHeight = 120; // approximate

    if (left + popupWidth > windowWidth - 20) {
        left = windowWidth - popupWidth - 20;
    }
    if (left < 20) left = 20;

    // Show above or below the selection
    if (top + popupHeight > windowHeight - 40) {
        top = top - popupHeight - 40; // show above
    } else {
        top = top + 30; // show below
    }

    return (
        <div style={{
            position: 'absolute',
            left: `${left}px`,
            top: `${top}px`,
            width: `${popupWidth}px`,
            backgroundColor: 'var(--surface)',
            color: 'var(--text)',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            border: '1px solid var(--border)',
            zIndex: 1000,
            animation: 'fade-in 0.2s ease-out',
            pointerEvents: 'auto'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '8px' }}>
                <div>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 'bold', letterSpacing: '1px' }}>🇬🇧 English</span>
                    <div style={{ fontSize: '15px', fontWeight: '500', marginTop: '4px', wordBreak: 'break-word' }}>{text}</div>
                </div>
                <button onClick={onClose} style={{
                    background: 'none', border: 'none', color: 'var(--textSecondary)', cursor: 'pointer', padding: '4px', fontSize: '16px', lineHeight: 1
                }}>✕</button>
            </div>

            <div style={{ minHeight: '40px' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--textSecondary)', fontWeight: 'bold', letterSpacing: '1px' }}>🇮🇹 Italiano</span>
                {loading ? (
                    <div style={{ color: 'var(--textSecondary)', fontSize: '14px', marginTop: '6px', fontStyle: 'italic' }}>Translating...</div>
                ) : error ? (
                    <div style={{ color: '#ff6b6b', fontSize: '14px', marginTop: '6px' }}>Failed to translate.</div>
                ) : (
                    <div style={{ fontSize: '16px', marginTop: '6px', wordBreak: 'break-word' }}>{translation}</div>
                )}
            </div>
        </div>
    );
}
