import React from 'react';
import './TableOfContents.css';

export default function TableOfContents({ toc, currentHref, onSelect, onClose }) {
    const renderItems = (items, depth = 0) => {
        return items.map((item, index) => (
            <div key={item.id || index}>
                <button
                    className={`toc-item ${depth > 0 ? 'toc-sub' : ''} ${currentHref === item.href ? 'active' : ''}`}
                    style={{ paddingLeft: 20 + depth * 20 + 'px' }}
                    onClick={() => onSelect(item.href)}
                >
                    <span className="toc-label">{item.label?.trim()}</span>
                    {depth === 0 && <span className="toc-arrow">›</span>}
                </button>
                {item.subitems && item.subitems.length > 0 && renderItems(item.subitems, depth + 1)}
            </div>
        ));
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
