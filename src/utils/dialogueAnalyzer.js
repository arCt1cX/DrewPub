/**
 * Dialogue Analyzer — Parses ePub text into TTS segments with character attribution.
 *
 * Detects:
 * - Dialogue vs narration
 * - Speaker identification via dialogue tags ("said John", "she whispered")
 * - Gender via pronouns and common English name database
 *
 * Each segment is a speakable TTS unit with its associated DOM element
 * for highlighting.
 */

// ─── Name Databases ─────────────────────────────────

const MALE_NAMES = new Set([
    'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
    'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark',
    'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian',
    'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan',
    'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry',
    'justin', 'scott', 'brandon', 'benjamin', 'samuel', 'raymond', 'gregory',
    'henry', 'alexander', 'jack', 'dennis', 'jerry', 'tyler', 'aaron',
    'peter', 'harry', 'tom', 'bob', 'jim', 'joe', 'bill', 'charlie', 'sam',
    'ben', 'max', 'leo', 'oliver', 'ethan', 'noah', 'liam', 'mason',
    'logan', 'lucas', 'aiden', 'jackson', 'sebastian', 'caleb', 'owen',
    'luke', 'adam', 'neil', 'frank', 'carl', 'ray', 'fred', 'albert',
    'arthur', 'lawrence', 'dylan', 'jesse', 'oscar', 'nathan', 'victor',
    'harold', 'ernest', 'phillip', 'todd', 'dale', 'ralph', 'eugene',
    'russell', 'randy', 'wayne', 'martin', 'walter', 'patrick',
    'lord', 'sir', 'mr', 'king', 'prince', 'duke', 'baron', 'edmund',
    'felix', 'miles', 'hugo', 'finn', 'theo', 'archie', 'freddie',
]);

const FEMALE_NAMES = new Set([
    'mary', 'patricia', 'jennifer', 'linda', 'barbara', 'elizabeth', 'susan',
    'jessica', 'sarah', 'karen', 'lisa', 'nancy', 'betty', 'margaret', 'sandra',
    'ashley', 'dorothy', 'kimberly', 'emily', 'donna', 'michelle', 'carol',
    'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura',
    'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda',
    'pamela', 'emma', 'nicole', 'helen', 'samantha', 'katherine', 'christine',
    'debra', 'rachel', 'carolyn', 'janet', 'catherine', 'maria', 'heather',
    'diane', 'ruth', 'julie', 'olivia', 'joyce', 'virginia', 'victoria',
    'kelly', 'lauren', 'christina', 'joan', 'evelyn', 'judith', 'megan',
    'andrea', 'cheryl', 'hannah', 'jacqueline', 'martha', 'gloria', 'teresa',
    'ann', 'sara', 'madison', 'frances', 'kathryn', 'janice', 'jean',
    'abigail', 'alice', 'judy', 'sophia', 'grace', 'denise', 'amber',
    'doris', 'marilyn', 'danielle', 'beverly', 'isabella', 'diana',
    'natalie', 'brittany', 'charlotte', 'marie', 'kayla', 'alexis', 'lori',
    'lady', 'mrs', 'ms', 'miss', 'queen', 'princess', 'duchess',
    'clara', 'ivy', 'lily', 'hazel', 'violet', 'ruby', 'scarlett', 'chloe',
]);

const SPEECH_VERBS = new Set([
    'said', 'says', 'asked', 'replied', 'answered', 'whispered', 'shouted',
    'yelled', 'screamed', 'cried', 'exclaimed', 'muttered', 'murmured',
    'growled', 'snapped', 'snarled', 'hissed', 'breathed', 'sighed',
    'groaned', 'moaned', 'laughed', 'chuckled', 'giggled', 'sobbed',
    'wailed', 'demanded', 'insisted', 'suggested', 'admitted', 'agreed',
    'argued', 'began', 'begged', 'bellowed', 'called', 'cautioned',
    'commented', 'complained', 'conceded', 'confessed', 'confirmed',
    'continued', 'declared', 'gasped', 'grunted', 'guessed', 'informed',
    'interrupted', 'noted', 'observed', 'offered', 'ordered', 'pleaded',
    'promised', 'protested', 'recalled', 'remarked', 'repeated', 'responded',
    'retorted', 'revealed', 'sang', 'scoffed', 'sniffed', 'spoke',
    'stammered', 'stated', 'stuttered', 'teased', 'told', 'urged',
    'warned', 'wondered', 'added', 'announced', 'barked', 'boomed',
    'cooed', 'drawled', 'echoed', 'fumed', 'grumbled', 'implored',
    'mused', 'panted', 'purred', 'questioned', 'roared', 'shrieked',
]);

// ─── Gender Detection ────────────────────────────────

