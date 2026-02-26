import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from '../components/Header';
import BookCard from '../components/BookCard';
import SettingsPanel from '../components/SettingsPanel';
import { getAllBooks, addBook } from '../db';
import { parseEpub, generateId } from '../utils/epub';
import { useSettings } from '../contexts/SettingsContext';
import './Library.css';

export default function Library() {
    const { settings, updateSetting } = useSettings();
    const [books, setBooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const fileInputRef = useRef(null);

    const loadBooks = useCallback(async () => {
        try {
            const allBooks = await getAllBooks();
            setBooks(allBooks);
        } catch (e) {
            console.error('Failed to load books:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadBooks();
    }, [loadBooks]);

    const handleFileSelect = async (files) => {
        if (!files?.length) return;
        setUploading(true);

        for (const file of files) {
            if (!file.name.endsWith('.epub')) continue;
            try {
                const arrayBuffer = await file.arrayBuffer();
                const meta = await parseEpub(arrayBuffer);
                const book = {
                    id: generateId(),
                    title: meta.title,
                    author: meta.author,
                    cover: meta.cover,
                    fileName: file.name,
                    fileSize: file.size,
                    data: arrayBuffer,
                    addedAt: Date.now(),
                    lastReadAt: Date.now(),
                    progress: 0,
                };
                await addBook(book);
            } catch (e) {
                console.error('Failed to add book:', file.name, e);
            }
        }

        await loadBooks();
        setUploading(false);
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleInputChange = (e) => {
        handleFileSelect(e.target.files);
        e.target.value = '';
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        handleFileSelect(e.dataTransfer.files);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleDragLeave = () => {
        setDragOver(false);
    };

    const handleDeleteBook = (bookId) => {
        setBooks(prev => prev.filter(b => b.id !== bookId));
    };

    // Sort books
    const sortedBooks = [...books].sort((a, b) => {
        const key = settings.librarySortBy;
        if (key === 'title') return (a.title || '').localeCompare(b.title || '');
        if (key === 'author') return (a.author || '').localeCompare(b.author || '');
        // lastReadAt, addedAt — descending
        return (b[key] || 0) - (a[key] || 0);
    });

    return (
        <div
            className={`library-page page ${dragOver ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            <Header
                viewMode={settings.libraryView}
                onToggleView={() =>
                    updateSetting('libraryView', settings.libraryView === 'grid' ? 'list' : 'grid')
                }
                sortBy={settings.librarySortBy}
                onSortChange={(val) => updateSetting('librarySortBy', val)}
                bookCount={books.length}
                onUpload={handleUploadClick}
                onShowSettings={() => setShowSettings(true)}
            />

            <input
                ref={fileInputRef}
                type="file"
                accept=".epub"
                multiple
                style={{ display: 'none' }}
                onChange={handleInputChange}
            />

            <main className="library-content">
                {loading ? (
                    <div className="library-loading">
                        <div className="spinner" />
                        <p>Loading your library...</p>
                    </div>
                ) : books.length === 0 ? (
                    <div className="library-empty animate-fade-in-up">
                        <div className="empty-illustration">
                            <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
                                <rect x="20" y="15" width="35" height="50" rx="4" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
                                <rect x="25" y="22" width="18" height="2" rx="1" fill="var(--accent)" opacity="0.4" />
                                <rect x="25" y="27" width="22" height="2" rx="1" fill="var(--text-secondary)" opacity="0.3" />
                                <rect x="25" y="32" width="15" height="2" rx="1" fill="var(--text-secondary)" opacity="0.3" />
                                <rect x="65" y="25" width="35" height="50" rx="4" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
                                <rect x="70" y="32" width="18" height="2" rx="1" fill="var(--accent)" opacity="0.4" />
                                <rect x="70" y="37" width="22" height="2" rx="1" fill="var(--text-secondary)" opacity="0.3" />
                                <rect x="70" y="42" width="15" height="2" rx="1" fill="var(--text-secondary)" opacity="0.3" />
                                <circle cx="60" cy="90" r="16" fill="var(--accent)" opacity="0.1" />
                                <text x="60" y="95" textAnchor="middle" fill="var(--accent)" fontSize="20" fontWeight="300">+</text>
                            </svg>
                        </div>
                        <h2 className="empty-title">Your library is empty</h2>
                        <p className="empty-desc">
                            Upload your EPUB files to start reading.<br />
                            Drag & drop files here or tap the button below.
                        </p>
                        <button className="btn btn-primary" onClick={handleUploadClick}>
                            <span>+</span> Add Your First Book
                        </button>
                    </div>
                ) : (
                    <div
                        className={`library-grid ${settings.libraryView === 'list' ? 'library-list' : ''} stagger-children`}
                    >
                        {sortedBooks.map(book => (
                            <BookCard
                                key={book.id}
                                book={book}
                                viewMode={settings.libraryView}
                                onDelete={handleDeleteBook}
                            />
                        ))}
                    </div>
                )}
            </main>

            {uploading && (
                <div className="upload-overlay">
                    <div className="upload-modal glass-strong animate-scale-in">
                        <div className="spinner" />
                        <p>Importing books...</p>
                    </div>
                </div>
            )}

            {dragOver && (
                <div className="drag-overlay animate-fade-in">
                    <div className="drag-content">
                        <div className="drag-icon">📚</div>
                        <p>Drop EPUB files here</p>
                    </div>
                </div>
            )}

            {showSettings && (
                <SettingsPanel onClose={() => setShowSettings(false)} />
            )}
        </div>
    );
}
