/**
 * dialogueParser.js
 *
 * Parses TTS segments to identify dialogue vs narration,
 * detects speaker names, and assigns voices to characters.
 */

// ── Dialogue detection patterns ────────────────────────────

// Matches quoted speech: "...", "...", «...», '...' (but not single apostrophes)
const QUOTE_PATTERNS = [
    /[""\u201C](.+?)[""\u201D]/g,   // "double quotes" / smart quotes
    /[«\u00AB](.+?)[»\u00BB]/g,     // «guillemets»
    /['\u2018](.+?)['\u2019]/g,     // 'single smart quotes' (careful with apostrophes)
];

// ── Speaker attribution patterns ───────────────────────────
// Matches: "said John", "John said", "whispered Mary", "Mary replied", etc.
// Must come AFTER or BEFORE the quoted text in the same block.

const SPEECH_VERBS = [
    'said', 'says', 'asked', 'replied', 'answered', 'whispered',
    'shouted', 'yelled', 'cried', 'exclaimed', 'muttered', 'murmured',
    'called', 'screamed', 'snapped', 'hissed', 'growled', 'sighed',
    'groaned', 'laughed', 'chuckled', 'giggled', 'sobbed', 'wailed',
    'pleaded', 'begged', 'demanded', 'insisted', 'declared', 'announced',
    'admitted', 'confessed', 'explained', 'continued', 'added', 'agreed',
    'interrupted', 'protested', 'suggested', 'warned', 'threatened',
    'promised', 'repeated', 'began', 'concluded', 'observed', 'noted',
    'remarked', 'commented', 'responded', 'retorted', 'teased', 'mocked',
    'breathed', 'stammered', 'stuttered', 'blurted',
];

const verbPattern = SPEECH_VERBS.join('|');

// "said John" / "John said" / "said the old man" / "the boy said"
const ATTRIBUTION_AFTER = new RegExp(
    `(?:,?\\s*(?:${verbPattern})\\s+(?:the\\s+)?([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?))`,
    'g'
);
const ATTRIBUTION_BEFORE = new RegExp(
    `((?:the\\s+)?[A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)\\s+(?:${verbPattern})`,
    'g'
);

// ── Possessive attribution ("Briar's bellowing") ───────────
const VOICE_NOUNS = [
    'voice', 'bellowing', 'bellow', 'cry', 'scream', 'shout', 'whisper',
    'words', 'tone', 'laughter', 'laugh', 'giggle', 'sob', 'groan',
    'sneer', 'snarl', 'bark', 'growl', 'hiss', 'murmur', 'plea',
    'demand', 'question', 'reply', 'answer', 'retort', 'exclamation',
    'remark', 'comment', 'outburst', 'call', 'gasp', 'sigh', 'moan',
    'wail', 'shriek', 'roar', 'cheer',
].join('|');

const POSSESSIVE_ATTR = new RegExp(
    `([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)['\u2019]s\\s+(?:${VOICE_NOUNS})`,
    'g'
);

// ── Name detection helpers ─────────────────────────────────
const COMMON_NON_NAMES = new Set([
    'the', 'but', 'and', 'then', 'with', 'that', 'this', 'what', 'how',
    'his', 'her', 'its', 'she', 'he', 'they', 'you', 'not', 'one',
    'all', 'some', 'most', 'each', 'every', 'many', 'few', 'could',
    'would', 'should', 'have', 'had', 'has', 'was', 'were', 'are',
    'did', 'does', 'may', 'can', 'will', 'just', 'even', 'still',
    'also', 'only', 'now', 'here', 'there', 'where', 'when', 'very',
    'much', 'more', 'such', 'other', 'both', 'yet', 'too', 'into',
    'from', 'down', 'back', 'after', 'before', 'while', 'because',
    'though', 'although', 'however', 'meanwhile', 'suddenly', 'finally',
    'again', 'never', 'always', 'perhaps', 'maybe', 'well', 'like',
    'said', 'asked', 'told', 'knew', 'thought', 'looked', 'seemed',
    'felt', 'took', 'made', 'came', 'went', 'got', 'put', 'let',
    'going', 'being', 'having', 'than', 'been', 'done', 'want', 'need',
    'know', 'think', 'come', 'give', 'take', 'tell', 'really', 'quite',
    'rather', 'instead', 'already', 'almost', 'about', 'around', 'along',
    'inside', 'outside', 'without', 'between', 'nothing', 'something',
    'everything', 'anything', 'everyone', 'someone', 'anyone', 'another',
    'chapter', 'part', 'book', 'page', 'professor', 'lord', 'lady',
    'king', 'queen', 'prince', 'princess', 'sir', 'madam', 'mister',
]);

