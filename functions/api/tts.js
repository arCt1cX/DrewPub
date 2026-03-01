/**
 * Cloudflare Pages Function: /api/tts
 *
 * Edge TTS synthesis via WebSocket + voice listing.
 *
 * POST /api/tts         — synthesize speech (body: { text, voice?, rate?, pitch? })
 * GET  /api/tts?voices=1 — list available English voices
 * GET  /api/tts?test=1   — quick WebSocket connectivity test
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=`;
const VOICES_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=' + TRUSTED_CLIENT_TOKEN;
const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildSSML(text, voice, rate, pitch) {
    const rateStr = rate >= 1 ? `+${Math.round((rate - 1) * 100)}%` : `-${Math.round((1 - rate) * 100)}%`;
    const pitchStr = pitch >= 1 ? `+${Math.round((pitch - 1) * 50)}Hz` : `-${Math.round((1 - pitch) * 50)}Hz`;

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
        `<voice name="${voice}">` +
        `<prosody rate="${rateStr}" pitch="${pitchStr}" volume="+0%">` +
        escapeXml(text) +
        `</prosody></voice></speak>`;
}

// -----------------------------------------------------------
// Open a WebSocket to Edge TTS
// Cloudflare docs: only set Upgrade header; runtime adds Sec-WebSocket-* automatically.
// -----------------------------------------------------------

async function openEdgeSocket(connId) {
    const wsUrl = WSS_URL + connId;
    const httpsUrl = wsUrl.replace('wss://', 'https://');

    const wsResp = await fetch(httpsUrl, {
        headers: {
            'Upgrade': 'websocket',
        },
    });

    const ws = wsResp.webSocket;
    if (!ws) {
        const status = wsResp.status;
        const body = await wsResp.text().catch(() => '(unreadable)');
        throw new Error(`WebSocket upgrade rejected (HTTP ${status}): ${body.substring(0, 300)}`);
    }
    ws.accept();
    return ws;
}

// -----------------------------------------------------------
// Edge TTS WebSocket Synthesis
// -----------------------------------------------------------

async function synthesize(text, voice, rate, pitch) {
    const connId = crypto.randomUUID().replace(/-/g, '');
    const requestId = crypto.randomUUID().replace(/-/g, '');

    const ws = await openEdgeSocket(connId);

    const audioChunks = [];
    let done = false;

    const completionPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            try { ws.close(); } catch (_) {}
            reject(new Error('TTS timeout (30 s)'));
        }, 30000);

        ws.addEventListener('message', (event) => {
            if (typeof event.data === 'string') {
                if (event.data.includes('turn.end')) {
                    done = true;
                    clearTimeout(timeout);
                    resolve();
                }
            } else {
                try {
                    const buf = event.data instanceof ArrayBuffer
                        ? event.data
                        : (event.data.buffer || event.data);
                    const view = new DataView(buf);
                    const headerLen = view.getUint16(0);
                    if (buf.byteLength > headerLen + 2) {
                        audioChunks.push(buf.slice(headerLen + 2));
                    }
                } catch (_) { /* ignore malformed */ }
            }
        });

        ws.addEventListener('error', () => {
            clearTimeout(timeout);
            reject(new Error('WebSocket error during synthesis'));
        });

        ws.addEventListener('close', () => {
            clearTimeout(timeout);
            if (!done) resolve();
        });
    });

    // 1. Config
    ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({
            context: {
                synthesis: {
                    audio: {
                        metadataoptions: {
                            sentenceBoundaryEnabled: 'false',
                            wordBoundaryEnabled: 'false',
                        },
                        outputFormat: OUTPUT_FORMAT,
                    },
                },
            },
        })
    );

    // 2. SSML
    ws.send(
        `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        buildSSML(text, voice, rate, pitch)
    );

    // 3. Wait
    await completionPromise;
    try { ws.close(); } catch (_) {}

    const totalLen = audioChunks.reduce((a, c) => a + c.byteLength, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of audioChunks) {
        result.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }
    return result;
}

// -----------------------------------------------------------
// Quick connectivity test
// -----------------------------------------------------------

async function testConnectivity() {
    const connId = crypto.randomUUID().replace(/-/g, '');
    const ws = await openEdgeSocket(connId);
    ws.close();
    return true;
}

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
    const english = all.filter(v => v.Locale?.startsWith('en-'));
    return english.map(v => ({
        id: v.ShortName,
        name: v.FriendlyName || v.ShortName,
        locale: v.Locale,
        gender: v.Gender,
    }));
}

// -----------------------------------------------------------
// Handlers
// -----------------------------------------------------------

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet(context) {
    const url = new URL(context.request.url);

    // GET /api/tts?test=1 — WebSocket connectivity check
    if (url.searchParams.get('test') === '1') {
        try {
            await testConnectivity();
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        } catch (err) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), {
                status: 503,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }
    }

    // GET /api/tts?voices=1
    if (url.searchParams.get('voices') === '1') {
        try {
            const voices = await fetchVoices();
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

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const { text, voice, rate, pitch } = body;

        if (!text || text.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Missing "text" field' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        const finalVoice = voice || 'en-US-GuyNeural';
        const finalRate = Math.max(0.25, Math.min(4.0, rate || 1.0));
        const finalPitch = Math.max(0.5, Math.min(2.0, pitch || 1.0));
        const finalText = text.substring(0, 3000);

        const audioBytes = await synthesize(finalText, finalVoice, finalRate, finalPitch);

        if (audioBytes.length === 0) {
            return new Response(JSON.stringify({ error: 'No audio data received' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        return new Response(audioBytes.buffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBytes.length.toString(),
                'Cache-Control': 'public, max-age=604800',
                ...CORS,
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'TTS synthesis failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS },
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: { ...CORS, 'Access-Control-Max-Age': '86400' },
    });
}
