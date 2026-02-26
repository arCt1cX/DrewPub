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
    const touchStartRef = useRef(null);

    // Keep refs in sync for handlers
    useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
    useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);
    useEffect(() => { showTocRef.current = showToc; }, [showToc]);
    useEffect(() => { settingsRef.current = settings; }, [settings]);

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

    const handleAction = useCallback((e) => {
        const isPaginated = settingsRef.current.readingMode !== 'scroll';

        if (showSettingsRef.current || showTocRef.current) {
            setShowSettings(false);
            setShowToc(false);
            setShowControls(true);
            scheduleHideControls();
            return;
        }

        const width = viewerRef.current?.clientWidth || window.innerWidth;
        const x = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
        const zone = x / width;

        if (isPaginated) {
            if (zone < 0.20) {
                renditionRef.current?.prev();
            } else if (zone > 0.80) {
                renditionRef.current?.next();
            } else {
                if (showControlsRef.current) setShowControls(false);
                else showControlsTemporarily();
            }
        } else {
            if (showControlsRef.current) setShowControls(false);
            else showControlsTemporarily();
        }
    }, [scheduleHideControls, showControlsTemporarily]);

    const handleTouchStart = (e) => {
        if (e.touches.length > 1) return;
        touchStartRef.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: Date.now()
        };
    };

    const handleTouchEnd = (e) => {
        if (!touchStartRef.current) return;

        const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
        const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
        const dt = Date.now() - touchStartRef.current.time;

        // Brief tap detection
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 300) {
            handleAction(e);
        }
        touchStartRef.current = null;
    };

    const applyStyles = (rendition, settings) => {
        const fontObj = FONTS.find(f => f.id === settings.font) || FONTS[0];
        const theme = getTheme(settings.theme, settings.customTheme);

        rendition.themes.default({
            'body': {
                'font-family': fontObj.family + ' !important',
                'font-size': settings.fontSize + 'px !important',
                'line-height': settings.lineHeight + ' !important',
                'color': theme.readerText + ' !important',
                'background': 'transparent !important', // Let parent handle BG
                'text-align': settings.textAlign + ' !important',
                'padding': `0 ${settings.margins}px !important`,
                'margin': '0 !important',
                'width': '100% !important',
                'height': '100% !important',
                'box-sizing': 'border-box !important',
                'overflow': 'hidden !important'
            },
            'p': {
                'margin-bottom': settings.paragraphSpacing + 'px !important',
                'font-family': 'inherit !important',
                'font-size': 'inherit !important',
                'line-height': 'inherit !important'
            },
            'img': {
                'max-width': '100% !important',
                'height': 'auto !important',
                'display': 'block !important',
                'margin': '1em auto !important'
            }
        });
    };

    const attachEvents = (rendition) => {
        rendition.on('click', handleAction);

        // Use Hooks to ensure touch events work inside iframe on iPad
        rendition.hooks.content.register((contents) => {
            const doc = contents.document;
            doc.addEventListener('touchstart', handleTouchStart, { passive: true });
            doc.addEventListener('touchend', handleTouchEnd, { passive: true });
        });

        rendition.on('keyup', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') rendition.next();
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') rendition.prev();
        });
    };

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
                    manager: settings.readingMode === 'scroll' ? 'continuous' : 'default',
                    spread: 'none'
                });
                renditionRef.current = rendition;

                applyStyles(rendition, settings);
                attachEvents(rendition);

                const savedPos = await getPosition(bookId);
                await rendition.display(savedPos?.cfi || undefined);

                await book.locations.generate(1024);
                setTotalPages(book.locations.length());
                setToc((await book.loaded.navigation).toc || []);

                rendition.on('relocated', (location) => {
                    if (destroyed) return;
                    const cfi = location.start.cfi;
                    setCurrentCfi(cfi);
                    const pct = book.locations.percentageFromCfi(cfi);
                    const progressPct = Math.round(pct * 100);
                    setProgress(progressPct);
                    setCurrentPage(book.locations.locationFromCfi(cfi) || 0);
                    savePosition(bookId, cfi, progressPct);
                    updateBookMeta(bookId, { progress: progressPct, lastReadAt: Date.now() });

                    const chapter = book.navigation?.toc?.find(item =>
                        location.start.href?.includes(item.href.split('#')[0])
                    );
                    if (chapter) setChapterTitle(chapter.label?.trim() || '');
                });

                setLoading(false);
                showControlsTemporarily();
            } catch (e) {
                console.error(e);
                setLoading(false);
            }
        })();
        return () => { destroyed = true; bookRef.current?.destroy(); };
    }, [bookId]);

    // Handle settings changes without re-rendering if possible
    useEffect(() => {
        if (renditionRef.current) applyStyles(renditionRef.current, settings);
    }, [settings.font, settings.fontSize, settings.lineHeight, settings.paragraphSpacing, settings.margins, settings.maxWidth, settings.textAlign, settings.theme]);

    // Rebuild rendition only when reading mode changes
    useEffect(() => {
        if (!bookRef.current || loading) return;
        setLoading(true);
        renditionRef.current?.destroy();
        const rendition = bookRef.current.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            flow: settings.readingMode === 'scroll' ? 'scrolled' : 'paginated',
            manager: settings.readingMode === 'scroll' ? 'continuous' : 'default',
            spread: 'none'
        });
        renditionRef.current = rendition;
        applyStyles(rendition, settings);
        attachEvents(rendition);
        rendition.display(currentCfi || undefined).then(() => setLoading(false));
    }, [settings.readingMode]);

    const isPaginated = settings.readingMode !== 'scroll';
    const theme = getTheme(settings.theme, settings.customTheme);

    return (
        <div className="reader-page" style={{ background: theme.readerBg }}>
            {!loading && (
                <ReaderControls
                    visible={showControls}
                    bookTitle={bookMeta?.title}
                    chapterTitle={chapterTitle}
                    progress={progress}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    isPaginated={isPaginated}
                    onBack={() => navigate('/')}
                    onToggleToc={() => { setShowToc(!showToc); setShowSettings(false); }}
                    onToggleSettings={() => { setShowSettings(!showSettings); setShowToc(false); }}
                    onPrev={() => renditionRef.current?.prev()}
                    onNext={() => renditionRef.current?.next()}
                />
            )}

            <div
                ref={viewerRef}
                className={`reader-viewer-container ${isPaginated ? 'paginated' : 'scroll'}`}
                style={{ maxWidth: settings.maxWidth, margin: '0 auto' }}
                onClick={(e) => { if (e.target === viewerRef.current) handleAction(e); }}
            />

            {isPaginated && !loading && (
                <>
                    <div className="edge-nav left" onClick={() => renditionRef.current?.prev()} />
                    <div className="edge-nav right" onClick={() => renditionRef.current?.next()} />
                </>
            )}

            {loading && (
                <div className="reader-loading">
                    <div className="spinner" />
                    <p>Loading...</p>
                </div>
            )}

            {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
            {showToc && (
                <TableOfContents
                    toc={toc}
                    onSelect={(href) => { renditionRef.current?.display(href); setShowToc(false); showControlsTemporarily(); }}
                    onClose={() => setShowToc(false)}
                />
            )}
        </div>
    );
}
