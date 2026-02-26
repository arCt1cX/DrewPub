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

    // ── Toggle controls logic (shared by all interaction methods) ──
    const toggleControls = useCallback(() => {
        if (showSettingsRef.current || showTocRef.current) {
            setShowSettings(false);
            setShowToc(false);
            setShowControls(true);
            scheduleHideControls();
            return;
        }
        if (showControlsRef.current) {
            setShowControls(false);
        } else {
            showControlsTemporarily();
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

    // ── Attach events to rendition ────────────────────────
    const attachRenditionEvents = useCallback((rendition) => {
        rendition.on('keyup', handleKeyPress);

        // Clean up &nbsp; entities that show as literal text in some epubs
        rendition.hooks.content.register((contents) => {
            try {
                const doc = contents.document;
                if (!doc) return;
                const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while ((node = walker.nextNode())) {
                    // Replace literal .&nbsp;, standalone &nbsp; (string) or \u00a0 (char) with proper space
                    if (node.nodeValue && (node.nodeValue.includes('\u00a0') || node.nodeValue.includes('&nbsp;'))) {
                        node.nodeValue = node.nodeValue
                            .replace(/\.\u00a0/g, '. ')
                            .replace(/\u00a0/g, ' ')
                            .replace(/\.&nbsp;/g, '. ')
                            .replace(/&nbsp;/g, ' ');
                    }
                }
            } catch (_) { /* ignore */ }
        });
    }, [toggleControls]);

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
            minSpreadWidth: 99999,
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

    // ── Reapply styles on change ──────────────────────────
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

    function applyStyles(rendition, s) {
        const fontObj = FONTS.find(f => f.id === s.font) || FONTS[0];
        const theme = getTheme(s.theme, s.customTheme);
        const isPag = s.readingMode !== 'scroll';

        // In paginated mode, do NOT override padding/max-width on body:
        // epub.js uses CSS columns for pagination and our overrides break
        // the column-width calculation, causing extra partial columns.
        const bodyStyles = {
            'font-family': fontObj.family + ' !important',
            'font-size': s.fontSize + 'px !important',
            'line-height': s.lineHeight + ' !important',
            'color': theme.readerText + ' !important',
            'background': theme.readerBg + ' !important',
            'text-align': s.textAlign + ' !important',
        };

        if (!isPag) {
            // Scroll mode: apply padding and max-width normally
            bodyStyles['padding'] = s.margins + 'px !important';
            bodyStyles['max-width'] = s.maxWidth + 'px !important';
            bodyStyles['margin'] = '0 auto !important';
        }

        rendition.themes.default({
            'body': bodyStyles,
            'p': {
                'margin-bottom': s.paragraphSpacing + 'px !important',
                'font-family': 'inherit !important',
                'font-size': 'inherit !important',
                'line-height': 'inherit !important',
            },
            'a': { 'color': theme.accent + ' !important' },
            'h1, h2, h3, h4, h5, h6': {
                'color': theme.readerText + ' !important',
                'font-family': fontObj.family + ' !important',
            },
            'img': { 'max-width': '100% !important', 'height': 'auto !important' },
        });
    }

    const handleGoToChapter = (href) => {
        renditionRef.current?.display(href);
        setShowToc(false);
        setShowControls(true);
        scheduleHideControls();
    };

    const handleGoBack = () => navigate('/');

    const isPaginated = settings.readingMode !== 'scroll';

    // ── Overlay touch/click handlers (BOTH modes) ─────────
    const overlayTouchRef = useRef(null);

    // Helper: find the scrollable epub container for scroll mode
    const getScrollContainer = useCallback(() => {
        const viewer = viewerRef.current;
        if (!viewer) return null;
        // epub.js continuous manager creates a scrollable container
        return viewer.querySelector('.epub-container') || viewer;
    }, []);

    const handleOverlayTouchStart = useCallback((e) => {
        if (e.touches.length === 1) {
            overlayTouchRef.current = {
                startX: e.touches[0].clientX,
                startY: e.touches[0].clientY,
                lastY: e.touches[0].clientY,
                time: Date.now(),
                moved: false,
            };
        }
    }, []);

    const handleOverlayTouchMove = useCallback((e) => {
        if (!overlayTouchRef.current) return;
        const t = e.touches[0];
        const dy = t.clientY - overlayTouchRef.current.lastY;
        overlayTouchRef.current.lastY = t.clientY;

        const totalDx = Math.abs(t.clientX - overlayTouchRef.current.startX);
        const totalDy = Math.abs(t.clientY - overlayTouchRef.current.startY);

        if (totalDx > 10 || totalDy > 10) {
            overlayTouchRef.current.moved = true;
        }

        // In scroll mode: scroll the epub container
        if (settingsRef.current.readingMode === 'scroll' && overlayTouchRef.current.moved) {
            e.preventDefault();
            const container = getScrollContainer();
            if (container) {
                container.scrollTop -= dy;
            }
        }
    }, [getScrollContainer]);

    const handleOverlayTouchEnd = useCallback((e) => {
        if (!overlayTouchRef.current) return;
        const t = e.changedTouches[0];
        const dx = Math.abs(t.clientX - overlayTouchRef.current.startX);
        const dy = Math.abs(t.clientY - overlayTouchRef.current.startY);
        const dt = Date.now() - overlayTouchRef.current.time;
        const wasMoved = overlayTouchRef.current.moved;
        overlayTouchRef.current = null;

        // Not a tap — it was a scroll/swipe gesture
        if (wasMoved || dx > 20 || dy > 20 || dt > 400) return;

        e.preventDefault();
        e.stopPropagation();

        const isCurrentlyPaginated = settingsRef.current.readingMode !== 'scroll';
        const viewerEl = viewerRef.current;
        if (!viewerEl) return;
        const rect = viewerEl.getBoundingClientRect();
        const x = t.clientX - rect.left;
        const zone = x / rect.width;

        if (isCurrentlyPaginated) {
            // Paginated: zone-based navigation
            if (zone < 0.2) {
                renditionRef.current?.prev();
            } else if (zone > 0.8) {
                renditionRef.current?.next();
            } else {
                toggleControls();
            }
        } else {
            // Scroll: any tap toggles controls
            toggleControls();
        }
    }, [toggleControls]);

    const handleOverlayClick = useCallback((e) => {
        const viewerEl = viewerRef.current;
        if (!viewerEl) return;
        const rect = viewerEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const zone = x / rect.width;

        const isCurrentlyPaginated = settingsRef.current.readingMode !== 'scroll';

        if (isCurrentlyPaginated) {
            if (zone < 0.2) {
                renditionRef.current?.prev();
            } else if (zone > 0.8) {
                renditionRef.current?.next();
            } else {
                toggleControls();
            }
        } else {
            toggleControls();
        }
    }, [toggleControls]);

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

            {/* epub.js renders into this div */}
            <div
                ref={viewerRef}
                className={`reader-viewer ${isPaginated ? 'reader-paginated' : 'reader-scroll'}`}
            />

            {/* TRANSPARENT OVERLAY — catches ALL touch/click in BOTH modes */}
            {!loading && (
                <div
                    className="reader-touch-overlay"
                    onClick={handleOverlayClick}
                    onTouchStart={handleOverlayTouchStart}
                    onTouchMove={handleOverlayTouchMove}
                    onTouchEnd={handleOverlayTouchEnd}
                />
            )}

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
