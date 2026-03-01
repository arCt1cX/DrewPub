/**
 * Edge TTS Proxy — Cloudflare Pages Function
 *
 * Proxies text-to-speech requests to Microsoft Edge's Read Aloud service.
 * The browser can't connect directly to speech.platform.bing.com (CORS),
 * so this function handles the WebSocket connection server-side.
 *
 * POST /api/tts  { text, voice, rate, pitch }  →  audio/mpeg
 */

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
    return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const text = body.text?.trim();
        const voice = body.voice || 'en-US-JennyNeural';
        const rate = typeof body.rate === 'number' ? body.rate : 0;
        const pitch = typeof body.pitch === 'number' ? body.pitch : 0;

        if (!text) {
            return new Response(JSON.stringify({ error: 'No text' }), {
                status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
            });
        }
        if (text.length > 5000) {
            return new Response(JSON.stringify({ error: 'Text too long' }), {
                status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
            });
        }

        const connId = crypto.randomUUID().replace(/-/g, '');
        const reqId = crypto.randomUUID().replace(/-/g, '');
        const outputFormat = 'audio-24khz-48kbitrate-mono-mp3';
        const ts = new Date().toISOString();

        const rateStr = rate >= 0 ? `+${rate}%` : `${rate}%`;
        const pitchStr = pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;

        const configMsg = [
            `X-Timestamp:${ts}`,
            'Content-Type:application/json; charset=utf-8',
            'Path:speech.config',
            '',
            JSON.stringify({
                context: {
                    synthesis: {
                        audio: {
                            metadataoptions: {
                                sentenceBoundaryEnabled: 'false',
                                wordBoundaryEnabled: 'true',
                            },
                            outputFormat,
                        },
                    },
                },
            }),
        ].join('\r\n');

        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
            `<voice name='${voice}'>` +
            `<prosody pitch='${pitchStr}' rate='${rateStr}' volume='+0%'>` +
            `${escapeXml(text)}` +
            `</prosody></voice></speak>`;

        const ssmlMsg = [
            `X-RequestId:${reqId}`,
            'Content-Type:application/ssml+xml',
            `X-Timestamp:${ts}`,
            'Path:ssml',
            '',
            ssml,
        ].join('\r\n');

        // --- Connect via Cloudflare's fetch-based WebSocket ---
        const wsUrl = `${EDGE_WSS}?TrustedClientToken=${TRUSTED_TOKEN}&ConnectionId=${connId}`;

        const upgradeResp = await fetch(wsUrl, {
            headers: {
                Upgrade: 'websocket',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        const ws = upgradeResp.webSocket;
        if (!ws) {
            // Fallback: try a second approach — direct fetching from a REST TTS endpoint
            return new Response(
                JSON.stringify({ error: 'WebSocket upgrade failed. Falling back not available.' }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }

        ws.accept();

        // Collect audio
        const audioChunks = [];
        let done = false;

        const audioPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!done) {
                    done = true;
                    try { ws.close(); } catch (_) {}
                    if (audioChunks.length > 0) resolve(); else reject(new Error('timeout'));
                }
            }, 30000);

            ws.addEventListener('message', (evt) => {
                if (done) return;

                if (typeof evt.data === 'string') {
                    if (evt.data.includes('Path:turn.end')) {
                        done = true;
                        clearTimeout(timer);
                        try { ws.close(); } catch (_) {}
                        resolve();
                    }
                } else if (evt.data instanceof ArrayBuffer) {
                    const buf = evt.data;
                    if (buf.byteLength < 2) return;
                    const headerLen = new DataView(buf).getUint16(0);
                    const headerEnd = 2 + headerLen;
                    if (headerEnd >= buf.byteLength) return;

                    const hdrText = new TextDecoder('ascii').decode(buf.slice(2, headerEnd));
                    if (hdrText.includes('Path:audio')) {
                        audioChunks.push(buf.slice(headerEnd));
                    }
                }
            });

            ws.addEventListener('close', () => {
                if (!done) { done = true; clearTimeout(timer); resolve(); }
            });

            ws.addEventListener('error', (e) => {
                if (!done) { done = true; clearTimeout(timer); reject(new Error('ws error')); }
            });
        });

        // Send messages
        ws.send(configMsg);
        ws.send(ssmlMsg);

        await audioPromise;

        if (audioChunks.length === 0) {
            return new Response(JSON.stringify({ error: 'No audio generated' }), {
                status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
            });
        }

        // Concatenate
        const totalLen = audioChunks.reduce((s, c) => s + c.byteLength, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of audioChunks) {
            result.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }

        return new Response(result.buffer, {
            headers: {
                ...CORS,
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'public, max-age=86400',
            },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
            status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }
}
