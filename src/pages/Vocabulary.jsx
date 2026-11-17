import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllVocab, deleteVocabEntry, markVocabReviewed, getAllBooks } from '../db';
import { formatDate } from '../utils/format';
import {
    IconSearch, IconClose, IconTrash, IconCards, IconBookOpen,
    IconStar, IconArrowRight, IconCheck, IconEye, IconRefresh,
} from '../components/Icons';
import BookCover from '../components/CoverArt';
import './Vocabulary.css';

export default function Vocabulary() {
    const navigate = useNavigate();
    const [entries, setEntries] = useState([]);
    const [books, setBooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [bookFilter, setBookFilter] = useState('all');
    const [reviewing, setReviewing] = useState(false);
    const [removing, setRemoving] = useState(null);

    const load = useCallback(async () => {
        try {
            const [vocab, allBooks] = await Promise.all([getAllVocab(), getAllBooks()]);
            setEntries(vocab);
            setBooks(allBooks);
        } catch (e) {
            console.error('Failed to load vocabulary:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return entries.filter((e) => {
            if (bookFilter !== 'all' && e.bookId !== bookFilter) return false;
            if (!q) return true;
            return (e.text || '').toLowerCase().includes(q)
                || (e.translation || '').toLowerCase().includes(q)
                || (e.context || '').toLowerCase().includes(q);
        });
    }, [entries, query, bookFilter]);

    // Only books that actually have saved words are worth offering as a filter.
    const booksWithWords = useMemo(() => {
        const ids = new Set(entries.map((e) => e.bookId));
        return books.filter((b) => ids.has(b.id));
    }, [entries, books]);

    const bookById = useMemo(() => Object.fromEntries(books.map((b) => [b.id, b])), [books]);

    // The card folds away first, then the word is removed.
    const handleDelete = async (entry) => {
        setRemoving(entry.id);
        await deleteVocabEntry(entry.id);
        setTimeout(() => {
            setEntries((prev) => prev.filter((e) => e.id !== entry.id));
            setRemoving(null);
        }, 320);
    };

    const handleOpen = (entry) => {
        if (!entry.bookId) return;
        const target = entry.cfi
            ? `/read/${entry.bookId}?cfi=${encodeURIComponent(entry.cfi)}`
            : `/read/${entry.bookId}`;
        navigate(target);
    };

    if (reviewing) {
        return (
            <ReviewSession
                entries={filtered}
                onExit={() => { setReviewing(false); load(); }}
            />
        );
    }

    return (
        <div className="vocab-page page">
            <header className="page-head">
                <div className="page-head-text">
                    <span className="page-head-sub">
                        {entries.length} {entries.length === 1 ? 'saved word' : 'saved words'}
                    </span>
                    <h1 className="page-head-title">Vocabulary</h1>
                </div>
                {entries.length > 0 && (
                    <button
                        className="page-head-action"
                        onClick={() => setReviewing(true)}
                        disabled={filtered.length === 0}
                    >
                        <IconCards size={16} />
                        <span>Review</span>
                    </button>
                )}
            </header>

            {entries.length > 0 && (
                <div className="vocab-filters">
                    <div className="vocab-search">
                        <IconSearch size={15} className="vocab-search-icon" />
                        <input
                            type="text"
                            className="vocab-search-input"
                            placeholder="Search your words..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                            <button className="vocab-search-clear" onClick={() => setQuery('')} title="Clear">
                                <IconClose size={13} />
                            </button>
                        )}
                    </div>
                    {booksWithWords.length > 1 && (
                        <select
                            className="vocab-book-select"
                            value={bookFilter}
                            onChange={(e) => setBookFilter(e.target.value)}
                        >
                            <option value="all">All books</option>
                            {booksWithWords.map((b) => (
                                <option key={b.id} value={b.id}>{b.title || 'Untitled'}</option>
                            ))}
                        </select>
                    )}
                </div>
            )}

            <main className="vocab-content">
                {loading ? (
                    <div className="vocab-loading">
                        <div className="spinner" />
                        <p>Loading your words...</p>
                    </div>
                ) : entries.length === 0 ? (
                    <div className="vocab-empty animate-fade-in-up">
                        <IconStar size={56} stroke={1} style={{ color: 'var(--accent)', opacity: 0.5 }} />
                        <h2 className="empty-title">No saved words yet</h2>
                        <p className="empty-desc">
                            While reading, hold your finger on a word to translate it,<br />
                            then tap the star in the popup to keep it here.
                        </p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="vocab-empty animate-fade-in">
                        <p className="empty-desc">No words match this filter.</p>
                    </div>
                ) : (
                    <div className="vocab-list">
                        {filtered.map((entry, i) => (
                            <article
                                key={entry.id}
                                className={`vocab-card ${removing === entry.id ? 'removing' : ''}`}
                                style={{ '--i': Math.min(i, 12) }}
                            >
                                <div className="vocab-card-main">
                                    <h3 className="vocab-term">{entry.text}</h3>
                                    <p className="vocab-translation">{entry.translation}</p>
                                    {entry.context && entry.context !== entry.text && (
                                        <p className="vocab-context">{entry.context}</p>
                                    )}
                                    <div className="vocab-meta">
                                        {entry.bookTitle && (
                                            <span className="vocab-meta-item vocab-meta-book">
                                                {bookById[entry.bookId] ? (
                                                    <span className="vocab-meta-cover">
                                                        <BookCover book={bookById[entry.bookId]} />
                                                    </span>
                                                ) : <IconBookOpen size={12} />}
                                                <span className="vocab-meta-book-title">{entry.bookTitle}</span>
                                            </span>
                                        )}
                                        <span className="vocab-meta-item">{formatDate(entry.createdAt)}</span>
                                        {entry.reviewCount > 0 && (
                                            <span className="vocab-meta-item">
                                                <IconEye size={12} />
                                                {entry.knownCount}/{entry.reviewCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="vocab-card-actions">
                                    <button
                                        className="btn-icon vocab-action"
                                        onClick={() => handleOpen(entry)}
                                        title="Open in book"
                                    >
                                        <IconArrowRight size={15} />
                                    </button>
                                    <button
                                        className="btn-icon vocab-action vocab-action-danger"
                                        onClick={() => handleDelete(entry)}
                                        title="Remove"
                                    >
                                        <IconTrash size={15} />
                                    </button>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

// ─── Flashcard review ───────────────────────────────────
// Least recently reviewed first, so repeated sessions cycle through the list
// instead of showing the same handful of words every time.

function ReviewSession({ entries, onExit }) {
    const [deck] = useState(() =>
        [...entries].sort((a, b) => (a.lastReviewedAt ?? 0) - (b.lastReviewedAt ?? 0))
    );
    const [index, setIndex] = useState(0);
    const [revealed, setRevealed] = useState(false);
    const [score, setScore] = useState({ known: 0, unknown: 0 });

    const card = deck[index];
    const done = index >= deck.length;

    const answer = async (known) => {
        if (!card) return;
        await markVocabReviewed(card.id, known);
        setScore((s) => ({
            known: s.known + (known ? 1 : 0),
            unknown: s.unknown + (known ? 0 : 1),
        }));
        setRevealed(false);
        setIndex((i) => i + 1);
    };

    const restart = () => {
        setIndex(0);
        setRevealed(false);
        setScore({ known: 0, unknown: 0 });
    };

    return (
        <div className="review-page page">
            <header className="page-head">
                <div className="page-head-text">
                    <span className="page-head-sub">
                        {done ? 'Session complete' : `Card ${index + 1} of ${deck.length}`}
                    </span>
                    <h1 className="page-head-title">Review</h1>
                </div>
                <button className="btn-icon review-close" onClick={onExit} title="Close review">
                    <IconClose size={16} />
                </button>
            </header>

            <div className="review-progress" style={{ '--p': `${deck.length ? (index / deck.length) * 100 : 0}%` }}>
                <div className="review-progress-track"><div className="review-progress-fill" /></div>
                <span className="review-progress-ribbon" />
            </div>

            <main className="review-content">
                {done ? (
                    <div className="review-summary animate-fade-in-up">
                        <IconCheck size={44} stroke={1.4} style={{ color: 'var(--accent)' }} />
                        <h2 className="review-summary-title">
                            {score.known} of {deck.length} remembered
                        </h2>
                        <p className="empty-desc">
                            {score.unknown === 0
                                ? 'Every word recalled. Nicely done.'
                                : `${score.unknown} still need another pass.`}
                        </p>
                        <div className="review-summary-actions">
                            <button className="btn btn-ghost" onClick={restart}>
                                <IconRefresh size={15} /> Again
                            </button>
                            <button className="btn btn-primary" onClick={onExit}>Done</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <button
                            type="button"
                            key={card.id}
                            className={`review-card ${revealed ? 'revealed' : ''}`}
                            onClick={() => setRevealed(true)}
                            aria-label={revealed ? `${card.text}: ${card.translation}` : `${card.text}. Tap to reveal`}
                        >
                            <span className="review-card-inner">
                                <span className="review-face review-front">
                                    <span className="review-card-term">{card.text}</span>
                                    <span className="review-card-hint">Tap to reveal</span>
                                </span>
                                <span className="review-face review-back">
                                    <span className="review-card-term small">{card.text}</span>
                                    <span className="review-card-translation">{card.translation}</span>
                                    {card.context && card.context !== card.text && (
                                        <span className="review-card-context">{card.context}</span>
                                    )}
                                </span>
                            </span>
                        </button>

                        {revealed && (
                            <div className="review-actions animate-fade-in">
                                <button className="btn btn-ghost review-answer" onClick={() => answer(false)}>
                                    Not yet
                                </button>
                                <button className="btn btn-primary review-answer" onClick={() => answer(true)}>
                                    <IconCheck size={15} /> I knew it
                                </button>
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
