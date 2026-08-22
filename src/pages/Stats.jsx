import React, { useEffect, useMemo, useState } from 'react';
import { getAllReadingStats, getAllBooks, getAllVocab, dayKey } from '../db';
import { formatDuration } from '../utils/format';
import { IconClock, IconFlame, IconStar, IconBookOpen, IconChart } from '../components/Icons';
import './Stats.css';

const CHART_DAYS = 14;

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
                    <h1 className="page-head-title">Statistics</h1>
                    <span className="page-head-sub">
                        {view.daysRead} {view.daysRead === 1 ? 'day' : 'days'} of reading
                    </span>
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
                                Icon={IconClock}
                                value={formatDuration(view.total, { short: true })}
                                label="Total read"
                            />
                            <Tile
                                Icon={IconFlame}
                                value={`${view.streak}`}
                                label="Day streak"
                            />
                            <Tile
                                Icon={IconBookOpen}
                                value={`${view.finished}`}
                                label={view.finished === 1 ? 'Book finished' : 'Books finished'}
                            />
                            <Tile
                                Icon={IconStar}
                                value={`${vocabCount}`}
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
                            <div className="stats-chart">
                                {view.chart.map((d) => (
                                    <div key={d.key} className="stats-bar-col" title={`${formatDuration(d.ms, { short: true })}`}>
                                        <div className="stats-bar-track">
                                            <div
                                                className={`stats-bar ${d.ms > 0 ? 'has-value' : ''}`}
                                                style={{ height: `${d.ms > 0 ? Math.max(6, (d.ms / peak) * 100) : 0}%` }}
                                            />
                                        </div>
                                        <span className="stats-bar-label">
                                            {d.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
                                        </span>
                                    </div>
                                ))}
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
                                {view.perBook.map(({ book, ms }) => (
                                    <div key={book.id} className="stats-book-row">
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
                                        <span className="stats-book-progress">{book.progress ?? 0}% read</span>
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

function Tile({ Icon, value, label }) {
    return (
        <div className="stats-tile">
            <Icon size={17} className="stats-tile-icon" />
            <span className="stats-tile-value">{value}</span>
            <span className="stats-tile-label">{label}</span>
        </div>
    );
}
