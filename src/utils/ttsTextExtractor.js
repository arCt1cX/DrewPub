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

/**
 * Split text into sentences — QUOTE-AWARE.
 * Never splits inside quoted speech so dialogue stays intact.
 * Handles abbreviations, ellipses, smart/straight quotes.
 */
function splitIntoSentences(text) {
    if (!text || text.length < 2) return [text].filter(Boolean);

    // ── Protect abbreviations ──
    const abbrevsRe = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|a\.m|p\.m|vol|ch|no|fig)\./gi;
    let processed = text;
    const abbrevMap = [];
    processed = processed.replace(abbrevsRe, (match) => {
        const ph = `\x00A${abbrevMap.length}\x00`;
        abbrevMap.push(match);
        return ph;
    });

    // ── Quote-aware walk ──
    const sentences = [];
    let current = '';
    let quoteDepth = 0;

    const OPEN_Q  = new Set(['\u201C', '\u00AB', '\u2018']);
    const CLOSE_Q = new Set(['\u201D', '\u00BB', '\u2019']);

    for (let i = 0; i < processed.length; i++) {
        const ch = processed[i];
        current += ch;

        // Track quote depth
        if (OPEN_Q.has(ch)) {
            quoteDepth++;
        } else if (CLOSE_Q.has(ch)) {
            quoteDepth = Math.max(0, quoteDepth - 1);
        } else if (ch === '"') {
            // ASCII straight quote — toggle
            if (quoteDepth > 0) quoteDepth--;
            else quoteDepth++;
        }
        if (quoteDepth > 4) quoteDepth = 0; // safety reset

        // Never split inside quotes
        if (quoteDepth > 0) continue;

        // Detect sentence-ending punctuation
        let isEnd = false;
        if (ch === '!' || ch === '?' || ch === '\u2026') {
            isEnd = true;
        } else if (ch === '.') {
            // Consume ellipsis (...)
            if (i + 2 < processed.length && processed[i + 1] === '.' && processed[i + 2] === '.') {
                current += '..';
                i += 2;
            }
            isEnd = true;
        }

        if (!isEnd) continue;

        // Look ahead for whitespace + uppercase / opening quote
        let j = i + 1;
        while (j < processed.length && processed[j] === ' ') j++;

        if (j > i + 1 && j < processed.length) {
            const next = processed[j];
            if (/[A-Z]/.test(next) || OPEN_Q.has(next) || next === '"') {
                sentences.push(current.trim());
                current = '';
                i = j - 1;
            }
        }
    }

    if (current.trim()) sentences.push(current.trim());

    // ── Restore abbreviations ──
    return sentences.map(s => {
        let r = s;
        for (let k = 0; k < abbrevMap.length; k++) {
            r = r.replace(`\x00A${k}\x00`, abbrevMap[k]);
        }
        return r;
    }).filter(s => s.length > 0);
}
