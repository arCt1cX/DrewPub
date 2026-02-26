import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteBook, updateBookMeta } from '../db';
import './BookCard.css';

export default function BookCard({ book, viewMode, onDelete }) {
    const navigate = useNavigate();
    const [showMenu, setShowMenu] = useState(false);
    const [pressing, setPressing] = useState(false);

    const handleOpen = () => {
        updateBookMeta(book.id, { lastReadAt: Date.now() });
        navigate(`/read/${book.id}`);
    };

    const handleDelete = async (e) => {
        e.stopPropagation();
        setShowMenu(false);
        await deleteBook(book.id);
        onDelete(book.id);
    };

    const progress = book.progress || 0;

    if (viewMode === 'list') {
        return (
            <div
                className={`book-card-list ${pressing ? 'pressing' : ''}`}
                onClick={handleOpen}
                onPointerDown={() => setPressing(true)}
                onPointerUp={() => setPressing(false)}
                onPointerLeave={() => setPressing(false)}
            >
                <div className="book-cover-list">
                    {book.cover ? (
                        <img src={book.cover} alt={book.title} />
                    ) : (
                        <div className="book-cover-placeholder-list">
                            <span>{book.title?.[0] || '?'}</span>
                        </div>
                    )}
                </div>
                <div className="book-info-list">
                    <h3 className="book-title-list">{book.title || 'Untitled'}</h3>
                    <p className="book-author-list">{book.author || 'Unknown Author'}</p>
                    {progress > 0 && (
                        <div className="book-progress-bar-list">
                            <div className="book-progress-fill-list" style={{ width: `${progress}%` }} />
                        </div>
                    )}
                </div>
                <button
                    className="book-menu-btn"
                    onClick={e => { e.stopPropagation(); setShowMenu(!showMenu); }}
                >
                    ⋯
                </button>
                {showMenu && (
                    <div className="book-menu glass-strong">
                        <button className="book-menu-item delete" onClick={handleDelete}>
                            🗑 Remove
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div
            className={`book-card ${pressing ? 'pressing' : ''}`}
            onClick={handleOpen}
            onPointerDown={() => setPressing(true)}
            onPointerUp={() => setPressing(false)}
            onPointerLeave={() => { setPressing(false); setShowMenu(false); }}
        >
            <div className="book-cover">
                {book.cover ? (
                    <img src={book.cover} alt={book.title} loading="lazy" />
                ) : (
                    <div className="book-cover-placeholder">
                        <span className="placeholder-letter">{book.title?.[0] || '?'}</span>
                        <span className="placeholder-title">{book.title}</span>
                    </div>
                )}
                {progress > 0 && (
                    <div className="book-progress-overlay">
                        <div className="book-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                )}
                <button
                    className="book-menu-trigger"
                    onClick={e => { e.stopPropagation(); setShowMenu(!showMenu); }}
                >
                    ⋮
                </button>
            </div>
            <div className="book-meta">
                <h3 className="book-title">{book.title || 'Untitled'}</h3>
                <p className="book-author">{book.author || 'Unknown Author'}</p>
            </div>
            {showMenu && (
                <div className="book-menu glass-strong" onClick={e => e.stopPropagation()}>
                    <button className="book-menu-item delete" onClick={handleDelete}>
                        🗑 Remove Book
                    </button>
                </div>
            )}
        </div>
    );
}
