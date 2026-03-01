/**
 * TTS Text Extractor — extracts structured text from an epub.js iframe document.
 * Groups text by block elements (paragraphs, headings, blockquotes) and maintains
 * a mapping to the original DOM elements for highlighting.
 */

const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'LI', 'FIGCAPTION', 'PRE', 'SECTION', 'ARTICLE',
]);

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/**
 * Extract text blocks from an iframe document.
 * @param {Document} doc — the iframe's contentDocument
 * @returns {Array<{ text: string, element: Element, type: 'paragraph'|'heading'|'quote' }>}
 */
export function extractChapterText(doc) {
    if (!doc?.body) return [];

    const blocks = [];
    const visited = new WeakSet();

    // Walk all block elements in document order
    const walker = doc.createTreeWalker(
        doc.body,
        NodeFilter.SHOW_ELEMENT,
        {
            acceptNode(node) {
                if (BLOCK_TAGS.has(node.tagName)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
        }
    );

    let node;
    while ((node = walker.nextNode())) {
        // Skip if already visited (nested block inside another block)
        if (visited.has(node)) continue;

        // Skip blocks that only contain other blocks (wrappers)
        const hasBlockChild = Array.from(node.children).some(c => BLOCK_TAGS.has(c.tagName));
        if (hasBlockChild && !node.textContent.trim()) continue;

        const text = getDirectText(node).trim();
        if (!text || text.length < 2) continue;

        visited.add(node);

        let type = 'paragraph';
        if (HEADING_TAGS.has(node.tagName)) {
            type = 'heading';
        } else if (node.tagName === 'BLOCKQUOTE' || node.closest?.('blockquote')) {
            type = 'quote';
        }

        blocks.push({ text, element: node, type });
    }

    // If no block elements found, fallback to entire body text split by double newlines
    if (blocks.length === 0) {
        const bodyText = doc.body.innerText?.trim();
        if (bodyText) {
            const paragraphs = bodyText.split(/\n\s*\n/).filter(p => p.trim().length > 1);
            for (const p of paragraphs) {
                blocks.push({ text: p.trim(), element: doc.body, type: 'paragraph' });
            }
        }
    }

    return blocks;
}

/**
 * Get direct text content of an element, excluding deeply nested block children.
 * This captures the text as epub.js renders it.
 */
function getDirectText(element) {
    let text = '';
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            // Include inline elements, skip block-level children
            if (!BLOCK_TAGS.has(child.tagName)) {
                text += child.textContent;
            }
        }
    }
    return text;
}

/**
 * Split a text block into sentences for finer-grained TTS control.
 * @param {string} text
 * @returns {string[]}
 */
export function splitIntoSentences(text) {
    if (!text) return [];

    // Split on sentence-ending punctuation followed by space or end
    // Handles: "Mr. Smith said..." correctly by checking capitalization after period
    const raw = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g) || [text];

    const sentences = [];
    let buffer = '';

    for (const segment of raw) {
        buffer += segment;
        // Check if this looks like a complete sentence (ends with .!? followed by space or is last)
        const trimmed = buffer.trim();
        if (trimmed.length > 0) {
            // Common abbreviations — don't split on these
            const endsAbbrev = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|approx|dept|est|inc|ltd|vol|ch|pg|no|fig)\.\s*$/i.test(trimmed);
            if (!endsAbbrev && /[.!?]["'»]?\s*$/.test(trimmed)) {
                sentences.push(trimmed);
                buffer = '';
            }
        }
    }

    if (buffer.trim()) {
        sentences.push(buffer.trim());
    }

    return sentences.filter(s => s.length > 0);
}

/**
 * Create a flat list of TTS segments from extracted chapter blocks.
 * Each segment is a sentence-level unit ready for speech synthesis.
 * @param {Array} blocks — from extractChapterText()
 * @returns {Array<{ text: string, element: Element, type: string, blockIndex: number, sentenceIndex: number }>}
 */
export function createTtsSegments(blocks) {
    const segments = [];

    for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi];
        const sentences = splitIntoSentences(block.text);

        for (let si = 0; si < sentences.length; si++) {
            segments.push({
                text: sentences[si],
                element: block.element,
                type: block.type,
                blockIndex: bi,
                sentenceIndex: si,
            });
        }
    }

    return segments;
}
