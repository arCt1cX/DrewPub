/**
 * Cloudflare Pages Function — Edge TTS Proxy
 * Converts text to speech using Microsoft Edge's neural TTS via WebSocket.
 * Returns MP3 audio binary.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WS_BASE = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

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

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const {
            text,
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

        // Limit text length to prevent abuse / timeouts
        const trimmedText = text.slice(0, 3000);

        const connectionId = crypto.randomUUID().replace(/-/g, '');
        const wsUrl = `${WS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`;

        // Open WebSocket connection to Edge TTS
        const wsResponse = await fetch(wsUrl, {
            headers: {
                'Upgrade': 'websocket',
                'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
            },
        });

        const ws = wsResponse.webSocket;
        if (!ws) {
            return new Response(JSON.stringify({ error: 'Failed to connect to TTS service' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        ws.accept();

        const audioChunks = [];

        const audioComplete = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                try { ws.close(); } catch (_) { }
                reject(new Error('TTS request timed out'));
            }, 25000);

            ws.addEventListener('message', (event) => {
                if (typeof event.data === 'string') {
                    // Text frame — check for completion signal
                    if (event.data.includes('Path:turn.end')) {
                        clearTimeout(timeout);
                        resolve();
                    }
                } else {
                    // Binary frame — extract audio data after header
                    try {
                        let buffer;
                        if (event.data instanceof ArrayBuffer) {
                            buffer = event.data;
                        } else if (typeof event.data === 'object' && event.data.arrayBuffer) {
                            // Handle Blob-like objects
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
                            audioChunks.push(audioData.slice()); // copy
                        }
                    } catch (_) { /* skip malformed frames */ }
                }
            });

            ws.addEventListener('close', () => {
                clearTimeout(timeout);
                resolve();
            });

            ws.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new Error('WebSocket error'));
            });
        });

        // Send speech config
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

        // Send SSML request
        const ssml =
            `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
            `<voice name='${escapeXml(voice)}'>` +
            `<prosody pitch='${escapeXml(pitch)}' rate='${escapeXml(rate)}' volume='+0%'>` +
            escapeXml(trimmedText) +
            `</prosody></voice></speak>`;

        ws.send(
            `X-RequestId:${connectionId}\r\n` +
            `Content-Type:application/ssml+xml\r\n` +
            `X-Timestamp:${new Date().toISOString()}\r\n` +
            `Path:ssml\r\n\r\n` +
            ssml
        );

        // Wait for all audio data
        await audioComplete;
        try { ws.close(); } catch (_) { }

        if (audioChunks.length === 0) {
            return new Response(JSON.stringify({ error: 'No audio data received' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        // Concatenate audio chunks
        let totalLen = 0;
        for (const chunk of audioChunks) totalLen += chunk.byteLength;

        const audio = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of audioChunks) {
            audio.set(chunk, offset);
            offset += chunk.byteLength;
        }

        return new Response(audio.buffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(totalLen),
                'Cache-Control': 'public, max-age=86400',
                ...CORS,
            },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message || 'TTS synthesis failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...CORS },
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS });
}
