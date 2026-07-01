/**
 * Cloudflare Pages Function: /api/analyze-dialogue
 *
 * Identifies who speaks each line of dialogue in a chapter. The whole chapter
 * is sent in a single request so the model has full context to resolve
 * speakers across long exchanges — far more reliable than per-line attribution.
 *
 * Two backends, picked automatically:
 *   1. Google Gemini      — if GEMINI_API_KEY is set (best quality, generous free tier)
 *   2. Cloudflare Workers AI — otherwise, using the `AI` binding + Llama-3.3-70B
 *                              (no external key needed)
 *
 * POST /api/analyze-dialogue
 *   Body: { segments: [ { text, segType, speaker?, index } ], knownCharacters: { name: { gender } } }
 *   Returns: { speakers: [ { index, speaker, gender } ] }   // one entry per resolved dialogue line
 *
 * Environment:
 *   GEMINI_API_KEY — Google AI Studio key (starts with "AIza…"). Optional.
 *   GEMINI_MODEL   — optional, defaults to "gemini-2.5-flash".
 *   AI             — Workers AI binding (fallback). Configured in Pages settings.
 *
 * On any failure the client silently falls back to its local regex attribution.
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Words that should never be a character name (last-line defense).
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
    if (n === n.toUpperCase() || n === n.toLowerCase()) {
        n = n.split(/\s+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    }
    return n;
}

// Pull a JSON array out of a possibly-messy model response.
function parseJsonArray(raw) {
    if (!raw) return null;
    try {
        const direct = JSON.parse(raw);
        if (Array.isArray(direct)) return direct;
    } catch { /* fall through */ }
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

function buildPrompt(transcript, dialogueIndices, knownList) {
    return `You are a literary dialogue analyst. Below is a numbered transcript of one chapter of a novel. Each line is tagged NARRATION or DIALOGUE.

Known characters from earlier in this book (reuse these EXACT names when the speaker matches so voices stay consistent): ${knownList}

Your task: for EACH DIALOGUE line, determine which character is speaking it.

Rules:
- Only these DIALOGUE line indices need an answer: [${dialogueIndices.join(', ')}]
- Use the character's real PROPER NAME with correct capitalization (e.g. "Regis", not "regis" or "REGIS"). If a known character above matches, reuse that exact spelling.
- Track the conversation flow: use dialogue tags ("said X", "X asked"), surrounding narration, and turn-taking to decide who speaks.
- A speaker MUST be a person/being who can talk. NEVER return: place names, objects, titles alone ("Lord", "Professor"), common words ("Whatever", "Nothing"), or narration.
- If you genuinely cannot tell who speaks a line, set speaker to null. Do NOT guess a random word.
- Infer gender from pronouns/context: "male", "female", or "unknown".
- Return ONLY a JSON array. Each element: {"index": <number>, "speaker": <name or null>, "gender": "male"|"female"|"unknown"}

Transcript:
${transcript}`;
}

// ── Backend: Google Gemini ─────────────────────────────────
async function runGemini(apiKey, model, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
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
    if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`Gemini ${resp.status}: ${errText.substring(0, 300)}`);
    }
    const data = await resp.json();
    return parseJsonArray(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
}

// ── Backend: Cloudflare Workers AI ─────────────────────────
async function runWorkersAI(ai, prompt) {
    const response = await ai.run(WORKERS_AI_MODEL, {
        messages: [
            { role: 'system', content: 'You are a precise JSON-only dialogue analyst. Respond with a valid JSON array only — no markdown, no commentary.' },
            { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
        temperature: 0.1,
    });
    return parseJsonArray((response.response || '').trim());
}

export async function onRequestOptions() {
    return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
    try {
        const apiKey = context.env.GEMINI_API_KEY;
        const model = context.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const ai = context.env.AI;

        if (!apiKey && !ai) {
            return Response.json(
                { error: 'No analysis backend configured (set GEMINI_API_KEY or bind Workers AI)' },
                { status: 500, headers: CORS }
            );
        }

        const body = await context.request.json();
        const { segments, knownCharacters } = body;

        if (!segments || !Array.isArray(segments) || segments.length === 0) {
            return Response.json({ error: 'No segments provided' }, { status: 400, headers: CORS });
        }

        const dialogueSegments = segments.filter(s => s.segType === 'dialogue');
        if (dialogueSegments.length === 0) {
            return Response.json({ speakers: [] }, { headers: CORS });
        }

        // Numbered transcript of the WHOLE chapter (narration included as context).
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

        const prompt = buildPrompt(transcript, dialogueIndices, knownList);

        let parsed;
        let backend;
        if (apiKey) {
            backend = 'gemini';
            parsed = await runGemini(apiKey, model, prompt);
        } else {
            backend = 'workers-ai';
            parsed = await runWorkersAI(ai, prompt);
        }

        if (!Array.isArray(parsed)) {
            return Response.json(
                { error: `${backend} returned unparseable output` },
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

        return Response.json({ speakers, backend }, { headers: CORS });

    } catch (err) {
        console.error('[AI] analyze-dialogue error:', err);
        return Response.json(
            { error: err.message || 'Analysis failed' },
            { status: 500, headers: CORS }
        );
    }
}
