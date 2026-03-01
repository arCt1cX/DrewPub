/**
 * TTS Engine Abstraction Layer
 * Supports Edge TTS (cloud) and Web Speech API (system) engines.
 */

// ─── Edge TTS Voice Catalog ──────────────────────────

export const EDGE_VOICES = {
    narrator: {
        male: 'en-US-GuyNeural',
        female: 'en-US-AriaNeural',
    },
    male: [
        'en-US-GuyNeural',
        'en-US-DavisNeural',
        'en-US-JasonNeural',
        'en-US-TonyNeural',
        'en-GB-RyanNeural',
        'en-AU-WilliamNeural',
        'en-US-AndrewNeural',
        'en-US-BrandonNeural',
    ],
    female: [
        'en-US-JennyNeural',
        'en-US-SaraNeural',
        'en-US-MichelleNeural',
        'en-GB-SoniaNeural',
        'en-AU-NatashaNeural',
        'en-US-AmberNeural',
        'en-US-AnaNeural',
        'en-US-AriaNeural',
    ],
};

// ─── Helpers ─────────────────────────────────────────

/** Convert rate (0.5–2.0) to Edge TTS format (+0%, +50%, -30%) */
function rateToEdge(rate) {
    const pct = Math.round((rate - 1.0) * 100);
    return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/** Convert pitch (0.5–2.0) to Edge TTS format (+0Hz) */
function pitchToEdge(pitch) {
    const hz = Math.round((pitch - 1.0) * 50);
    return `${hz >= 0 ? '+' : ''}${hz}Hz`;
}

// ─── Cloud Engine (Edge TTS via direct browser WebSocket) ─

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_WS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

class CloudTtsEngine {
    constructor() {
        this._audio = null;
        this._ws = null;
        this._playing = false;
        this._paused = false;
    }

    get isPlaying() { return this._playing && !this._paused; }
    get isPaused() { return this._paused; }

    /**
     * Synthesize and play text via Edge TTS WebSocket (direct from browser).
     * Collects audio chunks, then plays the complete MP3.
     * @param {string} text
     * @param {string} voice - Edge TTS voice name
     * @param {object} options - { rate, pitch, signal }
     * @returns {Promise<void>}
     */
    speak(text, voice, options = {}) {
        const { rate = 1.0, pitch = 1.0, signal } = options;

        this.stop();

        const rateStr = rateToEdge(rate);
        const pitchStr = pitchToEdge(pitch);
        const voiceName = voice || EDGE_VOICES.narrator.female;
        const trimmedText = text.slice(0, 3000);

        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            const connectionId = crypto.randomUUID().replace(/-/g, '');
            const wsUrl = `${EDGE_TTS_WS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`;

            let ws;
            try {
                ws = new WebSocket(wsUrl);
            } catch (e) {
                reject(new Error('Failed to create WebSocket: ' + e.message));
                return;
            }

            this._ws = ws;
            ws.binaryType = 'arraybuffer';

            const audioChunks = [];
            let resolved = false;

            const cleanup = () => {
                clearTimeout(timeout);
                if (this._ws === ws) this._ws = null;
                try { ws.close(); } catch (_) { }
            };

            const playAudio = () => {
                if (resolved) return;
                resolved = true;
                cleanup();

                if (audioChunks.length === 0) {
                    reject(new Error('No audio data received from Edge TTS'));
                    return;
                }

                // Concatenate chunks
                let totalLen = 0;
                for (const c of audioChunks) totalLen += c.byteLength;
                const merged = new Uint8Array(totalLen);
                let off = 0;
                for (const c of audioChunks) { merged.set(c, off); off += c.byteLength; }

                // Create audio element and play
                const blob = new Blob([merged.buffer], { type: 'audio/mpeg' });
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                this._audio = audio;
                this._playing = true;
                this._paused = false;

                audio.onended = () => {
                    this._playing = false;
                    this._paused = false;
                    URL.revokeObjectURL(url);
                    this._audio = null;
                    resolve();
                };

                audio.onerror = () => {
                    this._playing = false;
                    this._paused = false;
                    URL.revokeObjectURL(url);
                    this._audio = null;
                    reject(new Error('Audio playback error'));
                };

                audio.play().catch((e) => {
                    this._playing = false;
                    URL.revokeObjectURL(url);
                    this._audio = null;
                    reject(e);
                });
            };

            const fail = (msg) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                reject(new Error(msg));
            };

            const timeout = setTimeout(() => {
                if (!resolved) {
                    // If we have some audio, try to play it anyway
                    if (audioChunks.length > 0) {
                        playAudio();
                    } else {
                        fail('Edge TTS request timed out');
                    }
                }
            }, 30000);

            // Abort signal
            if (signal) {
                const onAbort = () => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        reject(new DOMException('Aborted', 'AbortError'));
                    }
                };
                signal.addEventListener('abort', onAbort, { once: true });
            }

            ws.onopen = () => {
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
                    `<voice name='${escapeXml(voiceName)}'>` +
                    `<prosody pitch='${escapeXml(pitchStr)}' rate='${escapeXml(rateStr)}' volume='+0%'>` +
                    escapeXml(trimmedText) +
                    `</prosody></voice></speak>`;

                ws.send(
                    `X-RequestId:${connectionId}\r\n` +
                    `Content-Type:application/ssml+xml\r\n` +
                    `X-Timestamp:${new Date().toISOString()}\r\n` +
                    `Path:ssml\r\n\r\n` +
                    ssml
                );
            };

            ws.onmessage = (event) => {
                if (resolved) return;

                if (typeof event.data === 'string') {
                    // Text frame — check for completion
                    if (event.data.includes('Path:turn.end')) {
                        playAudio();
                    }
                } else if (event.data instanceof ArrayBuffer) {
                    // Binary frame — extract audio after header
                    const buffer = event.data;
                    if (buffer.byteLength < 2) return;

                    try {
                        const view = new DataView(buffer);
                        const headerLen = view.getUint16(0);
                        if (2 + headerLen >= buffer.byteLength) return;
                        const audioData = new Uint8Array(buffer, 2 + headerLen);
                        if (audioData.byteLength > 0) {
                            audioChunks.push(audioData.slice());
                        }
                    } catch (_) { /* skip malformed frames */ }
                }
            };

            ws.onerror = () => {
                fail('Edge TTS WebSocket error');
            };

            ws.onclose = () => {
                if (!resolved) {
                    if (audioChunks.length > 0) {
                        playAudio(); // Graceful close with data
                    } else {
                        fail('Edge TTS WebSocket closed without audio');
                    }
                }
            };
        });
    }

    pause() {
        if (this._audio && this._playing) {
            this._audio.pause();
            this._paused = true;
        }
    }

    resume() {
        if (this._audio && this._paused) {
            this._audio.play();
            this._paused = false;
        }
    }

    stop() {
        if (this._ws) {
            try { this._ws.close(); } catch (_) { }
            this._ws = null;
        }
        if (this._audio) {
            this._audio.pause();
            this._audio.src = '';
            this._audio = null;
        }
        this._playing = false;
        this._paused = false;
    }
}

