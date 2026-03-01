/**
 * Cloudflare Pages Function — Edge TTS Proxy
 * Uses CF Workers outbound WebSocket via fetch() + Upgrade header.
 * This allows setting custom Origin header required by Edge TTS.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WS_ENDPOINT = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

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

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
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
            return jsonResponse({ error: 'Text is required' }, 400);
        }

        const trimmedText = text.slice(0, 3000);
        const audioBuffer = await synthesize(trimmedText, voice, rate, pitch);

        return new Response(audioBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(audioBuffer.byteLength),
                'Cache-Control': 'public, max-age=86400',
                ...CORS,
            },
        });
    } catch (err) {
        return jsonResponse({
            error: err.message || 'TTS synthesis failed',
            type: err.constructor?.name || 'Error',
        }, 500);
    }
}

/**
 * Connect to Edge TTS via CF Workers outbound WebSocket.
 *
 * CF Workers establish outbound WebSocket with:
 *   const resp = await fetch(httpsUrl, { headers: { Upgrade: 'websocket', ... } });
 *   const ws = resp.webSocket;
 *   ws.accept();
 *
 * This lets us set the required Origin header (unlike new WebSocket()).
 */
async function synthesize(text, voice, rate, pitch) {
    const connectionId = crypto.randomUUID().replace(/-/g, '');
    const url = `${WS_ENDPOINT}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`;

    // Step 1: Establish WebSocket via fetch() — lets us send custom headers
    const upgradeResp = await fetch(url, {
        headers: {
            'Upgrade': 'websocket',
            'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        },
    });

    const ws = upgradeResp.webSocket;
    if (!ws) {
        // Capture as much diagnostic info as possible
        let body = '';
        try { body = await upgradeResp.text(); } catch (_) {}
        throw new Error(
            `WebSocket upgrade failed: HTTP ${upgradeResp.status} ${upgradeResp.statusText}` +
            (body ? ` — ${body.slice(0, 200)}` : '')
        );
    }

    ws.accept();

    // Step 2: Collect audio in a Promise
    return new Promise((resolve, reject) => {
        const audioChunks = [];
        let done = false;

        const timeout = setTimeout(() => {
            if (done) return;
            done = true;
            try { ws.close(); } catch (_) {}
            if (audioChunks.length > 0) {
                resolve(concat(audioChunks));
            } else {
                reject(new Error('Edge TTS timeout (25 s) — no audio received'));
            }
        }, 25_000);

        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            try { ws.close(); } catch (_) {}
            if (audioChunks.length === 0) {
                reject(new Error('Edge TTS returned empty audio'));
            } else {
                resolve(concat(audioChunks));
            }
        };

        ws.addEventListener('message', (event) => {
            if (done) return;

            if (typeof event.data === 'string') {
                if (event.data.includes('Path:turn.end')) {
                    finish();
                }
            } else if (event.data instanceof ArrayBuffer) {
                // Binary frame: 2-byte header-length prefix, then header, then MP3 data
                const buf = event.data;
                if (buf.byteLength < 2) return;
                const headerLen = new DataView(buf).getUint16(0);
                const audioStart = 2 + headerLen;
                if (audioStart >= buf.byteLength) return;
                const chunk = new Uint8Array(buf, audioStart);
                if (chunk.byteLength > 0) {
                    audioChunks.push(new Uint8Array(chunk));
                }
            }
        });

        ws.addEventListener('error', (evt) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            try { ws.close(); } catch (_) {}
            reject(new Error(`Edge TTS WebSocket error: ${evt.message || evt.type || 'unknown'}`));
        });

        ws.addEventListener('close', (evt) => {
            if (done) return;
            if (audioChunks.length > 0) {
                finish();
            } else {
                done = true;
                clearTimeout(timeout);
                reject(new Error(`Edge TTS WS closed: code=${evt.code} reason=${evt.reason || 'none'}`));
            }
        });

        // Step 3: Send speech.config
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

        // Step 4: Send SSML
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
    });
}

function concat(chunks) {
    let len = 0;
    for (const c of chunks) len += c.byteLength;
    const out = new Uint8Array(len);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
    }
    return out.buffer;
}
