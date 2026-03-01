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
    const characters = {}; // { name: { gender, count } }
    const fullText = segments.map(s => s.text).join(' ');

    const enhanced = segments.map((seg, idx) => {
        const result = { ...seg, segType: seg.segType || 'text', speaker: null, gender: null };

        // Skip headings — they're always narration
        if (seg.segType === 'heading') {
            result.segType = 'narration';
            return result;
        }

        // Check if segment contains quoted speech
        let hasDialogue = false;
        for (const pattern of QUOTE_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(seg.text)) {
                hasDialogue = true;
                break;
            }
        }

        if (!hasDialogue) {
            result.segType = 'narration';
            return result;
        }

        result.segType = 'dialogue';

        // Try to find speaker attribution
        let speaker = null;

        // Check "said John" pattern
        ATTRIBUTION_AFTER.lastIndex = 0;
        let match = ATTRIBUTION_AFTER.exec(seg.text);
        if (match) speaker = match[1]?.trim();

        // Check "John said" pattern
        if (!speaker) {
            ATTRIBUTION_BEFORE.lastIndex = 0;
            match = ATTRIBUTION_BEFORE.exec(seg.text);
            if (match) speaker = match[1]?.trim();
        }

        // Filter out articles that got captured
        if (speaker) {
            speaker = speaker.replace(/^the\s+/i, '');
        }

        // Skip unlikely "names" (too short, common words)
        if (speaker && (speaker.length < 2 || /^(The|But|And|Then|With|That|This|What|How|His|Her|Its)$/i.test(speaker))) {
            speaker = null;
        }

        if (speaker) {
            result.speaker = speaker;

            // Register character
            if (!characters[speaker]) {
                let gender = guessGender(speaker);
                if (gender === 'unknown') {
                    gender = guessGenderFromContext(speaker, fullText);
                }
                characters[speaker] = { gender, count: 0 };
            }
            characters[speaker].count++;
            result.gender = characters[speaker].gender;
        } else {
            // No speaker found — check if previous segment had a speaker (continuation)
            if (idx > 0) {
                const prev = enhanced[idx - 1];
                if (prev?.speaker && prev.segType === 'dialogue') {
                    // Likely continuation of same speaker's dialogue
                    result.speaker = prev.speaker;
                    result.gender = prev.gender;
                    if (characters[prev.speaker]) characters[prev.speaker].count++;
                }
            }
        }

        return result;
    });

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
