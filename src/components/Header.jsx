import React from 'react';
import './Header.css';

const LOGO_SVG = `
<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="40" height="40" rx="10" fill="url(#logoGrad)"/>
  <path d="M12 10h3c1.5 0 2.5.5 3 1.5V28c-.5-.8-1.5-1.2-3-1.2h-3V10z" fill="rgba(255,255,255,0.9)"/>
  <path d="M28 10h-3c-1.5 0-2.5.5-3 1.5V28c.5-.8 1.5-1.2 3-1.2h3V10z" fill="rgba(255,255,255,0.7)"/>
  <path d="M20 12v16" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
  <rect x="14" y="14" width="4" height="0.8" rx="0.4" fill="rgba(255,255,255,0.3)"/>
  <rect x="14" y="16.5" width="3" height="0.8" rx="0.4" fill="rgba(255,255,255,0.3)"/>
  <rect x="22" y="14" width="4" height="0.8" rx="0.4" fill="rgba(255,255,255,0.2)"/>
  <rect x="22" y="16.5" width="3" height="0.8" rx="0.4" fill="rgba(255,255,255,0.2)"/>
  <defs>
    <linearGradient id="logoGrad" x1="0" y1="0" x2="40" y2="40">
      <stop stop-color="#7c5cfc"/>
      <stop offset="1" stop-color="#5c3cdc"/>
    </linearGradient>
  </defs>
</svg>`;

export default function Header({
    viewMode,
    onToggleView,
    sortBy,
    onSortChange,
    bookCount,
    onUpload
}) {
    return (
        <header className="header glass">
            <div className="header-left">
                <div className="header-logo" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
                <div className="header-brand">
                    <h1 className="header-title">DrewPub</h1>
                    <span className="header-subtitle">
                        {bookCount} {bookCount === 1 ? 'book' : 'books'}
                    </span>
                </div>
            </div>

            <div className="header-actions">
                <div className="sort-select-wrap">
                    <select
                        className="sort-select"
                        value={sortBy}
                        onChange={e => onSortChange(e.target.value)}
                    >
                        <option value="lastReadAt">Recently Read</option>
                        <option value="addedAt">Recently Added</option>
                        <option value="title">Title</option>
                        <option value="author">Author</option>
                    </select>
                    <span className="sort-icon">⇅</span>
                </div>

                <button
                    className="btn-icon view-toggle"
                    onClick={onToggleView}
                    title={viewMode === 'grid' ? 'Switch to list' : 'Switch to grid'}
                >
                    {viewMode === 'grid' ? '☰' : '⊞'}
                </button>

                <button
                    className="btn-icon settings-btn"
                    onClick={onShowSettings}
                    title="Settings"
                    style={{ fontSize: '1.2rem' }}
                >
                    ⚙
                </button>

                <button className="btn btn-primary upload-btn" onClick={onUpload}>
                    <span className="upload-icon">+</span>
                    <span className="upload-text">Add Book</span>
                </button>
            </div>
        </header>
    );
}