function findLastNameInText(text) {
    if (!text) return null;
    const re = /\b([A-Z][a-z]{2,})\b/g;
    const candidates = [];
    let m;
    while ((m = re.exec(text))) {
        const word = m[1];
        if (COMMON_NON_NAMES.has(word.toLowerCase())) continue;
        candidates.push(word);
    }
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

// ── Gender heuristic ───────────────────────────────────────

const MALE_NAMES = new Set([
    'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
    'thomas', 'charles', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven',
    'andrew', 'paul', 'joshua', 'kenneth', 'kevin', 'brian', 'george', 'timothy',
    'edward', 'ronald', 'jason', 'jeffrey', 'ryan', 'jacob', 'nicholas', 'gary',
    'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon', 'benjamin',
    'samuel', 'raymond', 'gregory', 'frank', 'alexander', 'patrick', 'jack', 'dennis',
    'peter', 'harry', 'henry', 'arthur', 'max', 'tom', 'bob', 'jim', 'joe', 'sam',
    'ben', 'charlie', 'luke', 'oliver', 'noah', 'ethan', 'mason', 'logan', 'liam',
    'aiden', 'elijah', 'sebastian', 'caleb', 'owen', 'nathan', 'gabriel', 'isaac',
    'connor', 'dylan', 'wyatt', 'ian', 'leo', 'adam', 'aaron', 'alex', 'finn',
    'hunter', 'kai', 'miles', 'theo', 'felix', 'marcus', 'victor', 'hugo', 'oscar',
]);

const FEMALE_NAMES = new Set([
    'mary', 'patricia', 'jennifer', 'linda', 'barbara', 'elizabeth', 'susan',
    'jessica', 'sarah', 'karen', 'lisa', 'nancy', 'betty', 'margaret', 'sandra',
    'ashley', 'dorothy', 'kimberly', 'emily', 'donna', 'michelle', 'carol',
    'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura',
    'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela',
    'emma', 'nicole', 'helen', 'samantha', 'katherine', 'christine', 'debra',
    'rachel', 'carolyn', 'janet', 'catherine', 'maria', 'heather', 'diane',
    'ruth', 'julie', 'olivia', 'joyce', 'virginia', 'victoria', 'kelly', 'lauren',
    'christina', 'joan', 'evelyn', 'judith', 'megan', 'andrea', 'cheryl', 'hannah',
    'jacqueline', 'martha', 'gloria', 'teresa', 'ann', 'sara', 'madison', 'frances',
    'kathryn', 'janice', 'jean', 'abigail', 'alice', 'judy', 'sophia', 'grace',
    'denise', 'amber', 'doris', 'marilyn', 'danielle', 'beverly', 'isabella',
    'theresa', 'diana', 'natalie', 'brittany', 'charlotte', 'marie', 'kayla', 'alexis',
    'lori', 'jane', 'lucy', 'lily', 'rose', 'ella', 'claire', 'violet', 'ivy',
    'luna', 'stella', 'maya', 'aurora', 'chloe', 'zoe', 'mia', 'nora', 'elena',
]);

function guessGender(name) {
    if (!name) return 'unknown';
    const lower = name.toLowerCase().trim();
    if (MALE_NAMES.has(lower)) return 'male';
    if (FEMALE_NAMES.has(lower)) return 'female';
    return 'unknown';
}

// Also check pronouns in surrounding context
function guessGenderFromContext(name, fullText) {
    if (!name || !fullText) return 'unknown';

    // Look for "he said" / "she said" near the name
    const nameIdx = fullText.indexOf(name);
    if (nameIdx === -1) return 'unknown';

    // Check 200 chars around the name mention
    const start = Math.max(0, nameIdx - 200);
    const end = Math.min(fullText.length, nameIdx + name.length + 200);
    const context = fullText.substring(start, end).toLowerCase();

    const malePronouns = (context.match(/\bhe\b|\bhis\b|\bhim\b|\bhimself\b/g) || []).length;
    const femalePronouns = (context.match(/\bshe\b|\bher\b|\bhers\b|\bherself\b/g) || []).length;

    if (malePronouns > femalePronouns + 1) return 'male';
    if (femalePronouns > malePronouns + 1) return 'female';
    return 'unknown';
}

// ── Main parser ────────────────────────────────────────────

/**
 * Parse segments to identify dialogue, speakers, and genders.
 *
 * @param {Array} segments — from createTtsSegments()
 * @returns {{ segments: Array, characters: Object }}
 */
export function parseDialogue(segments) {
    const characters = {};
    const fullText = segments.map(s => s.text).join(' ');
    const enhanced = [];

    let lastSpeaker1 = null; // most recent speaker
    let lastSpeaker2 = null; // second-most recent (for turn-taking)
    let chapterPovName = null; // POV character from chapter start

    // ── Detect POV chapter start ──
    // If first segment is very short (just a name), it's likely a POV indicator
    if (segments.length > 1 && segments[0].text.length < 30) {
        const first = segments[0].text.trim();
        // Single word or "First Last", all caps or title case, and is a plausible name
        if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/.test(first) &&
            !COMMON_NON_NAMES.has(first.toLowerCase())) {
            chapterPovName = first.split(/\s+/)[0]; // use first name
            // Register as character
            if (!characters[chapterPovName]) {
                let gender = guessGender(chapterPovName);
                if (gender === 'unknown') gender = guessGenderFromContext(chapterPovName, fullText);
                characters[chapterPovName] = { gender, count: 0 };
            }
        }
    }

    for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx];
        const result = { ...seg, segType: seg.segType || 'text', speaker: null, gender: null };

        if (seg.segType === 'heading') {
            result.segType = 'narration';
            enhanced.push(result);
            continue;
        }

        // ── Check for quoted speech (complete OR partial quotes) ──
        let hasDialogue = false;

        // Check complete quoted pairs
        for (const pattern of QUOTE_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(seg.text)) {
                hasDialogue = true;
                break;
            }
        }

        // Also detect partial quotes (sentence was split mid-dialogue)
        if (!hasDialogue) {
            const t = seg.text.trim();
            const OPEN_CHARS = /^["\u201C\u00AB\u2018]/;
            const CLOSE_CHARS = /["\u201D\u00BB\u2019][.,!?;:\s]*$/;
            // Starts with opening quote
            if (OPEN_CHARS.test(t)) hasDialogue = true;
            // Ends with closing quote (but not an apostrophe mid-word)
            else if (CLOSE_CHARS.test(t) && !/\w['\u2019]\s*$/.test(t)) hasDialogue = true;
            // Previous segment was dialogue and this looks like continuation
            else if (idx > 0 && enhanced[idx - 1]?.segType === 'dialogue' &&
                     !/^[A-Z][a-z]+ (said|asked|replied|whispered|shouted)/.test(t)) {
                // Check if previous segment ended without closing its quote
                const prevText = enhanced[idx - 1]?.text || '';
                const openCount = (prevText.match(/["\u201C\u00AB]/g) || []).length;
                const closeCount = (prevText.match(/["\u201D\u00BB]/g) || []).length;
                if (openCount > closeCount) hasDialogue = true;
            }
        }

        if (!hasDialogue) {
            result.segType = 'narration';
            enhanced.push(result);
            continue;
        }

        result.segType = 'dialogue';

        // ── Speaker attribution (multiple methods, confidence order) ──
        let speaker = null;
        let match;

        // Method 1: "said John" / "John said"
        ATTRIBUTION_AFTER.lastIndex = 0;
        match = ATTRIBUTION_AFTER.exec(seg.text);
        if (match?.[1]) speaker = match[1].trim();

        if (!speaker) {
            ATTRIBUTION_BEFORE.lastIndex = 0;
            match = ATTRIBUTION_BEFORE.exec(seg.text);
            if (match?.[1]) speaker = match[1].trim();
        }

        // Method 2: "Briar's bellowing" (possessive + voice noun)
        if (!speaker) {
            POSSESSIVE_ATTR.lastIndex = 0;
            match = POSSESSIVE_ATTR.exec(seg.text);
            if (match?.[1]) speaker = match[1].trim();
        }

        // Method 3: Name before the opening quote in same segment
        if (!speaker) {
            const quoteIdx = seg.text.search(/["\u201C\u00AB\u2018]/);
            if (quoteIdx > 2) {
                speaker = findLastNameInText(seg.text.substring(0, quoteIdx));
            }
        }

        // Method 4: Name or possessive in previous narration
        if (!speaker && idx > 0) {
            const prev = enhanced[idx - 1];
            if (prev?.segType === 'narration') {
                POSSESSIVE_ATTR.lastIndex = 0;
                match = POSSESSIVE_ATTR.exec(prev.text);
                if (match?.[1]) {
                    speaker = match[1].trim();
                } else {
                    speaker = findLastNameInText(prev.text);
                }
            }
        }

        // Method 5: Continuation from previous dialogue
        if (!speaker && idx > 0) {
            const prev = enhanced[idx - 1];
            if (prev?.speaker && prev.segType === 'dialogue') {
                speaker = prev.speaker;
            }
        }

        // Method 6: Turn-taking (alternate between last two known speakers)
        if (!speaker && lastSpeaker1 && lastSpeaker2 && lastSpeaker1 !== lastSpeaker2) {
            for (let k = idx - 1; k >= Math.max(0, idx - 5); k--) {
                if (enhanced[k].segType === 'dialogue' && enhanced[k].speaker) {
                    speaker = enhanced[k].speaker === lastSpeaker1 ? lastSpeaker2 : lastSpeaker1;
                    break;
                }
            }
        }

        // ── Validate speaker ──
        if (speaker) {
            speaker = speaker.replace(/^the\s+/i, '');
            if (speaker.length < 2 || /^(The|But|And|Then|With|That|This|What|How|His|Her|Its)$/i.test(speaker)) {
                speaker = null;
            }
        }

        if (speaker) {
            result.speaker = speaker;

            if (!characters[speaker]) {
                let gender = guessGender(speaker);
                if (gender === 'unknown') gender = guessGenderFromContext(speaker, fullText);
                characters[speaker] = { gender, count: 0 };
            }
            characters[speaker].count++;
            result.gender = characters[speaker].gender;

            // Update turn-taking trackers
            if (speaker !== lastSpeaker1) {
                lastSpeaker2 = lastSpeaker1;
                lastSpeaker1 = speaker;
            }
        }

        enhanced.push(result);
    }

    return { segments: enhanced, characters };
}

/**
 * Assign Edge TTS voices to characters based on gender.
 * Returns a stable mapping: { characterName: voiceId }
 *
 * @param {Object} characters — { name: { gender, count } }
 * @param {Array} availableVoices — [{ id, gender, ... }]
 * @param {string} narratorVoice — voice ID for narrator
 * @returns {Object} — { characterName: voiceId }
 */
export function assignVoicesToCharacters(characters, availableVoices, narratorVoice) {
    const assignment = {};
    const maleVoices = availableVoices.filter(v => v.gender === 'male');
    const femaleVoices = availableVoices.filter(v => v.gender === 'female');
    let maleIdx = 0;
    let femaleIdx = 0;
    let unknownIdx = 0;

    // Sort characters by frequency (most common first gets best voice)
    const sorted = Object.entries(characters)
        .sort((a, b) => b[1].count - a[1].count);

    for (const [name, info] of sorted) {
        if (info.gender === 'female' && femaleVoices.length > 0) {
            assignment[name] = femaleVoices[femaleIdx % femaleVoices.length].id;
            femaleIdx++;
        } else if (info.gender === 'male' && maleVoices.length > 0) {
            assignment[name] = maleVoices[maleIdx % maleVoices.length].id;
            maleIdx++;
        } else {
            // Unknown gender — alternate between male and female voices
            const pool = unknownIdx % 2 === 0 ? maleVoices : femaleVoices;
            const poolIdx = Math.floor(unknownIdx / 2);
            if (pool.length > 0) {
                assignment[name] = pool[poolIdx % pool.length].id;
            } else if (availableVoices.length > 0) {
                assignment[name] = availableVoices[unknownIdx % availableVoices.length].id;
            }
            unknownIdx++;
        }
    }

    return assignment;
}
