import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteBook, updateBookMeta } from '../db';
import { IconTrash, IconMore, IconMoreH, IconRefresh } from './Icons';
import BookCover, { hashString } from './CoverArt';
import { formatDuration, estimateRemaining } from '../utils/format';
import './BookCard.css';

export default function BookCard({ book, viewMode, onDelete, onSync, readingMs = 0, index = 0 }) {
    const navigate = useNavigate();
    const [showMenu, setShowMenu] = useState(false);
    const rootRef = useRef(null);
    const isNovel = book.sourceType === 'webnovel';

    // Close the menu when tapping anywhere else.
    useEffect(() => {
        if (!showMenu) return;
        const close = (e) => {
            if (!rootRef.current?.contains(e.target)) setShowMenu(false);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [showMenu]);

    const handleSync = (e) => {
        e.stopPropagation();
        setShowMenu(false);
        onSync?.(book);
    };

    const handleOpen = () => {
        updateBookMeta(book.id, { lastReadAt: Date.now() });
        navigate(`/read/${book.id}`);
    };

    const handleDelete = async (e) => {
        e.stopPropagation();
        const confirmed = window.confirm(`Are you sure you want to remove "${book.title}"?`);
        if (!confirmed) return;

        setShowMenu(false);
        try {
            await deleteBook(book.id);
            onDelete(book.id);
        } catch (err) {
            console.error('Failed to delete book:', err);
            alert('Could not delete book. Please try again.');
        }
    };

    const toggleMenu = (e) => {
        e.stopPropagation();
        setShowMenu((v) => !v);
    };

    const progress = book.progress || 0;

    const menu = showMenu && (
        <div className="book-menu" onClick={e => e.stopPropagation()}>
            {isNovel && (
                <button className="book-menu-item" onClick={handleSync}>
                    <IconRefresh size={15} /> Check for new chapters
                </button>
            )}
            <button className="book-menu-item delete" onClick={handleDelete}>
                <IconTrash size={15} /> Remove Book
            </button>
        </div>
    );

    if (viewMode === 'list') {
        // "1h 20m read · ~2h left" — only once there is something real to report.
        const remaining = estimateRemaining(readingMs, progress);
        const timeLine = readingMs > 0
            ? `${formatDuration(readingMs, { short: true })} read${remaining ? ` · ~${formatDuration(remaining, { short: true })} left` : ''}`
            : null;

        return (
            <div
                ref={rootRef}
                className={`book-card-list ${showMenu ? 'menu-open' : ''}`}
                onClick={handleOpen}
                style={{ '--i': Math.min(index, 14) }}
            >
                <div className="book-cover-list">
                    <BookCover book={book} />
                </div>
                <div className="book-info-list">
                    <h3 className="book-title-list">{book.title || 'Untitled'}</h3>
                    <p className="book-author-list">{book.author || 'Unknown Author'}</p>
                    {progress > 0 && (
                        <div className="book-progress-bar-list">
                            <div className="book-progress-fill-list" style={{ width: `${progress}%` }} />
                        </div>
                    )}
                    {timeLine && <p className="book-time-list">{timeLine}</p>}
                </div>
                <button className="book-menu-btn" onClick={toggleMenu} aria-label="Book options">
                    <IconMoreH size={18} />
                </button>
                {menu}
            </div>
        );
    }

    // Shelf mode: the book stands on a ledge, its status is printed under it
    // by the shelf itself. A little width variety makes the row feel real.
    const width = 90 + (hashString(book.id || book.title) % 11);

    return (
        <div
            ref={rootRef}
            className={`shelf-book ${showMenu ? 'menu-open' : ''}`}
            style={{ '--i': Math.min(index, 14), width: `${width}%` }}
            onClick={handleOpen}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(); }}
            aria-label={`${book.title || 'Untitled'}${book.author ? ` by ${book.author}` : ''}`}
            title={book.title}
        >
            <div className="shelf-book-cover">
                <BookCover book={book} />
                {progress > 0 && progress < 100 && (
                    <span className="shelf-book-progress" style={{ width: `${progress}%` }} />
                )}
                <button className="book-menu-trigger" onClick={toggleMenu} aria-label="Book options">
                    <IconMore size={15} />
                </button>
            </div>
            {menu}
        </div>
    );
}
