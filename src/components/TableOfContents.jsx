import React, { useEffect, useRef } from 'react';
import './TableOfContents.css';

export default function TableOfContents({ toc, currentHref, onSelect, onClose }) {
    const activeRef = useRef(null);

    useEffect(() => {
        if (activeRef.current) {
            setTimeout(() => {
                activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
        }
    }, [currentHref]);

    const renderItems = (items, depth = 0) => {
        return items.map((item, index) => {
            const itemBaseHref = item.href?.split('#')[0] || '';
            const currentBaseHref = currentHref?.split('#')[0] || '';
            
            const isActive = currentHref && (currentHref === item.href || currentBaseHref === itemBaseHref);

            return (
                <div key={item.id || index}>
                    <button
                        ref={isActive ? activeRef : null}
                        className={`toc-item ${depth > 0 ? 'toc-sub' : ''} ${isActive ? 'active' : ''}`}
                        style={{ paddingLeft: 20 + depth * 20 + 'px' }}
                        onClick={() => onSelect(item.href)}
                    >
                        <span className="toc-label">{item.label?.trim()}</span>
                        {depth === 0 && <span className="toc-arrow">›</span>}
                    </button>
                    {item.subitems && item.subitems.length > 0 && renderItems(item.subitems, depth + 1)}
                </div>
            );
        });
    };

    return (
        <>
            <div className="overlay" onClick={onClose} />
            <div className="toc-panel glass-strong">
                <div className="toc-header">
                    <h2 className="toc-title">Contents</h2>
                    <button className="btn-icon" onClick={onClose}>✕</button>
                </div>
                <div className="toc-body stagger-children">
                    {toc.length > 0 ? (
                        renderItems(toc)
                    ) : (
                        <p className="toc-empty">No table of contents available.</p>
                    )}
                </div>
            </div>
        </>
    );
}