function detectGender(name) {
    if (!name) return 'unknown';
    const lower = name.toLowerCase().trim();

    if (MALE_NAMES.has(lower)) return 'male';
    if (FEMALE_NAMES.has(lower)) return 'female';

    // Pronoun-based
    if (/^(he|him|his)$/i.test(lower)) return 'male';
    if (/^(she|her|hers)$/i.test(lower)) return 'female';

    return 'unknown';
}

function detectGenderFromContext(text) {
    // Count gendered pronouns in nearby text
    const malePronouns = (text.match(/\b(he|him|his)\b/gi) || []).length;
    const femalePronouns = (text.match(/\b(she|her|hers)\b/gi) || []).length;

    if (femalePronouns > malePronouns) return 'female';
    if (malePronouns > femalePronouns) return 'male';
    return 'unknown';
}

// ─── Dialogue Tag Parsing ────────────────────────────

/**
 * Try to extract speaker from dialogue tags near a quote.
 * Patterns:
 *   "..." said John.         → John
 *   "..." John said.         → John
 *   John said, "..."         → John
 *   "..." he whispered.      → he (resolve via context)
 *   "..." she said softly.   → she
 */
function extractSpeaker(beforeQuote, afterQuote) {
    // Pattern 1: "..." [VERB] [NAME]
    // e.g. afterQuote = " said John." or " whispered the old man."
    const afterMatch = afterQuote.match(
        /^\s*,?\s*(\w+)\s+(\w+(?:\s+\w+)?)/
    );
    if (afterMatch) {
        const word1 = afterMatch[1].toLowerCase();
        const word2 = afterMatch[2];

        // "said John" pattern
        if (SPEECH_VERBS.has(word1)) {
            const name = word2.replace(/[.,!?;:]/g, '').trim();
            if (name && name.length > 1) return name;
        }
        // "John said" pattern
        if (SPEECH_VERBS.has(word2.toLowerCase().replace(/[.,!?;:]/g, ''))) {
            const name = afterMatch[1].replace(/[.,!?;:]/g, '').trim();
            if (name && name.length > 1 && name[0] === name[0].toUpperCase()) return name;
        }
    }

    // Pattern 2: afterQuote has pronoun + verb  — "he said", "she whispered"
    const pronounVerb = afterQuote.match(
        /^\s*,?\s*(he|she|they)\s+(\w+)/i
    );
    if (pronounVerb) {
        const pronoun = pronounVerb[1].toLowerCase();
        const verb = pronounVerb[2].toLowerCase().replace(/[.,!?;:]/g, '');
        if (SPEECH_VERBS.has(verb)) {
            return pronoun; // Will be resolved to actual character via context
        }
    }

    // Pattern 3: [NAME] [VERB], "..."  — look at beforeQuote
    const beforeMatch = beforeQuote.match(
        /(\b[A-Z]\w+(?:\s+[A-Z]\w+)?)\s+(\w+)\s*,?\s*$/
    );
    if (beforeMatch) {
        const name = beforeMatch[1];
        const verb = beforeMatch[2].toLowerCase();
        if (SPEECH_VERBS.has(verb)) return name;
    }

    return null;
}

// ─── Core Analysis ───────────────────────────────────

/**
 * Extract paragraph blocks from an epub iframe document.
 * @param {Document} doc - The iframe's contentDocument
 * @returns {Array<{element: HTMLElement, text: string}>}
 */
export function extractParagraphs(doc) {
    if (!doc?.body) return [];

    const blocks = [];
    const selector = 'p, h1, h2, h3, h4, h5, h6, li, blockquote';
    const elements = doc.body.querySelectorAll(selector);

    for (const el of elements) {
        const text = el.textContent?.trim();
        if (text && text.length > 1) {
            blocks.push({ element: el, text });
        }
    }

    // If no paragraphs found, try divs with direct text
    if (blocks.length === 0) {
        const divs = doc.body.querySelectorAll('div');
        for (const el of divs) {
            const text = el.textContent?.trim();
            if (text && text.length > 1) {
                // Only include leaf divs (no child divs)
                if (!el.querySelector('div, p')) {
                    blocks.push({ element: el, text });
                }
            }
        }
    }

    return blocks;
}

/**
 * Split a paragraph into TTS segments (sentences/dialogue lines).
 * Each segment has: { text, type, character, gender, element }
 */
