/**
 * Edge TTS Proxy — Cloudflare Pages Function
 *
 * Uses Microsoft Edge's Read Aloud TTS service (free, neural voices).
 * Accepts text + voice parameters, returns MP3 audio.
 */

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function makeTimestamp() {
    return new Date().toISOString();
}

function makeConfigMessage(outputFormat) {
    const ts = makeTimestamp();
    return [
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
                        outputFormat: outputFormat,
                    },
                },
            },
        }),
    ].join('\r\n');
}

function makeSsmlMessage(requestId, text, voice, rate, pitch) {
    const ts = makeTimestamp();
    const rateStr = rate >= 0 ? `+${rate}%` : `${rate}%`;
    const pitchStr = pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;

    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody pitch='${pitchStr}' rate='${rateStr}' volume='+0%'>` +
        `${escapeXml(text)}` +
        `</prosody></voice></speak>`;

    return [
        `X-RequestId:${requestId}`,
        'Content-Type:application/ssml+xml',
        `X-Timestamp:${ts}`,
        'Path:ssml',
        '',
        ssml,
    ].join('\r\n');
}

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
    return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const text = body.text?.trim();
        const voice = body.voice || 'en-US-JennyNeural';
        const rate = typeof body.rate === 'number' ? body.rate : 0;
        const pitch = typeof body.pitch === 'number' ? body.pitch : 0;
        const outputFormat = 'audio-24khz-48kbitrate-mono-mp3';

        if (!text) {
            return new Response(JSON.stringify({ error: 'No text provided' }), {
                status: 400,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
        }

        // Limit text length to prevent abuse
        if (text.length > 5000) {
            return new Response(JSON.stringify({ error: 'Text too long (max 5000 chars)' }), {
                status: 400,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
        }

        const connectionId = crypto.randomUUID().replace(/-/g, '');
        const requestId = crypto.randomUUID().replace(/-/g, '');

        // Connect to Edge TTS via WebSocket
        // CF Workers use https:// with Upgrade header (not wss://)
        const wsUrl = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_TOKEN}&ConnectionId=${connectionId}`;

        const wsResponse = await fetch(wsUrl, {
            headers: {
                'Upgrade': 'websocket',
                'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
            },
        });

        const ws = wsResponse.webSocket;
        if (!ws) {
            return new Response(JSON.stringify({ error: 'WebSocket connection failed' }), {
                status: 502,
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
        }

        ws.accept();

        // Collect audio chunks via the WebSocket
        const audioData = await new Promise((resolve, reject) => {
            const audioChunks = [];

            const timeout = setTimeout(() => {
                try { ws.close(); } catch (_) {}
                reject(new Error('Synthesis timeout (30s)'));
            }, 30000);

            ws.addEventListener('message', (event) => {
                if (typeof event.data === 'string') {
                    // Text message — check for turn.end
                    if (event.data.includes('Path:turn.end')) {
                        clearTimeout(timeout);
                        try { ws.close(); } catch (_) {}
                        // Concatenate all audio chunks
                        const total = audioChunks.reduce((s, c) => s + c.byteLength, 0);
                        const result = new Uint8Array(total);
                        let offset = 0;
                        for (const chunk of audioChunks) {
                            result.set(new Uint8Array(chunk), offset);
                            offset += chunk.byteLength;
                        }
                        resolve(result.buffer);
                    }
                } else {
                    // Binary message — extract audio after header
                    const data = event.data; // ArrayBuffer
                    if (data.byteLength < 2) return;

                    const view = new DataView(data);
                    const headerLen = view.getUint16(0);
                    if (2 + headerLen >= data.byteLength) return;

                    const headerText = new TextDecoder('ascii').decode(
                        data.slice(2, 2 + headerLen)
                    );

                    if (headerText.includes('Path:audio')) {
                        audioChunks.push(data.slice(2 + headerLen));
                    }
                }
            });

            ws.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new Error('WebSocket error'));
            });

            ws.addEventListener('close', () => {
                clearTimeout(timeout);
                // If we haven't resolved yet, try to return what we have
                if (audioChunks.length > 0) {
                    const total = audioChunks.reduce((s, c) => s + c.byteLength, 0);
                    const result = new Uint8Array(total);
                    let offset = 0;
                    for (const chunk of audioChunks) {
                        result.set(new Uint8Array(chunk), offset);
                        offset += chunk.byteLength;
                    }
                    resolve(result.buffer);
                } else {
                    reject(new Error('Connection closed without audio'));
                }
            });

            // Send config message, then SSML
            ws.send(makeConfigMessage(outputFormat));
            ws.send(makeSsmlMessage(requestId, text, voice, rate, pitch));
        });

        return new Response(audioData, {
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'public, max-age=86400',
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
    }
}
