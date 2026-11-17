import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getAllReadingStats, getAllBooks, getAllVocab, dayKey } from '../db';
import { formatDuration } from '../utils/format';
import { IconClock, IconFlame, IconStar, IconBookOpen, IconChart } from '../components/Icons';
import BookCover from '../components/CoverArt';
import './Stats.css';

const CHART_DAYS = 14;

// Spine colours for the two-week shelf, the same cloths as generated covers.
const SPINES = [
    ['#7E9078', '#55684F'], ['#C97B5F', '#9E5239'], ['#6D8597', '#435A6B'], ['#D1A35A', '#A3742E'],
    ['#8C6A7E', '#5B4152'], ['#94966A', '#676943'], ['#B98A72', '#87604C'], ['#5F8A85', '#3E605C'],
];

// Counts up from zero when the number first appears.
function useCountUp(target, duration = 900) {
    const [value, setValue] = useState(0);
    const raf = useRef(0);
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setValue(target);
            return undefined;
        }
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setValue(Math.round(target * eased));
            if (t < 1) raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf.current);
    }, [target, duration]);
    return value;
}

// Last N days, oldest first, each with the total time read that day.
function buildChart(byDay) {
    const days = [];
    const now = new Date();
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = dayKey(d);
        days.push({ key, date: d, ms: byDay[key] ?? 0 });
    }
    return days;
}

