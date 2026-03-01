/**
 * Cloudflare Pages Function — Edge TTS Proxy
 * Uses outbound WebSocket (new WebSocket() — standard Web API supported by CF Workers)
 * to connect to Microsoft Edge Read Aloud service and return MP3 audio.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const {
            text = '',
            voice = 'en-US-AriaNeural',
            rate = '+0%',
            pitch = '+0Hz',
        } = body;

        if (!text || text.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Text is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        const trimmedText = text.slice(0, 3000);
        const audioBuffer = await synthesizeWithEdgeTts(trimmedText, voice, rate, pitch);

        return new Response(audioBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(audioBuffer.byteLength),
                'Cache-Control': 'public, max-age=86400',
                ...CORS,
            },
        });
    } catch (error) {
        // Return detailed error for debugging
        return new Response(JSON.stringify({
            error: error.message || 'TTS synthesis failed',
            type: error.constructor?.name || 'Error',
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS },
        });
    }
}

function synthesizeWithEdgeTts(text, voice, rate, pitch) {
    return new Promise((resolve, reject) => {
        const connectionId = crypto.randomUUID().replace(/-/g, '');
        const wsUrl = `${WS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`;

        let ws;
        try {
            ws = new WebSocket(wsUrl);
        } catch (e) {
            reject(new Error(`WebSocket constructor failed: ${e.message}`));
            return;
        }

        const audioChunks = [];
        let resolved = false;

        const timeout = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try { ws.close(); } catch (_) { }
            if (audioChunks.length > 0) {
                resolve(concatenateChunks(audioChunks));
            } else {
                reject(new Error('Edge TTS timeout after 25s — no audio received'));
            }
        }, 25000);

        const finishWithAudio = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            try { ws.close(); } catch (_) { }
            if (audioChunks.length === 0) {
                reject(new Error('Empty audio — no chunks received'));
                return;
            }
            resolve(concatenateChunks(audioChunks));
        };

        ws.addEventListener('open', () => {
            try {
                // 1. Send speech config
                ws.send(
                    'Content-Type:application/json; charset=utf-8\r\n' +
                    'Path:speech.config\r\n\r\n' +
                    JSON.stringify({
                        context: {
                            synthesis: {
                                audio: {
                                    metadataoptions: {
                                        sentenceBoundaryEnabled: 'false',
                                        wordBoundaryEnabled: 'false',
                                    },
                                    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                                },
                            },
                        },
                    })
                );

                // 2. Send SSML
                const ssml =
                    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
                    `<voice name='${escapeXml(voice)}'>` +
                    `<prosody pitch='${escapeXml(pitch)}' rate='${escapeXml(rate)}' volume='+0%'>` +
                    escapeXml(text) +
                    `</prosody></voice></speak>`;

                ws.send(
                    `X-RequestId:${connectionId}\r\n` +
                    `Content-Type:application/ssml+xml\r\n` +
                    `X-Timestamp:${new Date().toISOString()}\r\n` +
                    `Path:ssml\r\n\r\n` +
                    ssml
                );
            } catch (e) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error(`Send failed: ${e.message}`));
                }
            }
        });

        ws.addEventListener('message', (event) => {
            if (resolved) return;

            if (typeof event.data === 'string') {
                // Text frame — check for completion signal
                if (event.data.includes('Path:turn.end')) {
                    finishWithAudio();
                }
            } else {
                // Binary frame — extract audio data after header
                try {
                    let buffer;
                    if (event.data instanceof ArrayBuffer) {
                        buffer = event.data;
                    } else if (event.data.arrayBuffer) {
                        // Blob-like: skip (shouldn't happen in CF Workers)
                        return;
                    } else {
                        return;
                    }

                    if (buffer.byteLength < 2) return;

                    const view = new DataView(buffer);
                    const headerLen = view.getUint16(0);
                    if (2 + headerLen >= buffer.byteLength) return;

                    const audioData = new Uint8Array(buffer, 2 + headerLen);
                    if (audioData.byteLength > 0) {
                        audioChunks.push(new Uint8Array(audioData));
                    }
                } catch (_) { /* skip malformed frames */ }
            }
        });

        ws.addEventListener('error', (e) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            try { ws.close(); } catch (_) { }
            reject(new Error(`Edge TTS WebSocket error: ${e.message || 'connection failed'}`));
        });

        ws.addEventListener('close', (e) => {
            if (resolved) return;
            if (audioChunks.length > 0) {
                finishWithAudio();
            } else {
                resolved = true;
                clearTimeout(timeout);
                reject(new Error(`Edge TTS WS closed (code=${e.code}, reason=${e.reason || 'none'}) — no audio`));
            }
        });
    });
}

function concatenateChunks(chunks) {
    let totalLen = 0;
    for (const c of chunks) totalLen += c.byteLength;
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
        result.set(c, offset);
        offset += c.byteLength;
    }
    return result.buffer;
}
