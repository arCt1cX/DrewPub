/**
 * Cloudflare Pages Function: /api/analyze-dialogue
 *
 * Uses Workers AI (bound as `AI`) to identify speakers in dialogue segments.
 *
 * POST /api/analyze-dialogue
 *   Body: { segments: [ { text, segType, speaker?, index } ], knownCharacters: { name: { gender } } }
 *   Returns: { speakers: [ { index, speaker, gender } ] }
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// Words that should never be identified as character names
const NON_CHARACTER_WORDS = new Set([
    'the', 'but', 'and', 'then', 'with', 'that', 'this', 'what', 'how',
    'his', 'her', 'its', 'she', 'he', 'they', 'you', 'not', 'one',
    'whatever', 'nothing', 'something', 'everything', 'everyone', 'someone',
    'anyone', 'nobody', 'nowhere', 'somehow', 'yes', 'no', 'ok', 'okay',
    'well', 'hey', 'oh', 'ah', 'hmm', 'huh', 'ugh', 'wow', 'here', 'there',
    'where', 'when', 'how', 'what', 'why', 'who', 'whom', 'whose',
    'north', 'south', 'east', 'west', 'castle', 'tower', 'forest', 'city',
    'town', 'village', 'kingdom', 'realm', 'island', 'valley', 'mountain',
    'hall', 'house', 'inn', 'tavern', 'bridge', 'gate', 'road', 'street',
    'temple', 'church', 'palace', 'court', 'garden', 'library', 'school',
    'cave', 'mine', 'farm', 'port', 'bay', 'cliff', 'hill', 'peak', 'fort',
    'chapter', 'part', 'book', 'page', 'narrator', 'unknown', 'none',
]);

function isNonCharacterName(name) {
    if (!name || name.trim().length < 2) return true;
    const lower = name.trim().toLowerCase();
    if (NON_CHARACTER_WORDS.has(lower)) return true;
    if (/^\d/.test(name)) return true;           // starts with digit
    if (/^(the|a|an)\s/i.test(name)) return true; // "the X", "a X"
    if (name.trim().length === 1) return true;     // single char
    return false;
}

export async function onRequestOptions() {
    return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
    try {
        const ai = context.env.AI;
        if (!ai) {
            return Response.json(
                { error: 'AI binding not configured' },
                { status: 500, headers: CORS }
            );
        }

        const body = await context.request.json();
        const { segments, knownCharacters } = body;

        if (!segments || !Array.isArray(segments) || segments.length === 0) {
            return Response.json(
                { error: 'No segments provided' },
                { status: 400, headers: CORS }
            );
        }

        // Build a compact representation of dialogue segments that need speaker identification
        const dialogueSegments = segments.filter(s => s.segType === 'dialogue');

        if (dialogueSegments.length === 0) {
            return Response.json({ speakers: [] }, { headers: CORS });
        }

        // Build context window — include surrounding narration for each dialogue
        const contextChunks = [];
        for (const seg of dialogueSegments) {
            const idx = seg.index;
            // Get 1 segment before and after for context
            const before = segments.find(s => s.index === idx - 1);
            const after = segments.find(s => s.index === idx + 1);

            let context = '';
            if (before) context += before.text + ' ';
            context += seg.text;
            if (after) context += ' ' + after.text;

            contextChunks.push({
                index: seg.index,
                existingSpeaker: seg.speaker || null,
                context: context.substring(0, 500), // limit context size
            });
        }

        const knownList = knownCharacters
            ? Object.entries(knownCharacters).map(([name, info]) => `${name} (${info.gender || 'unknown'})`).join(', ')
            : 'none yet';

        // Batch into groups of max 15 to stay within token limits
        const BATCH_SIZE = 15;
        const allResults = [];

        for (let b = 0; b < contextChunks.length; b += BATCH_SIZE) {
            const batch = contextChunks.slice(b, b + BATCH_SIZE);

            const numberedLines = batch.map((c, i) =>
                `[${i}] ${c.existingSpeaker ? `(attributed: ${c.existingSpeaker}) ` : ''}${c.context}`
            ).join('\n');

            const prompt = `You are a literary dialogue analyst. Given numbered text excerpts from a novel, identify WHO is speaking in each quoted dialogue.

Known characters so far: ${knownList}

Rules:
- Return ONLY a JSON array, no explanation
- Each element: {"i": <number>, "speaker": "<name>", "gender": "male"|"female"|"unknown"}
- Use the character's PROPER NAME with correct capitalization (e.g., "Regis" not "regis" or "REGIS")
- ONLY identify actual CHARACTERS (people/beings who speak). Do NOT include:
  * Place names (cities, countries, buildings, forests, mountains, etc.)
  * Common words or non-name words (e.g., "Whatever", "Nothing", "Something")
  * Titles without names (e.g., just "Lord" or "Professor")
  * Objects, concepts, or abstract nouns
- If a character has already been identified, always use the EXACT SAME spelling
- If you cannot determine the speaker, use "speaker": null (do NOT guess random words)
- Detect gender from context clues (pronouns, titles, descriptions)
- Pay attention to dialogue tags like "said", "asked" etc. AND contextual clues

Excerpts:
${numberedLines}

JSON array:`;

            try {
                const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
                    messages: [
                        { role: 'system', content: 'You are a precise JSON-only dialogue analyst. Always respond with valid JSON arrays only, no markdown, no explanation.' },
                        { role: 'user', content: prompt },
                    ],
                    max_tokens: 1024,
                    temperature: 0.1,
                });

                const text = (response.response || '').trim();

                // Extract JSON array from response
                const jsonMatch = text.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        for (const item of parsed) {
                            if (typeof item.i === 'number' && item.i >= 0 && item.i < batch.length) {
                                let speaker = item.speaker ? item.speaker.trim() : null;

                                // Normalize name casing
                                if (speaker) {
                                    if (speaker === speaker.toUpperCase() || speaker === speaker.toLowerCase()) {
                                        speaker = speaker.split(/\s+/).map(w =>
                                            w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                                        ).join(' ');
                                    }
                                }

                                // Filter out obvious non-character names
                                if (speaker && isNonCharacterName(speaker)) {
                                    speaker = null;
                                }

                                allResults.push({
                                    index: batch[item.i].index,
                                    speaker: speaker,
                                    gender: ['male', 'female'].includes(item.gender) ? item.gender : 'unknown',
                                });
                            }
                        }
                    } catch {
                        console.warn('[AI] Failed to parse batch JSON:', text.substring(0, 200));
                    }
                }
            } catch (aiErr) {
                console.warn('[AI] Batch inference failed:', aiErr.message);
                // Continue with other batches
            }
        }

        return Response.json({ speakers: allResults }, { headers: CORS });

    } catch (err) {
        console.error('[AI] analyze-dialogue error:', err);
        return Response.json(
            { error: err.message || 'Analysis failed' },
            { status: 500, headers: CORS }
        );
    }
}
