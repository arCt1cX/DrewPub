/**
 * Cloudflare Pages Function: /api/tts
 *
 * Proxies TTS requests to a Kokoro-TTS FastAPI instance
 * (hosted on Hugging Face Spaces).
 *
 * POST /api/tts — synthesize speech (body: { text, voice?, rate?, pitch? })
 *   → proxies to TTS_BASE_URL/tts  (Kokoro API: { text, voice, speed, output_format })
 *
 * GET /api/tts?test=1   — connectivity check (hits /health)
 * GET /api/tts?voices=1 — list available voices (proxies /voices)
 *
 * Environment variable:
 *   TTS_BASE_URL — base URL of the Kokoro FastAPI instance
 *                  (e.g. https://your-user-kokoro-tts-fastapi.hf.space)
 *
 * Note: `pitch` is accepted for backwards-compat but ignored — Kokoro has no
 * pitch control. `rate` maps to Kokoro's `speed`.
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_VOICE = 'af_heart';

// Kokoro voice ids look like af_heart / am_michael / bf_emma / im_nicola.
// Anything else (e.g. a stale Edge id like "en-US-GuyNeural" left in saved
// settings or character overrides) is coerced to the default so synthesis
// never hard-fails on an unknown voice.
function sanitizeVoice(voice) {
    return /^[a-p][fm]_[a-z]+$/.test(voice || '') ? voice : DEFAULT_VOICE;
}

function getTtsBaseUrl(env) {
    const url = env.TTS_BASE_URL;
    if (!url) {
        throw new Error('TTS_BASE_URL environment variable is not set. Deploy a Kokoro FastAPI instance and configure the variable in Cloudflare Pages settings.');
    }
    return url.replace(/\/+$/, ''); // strip trailing slashes
}

// -----------------------------------------------------------
// POST /api/tts — synthesize speech
// -----------------------------------------------------------

export async function onRequestPost(context) {
    try {
        const baseUrl = getTtsBaseUrl(context.env);
        const body = await context.request.json();
        const { text, voice, rate } = body;

        if (!text || text.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Missing "text" field' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        // Map to the Kokoro FastAPI request format
        const ttsBody = {
            text: text.substring(0, 4096),
            voice: sanitizeVoice(voice),
            speed: Math.max(0.25, Math.min(4.0, rate || 1.0)),
            output_format: 'mp3',
        };

        const ttsResp = await fetch(`${baseUrl}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ttsBody),
        });

        if (!ttsResp.ok) {
            const errText = await ttsResp.text().catch(() => ttsResp.statusText);
            return new Response(JSON.stringify({ error: `TTS server error ${ttsResp.status}: ${errText}` }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        // Stream the audio back to the client
        const audioData = await ttsResp.arrayBuffer();
        const contentType = ttsResp.headers.get('Content-Type') || 'audio/mpeg';

        return new Response(audioData, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': audioData.byteLength.toString(),
                'Cache-Control': 'public, max-age=604800', // 1 week
                ...CORS,
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'TTS proxy failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS },
        });
    }
}

// -----------------------------------------------------------
// GET /api/tts?test=1   — connectivity check
// GET /api/tts?voices=1 — list voices
// -----------------------------------------------------------

export async function onRequestGet(context) {
    const url = new URL(context.request.url);

    // Test connectivity — hits the Kokoro /health endpoint (cheap, also wakes the Space)
    if (url.searchParams.get('test') === '1') {
        try {
            const baseUrl = getTtsBaseUrl(context.env);
            const resp = await fetch(`${baseUrl}/health`);

            if (resp.ok) {
                return new Response(JSON.stringify({ ok: true }), {
                    headers: { 'Content-Type': 'application/json', ...CORS },
                });
            }

            const errText = await resp.text().catch(() => '');
            return new Response(JSON.stringify({ ok: false, error: `TTS server returned ${resp.status}: ${errText}` }), {
                status: 503,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), {
                status: 503,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }
    }

    // List voices
    if (url.searchParams.get('voices') === '1') {
        try {
            const baseUrl = getTtsBaseUrl(context.env);
            const voicesResp = await fetch(`${baseUrl}/voices`);

            if (!voicesResp.ok) {
                throw new Error(`Voices endpoint returned ${voicesResp.status}`);
            }

            const voices = await voicesResp.json();
            return new Response(JSON.stringify(voices), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=86400',
                    ...CORS,
                },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }
    }

    return new Response(JSON.stringify({
        info: 'POST to synthesize, GET ?voices=1 for voice list, GET ?test=1 for connectivity check.',
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}

// Handle preflight
export async function onRequestOptions() {
    return new Response(null, {
        headers: { ...CORS, 'Access-Control-Max-Age': '86400' },
    });
}
