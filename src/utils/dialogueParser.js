/**
 * Dialogue Parser — analyzes text to identify narration vs dialogue,
 * attribute speakers, and infer character gender.
 * Works entirely client-side with regex heuristics.
 */

// Common speech verbs for dialogue attribution
const SPEECH_VERBS = [
    'said', 'asked', 'replied', 'shouted', 'whispered', 'muttered', 'exclaimed',
    'called', 'cried', 'yelled', 'answered', 'spoke', 'murmured', 'growled',
    'snapped', 'sighed', 'laughed', 'screamed', 'demanded', 'pleaded', 'added',
    'continued', 'began', 'interrupted', 'offered', 'suggested', 'insisted',
    'warned', 'agreed', 'admitted', 'announced', 'argued', 'begged', 'claimed',
    'commented', 'complained', 'concluded', 'confirmed', 'declared', 'denied',
    'explained', 'gasped', 'groaned', 'guessed', 'hissed', 'howled', 'joked',
    'moaned', 'noted', 'objected', 'observed', 'ordered', 'pointed', 'promised',
    'proposed', 'protested', 'recalled', 'remarked', 'repeated', 'responded',
    'revealed', 'roared', 'sobbed', 'stammered', 'stated', 'stuttered', 'urged',
    'wailed', 'wondered', 'mused', 'conceded', 'retorted', 'breathed', 'chuckled',
    'grinned', 'smirked', 'scoffed', 'teased', 'taunted', 'cooed',
];

const SPEECH_VERB_PATTERN = SPEECH_VERBS.join('|');

// Regex for finding dialogue quotes — supports "", "", '', «»
const DIALOGUE_PATTERNS = [
    /\u201c([^\u201d]+)\u201d/g,               // "..." (smart quotes)
    /\u201e([^\u201c\u201d]+)\u201d/g,          // „..." (German/some European)
    /\u00ab([^\u00bb]+)\u00bb/g,                // «...» (French/Italian)
    /"([^"]+)"/g,                                // "..." (straight quotes)
];

// Common female names/patterns (English literature)
const FEMALE_INDICATORS = new Set([
    'she', 'her', 'herself', 'hers',
    'woman', 'girl', 'lady', 'queen', 'princess', 'duchess', 'empress',
    'mother', 'mom', 'mum', 'daughter', 'sister', 'aunt', 'grandmother',
    'mrs', 'miss', 'ms', 'madam', 'ma\'am', 'mistress',
]);

// Common male names/patterns (English literature)
const MALE_INDICATORS = new Set([
    'he', 'him', 'himself', 'his',
    'man', 'boy', 'gentleman', 'king', 'prince', 'duke', 'emperor',
    'father', 'dad', 'son', 'brother', 'uncle', 'grandfather',
    'mr', 'sir', 'lord', 'master',
]);

/**
 * Parse text segments to identify dialogue, speakers, and gender.
 * @param {Array<{ text: string, element: Element, type: string }>} segments
 * @returns {{ segments: Array<ParsedSegment>, characters: Object }}
 *
 * ParsedSegment: { text, type: 'narration'|'dialogue'|'mixed', speaker, gender, element }
 */
export function parseDialogue(segments) {
    const characters = {};      // name → { gender, count, voiceAssigned }
    let lastSpeaker = null;
    let lastGender = null;

    const parsed = segments.map((seg, idx) => {
        const { text, element, type: blockType } = seg;

        // Check if this segment contains dialogue
        const dialogueInfo = extractDialogue(text);

        if (!dialogueInfo.hasDialogue) {
            // Pure narration
            return {
                ...seg,
                segType: 'narration',
                speaker: null,
                gender: null,
            };
        }

        // Try to find the speaker
        const attribution = findAttribution(text, idx, segments);
        let speaker = attribution.speaker;
        let gender = attribution.gender;

        // If no speaker found, try to infer from context
        if (!speaker && dialogueInfo.hasDialogue) {
            // Alternate speakers heuristic: if last segment was dialogue by someone,
            // this might be the other person in a back-and-forth
            speaker = lastSpeaker ? `Speaker ${lastSpeaker === 'Speaker A' ? 'B' : 'A'}` : 'Speaker A';
        }

        // Update character tracking
        if (speaker && speaker !== 'Speaker A' && speaker !== 'Speaker B') {
            if (!characters[speaker]) {
                characters[speaker] = { gender: gender || 'unknown', count: 0 };
            }
            characters[speaker].count++;
            if (gender && gender !== 'unknown') {
                characters[speaker].gender = gender;
            }
            // Use stored gender if we detected it before
            if (characters[speaker].gender !== 'unknown') {
                gender = characters[speaker].gender;
            }
        }

        lastSpeaker = speaker;
        lastGender = gender;

        return {
            ...seg,
            segType: dialogueInfo.isPure ? 'dialogue' : 'mixed',
            speaker,
            gender: gender || 'unknown',
            dialogueText: dialogueInfo.dialogueText,
            narrationText: dialogueInfo.narrationText,
        };
    });

    // Second pass: resolve gender for characters found with pronouns nearby
    resolveGendersFromContext(parsed, characters);

    return { segments: parsed, characters };
}

/**
 * Check if text contains dialogue (quoted speech).
 */
function extractDialogue(text) {
    let hasDialogue = false;
    let dialogueText = '';
    let narrationText = text;

    for (const pattern of DIALOGUE_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            hasDialogue = true;
            dialogueText += (dialogueText ? ' ' : '') + match[1];
            narrationText = narrationText.replace(match[0], '').trim();
        }
        if (hasDialogue) break; // Use first matching pattern
    }

    // Check straight double quotes if no smart quotes found
    if (!hasDialogue) {
        const straightMatch = text.match(/"([^"]+)"/);
        if (straightMatch) {
            hasDialogue = true;
            dialogueText = straightMatch[1];
            narrationText = text.replace(straightMatch[0], '').trim();
        }
    }

    const isPure = hasDialogue && narrationText.length < 10;

    return { hasDialogue, dialogueText, narrationText, isPure };
}