// ─── System Engine (Web Speech API) ──────────────────

class SystemTtsEngine {
    constructor() {
        this._utterance = null;
        this._playing = false;
        this._paused = false;
        this._voices = [];
        this._voicesLoaded = false;
        this._loadVoices();
    }

    get isPlaying() { return this._playing && !this._paused; }
    get isPaused() { return this._paused; }

    _loadVoices() {
        if (typeof window === 'undefined' || !window.speechSynthesis) return;
        const load = () => {
            this._voices = speechSynthesis.getVoices();
            this._voicesLoaded = true;
        };
        load();
        speechSynthesis.addEventListener('voiceschanged', load);
    }

    getVoices() {
        return this._voices.filter(v => v.lang.startsWith('en'));
    }

    _findVoice(voiceName) {
        if (!voiceName) return null;
        const name = voiceName.toLowerCase();
        return this._voices.find(v =>
            v.name.toLowerCase().includes(name) ||
            v.voiceURI.toLowerCase().includes(name)
        );
    }

    /**
     * Speak text using Web Speech API.
     * Safari has a bug where utterances >~15s stop silently,
     * so we chunk long text into sentences.
     */
    speak(text, voice, options = {}) {
        const { rate = 1.0, pitch = 1.0, signal } = options;

        this.stop();

        return new Promise((resolve, reject) => {
            if (typeof window === 'undefined' || !window.speechSynthesis) {
                reject(new Error('Speech synthesis not available'));
                return;
            }

            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            const utterance = new SpeechSynthesisUtterance(text);
            this._utterance = utterance;
            this._playing = true;
            this._paused = false;

            // Set voice
            const selectedVoice = this._findVoice(voice);
            if (selectedVoice) utterance.voice = selectedVoice;
            utterance.lang = 'en-US';
            utterance.rate = rate;
            utterance.pitch = pitch;

            utterance.onend = () => {
                this._playing = false;
                this._paused = false;
                this._utterance = null;
                resolve();
            };

            utterance.onerror = (e) => {
                if (e.error === 'canceled' || e.error === 'interrupted') {
                    reject(new DOMException('Aborted', 'AbortError'));
                } else {
                    reject(new Error(`Speech error: ${e.error}`));
                }
                this._playing = false;
                this._paused = false;
                this._utterance = null;
            };

            if (signal) {
                signal.addEventListener('abort', () => {
                    speechSynthesis.cancel();
                    this._playing = false;
                    this._paused = false;
                    this._utterance = null;
                    reject(new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            }

            // Safari workaround: resume periodically to prevent ~15s silence bug
            this._safariResumeTrick();

            speechSynthesis.speak(utterance);
        });
    }

    _safariResumeTrick() {
        // On Safari, speechSynthesis can pause silently after ~15s
        // Periodically calling resume() prevents this
        if (this._safariTimer) clearInterval(this._safariTimer);
        this._safariTimer = setInterval(() => {
            if (!this._playing || this._paused) {
                clearInterval(this._safariTimer);
                return;
            }
            if (speechSynthesis.speaking && !speechSynthesis.paused) {
                speechSynthesis.pause();
                speechSynthesis.resume();
            }
        }, 10000);
    }

    pause() {
        if (this._playing && window.speechSynthesis) {
            speechSynthesis.pause();
            this._paused = true;
        }
    }

    resume() {
        if (this._paused && window.speechSynthesis) {
            speechSynthesis.resume();
            this._paused = false;
        }
    }

    stop() {
        if (window?.speechSynthesis) {
            speechSynthesis.cancel();
        }
        if (this._safariTimer) clearInterval(this._safariTimer);
        this._playing = false;
        this._paused = false;
        this._utterance = null;
    }
}

// ─── Voice Assignment for Characters ─────────────────

/** Maps characters to persistent voice assignments for multi-voice TTS */
export class VoiceAssigner {
    constructor(engineType) {
        this._engineType = engineType;
        this._assignments = new Map(); // character name → voice
        this._maleIdx = 0;
        this._femaleIdx = 0;
    }

    /** Get voice for a given character + gender. Same character always gets same voice. */
    getVoice(character, gender = 'unknown') {
        if (!character || character === 'Narrator') {
            return this._engineType === 'cloud'
                ? EDGE_VOICES.narrator.female
                : null; // system default
        }

        const key = character.toLowerCase();
        if (this._assignments.has(key)) return this._assignments.get(key);

        let voice;
        if (this._engineType === 'cloud') {
            if (gender === 'female') {
                voice = EDGE_VOICES.female[this._femaleIdx % EDGE_VOICES.female.length];
                this._femaleIdx++;
            } else {
                voice = EDGE_VOICES.male[this._maleIdx % EDGE_VOICES.male.length];
                this._maleIdx++;
            }
        } else {
            // System voices — pick by gender if available
            voice = null; // Will use default
        }

        this._assignments.set(key, voice);
        return voice;
    }

    /** Get all current assignments */
    getAssignments() {
        return Object.fromEntries(this._assignments);
    }
}

// ─── Engine Factory ──────────────────────────────────

let _cloudEngine = null;
let _systemEngine = null;

export function getTtsEngine(engineType) {
    if (engineType === 'system') {
        if (!_systemEngine) _systemEngine = new SystemTtsEngine();
        return _systemEngine;
    }
    // Default to cloud (Edge TTS)
    if (!_cloudEngine) _cloudEngine = new CloudTtsEngine();
    return _cloudEngine;
}

export function stopAllEngines() {
    _cloudEngine?.stop();
    _systemEngine?.stop();
}
