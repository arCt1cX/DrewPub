/**
 * Cloudflare Pages Function: POST /api/tts
 *
 * Implements the Microsoft Edge Read Aloud TTS protocol directly via WebSocket.
 * No npm dependencies — uses only web-standard APIs available in Workers.
 *
 * Request body: { text, voice?, rate?, pitch?, volume? }
 * Response: audio/mpeg binary stream
 *
 * Also supports: GET /api/tts?voices=1 — returns list of available voices.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=`;
const VOICES_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=' + TRUSTED_CLIENT_TOKEN;

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

function uuid() {
    // Cloudflare Workers support crypto.randomUUID()
    return crypto.randomUUID().replace(/-/g, '');
}

function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildSSML(text, voice, rate, pitch, volume) {
    // Rate: +0% / -50% / +100% etc.
    const rateStr = rate >= 1 ? `+${Math.round((rate - 1) * 100)}%` : `-${Math.round((1 - rate) * 100)}%`;
    const pitchStr = pitch >= 1 ? `+${Math.round((pitch - 1) * 50)}Hz` : `-${Math.round((1 - pitch) * 50)}Hz`;
    const volStr = `+${Math.round((volume - 1) * 100)}%`;

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
        `<voice name="${voice}">` +
        `<prosody rate="${rateStr}" pitch="${pitchStr}" volume="${volStr}">` +
        escapeXml(text) +
        `</prosody></voice></speak>`;
}

// -----------------------------------------------------------
// Edge TTS WebSocket Synthesis
// -----------------------------------------------------------

async function synthesize(text, voice, rate, pitch, volume) {
    const connId = uuid();
    const requestId = uuid();

    // Cloudflare Workers: use fetch() with Upgrade header for outgoing WebSocket
    const wsUrl = WSS_URL + connId;

    const wsResp = await fetch(wsUrl.replace('wss://', 'https://'), {
        headers: {
            'Upgrade': 'websocket',
            'User-Agent': EDGE_UA,
            'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        },
    });

    const ws = wsResp.webSocket;
    if (!ws) {
        throw new Error('WebSocket upgrade failed — server did not accept');
    }
    ws.accept();

    // Collect audio chunks
    const audioChunks = [];
    let done = false;
    let error = null;

    const completionPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            error = new Error('TTS timeout after 30s');
            try { ws.close(); } catch (_) {}
            reject(error);
        }, 30000);

        ws.addEventListener('message', (event) => {
            if (typeof event.data === 'string') {
                // Text message
                if (event.data.includes('turn.end')) {
                    done = true;
                    clearTimeout(timeout);
                    resolve();
                }
            } else {
                // Binary message — contains audio data after a header
                // The binary message format:
                //   2 bytes (big-endian uint16): header length
                //   [header bytes] (text, ignored)
                //   [audio bytes] (mp3 data)
                try {
                    const buf = event.data instanceof ArrayBuffer ? event.data : event.data.buffer || event.data;
                    const view = new DataView(buf);
                    const headerLen = view.getUint16(0);
                    if (buf.byteLength > headerLen + 2) {
                        const audioData = buf.slice(headerLen + 2);
                        audioChunks.push(audioData);
                    }
                } catch (e) {
                    // Ignore malformed binary messages
                }
            }
        });

        ws.addEventListener('error', (e) => {
            clearTimeout(timeout);
            error = new Error('WebSocket error');
            reject(error);
        });

        ws.addEventListener('close', () => {
            clearTimeout(timeout);
            if (!done && !error) {
                resolve(); // Treat close as completion if no error
            }
        });
    });

    // Step 1: Send config message
    const configMsg =
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
            context: {
                synthesis: {
                    audio: {
                        metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                        outputFormat: OUTPUT_FORMAT,
                    },
                },
            },
        });
    ws.send(configMsg);

    // Step 2: Send SSML synthesis request
    const ssml = buildSSML(text, voice, rate, pitch, volume);
    const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
    ws.send(ssmlMsg);

    // Step 3: Wait for completion
    await completionPromise;

    // Close WebSocket
    try { ws.close(); } catch (_) {}

    // Concatenate all audio chunks
    const totalLen = audioChunks.reduce((acc, c) => acc + c.byteLength, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of audioChunks) {
        result.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }

    return result;
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

    // Filter to English voices for simplicity (user reads English books)
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

    return new Response('GET /api/tts?voices=1 to list voices, or POST to synthesize', { status: 200 });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const { text, voice, rate, pitch, volume } = body;

        if (!text || text.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Missing "text" field' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Defaults
        const finalVoice = voice || 'en-US-GuyNeural';
        const finalRate = Math.max(0.25, Math.min(4.0, rate || 1.0));
        const finalPitch = Math.max(0.5, Math.min(2.0, pitch || 1.0));
        const finalVolume = Math.max(0.0, Math.min(2.0, volume || 1.0));

        // Truncate very long text (Edge TTS has limits)
        const finalText = text.substring(0, 3000);

        const audioBytes = await synthesize(finalText, finalVoice, finalRate, finalPitch, finalVolume);

        if (audioBytes.length === 0) {
            return new Response(JSON.stringify({ error: 'No audio data received' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(audioBytes.buffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBytes.length.toString(),
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=604800', // 1 week
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'TTS synthesis failed' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
}

// Handle preflight
export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}
