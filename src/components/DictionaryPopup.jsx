import React from 'react';
import './DictionaryPopup.css';

export default function DictionaryPopup({ word, translation, loading, position, onClose }) {
    if (!word) return null;

    return (
        <>
            <div className="dict-backdrop" onClick={onClose} />
            <div
                className="dict-popup glass-strong animate-fade-in-up"
                style={{
                    top: Math.min(position.y + 10, window.innerHeight - 200) + 'px',
                    left: Math.max(16, Math.min(position.x - 100, window.innerWidth - 216)) + 'px',
                }}
            >
                <div className="dict-header">
                    <span className="dict-word">{word}</span>
                    <button className="dict-close" onClick={onClose}>✕</button>
                </div>
                <div className="dict-body">
                    {loading ? (
                        <div className="dict-loading">
                            <div className="spinner-small" />
                            <span>Translating...</span>
                        </div>
                    ) : translation ? (
                        <div className="dict-translation">{translation}</div>
                    ) : (
                        <div className="dict-error">Translation not found</div>
                    )}
                </div>
            </div>
        </>
    );
}
