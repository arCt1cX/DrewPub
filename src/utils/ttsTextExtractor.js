/**
 * ttsTextExtractor.js
 *
 * Extracts structured text blocks from an epub.js iframe document,
 * preserving DOM element references for TTS highlighting.
 */

// Block-level elements that represent discrete text units
const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'LI', 'TD', 'TH', 'FIGCAPTION', 'DT', 'DD',
]);

// Elements to skip entirely
const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'MATH', 'NAV',
    'HEADER', 'FOOTER', 'ASIDE', 'FIGURE',
]);

/**
 * Walk the iframe DOM and extract text blocks with their DOM elements.
 * Each block = one paragraph / heading / list-item etc.
 *
 * @param {Document} doc — the iframe's contentDocument
 * @returns {Array<{ text: string, element: Element, tagName: string, index: number }>}
 */
export function extractChapterText(doc) {
    if (!doc?.body) return [];

    const blocks = [];
    const body = doc.body;

    function walk(node) {
        if (!node) return;

        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName;
            if (SKIP_TAGS.has(tag)) return;

            if (BLOCK_TAGS.has(tag)) {
                const text = getCleanText(node);
                if (text.length > 1) {
                    blocks.push({
                        text,
                        element: node,
                        tagName: tag,
                        index: blocks.length,
                    });
                }
                return; // Don't recurse deeper — we already got all text from this block
            }
        }

        // Recurse into child nodes for non-block elements (e.g. <body>, <section>, <article>)
        const children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
            walk(children[i]);
        }
    }

    walk(body);
    return blocks;
}

/**
 * Clean and normalize text from a DOM element.
 */
function getCleanText(element) {
    // Use textContent for speed, then clean up whitespace
    let text = element.textContent || '';
    text = text.replace(/\s+/g, ' ').trim();
    // Remove zero-width chars
    text = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
    return text;
}

/**
 * Split text blocks into sentence-level segments for TTS.
 * Each segment is one sentence (or a short headings as-is).
 *
 * @param {Array} blocks — from extractChapterText()
 * @returns {Array<{ text: string, element: Element, blockIndex: number, sentenceIndex: number, segType: string }>}
 */
export function createTtsSegments(blocks) {
    const segments = [];

    for (const block of blocks) {
        const isHeading = block.tagName.startsWith('H');

        if (isHeading) {
            segments.push({
                text: block.text,
                element: block.element,
                blockIndex: block.index,
                sentenceIndex: 0,
                segType: 'heading',
            });
            continue;
        }

        // Always split into sentences — quote-aware splitter keeps dialogue intact
        const sentences = splitIntoSentences(block.text);
        for (let i = 0; i < sentences.length; i++) {
            if (sentences[i].trim().length < 2) continue;
            segments.push({
                text: sentences[i].trim(),
                element: block.element,
                blockIndex: block.index,
                sentenceIndex: i,
                segType: 'text',
            });
        }
    }

    return segments;
}

// ── Quote protection for sentence splitter ──────────────────
// Unicode private-use-area placeholders for punctuation inside quotes
const Q_PERIOD = '\uE001';
const Q_EXCL   = '\uE002';
const Q_QUEST  = '\uE003';
const Q_ELLIP  = '\uE004';

/**
 * Replace sentence-ending punctuation inside paired quotes with placeholders
 * so the splitter doesn't break mid-dialogue.
 */
function protectQuotedContent(text) {
    const protect = (inner) => inner
        .replace(/\./g, Q_PERIOD)
        .replace(/!/g, Q_EXCL)
        .replace(/\?/g, Q_QUEST)
        .replace(/\u2026/g, Q_ELLIP);

    let result = text;

    // Smart double quotes: \u201C…\u201D (distinct open/close chars)
    result = result.replace(/\u201C([^\u201D]*)\u201D/g,
        (_, inner) => '\u201C' + protect(inner) + '\u201D');

    // Guillemets: «…»
    result = result.replace(/\u00AB([^\u00BB]*)\u00BB/g,
        (_, inner) => '\u00AB' + protect(inner) + '\u00BB');

    // Straight double quotes: "…" (same char for open/close)
    result = result.replace(/"([^"]*?)"/g,
        (_, inner) => '"' + protect(inner) + '"');

    return result;
}

function restoreQuoteProtection(text) {
    return text
        .replace(/\uE001/g, '.')
        .replace(/\uE002/g, '!')
        .replace(/\uE003/g, '?')
        .replace(/\uE004/g, '\u2026');
}

/**
 * Split text into sentences — quote-aware, robust.
 * Protects quoted content, abbreviations, and decimal numbers.
 * Splits on sentence-ending punctuation followed by whitespace.
 */
function splitIntoSentences(text) {
    if (!text || text.length < 2) return [text].filter(Boolean);

    // ── Protect quoted content FIRST ──
    let processed = protectQuotedContent(text);

    // ── Protect abbreviations ──
    const abbrevsRe = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|a\.m|p\.m|vol|ch|no|fig)\./gi;
    const placeholders = [];
    processed = processed.replace(abbrevsRe, (match) => {
        const ph = `\x00P${placeholders.length}\x00`;
        placeholders.push(match);
        return ph;
    });

    // Protect decimal numbers (3.14, 1.5)
    processed = processed.replace(/(\d)\.(\d)/g, '$1\x00N$2');

    // Normalize triple dots to ellipsis char
    processed = processed.replace(/\.{3}/g, '\u2026');

    // ── Split on sentence-ending punctuation ──
    // Lookbehind: . ! ? … optionally followed by closing quotes
    // Then one or more whitespace
    const parts = processed.split(/(?<=[.!?\u2026][\u201D\u2019\u00BB\u00BB"'\)]*) +/);

    // ── Restore all placeholders ──
    const restored = parts.map(p => {
        let r = p;
        for (let k = 0; k < placeholders.length; k++) {
            r = r.split(`\x00P${k}\x00`).join(placeholders[k]);
        }
        r = r.split('\x00N').join('.');
        // Restore quote-protected punctuation
        r = restoreQuoteProtection(r);
        return r.trim();
    }).filter(s => s.length > 0);

    // ── Merge very short fragments with previous ──
    if (restored.length <= 1) return restored;

    const merged = [restored[0]];
    for (let i = 1; i < restored.length; i++) {
        if (restored[i].length < 12) {
            merged[merged.length - 1] += ' ' + restored[i];
        } else {
            merged.push(restored[i]);
        }
    }

    return merged;
}
