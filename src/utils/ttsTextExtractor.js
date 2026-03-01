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

        if (isHeading || block.text.length < 120) {
            // Short text or heading — keep as a single segment
            segments.push({
                text: block.text,
                element: block.element,
                blockIndex: block.index,
                sentenceIndex: 0,
                segType: isHeading ? 'heading' : 'text',
            });
            continue;
        }

        // Split longer paragraphs into sentences
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
 * Split text into sentences using common punctuation boundaries.
 * Handles abbreviations, dialog quotes, ellipses etc.
 */
function splitIntoSentences(text) {
    // Sentence-ending patterns: ., !, ?, …
    // Avoid splitting on: Mr., Mrs., Dr., etc., e.g., i.e., ...
    const abbrevs = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|a\.m|p\.m|vol|ch|no|fig)\./gi;

    // Temporarily replace abbreviations
    let processed = text;
    const abbrevMap = [];
    processed = processed.replace(abbrevs, (match) => {
        const placeholder = `\x00ABBR${abbrevMap.length}\x00`;
        abbrevMap.push(match);
        return placeholder;
    });

    // Split on sentence-ending punctuation followed by space + uppercase, or end of string
    // Also split on dialog breaks (closing quote + space)
    const parts = processed.split(/(?<=[.!?…])\s+(?=[A-Z""\u201C\u00AB«])|(?<=[.!?…])\s*$/);

    // Restore abbreviations
    return parts.map(p => {
        let restored = p;
        for (let i = 0; i < abbrevMap.length; i++) {
            restored = restored.replace(`\x00ABBR${i}\x00`, abbrevMap[i]);
        }
        return restored;
    }).filter(s => s.trim().length > 0);
}
