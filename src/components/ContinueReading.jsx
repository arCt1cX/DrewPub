import React from 'react';
import { useNavigate } from 'react-router-dom';
import BookCover from './CoverArt';
import { IconPlay } from './Icons';
import { updateBookMeta } from '../db';
import { formatDuration, estimateRemaining } from '../utils/format';
import './ContinueReading.css';

// The book you're in the middle of, standing out of the shelf in 3D.
export default function ContinueReading({ book, readingMs = 0 }) {
    const navigate = useNavigate();
    const progress = Math.min(100, Math.max(0, book.progress || 0));
    const remaining = estimateRemaining(readingMs, progress);

    const open = () => {
        updateBookMeta(book.id, { lastReadAt: Date.now() });
        navigate(`/read/${book.id}`);
    };

    return (
        <section className="continue-card" aria-label="Continue reading">
            <button className="continue-book-wrap" onClick={open} aria-label={`Open ${book.title || 'book'}`}>
                <span className="continue-book">
                    <span className="continue-book-front">
                        <BookCover book={book} lazy={false} />
                    </span>
                    <span className="continue-book-pages" />
                </span>
            </button>

            <div className="continue-info">
                <span className="continue-eyebrow">Continue reading</span>
                <h2 className="continue-title">{book.title || 'Untitled'}</h2>
                <p className="continue-sub">{book.lastChapter || book.author || 'Unknown Author'}</p>

                <div className="continue-mark" style={{ '--p': `${progress}%` }}>
                    <div className="continue-track"><div className="continue-fill" /></div>
                    <span className="continue-ribbon" />
                </div>
                <div className="continue-meta">
                    <span>{progress}%</span>
                    {remaining
                        ? <span>~{formatDuration(remaining, { short: true })} left</span>
                        : readingMs >= 60000 && <span>{formatDuration(readingMs, { short: true })} read</span>}
                </div>

                <button className="continue-resume" onClick={open}>
                    <IconPlay size={12} stroke={0} /> Resume
                </button>
            </div>
        </section>
    );
}
