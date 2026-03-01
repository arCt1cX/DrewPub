/**
 * Cloudflare Pages Function: /api/tts
 *
 * Voice listing endpoint only.
 * TTS synthesis now happens client-side via direct browser WebSocket to Edge TTS.
 *
 * GET /api/tts?voices=1 — returns list of available English voices.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const VOICES_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=' + TRUSTED_CLIENT_TOKEN;

// -----------------------------------------------------------
// Fetch available voices
// -----------------------------------------------------------

async function fetchVoices() {
    const resp = await fetch(VOICES_URL, {
        headers: {
            'User-Agent': EDGE_UA,
            'Accept': 'application/json',
        },
    });
    if (!resp.ok) throw new Error(`Voice list fetch failed: ${resp.status}`);
    const all = await resp.json();

    // Filter to English voices
    const english = all.filter(v => v.Locale?.startsWith('en-'));
    return english.map(v => ({
        id: v.ShortName,
        name: v.FriendlyName || v.ShortName,
        locale: v.Locale,
        gender: v.Gender,
    }));
}

// -----------------------------------------------------------
// Request handlers
// -----------------------------------------------------------

export async function onRequestGet(context) {
    const url = new URL(context.request.url);

    if (url.searchParams.get('voices') === '1') {
        try {
            const voices = await fetchVoices();
            return new Response(JSON.stringify(voices), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=86400',
                },
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    }

    return new Response(JSON.stringify({
        info: 'TTS synthesis now runs client-side. Use GET /api/tts?voices=1 to list available voices.',
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function onRequestPost() {
    return new Response(JSON.stringify({
        error: 'POST synthesis has been moved client-side. The browser connects directly to Edge TTS via WebSocket.',
    }), {
        status: 410,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}

// Handle preflight
export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}
