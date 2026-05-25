import React from 'react';
import { IconSearch, IconGrid, IconList, IconSettings, IconPlus, IconSort } from './Icons';
import './Header.css';

export default function Header({
    viewMode,
    onToggleView,
    sortBy,
    onSortChange,
    bookCount,
    onUpload,
    onShowSettings
}) {
    return (
        <header className="header">
            <div className="header-left">
                <div className="header-logo">d</div>
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
                    <span className="sort-icon-wrap">
                        <IconSort size={14} />
                    </span>
                </div>

                <button
                    className="btn-icon view-toggle"
                    onClick={onToggleView}
                    title={viewMode === 'grid' ? 'Switch to list' : 'Switch to grid'}
                >
                    {viewMode === 'grid' ? <IconList size={16} /> : <IconGrid size={16} />}
                </button>

                <button
                    className="btn-icon settings-btn"
                    onClick={onShowSettings}
                    title="Settings"
                >
                    <IconSettings size={16} />
                </button>

                <button className="btn btn-primary upload-btn" onClick={onUpload}>
                    <IconPlus size={16} stroke={2.2} />
                    <span className="upload-text">Add Book</span>
                </button>
            </div>
        </header>
    );
}
