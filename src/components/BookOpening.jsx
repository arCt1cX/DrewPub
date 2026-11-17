import React, { useEffect, useState } from 'react';
import BookCover from './CoverArt';
import './BookOpening.css';

// Shown while the EPUB loads: the closed book sits in the middle of the
// screen, then its cover swings open onto the first page and fades away.
export default function BookOpening({ book, ready, onDone }) {
    const [phase, setPhase] = useState('closed');

    useEffect(() => {
        if (ready) setPhase('open');
    }, [ready]);

    return (
        <div
            className={`book-opening ${phase}`}
            onAnimationEnd={(e) => {
                if (e.target === e.currentTarget && phase === 'open') onDone?.();
            }}
            aria-hidden="true"
        >
            {book && (
                <div className="book-opening-book">
                    <div className="book-opening-page">
                        <span className="book-opening-page-title">{book.title}</span>
                    </div>
                    <div className="book-opening-cover">
                        <BookCover book={book} lazy={false} />
                    </div>
                </div>
            )}
            {phase === 'closed' && <div className="book-opening-loading">Opening…</div>}
        </div>
    );
}
