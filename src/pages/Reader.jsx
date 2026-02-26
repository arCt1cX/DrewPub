import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ePub from 'epubjs';
import { getBook, savePosition, getPosition, updateBookMeta } from '../db';
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

    const [translationText, setTranslationText] = useState(null);
    const [translationPos, setTranslationPos] = useState({ x: 0, y: 0 });

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

        // Handle text selection for dictionary
        rendition.on('selected', (cfiRange, contents) => {
            const range = rendition.getRange(cfiRange);
            const text = range.toString().trim();
            if (!text || text.length > 50) return; // Ignore very long strings or empty

            try {
                // Get rect of the selection
                const rect = range.getBoundingClientRect();
                const iframeRect = viewerRef.current.querySelector('iframe').getBoundingClientRect();

                // Position relative to viewport
                const x = rect.left + iframeRect.left + (rect.width / 2);
                const y = rect.top + iframeRect.top;

                setTranslationText(text);
                setTranslationPos({ x, y });
            } catch (err) {
                console.error("Selection rect error:", err);
            }
        });

        // Hide translation on tap/click elsewhere or unselect
        rendition.on('unselected', () => {
            setTranslationText(null);
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

    async function applyStyles(rendition, s) {
        let fontFamily = '';
        const theme = getTheme(s.theme, s.customTheme);
        const isPag = s.readingMode !== 'scroll';

        // 1. Handle Custom Font
        if (s.font === 'custom' && s.customFontId) {
            try {
                const { getCustomAsset } = await import('../db');
                const fontBlob = await getCustomAsset(s.customFontId);
                if (fontBlob) {
                    const fontUrl = URL.createObjectURL(fontBlob);
                    const fontFaceRule = `
                        @font-face {
                            font-family: 'DrewPubCustom';
                            src: url('${fontUrl}');
                        }
                    `;
                    rendition.hooks.content.register((contents) => {
                        contents.addStylesheetRules(fontFaceRule);
                    });
                    fontFamily = "'DrewPubCustom', sans-serif";
                } else {
                    fontFamily = FONTS[0].family;
                }
            } catch (err) {
                console.error("Failed to load custom font from DB:", err);
                fontFamily = FONTS[0].family;
            }
        } else {
            const fontObj = FONTS.find(f => f.id === s.font) || FONTS[0];
            fontFamily = fontObj.family;
        }

        // 2. Handle Custom Background
        let mainBgColor = theme.readerBg;
        let iframeBgColor = theme.readerBg;

        if (s.customBackgroundId) {
            try {
                const { getCustomAsset } = await import('../db');
                const bgBlob = await getCustomAsset(s.customBackgroundId);
                if (bgBlob) {
                    const bgUrl = URL.createObjectURL(bgBlob);
                    // Set the image on the wrapper div via CSS variable
                    document.documentElement.style.setProperty('--custom-bg-image', `url(${bgUrl})`);

                    // Convert hex to rgb for rgba overlay
                    let hex = theme.readerBg.replace('#', '');
                    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
                    const r = parseInt(hex.substring(0, 2), 16) || 0;
                    const g = parseInt(hex.substring(2, 4), 16) || 0;
                    const b = parseInt(hex.substring(4, 6), 16) || 0;

                    const opacity = s.backgroundOverlayOpacity ?? 0.8;
                    // Iframe gets the translucent color, main wrapper becomes transparent so the image shows
                    iframeBgColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
                    mainBgColor = 'transparent';
                } else {
                    document.documentElement.style.removeProperty('--custom-bg-image');
                }
            } catch (e) {
                console.error("Failed to load custom background from DB:", e);
                document.documentElement.style.removeProperty('--custom-bg-image');
            }
        } else {
            document.documentElement.style.removeProperty('--custom-bg-image');
        }

        // Apply background to main page
        const readerPage = document.querySelector('.reader-page');
        if (readerPage) {
            if (s.customBackgroundId) {
                readerPage.style.backgroundImage = 'var(--custom-bg-image)';
                readerPage.style.backgroundSize = 'cover';
                readerPage.style.backgroundPosition = 'center';
                readerPage.style.backgroundAttachment = 'fixed';
            } else {
                readerPage.style.backgroundImage = 'none';
                readerPage.style.backgroundColor = mainBgColor;
            }
        }

        // In paginated mode, do NOT override padding/max-width on body:
        const bodyStyles = {
            'font-family': fontFamily + ' !important',
            'font-size': s.fontSize + 'px !important',
            'line-height': s.lineHeight + ' !important',
            'color': theme.readerText + ' !important',
            'background': iframeBgColor + ' !important',
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
            'p, span, div, li, td': {
                'color': theme.readerText + ' !important',
            },
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
    const longPressTimerRef = useRef(null);

    // ── Document Word Selection (through overlay) ─────────
    const getWordAtPoint = useCallback((clientX, clientY) => {
        try {
            const iframe = viewerRef.current?.querySelector('iframe');
            if (!iframe) return null;
            const iframeRect = iframe.getBoundingClientRect();
            const x = clientX - iframeRect.left;
            const y = clientY - iframeRect.top;

            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) return null;

            let range, textNode, offset;
            if (doc.caretRangeFromPoint) {
                range = doc.caretRangeFromPoint(x, y);
                if (range) {
                    textNode = range.startContainer;
                    offset = range.startOffset;
                }
            } else if (doc.caretPositionFromPoint) {
                const pos = doc.caretPositionFromPoint(x, y);
                if (pos) {
                    textNode = pos.offsetNode;
                    offset = pos.offset;
                }
            }

            if (textNode && textNode.nodeType === 3) {
                const text = textNode.nodeValue;
                let start = offset;
                let end = offset;
                // Match word characters + common accented characters
                const isWordChar = (c) => /[\w\u00C0-\u024F\u1E00-\u1EFF\']/.test(c);

                while (start > 0 && isWordChar(text[start - 1])) start--;
                while (end < text.length && isWordChar(text[end])) end++;

                const word = text.slice(start, end).trim();
                // Reject if empty or too long
                if (word.length > 0 && word.length < 50) {
                    const wordRange = doc.createRange();
                    wordRange.setStart(textNode, start);
                    wordRange.setEnd(textNode, end);
                    // Clear and apply strict selection to document
                    const sel = doc.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(wordRange);

                    const rect = wordRange.getBoundingClientRect();
                    return {
                        word,
                        x: rect.left + iframeRect.left + (rect.width / 2),
                        y: rect.top + iframeRect.top
                    };
                }
            }
        } catch (err) {
            console.error("Word selection failed:", err);
        }
        return null;
    }, []);

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
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);

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

            // Start long press timer for dictionary (500ms)
            longPressTimerRef.current = setTimeout(() => {
                if (!overlayTouchRef.current?.moved) {
                    if (navigator.vibrate) navigator.vibrate(50);
                    const result = getWordAtPoint(t.clientX, t.clientY);
                    if (result) {
                        setTranslationText(result.word);
                        setTranslationPos({ x: result.x, y: result.y });
                    }
                }
            }, 500);
        }
    }, [stopMomentum, getWordAtPoint]);

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
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
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
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
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
        // Dismiss translation if open
        if (translationText) {
            setTranslationText(null);
            renditionRef.current?.getContents()?.forEach(c => c.document.getSelection().removeAllRanges());
            return;
        }

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

    const handleOverlayDoubleClick = useCallback((e) => {
        const result = getWordAtPoint(e.clientX, e.clientY);
        if (result) {
            setTranslationText(result.word);
            setTranslationPos({ x: result.x, y: result.y });
        }
    }, [getWordAtPoint]);

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
                    onDoubleClick={handleOverlayDoubleClick}
                    onTouchStart={handleOverlayTouchStart}
                    onTouchMove={handleOverlayTouchMove}
                    onTouchEnd={handleOverlayTouchEnd}
                    onContextMenu={(e) => {
                        e.preventDefault(); // Prevents iOS Safari showing a default popup/select all on this overlay
                    }}
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