/**
 * Find who is speaking in a text segment by analyzing attribution tags.
 */
function findAttribution(text, index, allSegments) {
    const verbPattern = new RegExp(
        `[\\u201c\\u201d""\\'\\u2018\\u2019][,.]?\\s*(\\w+)\\s+(${SPEECH_VERB_PATTERN})\\b`,
        'i'
    );
    const verbPatternBefore = new RegExp(
        `(\\w+)\\s+(${SPEECH_VERB_PATTERN})\\s*[,:]?\\s*[\\u201c"\\u2018]`,
        'i'
    );

    let speaker = null;
    let gender = null;

    // Pattern 1: "Hello," NAME said
    let match = text.match(verbPattern);
    if (match) {
        const word = match[1].toLowerCase();
        if (FEMALE_INDICATORS.has(word)) {
            gender = 'female';
        } else if (MALE_INDICATORS.has(word)) {
            gender = 'male';
        } else if (word[0] === word[0]?.toUpperCase?.() || /^[A-Z]/.test(match[1])) {
            speaker = match[1];
        }
        if (!speaker && (gender === 'female' || gender === 'male')) {
            // Look for a proper noun nearby
            const nameMatch = text.match(new RegExp(
                `(${gender === 'female' ? 'she|her' : 'he|him'}).*?\\b([A-Z][a-z]{2,})\\b|\\b([A-Z][a-z]{2,})\\b.*?(${gender === 'female' ? 'she|her' : 'he|him'})`,
                'i'
            ));
            if (nameMatch) {
                speaker = nameMatch[2] || nameMatch[3];
            }
        }
    }

    // Pattern 2: NAME said, "Hello"
    if (!speaker) {
        match = text.match(verbPatternBefore);
        if (match) {
            const word = match[1].toLowerCase();
            if (FEMALE_INDICATORS.has(word)) {
                gender = 'female';
            } else if (MALE_INDICATORS.has(word)) {
                gender = 'male';
            } else if (/^[A-Z]/.test(match[1])) {
                speaker = match[1];
            }
        }
    }

    // Infer gender from pronouns in surrounding text (same paragraph or nearby)
    if (speaker && !gender) {
        gender = inferGenderFromContext(text, speaker);
    }

    return { speaker, gender };
}

/**
 * Infer gender from pronoun usage near a character name.
 */
function inferGenderFromContext(text, name) {
    const namePos = text.toLowerCase().indexOf(name.toLowerCase());
    if (namePos === -1) return 'unknown';

    // Look for pronouns near the name (within ~100 chars)
    const context = text.substring(
        Math.max(0, namePos - 100),
        Math.min(text.length, namePos + name.length + 100)
    ).toLowerCase();

    const femaleCount = (context.match(/\bshe\b|\bher\b|\bherself\b/g) || []).length;
    const maleCount = (context.match(/\bhe\b|\bhis\b|\bhim\b|\bhimself\b/g) || []).length;

    if (femaleCount > maleCount) return 'female';
    if (maleCount > femaleCount) return 'male';
    return 'unknown';
}

/**
 * Second pass to resolve unknown genders from cross-paragraph context.
 */
function resolveGendersFromContext(parsed, characters) {
    for (const seg of parsed) {
        if (seg.speaker && characters[seg.speaker]?.gender === 'unknown') {
            // Search surrounding segments for pronoun clues
            const nearbyText = parsed
                .filter(s => s.speaker === seg.speaker)
                .map(s => s.text)
                .join(' ');

            const gender = inferGenderFromContext(nearbyText, seg.speaker);
            if (gender !== 'unknown') {
                characters[seg.speaker].gender = gender;
            }
        }
    }

    // Update segments with resolved genders
    for (const seg of parsed) {
        if (seg.speaker && characters[seg.speaker]) {
            seg.gender = characters[seg.speaker].gender;
        }
    }
}

/**
 * Assign voices to characters based on gender and character importance.
 * @param {Object} characters — { name: { gender, count } }
 * @param {Array} availableVoices — [{ id, name, gender: 'male'|'female', style }]
 * @param {string} narratorVoiceId — voice ID for the narrator
 * @returns {Object} — { characterName: voiceId, __narrator__: voiceId }
 */
export function assignVoicesToCharacters(characters, availableVoices, narratorVoiceId) {
    const assignment = { __narrator__: narratorVoiceId };

    const maleVoices = availableVoices.filter(v => v.gender === 'male');
    const femaleVoices = availableVoices.filter(v => v.gender === 'female');

    // Sort characters by frequency (most important first)
    const sorted = Object.entries(characters)
        .sort((a, b) => b[1].count - a[1].count);

    let maleIdx = 0;
    let femaleIdx = 0;

    for (const [name, info] of sorted) {
        if (info.gender === 'female' && femaleVoices.length > 0) {
            assignment[name] = femaleVoices[femaleIdx % femaleVoices.length].id;
            femaleIdx++;
        } else if (info.gender === 'male' && maleVoices.length > 0) {
            assignment[name] = maleVoices[maleIdx % maleVoices.length].id;
            maleIdx++;
        } else {
            // Unknown gender — alternate between male and female voices
            const allDialogueVoices = [...maleVoices, ...femaleVoices];
            if (allDialogueVoices.length > 0) {
                assignment[name] = allDialogueVoices[(maleIdx + femaleIdx) % allDialogueVoices.length].id;
                maleIdx++;
            }
        }
    }

    return assignment;
}
