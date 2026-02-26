import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ePub from 'epubjs';
import { getBook, savePosition, getPosition, updateBookMeta, getAsset } from '../db';
import { useSettings } from '../contexts/SettingsContext';
import { FONTS, getTheme } from '../styles/themes';
import ReaderControls from '../components/ReaderControls';
import SettingsPanel from '../components/SettingsPanel';
import TableOfContents from '../components/TableOfContents';
import TranslationPopup from '../components/TranslationPopup';
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

    // ── Custom Assets State ─────────────────────────────
    const [customFontUrl, setCustomFontUrl] = useState(null);
    const [customBgUrl, setCustomBgUrl] = useState(null);
    const customFontUrlRef = useRef(null);

    useEffect(() => {
        let active = true;
        const loadAssets = async () => {
            if (settings.customFontId) {
                const blob = await getAsset('custom_font');
                if (blob && active) {
                    const url = URL.createObjectURL(blob);
                    setCustomFontUrl(url);
                    customFontUrlRef.current = url;
                }
            } else { setCustomFontUrl(null); customFontUrlRef.current = null; }

            if (settings.customBgId) {
                const blob = await getAsset('custom_bg');
                if (blob && active) setCustomBgUrl(URL.createObjectURL(blob));
            } else { setCustomBgUrl(null); }
        };
        loadAssets();
        return () => { active = false; };
    }, [settings.customFontId, settings.customBgId]);

    useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
    useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);
    useEffect(() => { showTocRef.current = showToc; }, [showToc]);

    // ── Translation State ────────────────────────────────
    const [translationData, setTranslationData] = useState(null);

    const handleSelection = useCallback(async (cfiRange, contents) => {
        try {
            const range = contents.range(cfiRange);
            const text = range.toString().trim();

            // Only translate single words or short phrases (up to 3 words)
            if (!text || text.split(/\s+/).length > 3) return;

            setTranslationData({ text, translation: null, loading: true });

            const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|it`);
            const data = await res.json();

            if (data.responseData?.translatedText) {
                setTranslationData({ text, translation: data.responseData.translatedText, loading: false });
            } else {
                setTranslationData(null);
            }

            // Allow the user to see the highlight briefly, then you could clear it. 
            // We'll leave the highlight until they tap away or close the popup.
        } catch (e) {
            console.error('Translation error:', e);
            setTranslationData(null);
        }
    }, []);

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
        rendition.on('selected', handleSelection);

        // Clean up &nbsp; entities that show as literal text in some epubs
        rendition.hooks.content.register((contents) => {
            try {
                const doc = contents.document;
                if (!doc) return;

                // Inject custom font if available
                if (customFontUrlRef.current && !doc.getElementById('custom-user-font')) {
                    const style = doc.createElement('style');
                    style.id = 'custom-user-font';
                    style.textContent = `
                        @font-face {
                            font-family: 'CustomUserFont';
                            src: url('${customFontUrlRef.current}');
                            font-display: swap;
                        }
                    `;
                    doc.head.appendChild(style);
                }

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
    }, [toggleControls, handleSelection]);

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
            manager: 'default', // Using default manager for both so each chapter is discrete
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
    }, [bookId, settings.readingMode, attachRenditionEvents, makeRelocatedHandler, showControlsTemporarily]); // eslint-disable-line react-hooks/exhaustive-deps

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
    }, [settings.readingMode, loading, currentCfi, attachRenditionEvents, makeRelocatedHandler]); // eslint-disable-line react-hooks/exhaustive-deps

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
            'background': (s.customBgId ? 'transparent' : theme.readerBg) + ' !important',
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
    const momentumRef = useRef({ velocity: 0, lastTime: 0, lastY: 0, animationFrame: null });

    // Helper: find the scrollable epub container for scroll mode
    const getScrollContainer = useCallback(() => {
        const viewer = viewerRef.current;
        if (!viewer) return null;
        // epub.js continuous manager creates a scrollable container
        return viewer.querySelector('.epub-container') || viewer;
    }, []);

    const stopMomentum = useCallback(() => {
        if (momentumRef.current.animationFrame) {
            cancelAnimationFrame(momentumRef.current.animationFrame);
            momentumRef.current.animationFrame = null;
        }
        momentumRef.current.velocity = 0;
    }, []);

    const startMomentum = useCallback(() => {
        const container = getScrollContainer();
        if (!container || Math.abs(momentumRef.current.velocity) < 0.5) return;

        const friction = 0.95; // Decay factor
        const step = () => {
            if (Math.abs(momentumRef.current.velocity) < 0.5) {
                momentumRef.current.animationFrame = null;
                return;
            }

            container.scrollTop -= momentumRef.current.velocity;
            momentumRef.current.velocity *= friction;
            momentumRef.current.animationFrame = requestAnimationFrame(step);
        };

        momentumRef.current.animationFrame = requestAnimationFrame(step);
    }, [getScrollContainer]);

    const handleOverlayTouchStart = useCallback((e) => {
        stopMomentum();
        if (e.touches.length === 1) {
            const t = e.touches[0];
            overlayTouchRef.current = {
                startX: t.clientX,
                startY: t.clientY,
                lastY: t.clientY,
                time: Date.now(),
                moved: false,
                pullOffset: 0,
            };
            momentumRef.current.lastY = t.clientY;
            momentumRef.current.lastTime = Date.now();
            momentumRef.current.velocity = 0;

            // Remove transition during drag for responsiveness
            if (viewerRef.current) {
                viewerRef.current.style.transition = 'none';
            }
        }
    }, [stopMomentum]);

    const handleOverlayTouchMove = useCallback((e) => {
        if (!overlayTouchRef.current) return;
        const t = e.touches[0];
        const now = Date.now();
        const dy = t.clientY - overlayTouchRef.current.lastY;
        const dt = now - momentumRef.current.lastTime;

        overlayTouchRef.current.lastY = t.clientY;

        const totalDx = Math.abs(t.clientX - overlayTouchRef.current.startX);
        const totalDy = Math.abs(t.clientY - overlayTouchRef.current.startY);

        if (totalDx > 10 || totalDy > 10) {
            overlayTouchRef.current.moved = true;
        }

        // Calculate instantaneous velocity for momentum
        if (dt > 0) {
            momentumRef.current.velocity = (t.clientY - momentumRef.current.lastY) / (dt / 16);
            momentumRef.current.lastY = t.clientY;
            momentumRef.current.lastTime = now;
        }

        // In scroll mode: scroll the epub container or apply resistance pull
        if (settingsRef.current.readingMode === 'scroll' && overlayTouchRef.current.moved) {
            e.preventDefault();
            const container = getScrollContainer();
            if (container) {
                const atTop = container.scrollTop <= 0;
                const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;

                if ((atTop && dy > 0) || (atBottom && dy < 0) || overlayTouchRef.current.pullOffset !== 0) {
                    // Apply resistance pull
                    const resistance = 0.4;
                    overlayTouchRef.current.pullOffset += dy * resistance;

                    // Cap the pull offset visually
                    const displayOffset = Math.max(-120, Math.min(120, overlayTouchRef.current.pullOffset));
                    viewerRef.current.style.transform = `translateY(${displayOffset}px)`;
                } else {
                    container.scrollTop -= dy;
                }
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
        const finalPull = overlayTouchRef.current.pullOffset;
        overlayTouchRef.current = null;

        // Reset transform with animation
        if (viewerRef.current) {
            viewerRef.current.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
            viewerRef.current.style.transform = 'translateY(0)';
        }

        // Check if pull met threshold for chapter change
        const threshold = 60;
        if (Math.abs(finalPull) > threshold) {
            if (finalPull > 0) {
                renditionRef.current?.prev();
            } else {
                renditionRef.current?.next();
            }
            return;
        }

        // If it was a scroll gesture, start momentum
        if (wasMoved || dx > 20 || dy > 20 || dt > 400) {
            if (settingsRef.current.readingMode === 'scroll') {
                startMomentum();
            }
            return;
        }

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
    }, [toggleControls, startMomentum]);

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
        <div
            className="reader-page"
            style={customBgUrl ? { backgroundImage: `url(${customBgUrl})` } : {}}
        >
            {customFontUrl && (
                <style>{`
                    @font-face {
                        font-family: 'CustomUserFont';
                        src: url('${customFontUrl}');
                        font-display: swap;
                    }
                `}</style>
            )}

            {customBgUrl && <div className="reader-bg-overlay" />}

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

            <TranslationPopup
                data={translationData}
                onClose={() => {
                    setTranslationData(null);
                    // Clear selection in the iframe if possible
                    if (renditionRef.current) {
                        try {
                            renditionRef.current.getContents()[0].document.getSelection().removeAllRanges();
                        } catch (e) { }
                    }
                }}
            />
        </div>
    );
}
