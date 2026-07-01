/**
 * Cloudflare Pages Function: /api/analyze-dialogue
 *
 * Identifies who speaks each line of dialogue in a chapter using Google
 * Gemini (free tier). The whole chapter is sent in a single request so the
 * model has full context to resolve speakers across long exchanges — far more
 * reliable than the previous per-line Workers-AI approach.
 *
 * POST /api/analyze-dialogue
 *   Body: { segments: [ { text, segType, speaker?, index } ], knownCharacters: { name: { gender } } }
 *   Returns: { speakers: [ { index, speaker, gender } ] }   // one entry per dialogue segment
 *
 * Environment variable:
 *   GEMINI_API_KEY — Google AI Studio API key (starts with "AIza…")
 *   GEMINI_MODEL   — optional, defaults to "gemini-2.5-flash"
 *
 * If the key is missing or Gemini fails the endpoint returns an error and the
 * client silently falls back to its local regex attribution.
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// Words that should never be identified as character names (last-line defense
// against the model returning a stray common word / place).
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
    'chapter', 'part', 'book', 'page', 'narrator', 'unknown', 'none', 'null',
]);

function isNonCharacterName(name) {
    if (!name || name.trim().length < 2) return true;
    const lower = name.trim().toLowerCase();
    if (NON_CHARACTER_WORDS.has(lower)) return true;
    if (/^\d/.test(name)) return true;            // starts with digit
    if (/^(the|a|an)\s/i.test(name)) return true;  // "the X", "a X"
    if (name.trim().length === 1) return true;      // single char
    return false;
}

function normalizeName(name) {
    if (!name) return null;
    let n = String(name).trim();
    if (n.length < 2) return null;
    // ALL CAPS or all lowercase → Title Case
    if (n === n.toUpperCase() || n === n.toLowerCase()) {
        n = n.split(/\s+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    }
    return n;
}

export async function onRequestOptions() {
    return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
    try {
        const apiKey = context.env.GEMINI_API_KEY;
        if (!apiKey) {
            return Response.json(
                { error: 'GEMINI_API_KEY not configured' },
                { status: 500, headers: CORS }
            );
        }
        const model = context.env.GEMINI_MODEL || 'gemini-2.5-flash';

        const body = await context.request.json();
        const { segments, knownCharacters } = body;

        if (!segments || !Array.isArray(segments) || segments.length === 0) {
            return Response.json({ error: 'No segments provided' }, { status: 400, headers: CORS });
        }

        const dialogueSegments = segments.filter(s => s.segType === 'dialogue');
        if (dialogueSegments.length === 0) {
            return Response.json({ speakers: [] }, { headers: CORS });
        }

        // ── Build a numbered transcript of the WHOLE chapter ──
        // Narration is included (unlabelled indices) so the model can use it as
        // context; only dialogue indices need an answer.
        const transcript = segments
            .map(s => {
                const tag = s.segType === 'dialogue' ? 'DIALOGUE' : 'NARRATION';
                return `[${s.index}] ${tag}: ${String(s.text || '').replace(/\s+/g, ' ').trim()}`;
            })
            .join('\n');

        const dialogueIndices = dialogueSegments.map(s => s.index);

        const knownList = knownCharacters && Object.keys(knownCharacters).length
            ? Object.entries(knownCharacters)
                .map(([name, info]) => `${name} (${info.gender || 'unknown'})`)
                .join(', ')
            : 'none yet';

        const prompt = `You are a literary dialogue analyst. Below is a numbered transcript of one chapter of a novel. Each line is tagged NARRATION or DIALOGUE.

Known characters from earlier in this book (reuse these EXACT names when the speaker matches so voices stay consistent): ${knownList}

Your task: for EACH DIALOGUE line, determine which character is speaking it.

Rules:
- Only these DIALOGUE line indices need an answer: [${dialogueIndices.join(', ')}]
- Use the character's real PROPER NAME with correct capitalization (e.g. "Regis", not "regis" or "REGIS"). If a known character above matches, reuse that exact spelling.
- Track the conversation flow: use dialogue tags ("said X", "X asked"), surrounding narration, and turn-taking to decide who speaks.
- A speaker MUST be a person/being who can talk. NEVER return: place names, objects, titles alone ("Lord", "Professor"), common words ("Whatever", "Nothing"), or narration.
- If you genuinely cannot tell who speaks a line, set speaker to null. Do NOT guess a random word.
- Infer gender from pronouns/context: "male", "female", or "unknown".

Transcript:
${transcript}`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const geminiResp = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                index: { type: 'INTEGER' },
                                speaker: { type: 'STRING', nullable: true },
                                gender: { type: 'STRING', enum: ['male', 'female', 'unknown'] },
                            },
                            required: ['index', 'gender'],
                        },
                    },
                },
            }),
        });

        if (!geminiResp.ok) {
            const errText = await geminiResp.text().catch(() => geminiResp.statusText);
            return Response.json(
                { error: `Gemini error ${geminiResp.status}: ${errText.substring(0, 300)}` },
                { status: 502, headers: CORS }
            );
        }

        const data = await geminiResp.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            // Best-effort: pull the first JSON array out of the text
            const m = raw.match(/\[[\s\S]*\]/);
            parsed = m ? JSON.parse(m[0]) : null;
        }

        if (!Array.isArray(parsed)) {
            return Response.json(
                { error: 'Gemini returned unparseable output' },
                { status: 502, headers: CORS }
            );
        }

        const validIndices = new Set(dialogueIndices);
        const speakers = [];
        for (const item of parsed) {
            const idx = typeof item.index === 'number' ? item.index : Number(item.index);
            if (!Number.isInteger(idx) || !validIndices.has(idx)) continue;

            let speaker = item.speaker ? normalizeName(item.speaker) : null;
            if (speaker && isNonCharacterName(speaker)) speaker = null;

            const gender = ['male', 'female'].includes(item.gender) ? item.gender : 'unknown';
            speakers.push({ index: idx, speaker, gender });
        }

        return Response.json({ speakers }, { headers: CORS });

    } catch (err) {
        console.error('[AI] analyze-dialogue error:', err);
        return Response.json(
            { error: err.message || 'Analysis failed' },
            { status: 500, headers: CORS }
        );
    }
}
