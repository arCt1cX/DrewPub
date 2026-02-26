import React from 'react';
import './TranslationPopup.css';

export default function TranslationPopup({ data, onClose }) {
    if (!data) return null;

    return (
        <div className="translation-popup-overlay" onClick={onClose}>
            <div className="translation-popup glass-strong animate-slide-in-up" onClick={e => e.stopPropagation()}>
                <div className="translation-popup-header">
                    <span className="translation-popup-lang">🇬🇧 English</span>
                    <span className="translation-popup-arrow">➔</span>
                    <span className="translation-popup-lang">🇮🇹 Italian</span>
                    <button className="btn-icon close-btn" onClick={onClose}>✕</button>
                </div>

                <div className="translation-popup-content">
                    <h3 className="translation-popup-original">{data.text}</h3>

                    {data.loading ? (
                        <div className="translation-loading">
                            <div className="spinner-small" />
                            <span>Translating...</span>
                        </div>
                    ) : (
                        <p className="translation-popup-result">{data.translation}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
