import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconClose, IconLanguages } from './Icons';
import './DictionaryPopup.css';

const EDGE = 12;        // distanza minima dai bordi dello schermo
const GAP = 14;         // distanza dal punto toccato
const MIN_SPACE = 140;  // sotto questa soglia il popup non ci sta comodo

function readInset(name) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const px = parseFloat(raw);
    return Number.isFinite(px) ? px : 0;
}

export default function DictionaryPopup({ word, translation, loading, position, onClose }) {
    const popupRef = useRef(null);
    const headerRef = useRef(null);
    const bodyRef = useRef(null);
    const [layout, setLayout] = useState(null);

    const reposition = useCallback(() => {
        const el = popupRef.current;
        if (!el || !position) return;

        const vv = window.visualViewport;
        const vw = vv?.width ?? window.innerWidth;
        const vh = vv?.height ?? window.innerHeight;

        const safeTop = readInset('--safe-top');
        const safeBottom = readInset('--safe-bottom');
        const safeLeft = readInset('--safe-left');
        const safeRight = readInset('--safe-right');

        const minTop = EDGE + safeTop;
        const maxBottom = vh - EDGE - safeBottom;

        // Altezza naturale del contenuto (il body può scrollare, quindi la
        // misuriamo da scrollHeight invece che dal box già vincolato).
        const chrome = el.offsetHeight - el.clientHeight; // bordi
        const natural =
            (headerRef.current?.offsetHeight ?? 0) +
            (bodyRef.current?.scrollHeight ?? 0) +
            chrome;

        const anchorY = Math.min(Math.max(position.y, minTop), maxBottom);
        const spaceBelow = maxBottom - (anchorY + GAP);
        const spaceAbove = (anchorY - GAP) - minTop;

        let top;
        let maxHeight;
        let placement;

        if (natural <= spaceBelow) {
            placement = 'below';
            top = anchorY + GAP;
            maxHeight = spaceBelow;
        } else if (natural <= spaceAbove) {
            placement = 'above';
            top = anchorY - GAP - natural;
            maxHeight = spaceAbove;
        } else if (Math.max(spaceBelow, spaceAbove) < MIN_SPACE) {
            // Nessuno dei due lati è utilizzabile: occupiamo tutto lo spazio
            // disponibile, anche coprendo il punto toccato.
            placement = 'cover';
            maxHeight = maxBottom - minTop;
            top = Math.min(Math.max(anchorY - maxHeight / 2, minTop), maxBottom - Math.min(natural, maxHeight));
        } else if (spaceAbove > spaceBelow) {
            placement = 'above';
            maxHeight = spaceAbove;
            top = minTop;
        } else {
            placement = 'below';
            maxHeight = spaceBelow;
            top = anchorY + GAP;
        }

        const width = el.offsetWidth;
        const minLeft = EDGE + safeLeft;
        const maxLeft = Math.max(minLeft, vw - EDGE - safeRight - width);
        const left = Math.min(Math.max(position.x - width / 2, minLeft), maxLeft);

        setLayout((prev) => {
            if (prev && prev.top === top && prev.left === left &&
                prev.maxHeight === maxHeight && prev.placement === placement) {
                return prev;
            }
            return { top, left, maxHeight, placement };
        });
    }, [position]);

    // Riposiziona quando cambia parola, stato di caricamento o traduzione.
    useLayoutEffect(() => {
        if (!word) {
            setLayout(null);
            return;
        }
        reposition();
    }, [word, translation, loading, reposition]);

    // Il contenuto può cambiare altezza (traduzione lunga in arrivo) e lo
    // schermo può ruotare o restringersi per la tastiera.
    useEffect(() => {
        if (!word) return;
        const el = popupRef.current;
        let ro;
        if (el && typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => reposition());
            ro.observe(el);
            if (bodyRef.current) ro.observe(bodyRef.current);
        }
        window.addEventListener('resize', reposition);
        window.addEventListener('orientationchange', reposition);
        window.visualViewport?.addEventListener('resize', reposition);
        window.visualViewport?.addEventListener('scroll', reposition);
        return () => {
            ro?.disconnect();
            window.removeEventListener('resize', reposition);
            window.removeEventListener('orientationchange', reposition);
            window.visualViewport?.removeEventListener('resize', reposition);
            window.visualViewport?.removeEventListener('scroll', reposition);
        };
    }, [word, reposition]);

    if (!word) return null;

    return (
        <>
            <div className="dict-backdrop" onClick={onClose} />
            <div
                ref={popupRef}
                className="dict-popup"
                data-placement={layout?.placement ?? 'below'}
                style={{
                    top: (layout?.top ?? position.y + GAP) + 'px',
                    left: (layout?.left ?? position.x) + 'px',
                    maxHeight: layout ? layout.maxHeight + 'px' : undefined,
                    visibility: layout ? 'visible' : 'hidden',
                }}
            >
                <div className="dict-header" ref={headerRef}>
                    <span className="dict-word">{word}</span>
                    <button className="dict-close" onClick={onClose} aria-label="Chiudi">
                        <IconClose size={14} />
                    </button>
                </div>
                <div className="dict-body" ref={bodyRef}>
                    {loading ? (
                        <div className="dict-loading">
                            <div className="spinner-small" />
                            <span>Translating...</span>
                        </div>
                    ) : translation ? (
                        <div className="dict-translation-wrap">
                            <div className="dict-translation-label">
                                <IconLanguages size={12} />
                                Translation
                            </div>
                            <div className="dict-translation">{translation}</div>
                        </div>
                    ) : (
                        <div className="dict-error">Translation not found</div>
                    )}
                </div>
            </div>
        </>
    );
}
