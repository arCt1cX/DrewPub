import React from 'react';
import './CoverArt.css';

// Cloth-like palettes that sit well on the cozy cream/sage/terracotta UI.
const PALETTES = [
    ['#C97B5F', '#9E5239'], // terracotta
    ['#6D8597', '#435A6B'], // slate
    ['#46505F', '#272D37'], // ink
    ['#D1A35A', '#A3742E'], // ochre
    ['#94966A', '#676943'], // moss
    ['#8C6A7E', '#5B4152'], // plum
    ['#B98A72', '#87604C'], // clay
    ['#7E9078', '#55684F'], // sage
    ['#9A5B5B', '#6B3A3A'], // wine
    ['#5F8A85', '#3E605C'], // teal
];

// Small stable hash so a title always gets the same colour and motif.
export function hashString(str = '') {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function lastName(author) {
    if (!author) return '';
    const parts = author.trim().split(/\s+/);
    return parts[parts.length - 1];
}

/** A generated cover for books that don't ship one. */
export function CoverArt({ title, author, className = '' }) {
    const h = hashString(title || '?');
    const [c1, c2] = PALETTES[h % PALETTES.length];
    const motif = (h >>> 8) % 4;
    return (
        <div
            className={`cover-art cover-art-m${motif} ${className}`}
            style={{ '--c1': c1, '--c2': c2 }}
            aria-hidden="true"
        >
            <span className="cover-art-title">{title || 'Untitled'}</span>
            {author && <span className="cover-art-author">{lastName(author)}</span>}
        </div>
    );
}

/** The book's real cover when it has one, otherwise a generated one. */
export default function BookCover({ book, className = '', lazy = true }) {
    const [failed, setFailed] = React.useState(false);
    if (book?.cover && !failed) {
        return (
            <img
                className={`book-cover-img ${className}`}
                src={book.cover}
                alt=""
                loading={lazy ? 'lazy' : undefined}
                draggable={false}
                onError={() => setFailed(true)}
            />
        );
    }
    return <CoverArt title={book?.title} author={book?.author} className={className} />;
}
