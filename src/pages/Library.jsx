import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from '../components/Header';
import BookCard from '../components/BookCard';
import SettingsPanel from '../components/SettingsPanel';
import { IconSearch, IconClose, IconDownload, IconArrowLeft, IconArrowRight, IconPlus, IconBookOpen } from '../components/Icons';
import { getAllBooks, addBook } from '../db';
import { parseEpub, generateId } from '../utils/epub';
import { importNovel, syncNovel, isNovelUrl } from '../utils/novel';
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

    // ─── Search State ───────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [searchPage, setSearchPage] = useState(1);
    const [searchPagination, setSearchPagination] = useState(null);
    const [downloadingId, setDownloadingId] = useState(null);
    const [downloadProgress, setDownloadProgress] = useState('');
    const searchInputRef = useRef(null);

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

    // ─── Web-Novel Import / Sync ────────────────────────
    const [novelBusy, setNovelBusy] = useState('');

    const handleImportNovel = async (url) => {
        if (novelBusy) return;
        setNovelBusy('Starting…');
        try {
            const book = await importNovel(url, { onProgress: setNovelBusy });
            await addBook(book);
            await loadBooks();
            clearSearch();
            setNovelBusy(book.complete
                ? `✓ Added ${book.fetchedCount} chapters!`
                : `✓ Added ${book.fetchedCount}/${book.chapterCount} — rate limited. Tap ⋯ → Check for new chapters to resume.`);
        } catch (err) {
            console.error('Novel import failed:', err);
            setNovelBusy(`✗ ${err.message}`);
        } finally {
            setTimeout(() => setNovelBusy(''), 6000);
        }
    };

    const handleSyncBook = async (book) => {
        if (novelBusy) return;
        setNovelBusy('Checking for new chapters…');
        try {
            const { book: updated, added, complete } = await syncNovel(book, { onProgress: setNovelBusy });
            if (updated) {
                await addBook(updated);
                await loadBooks();
                setNovelBusy(complete
                    ? `✓ Added ${added} chapter${added !== 1 ? 's' : ''}`
                    : `✓ Added ${added} — still rate limited, run again to continue`);
            } else {
                setNovelBusy('✓ Already up to date');
            }
        } catch (err) {
            console.error('Novel sync failed:', err);
            setNovelBusy(`✗ ${err.message}`);
        } finally {
            setTimeout(() => setNovelBusy(''), 5000);
        }
    };

    // ─── Search Logic ───────────────────────────────────
    const handleSearch = async (page = 1) => {
        const q = searchQuery.trim();
        if (!q) return;

        // A pasted web-novel URL imports the novel instead of searching.
        if (isNovelUrl(q)) {
            handleImportNovel(q);
            return;
        }

        setSearching(true);
        setSearchError('');
        setSearchPage(page);

        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${page}`);
            const data = await res.json();

            if (data.error) {
                setSearchError(data.error);
                setSearchResults(null);
            } else {
                setSearchResults(data.results || []);
                setSearchPagination(data.pagination || null);
            }
        } catch (err) {
            setSearchError('Search failed. Please try again.');
            setSearchResults(null);
        } finally {
            setSearching(false);
        }
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleSearch(1);
        }
    };

    const clearSearch = () => {
        setSearchQuery('');
        setSearchResults(null);
        setSearchError('');
        setSearchPagination(null);
        setSearchPage(1);
    };

    // ─── Download Flow ──────────────────────────────────
    const handleDownloadBook = async (result) => {
        const resultKey = result.detailUrl;
        if (downloadingId) return;

        setDownloadingId(resultKey);
        setDownloadProgress('Fetching book info...');

        try {
            // Step 1: Get download form data from the detail page
            const infoRes = await fetch(`/api/book-info?url=${encodeURIComponent(result.detailUrl)}`);
            const infoData = await infoRes.json();

            if (infoData.error) {
                throw new Error(infoData.error);
            }

            // Find the EPUB download (prefer epub over pdf)
            const epubDownload = infoData.downloads.find(d => d.format === 'epub');
            const download = epubDownload || infoData.downloads[0];

            if (!download) {
                throw new Error('No download link found for this book');
            }

            setDownloadProgress('Downloading EPUB...');

            // Step 2: Download the actual EPUB file
            const dlRes = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: download.action,
                    id: download.id,
                    filename: download.filename,
                }),
            });

            const contentType = dlRes.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
                const errData = await dlRes.json();
                throw new Error(errData.error || 'Download failed');
            }

            if (!dlRes.ok) {
                throw new Error(`Download failed with status ${dlRes.status}`);
            }

            setDownloadProgress('Importing to library...');

            // Step 3: Parse the EPUB and add to library
            const arrayBuffer = await dlRes.arrayBuffer();
            const meta = await parseEpub(arrayBuffer);

            const book = {
                id: generateId(),
                title: meta.title || result.title,
                author: meta.author || result.author,
                cover: meta.cover || result.cover,
                fileName: download.filename,
                fileSize: arrayBuffer.byteLength,
                data: arrayBuffer,
                addedAt: Date.now(),
                lastReadAt: Date.now(),
                progress: 0,
            };

            await addBook(book);
            await loadBooks();

            setDownloadProgress('✓ Added to library!');
            setTimeout(() => {
                setDownloadingId(null);
                setDownloadProgress('');
            }, 2000);

        } catch (err) {
            console.error('Download failed:', err);
            setDownloadProgress(`✗ ${err.message}`);
            setTimeout(() => {
                setDownloadingId(null);
                setDownloadProgress('');
            }, 3000);
        }
    };

    // ─── File Upload Logic ──────────────────────────────
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
        return (b[key] || 0) - (a[key] || 0);
    });

    const showSearchResults = searchResults !== null || searching || searchError;

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

            {/* ─── Search Bar ───────────────────────────── */}
            <div className="search-section">
                <div className="search-bar">
                    <IconSearch size={16} className="search-bar-icon" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        className="search-input"
                        placeholder="Search OceanOfPDF, or paste a novelight.net link..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                    />
                    {searchQuery && (
                        <button className="search-clear-btn" onClick={clearSearch} title="Clear search">
                            <IconClose size={14} />
                        </button>
                    )}
                    <button
                        className="search-btn btn-primary"
                        onClick={() => handleSearch(1)}
                        disabled={searching || !searchQuery.trim()}
                    >
                        {searching ? (
                            <div className="search-spinner" />
                        ) : (
                            'Search'
                        )}
                    </button>
                </div>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept=".epub"
                multiple
                style={{ display: 'none' }}
                onChange={handleInputChange}
            />

            <main className="library-content">
                {/* ─── Search Results ─────────────────────── */}
                {showSearchResults && (
                    <div className="search-results-section animate-fade-in">
                        <div className="search-results-header">
                            <h2 className="search-results-title">
                                {searching ? 'Searching...' : searchError ? 'Error' : `Search Results`}
                            </h2>
                            {searchResults && !searching && (
                                <span className="search-results-count">
                                    {searchResults.length} results found
                                </span>
                            )}
                        </div>

                        {searchError && (
                            <div className="search-error animate-fade-in">
                                <p>{searchError}</p>
                            </div>
                        )}

                        {searching && (
                            <div className="search-loading">
                                <div className="spinner" />
                                <p>Searching OceanOfPDF...</p>
                            </div>
                        )}

                        {searchResults && searchResults.length === 0 && !searching && (
                            <div className="search-no-results animate-fade-in">
                                <p>No books found. Try a different search term.</p>
                            </div>
                        )}

                        {searchResults && searchResults.length > 0 && (
                            <>
                                <div className="search-results-grid stagger-children">
                                    {searchResults.map((result, idx) => (
                                        <div key={result.detailUrl + idx} className="search-result-card">
                                            <div className="search-result-cover">
                                                {result.cover ? (
                                                    <img
                                                        src={result.cover}
                                                        alt={result.title}
                                                        loading="lazy"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                ) : (
                                                    <div className="search-result-no-cover">
                                                        <IconBookOpen size={24} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="search-result-info">
                                                <h3 className="search-result-title">{result.title}</h3>
                                                <p className="search-result-author">{result.author}</p>
                                                {result.genre && (
                                                    <p className="search-result-genre">{result.genre}</p>
                                                )}
                                                <button
                                                    className={`search-download-btn ${downloadingId === result.detailUrl ? 'downloading' : ''
                                                        }`}
                                                    onClick={() => handleDownloadBook(result)}
                                                    disabled={!!downloadingId}
                                                >
                                                    {downloadingId === result.detailUrl ? (
                                                        <>
                                                            <div className="search-spinner small" />
                                                            <span>{downloadProgress}</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <IconDownload size={13} />
                                                            <span>Get EPUB</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Pagination */}
                                {searchPagination && searchPagination.totalPages > 1 && (
                                    <div className="search-pagination">
                                        {searchPage > 1 && (
                                            <button
                                                className="pagination-btn"
                                                onClick={() => handleSearch(searchPage - 1)}
                                            >
                                                <IconArrowLeft size={14} /> Prev
                                            </button>
                                        )}
                                        <span className="pagination-info">
                                            Page {searchPage} of {searchPagination.totalPages}
                                        </span>
                                        {searchPagination.hasNext && (
                                            <button
                                                className="pagination-btn pagination-btn-next"
                                                onClick={() => handleSearch(searchPage + 1)}
                                            >
                                                Next <IconArrowRight size={14} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </>
                        )}

                        {/* Divider between search results and library */}
                        {books.length > 0 && (
                            <div className="search-library-divider">
                                <span>Your Library</span>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── Library Content ────────────────────── */}
                {loading ? (
                    <div className="library-loading">
                        <div className="spinner" />
                        <p>Loading your library...</p>
                    </div>
                ) : books.length === 0 && !showSearchResults ? (
                    <div className="library-empty animate-fade-in-up">
                        <div className="empty-illustration">
                            <IconBookOpen size={64} stroke={1} style={{ color: 'var(--accent)', opacity: 0.5 }} />
                        </div>
                        <h2 className="empty-title">Your library is empty</h2>
                        <p className="empty-desc">
                            Search for books above or upload your EPUB files.<br />
                            Drag & drop files here or tap the button below.
                        </p>
                        <button className="btn btn-primary" onClick={handleUploadClick}>
                            <IconPlus size={16} stroke={2.2} /> Add Your First Book
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
                                onSync={handleSyncBook}
                            />
                        ))}
                    </div>
                )}
            </main>

            {uploading && (
                <div className="upload-overlay">
                    <div className="upload-modal animate-scale-in">
                        <div className="spinner" />
                        <p>Importing books...</p>
                    </div>
                </div>
            )}

            {novelBusy && (
                <div className="upload-overlay">
                    <div className="upload-modal animate-scale-in">
                        {!novelBusy.startsWith('✓') && !novelBusy.startsWith('✗') && <div className="spinner" />}
                        <p>{novelBusy}</p>
                    </div>
                </div>
            )}

            {dragOver && (
                <div className="drag-overlay animate-fade-in">
                    <div className="drag-content">
                        <div className="drag-icon">
                            <IconBookOpen size={48} stroke={1.2} />
                        </div>
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
