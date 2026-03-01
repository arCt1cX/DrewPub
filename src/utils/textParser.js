/**
 * textParser.js — Parses chapter text into segments (narration / dialogue)
 * with speaker attribution and gender detection.
 */

// Common English gendered first names for heuristic gender guessing
const MALE_NAMES = new Set([
    'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles',
    'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul', 'andrew', 'joshua',
    'kenneth', 'kevin', 'brian', 'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan',
    'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon',
    'benjamin', 'samuel', 'raymond', 'gregory', 'frank', 'alexander', 'patrick', 'jack', 'henry', 'peter',
    'harry', 'arthur', 'tom', 'ben', 'luke', 'sam', 'max', 'alex', 'adam', 'nathan', 'ethan', 'noah',
    'oliver', 'leo', 'oscar', 'charlie', 'freddie', 'alfie', 'archie', 'edmund', 'felix', 'hugo',
    'sebastian', 'theodore', 'vincent', 'simon', 'philip', 'martin', 'roger', 'stanley', 'bruce', 'alan',
    'carl', 'ralph', 'roy', 'eugene', 'russell', 'bobby', 'howard', 'fred', 'albert', 'clarence',
    'aragorn', 'frodo', 'gandalf', 'legolas', 'gimli', 'boromir', 'faramir', 'saruman', 'sauron',
    'bilbo', 'samwise', 'pippin', 'merry', 'dumbledore', 'snape', 'voldemort', 'draco', 'ron', 'neville',
]);

const FEMALE_NAMES = new Set([
    'mary', 'patricia', 'jennifer', 'linda', 'barbara', 'elizabeth', 'susan', 'jessica', 'sarah', 'karen',
    'lisa', 'nancy', 'betty', 'margaret', 'sandra', 'ashley', 'dorothy', 'kimberly', 'emily', 'donna',
    'michelle', 'carol', 'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura',
    'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela', 'emma', 'nicole',
    'helen', 'samantha', 'katherine', 'christine', 'debra', 'rachel', 'carolyn', 'janet', 'catherine',
    'maria', 'heather', 'diane', 'ruth', 'julie', 'olivia', 'joyce', 'virginia', 'victoria', 'kelly',
    'lauren', 'christina', 'joan', 'evelyn', 'judith', 'andrea', 'hannah', 'megan', 'cheryl', 'jacqueline',
    'martha', 'gloria', 'teresa', 'ann', 'sara', 'madison', 'frances', 'kathryn', 'janice', 'jean',
    'abigail', 'alice', 'judy', 'sophia', 'grace', 'denise', 'amber', 'doris', 'marilyn', 'danielle',
    'beverly', 'isabella', 'theresa', 'diana', 'natalie', 'brittany', 'charlotte', 'marie', 'kayla', 'alexis',
    'arwen', 'galadriel', 'eowyn', 'hermione', 'ginny', 'luna', 'bellatrix', 'minerva', 'molly', 'lily',
]);

/**
 * Parse raw chapter text into an array of segments.
 * Each segment: { type: 'narration'|'dialogue', text: string, speaker: string|null, gender: 'male'|'female'|'unknown' }
 */
export function parseChapterText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    const segments = [];
    // Match dialogue in various quote styles
    const dialogueRegex = /([""«])([\s\S]*?)([""»])/g;

    let lastIndex = 0;
    let match;

    while ((match = dialogueRegex.exec(rawText)) !== null) {
        // Narration before this dialogue
        if (match.index > lastIndex) {
            const narration = rawText.substring(lastIndex, match.index).trim();
            if (narration) {
                segments.push({
                    type: 'narration',
                    text: narration,
                    speaker: null,
                    gender: 'unknown',
                });
            }
        }

        const dialogueText = match[2].trim();
        if (dialogueText) {
            // Try to attribute speaker from surrounding context
            const contextAfter = rawText.substring(match.index + match[0].length, match.index + match[0].length + 150);
            const contextBefore = rawText.substring(Math.max(0, match.index - 150), match.index);
            const { speaker, gender } = attributeSpeaker(contextBefore, contextAfter, dialogueText);

            segments.push({
                type: 'dialogue',
                text: dialogueText,
                speaker,
                gender,
            });
        }

        lastIndex = match.index + match[0].length;
    }

    // Remaining narration after last dialogue
    if (lastIndex < rawText.length) {
        const remaining = rawText.substring(lastIndex).trim();
        if (remaining) {
            segments.push({
                type: 'narration',
                text: remaining,
                speaker: null,
                gender: 'unknown',
            });
        }
    }

    // If no dialogue was found, just split narration into manageable chunks
    if (segments.length === 0 && rawText.trim()) {
        segments.push({
            type: 'narration',
            text: rawText.trim(),
            speaker: null,
            gender: 'unknown',
        });
    }

    return segments;
}

