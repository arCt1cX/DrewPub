import React from 'react';
import './ReaderControls.css';

export default function ReaderControls({
    visible,
    bookTitle,
    chapterTitle,
    progress,
    currentPage,
    totalPages,
    onBack,
    onToggleToc,
    onToggleSettings,
    onToggleTts,
    onPrev,
    onNext,
    isPaginated,
}) {
    return (
        <>
            {/* Top bar */}
            <div className={`reader-top-bar glass ${visible ? 'visible' : ''}`}>
                <button className="btn-icon reader-btn" onClick={onBack} title="Back to Library">
                    ←
                </button>
                <div className="reader-top-info">
                    <span className="reader-book-title">{bookTitle}</span>
                    {chapterTitle && <span className="reader-chapter">{chapterTitle}</span>}
                </div>
                <div className="reader-top-actions">
                    <button className="btn-icon reader-btn" onClick={onToggleTts} title="Text-to-Speech">
                        🔊
                    </button>
                    <button className="btn-icon reader-btn" onClick={onToggleToc} title="Table of Contents">
                        ☰
                    </button>
                    <button className="btn-icon reader-btn" onClick={onToggleSettings} title="Settings">
                        ⚙
                    </button>
                </div>
            </div>

            {/* Bottom bar */}
            <div className={`reader-bottom-bar glass ${visible ? 'visible' : ''}`}>
                <button className="reader-nav-btn" onClick={onPrev} title="Previous">
                    ‹
                </button>
                <div className="reader-progress-section">
                    <div className="reader-progress-bar">
                        <div className="reader-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="reader-progress-info">
                        <span>{progress}%</span>
                        {totalPages > 0 && (
                            <span className="reader-page-info">
                                {currentPage} / {totalPages}
                            </span>
                        )}
                    </div>
                </div>
                <button className="reader-nav-btn" onClick={onNext} title="Next">
                    ›
                </button>
            </div>
        </>
    );
}
