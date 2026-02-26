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
    const showControlsRef = useRef(true);
    const showSettingsRef = useRef(false);
    const showTocRef = useRef(false);
    const settingsRef = useRef(settings);

    useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
    useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);
    useEffect(() => { showTocRef.current = showToc; }, [showToc]);
    useEffect(() => { settingsRef.current = settings; }, [settings]);

    // ── Auto-hide controls ────────────────────────────────
    const scheduleHideControls = useCallback(() => {
        if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = setTimeout(() => {
            if (!showSettingsRef.current && !showTocRef.current) {
                setShowControls(false);
            }
        }, 3500);
    }, []);

    const showControlsTemporarily = useCallback(() => {
        setShowControls(true);
        scheduleHideControls();
    }, [scheduleHideControls]);

    // ── Core tap handler ──────────────────────────────────
    const handleTapRef = useRef(null);
    handleTapRef.current = (clientX, viewerWidth) => {
        const isPaginated = settingsRef.current.readingMode !== 'scroll';

        if (showSettingsRef.current || showTocRef.current) {
            setShowSettings(false);
            setShowToc(false);
            setShowControls(true);
            scheduleHideControls();
            return;
        }

        if (!isPaginated) {
            if (showControlsRef.current) {
                setShowControls(false);
            } else {
                showControlsTemporarily();
            }
            return;
        }

        const zone = clientX / viewerWidth;

        if (zone < 0.3) {
            renditionRef.current?.prev();
        } else if (zone > 0.7) {
            renditionRef.current?.next();
        } else {
            if (showControlsRef.current) {
                setShowControls(false);
            } else {
                showControlsTemporarily();
            }
        }
    };

    // ── Keyboard navigation ───────────────────────────────
    function handleKeyPress(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            renditionRef.current?.next();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            renditionRef.current?.prev();
        }
    }

    // ── Attach events using hooks.content (iframe access) ─
    const attachRenditionEvents = useCallback((rendition) => {
        rendition.on('keyup', handleKeyPress);

        // Desktop click inside iframe (forwarded by epub.js)
        rendition.on('click', (e) => {
            const viewerEl = viewerRef.current;
            if (!viewerEl) return;
            handleTapRef.current(e.clientX, viewerEl.clientWidth);
        });

        // Touch events: attach directly to each iframe's document
        // This is the ONLY reliable way to get touch events from epub.js iframes
        rendition.hooks.content.register((contents) => {
            const doc = contents.document;
            if (!doc) return;

            let touchStartX = null;
            let touchStartY = null;
            let touchStartTime = 0;

            doc.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    touchStartTime = Date.now();
                }
            }, { passive: true });

            doc.addEventListener('touchend', (e) => {
                if (touchStartX === null) return;

                const touch = e.changedTouches[0];
                const dx = Math.abs(touch.clientX - touchStartX);
                const dy = Math.abs(touch.clientY - touchStartY);
                const dt = Date.now() - touchStartTime;

                // Tap = small movement + short hold
                if (dx < 20 && dy < 20 && dt < 400) {
                    e.preventDefault();
                    const viewerEl = viewerRef.current;
                    if (!viewerEl) return;
                    handleTapRef.current(touch.clientX, viewerEl.clientWidth);
                }

                touchStartX = null;
                touchStartY = null;
            }, { passive: false });
        });
    }, []);

    // ── Relocated handler ─────────────────────────────────
    const makeRelocatedHandler = useCallback((book, destroyed_getter) => (location) => {
        if (destroyed_getter()) return;
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
    }, [bookId]);

    // ── Rendition options ─────────────────────────────────
    function getRenditionOptions(readingMode) {
        const isPaginated = readingMode !== 'scroll';
        return {
            width: '100%',
            height: '100%',
            flow: isPaginated ? 'paginated' : 'scrolled',
            spread: 'none',
            manager: isPaginated ? 'default' : 'continuous',
        };
    }

    // ── Initialize book ───────────────────────────────────
    useEffect(() => {
        let destroyed = false;
        const destroyed_getter = () => destroyed;

        (async () => {
            try {
                const bookData = await getBook(bookId);
                if (!bookData || destroyed) return;
                setBookMeta(bookData);

                const book = ePub(bookData.data);
                bookRef.current = book;
                await book.ready;

                const rendition = book.renderTo(viewerRef.current, getRenditionOptions(settings.readingMode));
                renditionRef.current = rendition;

                applyStyles(rendition, settings);

                const navigation = await book.loaded.navigation;
                setToc(navigation.toc || []);

                const savedPos = await getPosition(bookId);
                if (savedPos?.cfi) {
                    await rendition.display(savedPos.cfi);
                } else {
                    await rendition.display();
                }

                await book.locations.generate(1024);
                setTotalPages(book.locations.length());

                rendition.on('relocated', makeRelocatedHandler(book, destroyed_getter));
                attachRenditionEvents(rendition);

                setLoading(false);
                showControlsTemporarily();
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

    // ── Reapply styles on settings change ────────────────
    useEffect(() => {
        if (renditionRef.current) {
            applyStyles(renditionRef.current, settings);
        }
    }, [
        settings.font, settings.fontSize, settings.lineHeight,
        settings.paragraphSpacing, settings.margins, settings.maxWidth,
        settings.textAlign, settings.theme, settings.customTheme
    ]);

    // ── Rebuild on reading mode change ────────────────────
    useEffect(() => {
        if (!bookRef.current || !viewerRef.current || loading) return;

        const book = bookRef.current;
        const currentCfiVal = currentCfi;
        let localDestroyed = false;

        if (renditionRef.current) {
            try { renditionRef.current.destroy(); } catch (_) { }
        }
        if (viewerRef.current) {
            viewerRef.current.innerHTML = '';
        }

        const rendition = book.renderTo(viewerRef.current, getRenditionOptions(settings.readingMode));
        renditionRef.current = rendition;

        applyStyles(rendition, settings);
        rendition.on('relocated', makeRelocatedHandler(book, () => localDestroyed));
        attachRenditionEvents(rendition);

        if (currentCfiVal) {
            rendition.display(currentCfiVal);
        } else {
            rendition.display();
        }

        return () => { localDestroyed = true; };
    }, [settings.readingMode]); // eslint-disable-line react-hooks/exhaustive-deps

    function applyStyles(rendition, settings) {
        const fontObj = FONTS.find(f => f.id === settings.font) || FONTS[0];
        const theme = getTheme(settings.theme, settings.customTheme);
        const isPaginated = settings.readingMode !== 'scroll';

        rendition.themes.default({
            'html': {
                ...(isPaginated ? {
                    'column-count': '1 !important',
                    'columns': 'auto !important',
                } : {}),
            },
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
                ...(isPaginated ? {
                    'column-count': '1 !important',
                    'columns': 'auto !important',
                } : {}),
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

    const handleGoToChapter = (href) => {
        renditionRef.current?.display(href);
        setShowToc(false);
        setShowControls(true);
        scheduleHideControls();
    };

    const handleGoBack = () => {
        navigate('/');
    };

    const isPaginated = settings.readingMode !== 'scroll';

    return (
        <div className="reader-page">
            {loading ? (
                <div className="reader-loading">
                    <div className="spinner" />
                    <p>Loading book...</p>
                </div>
            ) : (
                <ReaderControls
                    visible={showControls}
                    bookTitle={bookMeta?.title}
                    chapterTitle={chapterTitle}
                    progress={progress}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    isPaginated={isPaginated}
                    onBack={handleGoBack}
                    onToggleToc={() => { setShowToc(!showToc); setShowSettings(false); }}
                    onToggleSettings={() => { setShowSettings(!showSettings); setShowToc(false); }}
                    onPrev={() => renditionRef.current?.prev()}
                    onNext={() => renditionRef.current?.next()}
                />
            )}

            <div
                ref={viewerRef}
                className={`reader-viewer ${isPaginated ? 'reader-paginated' : 'reader-scroll'}`}
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