/**
 * Try to detect the speaker and gender from surrounding text context.
 */
function attributeSpeaker(before, after, dialogueText) {
    let speaker = null;
    let gender = 'unknown';

    // Pattern 1: "text," said CharacterName / "text," CharacterName said
    const afterPatterns = [
        /^\s*[,.]?\s*(?:said|asked|replied|whispered|shouted|cried|exclaimed|muttered|murmured|called|yelled|screamed|answered|responded|continued|added|insisted|demanded|suggested|explained|warned|promised|admitted|declared|announced|sighed|groaned|laughed|snapped|hissed|growled|barked|roared|bellowed|gasped|breathed|pleaded|begged|urged|commanded|ordered|interrupted|protested|objected|agreed|conceded|acknowledged|noted|observed|remarked|commented|mentioned)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
        /^\s*[,.]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:said|asked|replied|whispered|shouted|cried|exclaimed|muttered|murmured|called|yelled|screamed|answered|responded|continued|added|insisted|demanded|suggested|explained|warned|promised|admitted|declared|announced|sighed|groaned|laughed|snapped|hissed|growled|barked|roared|bellowed|gasped|breathed|pleaded|begged|urged|commanded|ordered|interrupted|protested|objected|agreed|conceded|acknowledged|noted|observed|remarked|commented|mentioned)/i,
    ];

    for (const pattern of afterPatterns) {
        const m = after.match(pattern);
        if (m && m[1]) {
            speaker = m[1].trim();
            break;
        }
    }

    // Pattern 2: CharacterName said, "text"
    if (!speaker) {
        const beforePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:said|asked|replied|whispered|shouted|cried|exclaimed|muttered|murmured|called|yelled|screamed|answered|responded|continued|added|insisted|demanded|suggested|explained|warned|promised)\s*[,:]\s*$/i;
        const m = before.match(beforePattern);
        if (m && m[1]) {
            speaker = m[1].trim();
        }
    }

    // Determine gender
    if (speaker) {
        gender = guessGender(speaker, before + ' ' + after);
    } else {
        // No speaker found — try gender from context pronouns
        gender = guessGenderFromPronouns(before + ' ' + after);
    }

    return { speaker, gender };
}

/**
 * Guess gender from a character name, then fall back to context pronouns.
 */
function guessGender(name, context) {
    const firstName = name.split(/\s+/)[0].toLowerCase();

    if (MALE_NAMES.has(firstName)) return 'male';
    if (FEMALE_NAMES.has(firstName)) return 'female';

    // Fallback to pronouns near the name in context
    return guessGenderFromPronouns(context);
}

/**
 * Guess gender purely from pronoun frequency in surrounding context.
 */
function guessGenderFromPronouns(context) {
    const lower = context.toLowerCase();
    const malePronouns = (lower.match(/\b(he|him|his|himself)\b/g) || []).length;
    const femalePronouns = (lower.match(/\b(she|her|hers|herself)\b/g) || []).length;

    if (malePronouns > femalePronouns) return 'male';
    if (femalePronouns > malePronouns) return 'female';
    return 'unknown';
}

/**
 * Split a long text into sentences (for TTS chunking).
 * Each sentence is a natural pause point.
 */
export function splitIntoSentences(text) {
    if (!text) return [];
    // Split on sentence-ending punctuation followed by space or end of string
    const raw = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g) || [text];
    return raw.map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Build TTS-ready chunks from segments.
 * Returns an array of { text, voiceType: 'narrator'|'male'|'female', speaker }
 * Each chunk is a sentence or short passage suitable for one TTS API call.
 */
export function buildTTSChunks(segments) {
    const chunks = [];

    for (const seg of segments) {
        const voiceType = seg.type === 'dialogue'
            ? (seg.gender === 'female' ? 'female' : seg.gender === 'male' ? 'male' : 'narrator')
            : 'narrator';

        const sentences = splitIntoSentences(seg.text);
        for (const sentence of sentences) {
            // Google Cloud TTS has a 5000 byte limit per request
            // Split further if a sentence is too long
            if (new Blob([sentence]).size > 4500) {
                const parts = splitLongText(sentence, 4000);
                for (const part of parts) {
                    chunks.push({
                        text: part,
                        voiceType,
                        speaker: seg.speaker,
                    });
                }
            } else {
                chunks.push({
                    text: sentence,
                    voiceType,
                    speaker: seg.speaker,
                });
            }
        }
    }

    return chunks;
}

/**
 * Split text that exceeds byte limits into smaller parts at word boundaries.
 */
function splitLongText(text, maxBytes) {
    const words = text.split(/\s+/);
    const parts = [];
    let current = '';

    for (const word of words) {
        const candidate = current ? current + ' ' + word : word;
        if (new Blob([candidate]).size > maxBytes && current) {
            parts.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }

    if (current) parts.push(current);
    return parts;
}
