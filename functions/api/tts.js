/**
 * Cloudflare Pages Function: /api/tts
 *
 * Proxies TTS requests to an external openai-edge-tts server
 * (hosted on Hugging Face Spaces or similar).
 *
 * POST /api/tts — synthesize speech (body: { text, voice?, rate?, pitch? })
 *   → proxies to HF_TTS_URL/v1/audio/speech
 *
 * GET /api/tts?test=1 — quick connectivity check to the TTS server
 * GET /api/tts?voices=1 — list available voices from the TTS server
 *
 * Environment variable:
 *   TTS_BASE_URL — base URL of the openai-edge-tts instance
 *                  (e.g. https://your-user-openai-edge-tts.hf.space)
 */

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function getTtsBaseUrl(env) {
    // Cloudflare Pages: environment variables are on context.env
    const url = env.TTS_BASE_URL;
    if (!url) {
        throw new Error('TTS_BASE_URL environment variable is not set. Deploy an openai-edge-tts instance and configure the variable in Cloudflare Pages settings.');
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
        const { text, voice, rate, pitch } = body;

        if (!text || text.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Missing "text" field' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        // Map to openai-edge-tts API format
        const ttsBody = {
            input: text.substring(0, 4096),
            voice: voice || 'en-US-GuyNeural', // edge-tts voice name directly
            response_format: 'mp3',
            speed: Math.max(0.25, Math.min(4.0, rate || 1.0)),
        };

        const ttsResp = await fetch(`${baseUrl}/v1/audio/speech`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer drewpub_tts_key', // openai-edge-tts accepts any key
            },
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

        return new Response(audioData, {
            headers: {
                'Content-Type': 'audio/mpeg',
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
// GET /api/tts?test=1 — connectivity check
// GET /api/tts?voices=1 — list voices
// -----------------------------------------------------------

export async function onRequestGet(context) {
    const url = new URL(context.request.url);

    // Test connectivity
    if (url.searchParams.get('test') === '1') {
        try {
            const baseUrl = getTtsBaseUrl(context.env);

            // Try to synthesize a tiny text to confirm end-to-end works
            const ttsResp = await fetch(`${baseUrl}/v1/audio/speech`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer drewpub_tts_key',
                },
                body: JSON.stringify({
                    input: 'test',
                    voice: 'en-US-GuyNeural',
                    response_format: 'mp3',
                    speed: 1.0,
                }),
            });

            if (ttsResp.ok) {
                return new Response(JSON.stringify({ ok: true }), {
                    headers: { 'Content-Type': 'application/json', ...CORS },
                });
            }

            const errText = await ttsResp.text().catch(() => '');
            return new Response(JSON.stringify({ ok: false, error: `TTS server returned ${ttsResp.status}: ${errText}` }), {
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
            const voicesResp = await fetch(`${baseUrl}/v1/voices?language=en`, {
                headers: { 'Authorization': 'Bearer drewpub_tts_key' },
            });

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
