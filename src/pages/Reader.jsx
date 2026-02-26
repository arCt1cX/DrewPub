import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ePub from 'epubjs';
import { getBook, savePosition, getPosition, updateBookMeta } from '../db';
import { useSettings } from '../contexts/SettingsContext';
import { FONTS, getTheme } from '../styles/themes';
import ReaderControls from '../components/ReaderControls';
import SettingsPanel from '../components/SettingsPanel';
import TableOfContents from '../components/TableOfContents';
import './Reader.css';

export default function Reader() {
    const { bookId } = useParams();
    const navigate = useNavigate();
    const { settings } = useSettings();

    const viewerRef = useRef(null);
    const bookRef = useRef(null);
    const renditionRef = useRef(null);

    const [bookMeta, setBookMeta] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentCfi, setCurrentCfi] = useState(null);
    const [progress, setProgress] = useState(0);
    const [chapterTitle, setChapterTitle] = useState('');
    const [toc, setToc] = useState([]);
    const [showControls, setShowControls] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [showToc, setShowToc] = useState(false);
    const [totalPages, setTotalPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(0);

    const controlsTimerRef = useRef(null);

    // Auto-hide controls
    const scheduleHideControls = useCallback(() => {
        if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = setTimeout(() => {
            if (!showSettings && !showToc) {
                setShowControls(false);
            }
        }, 3500);
    }, [showSettings, showToc]);

    // Initialize book
    useEffect(() => {
        let destroyed = false;

        (async () => {
            try {
                const bookData = await getBook(bookId);
                if (!bookData || destroyed) return;

                setBookMeta(bookData);

                const book = ePub(bookData.data);
                bookRef.current = book;

                await book.ready;

                const rendition = book.renderTo(viewerRef.current, {
                    width: '100%',
                    height: '100%',
                    flow: settings.readingMode === 'scroll' ? 'scrolled' : 'paginated',
                    spread: 'none',
                    manager: settings.readingMode === 'scroll' ? 'continuous' : 'default',
                });
                renditionRef.current = rendition;

                // Apply reading styles
                applyStyles(rendition, settings);

                // Load TOC
                const navigation = await book.loaded.navigation;
                setToc(navigation.toc || []);

                // Restore position
                const savedPos = await getPosition(bookId);
                if (savedPos?.cfi) {
                    await rendition.display(savedPos.cfi);
                } else {
                    await rendition.display();
                }

                // Generate locations for progress tracking
                await book.locations.generate(1024);
                setTotalPages(book.locations.length());

                // Event handlers
                rendition.on('relocated', (location) => {
                    if (destroyed) return;
                    const cfi = location.start.cfi;
                    setCurrentCfi(cfi);

                    // Calculate progress
                    const pct = book.locations.percentageFromCfi(cfi);
                    const progressPct = Math.round(pct * 100);
                    setProgress(progressPct);
                    setCurrentPage(book.locations.locationFromCfi(cfi) || 0);

                    // Save position
                    savePosition(bookId, cfi, progressPct);
                    updateBookMeta(bookId, { progress: progressPct, lastReadAt: Date.now() });

                    // Update chapter title
                    const chapter = book.navigation?.toc?.find(item => {
                        const href = item.href.split('#')[0];
                        return location.start.href?.includes(href);
                    });
                    if (chapter) setChapterTitle(chapter.label?.trim() || '');
                });

                // Swipe / touch
                rendition.on('keyup', handleKeyPress);

                setLoading(false);
                scheduleHideControls();

            } catch (e) {
                console.error('Failed to load book:', e);
                setLoading(false);
            }
        })();

        return () => {
            destroyed = true;
            if (renditionRef.current) {
                try { renditionRef.current.destroy(); } catch (_) { }
            }
            if (bookRef.current) {
                try { bookRef.current.destroy(); } catch (_) { }
            }
            if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
        };
    }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reapply styles when settings change
    useEffect(() => {
        if (renditionRef.current) {
            applyStyles(renditionRef.current, settings);
        }
    }, [
        settings.font, settings.fontSize, settings.lineHeight,
        settings.paragraphSpacing, settings.margins, settings.maxWidth,
        settings.textAlign, settings.theme, settings.customTheme
    ]);

    // Handle reading mode change (requires re-rendering)
    useEffect(() => {
        if (!bookRef.current || !viewerRef.current || loading) return;

        const book = bookRef.current;
        const currentCfiVal = currentCfi;

        // Destroy old rendition
        if (renditionRef.current) {
            try { renditionRef.current.destroy(); } catch (_) { }
        }

        // Clear container
        if (viewerRef.current) {
            viewerRef.current.innerHTML = '';
        }

        const rendition = book.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            flow: settings.readingMode === 'scroll' ? 'scrolled' : 'paginated',
            spread: 'none',
            manager: settings.readingMode === 'scroll' ? 'continuous' : 'default',
        });
        renditionRef.current = rendition;

        applyStyles(rendition, settings);

        rendition.on('relocated', (location) => {
            const cfi = location.start.cfi;
            setCurrentCfi(cfi);
            const pct = book.locations.percentageFromCfi(cfi);
            const progressPct = Math.round(pct * 100);
            setProgress(progressPct);
            setCurrentPage(book.locations.locationFromCfi(cfi) || 0);
            savePosition(bookId, cfi, progressPct);
            updateBookMeta(bookId, { progress: progressPct, lastReadAt: Date.now() });

            const chapter = book.navigation?.toc?.find(item => {
                const href = item.href.split('#')[0];
                return location.start.href?.includes(href);
            });
            if (chapter) setChapterTitle(chapter.label?.trim() || '');
        });

        rendition.on('keyup', handleKeyPress);

        if (currentCfiVal) {
            rendition.display(currentCfiVal);
        } else {
            rendition.display();
        }
    }, [settings.readingMode]); // eslint-disable-line react-hooks/exhaustive-deps

    function applyStyles(rendition, settings) {
        const fontObj = FONTS.find(f => f.id === settings.font) || FONTS[0];
        const theme = getTheme(settings.theme, settings.customTheme);

        rendition.themes.default({
            'body': {
                'font-family': fontObj.family + ' !important',
                'font-size': settings.fontSize + 'px !important',
                'line-height': settings.lineHeight + ' !important',
                'color': theme.readerText + ' !important',
                'background': theme.readerBg + ' !important',
                'text-align': settings.textAlign + ' !important',
                'padding': settings.margins + 'px !important',
                'max-width': settings.maxWidth + 'px !important',
                'margin': '0 auto !important',
            },
            'p': {
                'margin-bottom': settings.paragraphSpacing + 'px !important',
                'font-family': 'inherit !important',
                'font-size': 'inherit !important',
                'line-height': 'inherit !important',
            },
            'a': {
                'color': theme.accent + ' !important',
            },
            'h1, h2, h3, h4, h5, h6': {
                'color': theme.readerText + ' !important',
                'font-family': fontObj.family + ' !important',
            },
            'img': {
                'max-width': '100% !important',
                'height': 'auto !important',
            }
        });
    }

    function handleKeyPress(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            renditionRef.current?.next();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            renditionRef.current?.prev();
        }
    }

    // Touch navigation zones
    const handleViewerClick = (e) => {
        if (showSettings || showToc) {
            setShowSettings(false);
            setShowToc(false);
            return;
        }

        const rect = viewerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const width = rect.width;
        const zone = x / width;

        if (zone < 0.25) {
            // Left zone — previous
            renditionRef.current?.prev();
        } else if (zone > 0.75) {
            // Right zone — next
            renditionRef.current?.next();
        } else {
            // Center — toggle controls
            setShowControls(prev => !prev);
            if (!showControls) {
                scheduleHideControls();
            }
        }
    };

    const handleGoToChapter = (href) => {
        renditionRef.current?.display(href);
        setShowToc(false);
        setShowControls(true);
        scheduleHideControls();
    };

    const handleGoBack = () => {
        navigate('/');
    };

    return (
        <div className="reader-page">
            {loading ? (
                <div className="reader-loading">
                    <div className="spinner" />
                    <p>Loading book...</p>
                </div>
            ) : (
                <>
                    <ReaderControls
                        visible={showControls}
                        bookTitle={bookMeta?.title}
                        chapterTitle={chapterTitle}
                        progress={progress}
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onBack={handleGoBack}
                        onToggleToc={() => { setShowToc(!showToc); setShowSettings(false); }}
                        onToggleSettings={() => { setShowSettings(!showSettings); setShowToc(false); }}
                        onPrev={() => renditionRef.current?.prev()}
                        onNext={() => renditionRef.current?.next()}
                    />
                </>
            )}

            <div
                ref={viewerRef}
                className="reader-viewer"
                onClick={handleViewerClick}
            />

            {showSettings && (
                <SettingsPanel onClose={() => setShowSettings(false)} />
            )}

            {showToc && (
                <TableOfContents
                    toc={toc}
                    currentHref=""
                    onSelect={handleGoToChapter}
                    onClose={() => setShowToc(false)}
                />
            )}
        </div>
    );
}