// Consecutive days with any reading, counting back from today. Yesterday still
// keeps the streak alive so it doesn't reset before the day is over.
function computeStreak(byDay) {
    const today = new Date();
    let streak = 0;
    let cursor = new Date(today);
    if (!byDay[dayKey(cursor)]) {
        cursor.setDate(cursor.getDate() - 1);
        if (!byDay[dayKey(cursor)]) return 0;
    }
    while (byDay[dayKey(cursor)]) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

export default function Stats() {
    const [stats, setStats] = useState([]);
    const [books, setBooks] = useState([]);
    const [vocabCount, setVocabCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [picked, setPicked] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const [rows, allBooks, vocab] = await Promise.all([
                    getAllReadingStats(), getAllBooks(), getAllVocab(),
                ]);
                setStats(rows);
                setBooks(allBooks);
                setVocabCount(vocab.length);
            } catch (e) {
                console.error('Failed to load statistics:', e);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const view = useMemo(() => {
        const byDay = {};
        const byBook = {};
        let total = 0;
        for (const row of stats) {
            const ms = row.ms ?? 0;
            byDay[row.day] = (byDay[row.day] ?? 0) + ms;
            byBook[row.bookId] = (byBook[row.bookId] ?? 0) + ms;
            total += ms;
        }

        const chart = buildChart(byDay);
        const week = chart.slice(-7).reduce((sum, d) => sum + d.ms, 0);
        const daysRead = Object.keys(byDay).length;

        const perBook = books
            .map((b) => ({ book: b, ms: byBook[b.id] ?? 0 }))
            .filter((row) => row.ms > 0)
            .sort((a, b) => b.ms - a.ms);

        return {
            total,
            week,
            chart,
            daysRead,
            streak: computeStreak(byDay),
            perBook,
            finished: books.filter((b) => (b.progress ?? 0) >= 98).length,
            started: books.filter((b) => (b.progress ?? 0) > 0 && (b.progress ?? 0) < 98).length,
            average: daysRead ? total / daysRead : 0,
        };
    }, [stats, books]);

    const peak = Math.max(...view.chart.map((d) => d.ms), 1);
    const bookPeak = Math.max(...view.perBook.map((r) => r.ms), 1);

    return (
        <div className="stats-page page">
            <header className="page-head">
                <div className="page-head-text">
                    <span className="page-head-sub">
                        {view.daysRead} {view.daysRead === 1 ? 'day' : 'days'} of reading
                    </span>
                    <h1 className="page-head-title">Statistics</h1>
                </div>
            </header>

            <main className="stats-content">
                {loading ? (
                    <div className="stats-loading">
                        <div className="spinner" />
                        <p>Loading your statistics...</p>
                    </div>
                ) : view.total === 0 ? (
                    <div className="stats-empty animate-fade-in-up">
                        <IconChart size={56} stroke={1} style={{ color: 'var(--accent)', opacity: 0.5 }} />
                        <h2 className="empty-title">Nothing to show yet</h2>
                        <p className="empty-desc">
                            Open a book and your reading time will start<br />
                            building up here.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="stats-tiles">
                            <Tile
                                i={0}
                                Icon={IconClock}
                                minutes={Math.floor(view.total / 60000)}
                                label="Total read"
                            />
                            <Tile
                                i={1}
                                Icon={IconFlame}
                                count={view.streak}
                                label="Day streak"
                            />
                            <Tile
                                i={2}
                                Icon={IconBookOpen}
                                count={view.finished}
                                label={view.finished === 1 ? 'Book finished' : 'Books finished'}
                            />
                            <Tile
                                i={3}
                                Icon={IconStar}
                                count={vocabCount}
                                label={vocabCount === 1 ? 'Word saved' : 'Words saved'}
                            />
                        </div>

                        <section className="stats-section">
                            <div className="stats-section-head">
                                <h2 className="stats-section-title">Last two weeks</h2>
                                <span className="stats-section-note">
                                    {formatDuration(view.week, { short: true })} in the last 7 days
                                </span>
                            </div>
                            <div className="stats-shelf">
                                <div className="stats-spines">
                                    {view.chart.map((d, i) => {
                                        const [c1, c2] = SPINES[i % SPINES.length];
                                        const isToday = i === view.chart.length - 1;
                                        return (
                                            <button
                                                type="button"
                                                key={d.key}
                                                className={`stats-spine-slot ${picked === i ? 'picked' : ''}`}
                                                onClick={() => setPicked(picked === i ? null : i)}
                                                aria-label={`${d.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}: ${formatDuration(d.ms)}`}
                                            >
                                                {d.ms > 0 ? (
                                                    <span
                                                        className={`stats-spine ${isToday ? 'today' : ''}`}
                                                        style={{
                                                            height: `${Math.max(10, (d.ms / peak) * 100)}%`,
                                                            '--c1': isToday ? 'var(--accent-secondary)' : c1,
                                                            '--c2': isToday ? 'var(--accent-secondary-deep)' : c2,
                                                            '--i': i,
                                                        }}
                                                    />
                                                ) : (
                                                    <span className="stats-spine-gap" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="stats-ledge" />
                                <div className="stats-days">
                                    {view.chart.map((d, i) => (
                                        <span key={d.key} className={i === view.chart.length - 1 ? 'today' : ''}>
                                            {d.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
                                        </span>
                                    ))}
                                </div>
                                <p className="stats-picked">
                                    {picked !== null
                                        ? <>
                                            <b>{view.chart[picked].date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</b>
                                            {' · '}{view.chart[picked].ms > 0 ? formatDuration(view.chart[picked].ms, { short: true }) : 'no reading'}
                                        </>
                                        : 'Tap a book to see that day'}
                                </p>
                            </div>
                        </section>

                        <section className="stats-section">
                            <div className="stats-section-head">
                                <h2 className="stats-section-title">Time per book</h2>
                                <span className="stats-section-note">
                                    {formatDuration(view.average, { short: true })} on an average day
                                </span>
                            </div>
                            <div className="stats-books">
                                {view.perBook.map(({ book, ms }, i) => (
                                    <div key={book.id} className="stats-book-row" style={{ '--i': i }}>
                                        <div className="stats-book-cover">
                                            <BookCover book={book} />
                                        </div>
                                        <div className="stats-book-body">
                                            <div className="stats-book-info">
                                                <span className="stats-book-title">{book.title || 'Untitled'}</span>
                                                <span className="stats-book-time">{formatDuration(ms, { short: true })}</span>
                                            </div>
                                            <div className="stats-book-track">
                                                <div
                                                    className="stats-book-fill"
                                                    style={{ width: `${(ms / bookPeak) * 100}%` }}
                                                />
                                            </div>
                                            <span className="stats-book-progress">
                                                {(book.progress ?? 0) >= 100 ? 'Finished' : (book.progress ?? 0) > 0 ? `${book.progress}% read` : 'Under 1% read'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}

function Tile({ i, Icon, count, minutes, label }) {
    const shown = useCountUp(minutes ?? count ?? 0);
    let value = `${shown}`;
    if (minutes !== undefined) {
        const h = Math.floor(shown / 60);
        const m = shown % 60;
        value = h ? `${h}h ${m}m` : `${m}m`;
    }
    return (
        <div className="stats-tile" style={{ '--i': i }}>
            <span className="stats-tile-icon"><Icon size={16} /></span>
            <span className="stats-tile-value">{value}</span>
            <span className="stats-tile-label">{label}</span>
        </div>
    );
}
