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
    // Refs for values needed inside epubjs event handlers (avoid stale closures)
    const showControlsRef = useRef(true);
    const showSettingsRef = useRef(false);
    const showTocRef = useRef(false);
    const settingsRef = useRef(settings);

    // Keep refs in sync
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

    // ── Core tap handler (used by both mouse and touch) ────
    const handleTap = useCallback((clientX) => {
        const isPaginated = settingsRef.current.readingMode !== 'scroll';

        // If any panel open → close it
        if (showSettingsRef.current || showTocRef.current) {
            setShowSettings(false);
            setShowToc(false);
            setShowControls(true);
            scheduleHideControls();
            return;
        }

        if (!isPaginated) {
            // Scroll mode: any tap just toggles controls
            if (showControlsRef.current) {
                setShowControls(false);
            } else {
                showControlsTemporarily();
            }
            return;
        }

        // Paginated mode: use tap zones
        const viewerEl = viewerRef.current;
        if (!viewerEl) return;
        const width = viewerEl.clientWidth;
        const zone = clientX / width;

        if (zone < 0.3) {
            renditionRef.current?.prev();
        } else if (zone > 0.7) {
            renditionRef.current?.next();
        } else {
            // Center tap → toggle controls
            if (showControlsRef.current) {
                setShowControls(false);
            } else {
                showControlsTemporarily();
            }
        }
    }, [scheduleHideControls, showControlsTemporarily]);

    // ── Keyboard navigation ───────────────────────────────
    function handleKeyPress(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            renditionRef.current?.next();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            renditionRef.current?.prev();
        }
    }

    // ── Attach events to rendition (works inside iframe) ──
    const attachRenditionEvents = useCallback((rendition) => {
        rendition.on('keyup', handleKeyPress);

        // For desktop: mouse click inside iframe
        rendition.on('click', (e) => {
            handleTap(e.clientX);
        });

        // For touch devices (iPad etc): detect taps via touchstart/touchend
        let touchStartX = null;
        let touchStartY = null;
        let touchStartTime = 0;

        rendition.on('touchstart', (e) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchStartTime = Date.now();
            }
        });

        rendition.on('touchend', (e) => {
            if (touchStartX === null) return;
            const touch = e.changedTouches[0];
            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);
            const dt = Date.now() - touchStartTime;

            // Only count as a tap if finger moved < 15px and held < 500ms
            if (dx < 15 && dy < 15 && dt < 500) {
                handleTap(touch.clientX);
            }

            touchStartX = null;
            touchStartY = null;
        });
    }, [handleTap]);

    // ── Common relocated handler ──────────────────────────
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

    // ── Create rendition options ──────────────────────────
    function getRenditionOptions(readingMode) {
        const isPaginated = readingMode !== 'scroll';
        return {
            width: '100%',
            height: '100%',
            flow: isPaginated ? 'paginated' : 'scrolled',
            spread: 'none',
            manager: isPaginated ? 'default' : 'continuous',
            // Force single column in paginated mode
            ...(isPaginated ? { allowScriptedContent: false } : {}),
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

    // ── Rebuild rendition on reading mode change ──────────
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
                // Force single column in paginated mode
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
                // Force single column
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

    // ── Outer wrapper tap (for margins outside iframe) ────
    const handleOuterTouchEnd = useCallback((e) => {
        // Only handle single-touch taps on the outer wrapper
        const touch = e.changedTouches?.[0];
        if (!touch) return;
        const viewerEl = viewerRef.current;
        if (!viewerEl) return;
        const rect = viewerEl.getBoundingClientRect();
        handleTap(touch.clientX - rect.left + (rect.left > 0 ? rect.left : 0));
    }, [handleTap]);

    const handleOuterClick = useCallback((e) => {
        const viewerEl = viewerRef.current;
        if (!viewerEl) return;
        const rect = viewerEl.getBoundingClientRect();
        handleTap(e.clientX - rect.left);
    }, [handleTap]);

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
                onClick={handleOuterClick}
                onTouchEnd={handleOuterTouchEnd}
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
