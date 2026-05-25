import React from 'react';
import { IconArrowLeft, IconMenu, IconSettings, IconVolume, IconArrowRight } from './Icons';
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
    ttsActive,
    onPrev,
    onNext,
    isPaginated,
}) {
    return (
        <>
            {/* Top bar */}
            <div className={`reader-top-bar ${visible ? 'visible' : ''}`}>
                <button className="btn-icon reader-btn" onClick={onBack} title="Back to Library">
                    <IconArrowLeft size={17} />
                </button>
                <div className="reader-top-info">
                    <span className="reader-book-title">{bookTitle}</span>
                    {chapterTitle && <span className="reader-chapter">{chapterTitle}</span>}
                </div>
                <div className="reader-top-actions">
                    <button
                        className={`btn-icon reader-btn ${ttsActive ? 'reader-btn-active' : ''}`}
                        onClick={onToggleTts}
                        title="Text-to-Speech"
                    >
                        <IconVolume size={16} />
                    </button>
                    <button className="btn-icon reader-btn" onClick={onToggleToc} title="Table of Contents">
                        <IconMenu size={16} />
                    </button>
                    <button className="btn-icon reader-btn" onClick={onToggleSettings} title="Settings">
                        <IconSettings size={16} />
                    </button>
                </div>
            </div>

            {/* Bottom bar */}
            <div className={`reader-bottom-bar ${visible ? 'visible' : ''}`}>
                <button className="reader-nav-btn" onClick={onPrev} title="Previous">
                    <IconArrowLeft size={18} />
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
                    <IconArrowRight size={18} />
                </button>
            </div>
        </>
    );
}