function splitIntoSegments(paragraph, lastSpeaker, characterGenders) {
    const { text, element } = paragraph;
    const segments = [];

    // Regex to find quoted dialogue — supports " " and " "
    const quoteRegex = /(?:[\u201C"]\s*(.*?)\s*[\u201D"])|(?:[\u2018']\s*(.*?)\s*[\u2019'])/g;
    let lastIndex = 0;
    let match;

    while ((match = quoteRegex.exec(text)) !== null) {
        const quoteText = match[1] || match[2];
        if (!quoteText || quoteText.length < 2) continue;

        // Text before this quote → narration
        const beforeText = text.slice(lastIndex, match.index).trim();
        if (beforeText.length > 1) {
            segments.push({
                text: beforeText,
                type: 'narration',
                character: null,
                gender: 'unknown',
                element,
            });
        }

        // Try to identify speaker
        const contextBefore = text.slice(Math.max(0, match.index - 100), match.index);
        const contextAfter = text.slice(match.index + match[0].length, match.index + match[0].length + 100);
        let speaker = extractSpeaker(contextBefore, contextAfter);

        // Resolve pronoun to last known speaker of that gender
        if (speaker && /^(he|she|they)$/i.test(speaker)) {
            const pronGender = detectGender(speaker);
            speaker = lastSpeaker?.[pronGender] || speaker;
        }

        // Track gender for character
        let gender = 'unknown';
        if (speaker) {
            const speakerLower = speaker.toLowerCase();
            if (characterGenders.has(speakerLower)) {
                gender = characterGenders.get(speakerLower);
            } else {
                gender = detectGender(speaker);
                if (gender === 'unknown') {
                    gender = detectGenderFromContext(contextBefore + ' ' + contextAfter);
                }
                if (gender !== 'unknown') {
                    characterGenders.set(speakerLower, gender);
                }
            }
            // Update last speaker by gender
            if (gender === 'male' || gender === 'female') {
                lastSpeaker[gender] = speaker;
            }
        }

        segments.push({
            text: quoteText,
            type: 'dialogue',
            character: speaker || lastSpeaker.last || null,
            gender,
            element,
        });

        if (speaker) lastSpeaker.last = speaker;
        lastIndex = match.index + match[0].length;
    }

    // Remaining text after last quote → narration
    const remaining = text.slice(lastIndex).trim();
    if (remaining.length > 1) {
        segments.push({
            text: remaining,
            type: 'narration',
            character: null,
            gender: 'unknown',
            element,
        });
    }

    // If no quotes found, treat entire paragraph as narration
    if (segments.length === 0 && text.length > 1) {
        segments.push({
            text,
            type: 'narration',
            character: null,
            gender: 'unknown',
            element,
        });
    }

    return segments;
}

/**
 * Split a long segment into smaller chunks at sentence boundaries.
 * Keeps each chunk under maxLen characters for better TTS latency.
 */
function splitLongSegment(segment, maxLen = 300) {
    if (segment.text.length <= maxLen) return [segment];

    const chunks = [];
    // Split at sentence boundaries: . ! ? followed by space or end
    const sentences = segment.text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g) || [segment.text];

    let current = '';
    for (const sentence of sentences) {
        if (current.length + sentence.length > maxLen && current.length > 0) {
            chunks.push({ ...segment, text: current.trim() });
            current = sentence;
        } else {
            current += sentence;
        }
    }
    if (current.trim().length > 1) {
        chunks.push({ ...segment, text: current.trim() });
    }

    return chunks.length > 0 ? chunks : [segment];
}

// ─── Public API ──────────────────────────────────────

/**
 * Analyze a chapter's content into TTS-ready segments.
 * @param {Document} iframeDoc - The epub iframe's contentDocument
 * @param {boolean} multiVoice - Whether to detect characters for multi-voice
 * @returns {{ segments: Array, characters: Object }}
 */
export function analyzeChapter(iframeDoc, multiVoice = true) {
    const paragraphs = extractParagraphs(iframeDoc);
    if (paragraphs.length === 0) return { segments: [], characters: {} };

    const characterGenders = new Map();
    const lastSpeaker = { male: null, female: null, last: null };
    const allSegments = [];

    for (const paragraph of paragraphs) {
        let segments;
        if (multiVoice) {
            segments = splitIntoSegments(paragraph, lastSpeaker, characterGenders);
        } else {
            // Single voice mode — treat everything as narration
            segments = [{
                text: paragraph.text,
                type: 'narration',
                character: null,
                gender: 'unknown',
                element: paragraph.element,
            }];
        }

        // Split any long segments for better latency
        for (const seg of segments) {
            allSegments.push(...splitLongSegment(seg));
        }
    }

    // Build character map
    const characters = {};
    for (const [name, gender] of characterGenders) {
        characters[name] = { gender, count: 0 };
    }
    for (const seg of allSegments) {
        if (seg.character) {
            const key = seg.character.toLowerCase();
            if (characters[key]) characters[key].count++;
        }
    }

    return { segments: allSegments, characters };
}

/**
 * Quick re-analysis when user navigates to a new page within same chapter.
 * Returns segments whose DOM elements exist in the document.
 */
export function analyzeVisibleContent(iframeDoc, multiVoice = true) {
    return analyzeChapter(iframeDoc, multiVoice);
}
