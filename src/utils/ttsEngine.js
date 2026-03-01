/**
 * TTS Engine — abstraction layer for speech synthesis.
 * Supports:
 * 1. Web Speech API (system voices) — works offline, available everywhere
 * 2. Cloud (Edge TTS via Cloudflare proxy) — high quality neural voices, no download
 * 3. Kokoro.js (ONNX in-browser) — high quality, requires heavy model download
 *
 * The engine provides a unified interface for speaking text with different voices.
 */

// ─── Voice Presets (used for character mapping) ────────────

export const VOICE_PRESETS = {
    system: {
        narrator: { label: 'Narrator (Default)', gender: 'neutral', style: 'narrator' },
        male1: { label: 'Male Voice 1', gender: 'male', style: 'default' },
        male2: { label: 'Male Voice 2', gender: 'male', style: 'deep' },
        female1: { label: 'Female Voice 1', gender: 'female', style: 'default' },
        female2: { label: 'Female Voice 2', gender: 'female', style: 'warm' },
    },
    cloud: {
        narrator: { id: 'en-US-JennyNeural', label: 'Jenny (Narrator)', gender: 'female', style: 'narrator' },
        male1: { id: 'en-US-GuyNeural', label: 'Guy', gender: 'male', style: 'newscast' },
        male2: { id: 'en-US-DavisNeural', label: 'Davis', gender: 'male', style: 'calm' },
        male3: { id: 'en-US-JasonNeural', label: 'Jason', gender: 'male', style: 'cheerful' },
        male4: { id: 'en-GB-RyanNeural', label: 'Ryan', gender: 'male', style: 'british' },
        female1: { id: 'en-US-AriaNeural', label: 'Aria', gender: 'female', style: 'expressive' },
        female2: { id: 'en-US-SaraNeural', label: 'Sara', gender: 'female', style: 'warm' },
        female3: { id: 'en-GB-SoniaNeural', label: 'Sonia', gender: 'female', style: 'british' },
        female4: { id: 'en-US-NancyNeural', label: 'Nancy', gender: 'female', style: 'mature' },
    },
    kokoro: {
        narrator: { id: 'af_heart', label: 'Heart (Narrator)', gender: 'female', style: 'narrator' },
        male1: { id: 'am_adam', label: 'Adam', gender: 'male', style: 'default' },
        male2: { id: 'am_michael', label: 'Michael', gender: 'male', style: 'deep' },
        male3: { id: 'bm_george', label: 'George', gender: 'male', style: 'british' },
        male4: { id: 'bm_lewis', label: 'Lewis', gender: 'male', style: 'formal' },
        female1: { id: 'af_bella', label: 'Bella', gender: 'female', style: 'warm' },
        female2: { id: 'af_sarah', label: 'Sarah', gender: 'female', style: 'clear' },
        female3: { id: 'bf_emma', label: 'Emma', gender: 'female', style: 'british' },
        female4: { id: 'af_nicole', label: 'Nicole', gender: 'female', style: 'cheerful' },
    },
};

// ─── System TTS Engine (Web Speech API) ─────────────────

class SystemTTSEngine {
    constructor() {
        this.synth = window.speechSynthesis;
        this.voices = [];
        this.currentUtterance = null;
        this.onBoundary = null;
        this.onEnd = null;
        this.onError = null;
        this._voiceMap = {}; // gender → [voices]
        this._ready = false;
    }

    async init() {
        return new Promise((resolve) => {
            let resolved = false;
            const loadVoices = () => {
                this.voices = this.synth.getVoices();
                console.log(`[TTS] Voices loaded: ${this.voices.length}`);
                if (this.voices.length > 0 && !resolved) {
                    resolved = true;
                    this._categorizeVoices();
                    console.log(`[TTS] Voice categories — Male: ${this._voiceMap.male?.length}, Female: ${this._voiceMap.female?.length}, All: ${this._voiceMap.all?.length}`);
                    this._ready = true;
                    resolve(true);
                }
            };

            loadVoices();
            if (!resolved) {
                this.synth.onvoiceschanged = () => {
                    loadVoices();
                };
                // Timeout fallback
                setTimeout(() => {
                    if (!resolved) {
                        loadVoices();
                        if (!resolved) {
                            console.warn('[TTS] No voices found after timeout');
                            resolved = true;
                            resolve(false);
                        }
                    }
                }, 2000);
            }
        });
    }

    _categorizeVoices() {
        // Prefer English voices
        const enVoices = this.voices.filter(v =>
            v.lang.startsWith('en') || v.lang.startsWith('EN')
        );
        const voicesToUse = enVoices.length > 0 ? enVoices : this.voices;

        this._voiceMap = {
            male: voicesToUse.filter(v =>
                /\b(male|man|david|james|daniel|mark|george|guy|thomas|alex|aaron)\b/i.test(v.name)
            ),
            female: voicesToUse.filter(v =>
                /\b(female|woman|samantha|karen|victoria|fiona|kate|zira|susan|moira|tessa)\b/i.test(v.name)
            ),
            all: voicesToUse,
        };

        // If no gender-specific voices found, split the available voices
        if (this._voiceMap.male.length === 0 && this._voiceMap.female.length === 0) {
            const half = Math.floor(voicesToUse.length / 2);
            this._voiceMap.male = voicesToUse.slice(0, half);
            this._voiceMap.female = voicesToUse.slice(half);
        }
    }

    get isReady() {
        return this._ready;
    }

    getAvailableVoices() {
        const presets = [];
        const { male, female, all } = this._voiceMap;

        // Create voice presets from available system voices
        presets.push({
            id: 'system-default',
            name: 'Default',
            gender: 'neutral',
            style: 'narrator',
            systemVoice: all[0] || null,
        });

        male.slice(0, 3).forEach((v, i) => {
            presets.push({
                id: `system-male-${i}`,
                name: v.name.split(' ')[0] || `Male ${i + 1}`,
                gender: 'male',
                style: 'default',
                systemVoice: v,
            });
        });

        female.slice(0, 3).forEach((v, i) => {
            presets.push({
                id: `system-female-${i}`,
                name: v.name.split(' ')[0] || `Female ${i + 1}`,
                gender: 'female',
                style: 'default',
                systemVoice: v,
            });
        });

        return presets;
    }

    async speak(text, voiceId, rate = 1.0, pitch = 1.0) {
        if (!this.synth) {
            throw new Error('Speech synthesis not available');
        }

        if (!text || text.trim().length === 0) {
            console.warn('[TTS] Empty text, skipping');
            return;
        }

        // Cancel any currently speaking utterance with a delay
        // Chrome bug: cancel() + speak() without delay cancels the new utterance too
        if (this.synth.speaking || this.synth.pending) {
            this.synth.cancel();
            await new Promise(r => setTimeout(r, 100));
        }

        return new Promise((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = Math.max(0.1, Math.min(3.0, rate));
            utterance.pitch = Math.max(0.1, Math.min(2.0, pitch));
            utterance.lang = 'en-US';

            // Find the voice by ID
            const voicePreset = this.getAvailableVoices().find(v => v.id === voiceId);
            if (voicePreset?.systemVoice) {
                utterance.voice = voicePreset.systemVoice;
            } else if (this._voiceMap.all?.length > 0) {
                utterance.voice = this._voiceMap.all[0];
            }
            // If no voice found at all, don't set .voice — browser uses default

            console.log('[TTS] Speaking:', text.substring(0, 50) + '...', 'voice:', utterance.voice?.name || 'default');

            let resolved = false;

            utterance.onboundary = (event) => {
                if (this.onBoundary) {
                    this.onBoundary({
                        charIndex: event.charIndex,
                        charLength: event.charLength || 0,
                        name: event.name,
                    });
                }
            };

            utterance.onend = () => {
                if (resolved) return;
                resolved = true;
                this.currentUtterance = null;
                if (this.onEnd) this.onEnd();
                resolve();
            };

            utterance.onerror = (event) => {
                if (resolved) return;
                resolved = true;
                this.currentUtterance = null;
                console.warn('[TTS] Utterance error:', event.error);
                if (event.error === 'interrupted' || event.error === 'canceled') {
                    resolve(); // Not a real error — user stopped it
                } else {
                    if (this.onError) this.onError(event);
                    reject(new Error(`TTS error: ${event.error}`));
                }
            };

            this.currentUtterance = utterance;
            this.synth.speak(utterance);

            // Safety: if nothing happens after 10 seconds, resolve anyway
            setTimeout(() => {
                if (!resolved && !this.synth.speaking) {
                    console.warn('[TTS] Utterance timed out, advancing');
                    resolved = true;
                    this.currentUtterance = null;
                    resolve();
                }
            }, Math.max(10000, text.length * 100));

            // iOS Safari fix: speechSynthesis can pause itself after ~15 seconds
            this._iosKeepAlive();
        });
    }

    // iOS Safari has a bug where speech pauses after ~15 seconds
    _iosKeepAlive() {
        if (this._iosTimer) clearInterval(this._iosTimer);
        this._iosTimer = setInterval(() => {
            if (this.synth.speaking && !this.synth.paused) {
                this.synth.pause();
                this.synth.resume();
            } else {
                clearInterval(this._iosTimer);
            }
        }, 14000);
    }

    pause() {
        if (this.synth.speaking) {
            this.synth.pause();
        }
    }

    resume() {
        if (this.synth.paused) {
            this.synth.resume();
        }
    }

    stop() {
        if (this._iosTimer) clearInterval(this._iosTimer);
        this.synth.cancel();
        this.currentUtterance = null;
    }

    get speaking() {
        return this.synth.speaking;
    }

    get paused() {
        return this.synth.paused;
    }

    destroy() {
        this.stop();
        this.onBoundary = null;
        this.onEnd = null;
        this.onError = null;
    }
}

// ─── WAV Helper ─────────────────────────────────────────

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

/**
 * Convert a Float32Array of audio samples to a WAV Blob.
 */
function float32ToWavBlob(samples, sampleRate) {
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);       // chunk size
    view.setUint16(20, 1, true);        // PCM format
    view.setUint16(22, 1, true);        // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);        // block align
    view.setUint16(34, 16, true);       // bits per sample

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Float32 → Int16 conversion
    for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Create a tiny silent WAV blob (100ms) — used to "unlock" Audio on iOS.
 */
export function createSilentWavBlob() {
    const sampleRate = 24000;
    const numSamples = Math.floor(sampleRate * 0.1); // 100ms
    const samples = new Float32Array(numSamples); // all zeros = silence
    return float32ToWavBlob(samples, sampleRate);
}

// ─── Kokoro TTS Engine (ONNX WebAssembly) ───────────────

class KokoroTTSEngine {
    constructor() {
        this._kokoro = null;
        this._ready = false;
        this._loading = false;
        this._audioElement = null;  // HTML Audio element (unlocked on user gesture)
        this._currentBlobUrl = null;
        this.onBoundary = null;
        this.onEnd = null;
        this.onError = null;
        this._stopped = false;
        this._paused = false;
        this._endResolve = null;
    }

    /**
     * Set a pre-warmed Audio element (must be created + played on user gesture).
     */
    setAudioElement(el) {
        this._audioElement = el;
        console.log('[Kokoro] Audio element set (pre-warmed)');
    }

    async init() {
        if (this._ready) return true;
        if (this._loading) return false;
        this._loading = true;

        try {
            console.log('[Kokoro] Importing kokoro-js module...');
            const { KokoroTTS } = await import('kokoro-js');
            console.log('[Kokoro] Module loaded, downloading model (this may take a minute)...');
            this._kokoro = await KokoroTTS.from_pretrained(
                'onnx-community/Kokoro-82M-v1.0-ONNX',
                { dtype: 'q8' } // Quantized for smaller size + faster on mobile
            );
            console.log('[Kokoro] Model loaded successfully!');
            this._ready = true;
            this._loading = false;
            return true;
        } catch (err) {
            console.error('[Kokoro] Failed to load:', err);
            console.error('[Kokoro] This may be due to missing Cross-Origin-Isolation headers.');
            console.error('[Kokoro] Falling back to system TTS.');
            this._loading = false;
            return false;
        }
    }

    get isReady() {
        return this._ready;
    }

    get isLoading() {
        return this._loading;
    }

    getAvailableVoices() {
        return Object.entries(VOICE_PRESETS.kokoro).map(([key, preset]) => ({
            id: preset.id,
            name: preset.label,
            gender: preset.gender,
            style: preset.style,
        }));
    }

    async speak(text, voiceId, rate = 1.0) {
        if (!this._kokoro) throw new Error('Kokoro not initialized');
        if (!text || text.trim().length === 0) return;
        this._stopped = false;
        this._paused = false;

        try {
            console.log('[Kokoro] Generating audio for:', text.substring(0, 50) + '...');
            // Generate audio
            const audio = await this._kokoro.generate(text, {
                voice: voiceId || 'af_heart',
                speed: rate,
            });

            if (this._stopped) return;

            const samples = audio.audio;
            const sampleRate = audio.sampling_rate || 24000;
            console.log(`[Kokoro] Audio generated — ${samples.length} samples, ${sampleRate}Hz, duration: ${(samples.length / sampleRate).toFixed(2)}s`);

            if (!samples || samples.length === 0) {
                console.warn('[Kokoro] Empty audio buffer, skipping');
                return;
            }

            // Convert to WAV blob
            const wavBlob = float32ToWavBlob(samples, sampleRate);
            const blobUrl = URL.createObjectURL(wavBlob);

            // Clean up previous blob URL
            if (this._currentBlobUrl) {
                URL.revokeObjectURL(this._currentBlobUrl);
            }
            this._currentBlobUrl = blobUrl;

            // Ensure we have an audio element
            if (!this._audioElement) {
                console.warn('[Kokoro] No pre-warmed audio element, creating one (may not play on iOS)');
                this._audioElement = new Audio();
            }

            const el = this._audioElement;
            el.src = blobUrl;
            el.playbackRate = 1.0; // Rate is already baked into the Kokoro output

            // Wait if paused
            if (this._paused) {
                await new Promise(resolve => { this._endResolve = resolve; });
                if (this._stopped) return;
            }

            return new Promise((resolve, reject) => {
                const onEnded = () => {
                    cleanup();
                    if (this.onEnd && !this._stopped) this.onEnd();
                    resolve();
                };

                const onError = (e) => {
                    cleanup();
                    console.error('[Kokoro] Audio playback error:', e);
                    if (this.onError && !this._stopped) this.onError(e);
                    reject(new Error('Audio playback failed'));
                };

                const cleanup = () => {
                    el.removeEventListener('ended', onEnded);
                    el.removeEventListener('error', onError);
                };

                el.addEventListener('ended', onEnded, { once: true });
                el.addEventListener('error', onError, { once: true });

                console.log('[Kokoro] Playing audio...');
                const playPromise = el.play();
                if (playPromise) {
                    playPromise.catch(err => {
                        console.error('[Kokoro] play() rejected:', err);
                        cleanup();
                        reject(err);
                    });
                }
            });

        } catch (err) {
            if (this._stopped) return;
            console.error('[Kokoro] speak error:', err);
            if (this.onError) this.onError(err);
            throw err;
        }
    }

    pause() {
        this._paused = true;
        if (this._audioElement && !this._audioElement.paused) {
            this._audioElement.pause();
        }
    }

    resume() {
        this._paused = false;
        if (this._endResolve) {
            this._endResolve();
            this._endResolve = null;
        }
        if (this._audioElement && this._audioElement.paused && this._audioElement.src) {
            this._audioElement.play().catch(() => {});
        }
    }

    stop() {
        this._stopped = true;
        this._paused = false;
        if (this._endResolve) {
            this._endResolve();
            this._endResolve = null;
        }
        if (this._audioElement) {
            this._audioElement.pause();
            this._audioElement.currentTime = 0;
        }
    }

    get speaking() {
        return this._audioElement ? !this._audioElement.paused : false;
    }

    get paused() {
        return this._paused;
    }

    destroy() {
        this.stop();
        if (this._currentBlobUrl) {
            URL.revokeObjectURL(this._currentBlobUrl);
            this._currentBlobUrl = null;
        }
        if (this._audioElement) {
            this._audioElement.pause();
            this._audioElement.removeAttribute('src');
            this._audioElement = null;
        }
        this._kokoro = null;
        this._ready = false;
        this.onBoundary = null;
        this.onEnd = null;
        this.onError = null;
    }
}

// ─── Edge TTS Helper Functions ──────────────────────────

const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

function _escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _makeTimestamp() {
    return new Date().toISOString();
}

function _makeConfigPayload(outputFormat) {
    return [
        `X-Timestamp:${_makeTimestamp()}`,
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
}

function _makeSsmlPayload(requestId, text, voice, rate, pitch) {
    const rateStr = rate >= 0 ? `+${rate}%` : `${rate}%`;
    const pitchStr = pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;

    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody pitch='${pitchStr}' rate='${rateStr}' volume='+0%'>` +
        `${_escapeXml(text)}` +
        `</prosody></voice></speak>`;

    return [
        `X-RequestId:${requestId}`,
        'Content-Type:application/ssml+xml',
        `X-Timestamp:${_makeTimestamp()}`,
        'Path:ssml',
        '',
        ssml,
    ].join('\r\n');
}

/**
 * Synthesize text to MP3 audio via Edge TTS WebSocket (direct from browser).
 * Returns a Blob of audio/mpeg.
 */
async function edgeTtsSynthesize(text, voice, rate = 0, pitch = 0) {
    const connectionId = crypto.randomUUID().replace(/-/g, '');
    const requestId = crypto.randomUUID().replace(/-/g, '');
    const wsUrl = `${EDGE_TTS_URL}?TrustedClientToken=${EDGE_TTS_TOKEN}&ConnectionId=${connectionId}`;
    const outputFormat = 'audio-24khz-48kbitrate-mono-mp3';

    return new Promise((resolve, reject) => {
        let ws;
        try {
            ws = new WebSocket(wsUrl);
        } catch (e) {
            reject(new Error(`WebSocket creation failed: ${e.message}`));
            return;
        }

        ws.binaryType = 'arraybuffer';
        const audioChunks = [];

        const timeout = setTimeout(() => {
            try { ws.close(); } catch (_) {}
            if (audioChunks.length > 0) {
                resolve(_concatChunks(audioChunks));
            } else {
                reject(new Error('Edge TTS timeout (30s)'));
            }
        }, 30000);

        ws.onopen = () => {
            ws.send(_makeConfigPayload(outputFormat));
            ws.send(_makeSsmlPayload(requestId, text, voice, rate, pitch));
        };

        ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                if (event.data.includes('Path:turn.end')) {
                    clearTimeout(timeout);
                    try { ws.close(); } catch (_) {}
                    resolve(_concatChunks(audioChunks));
                }
            } else {
                // Binary: 2-byte header length, then text header, then audio
                const data = event.data; // ArrayBuffer
                if (data.byteLength < 2) return;

                const view = new DataView(data);
                const headerLen = view.getUint16(0);
                if (2 + headerLen >= data.byteLength) return;

                // Check if this is an audio chunk
                const headerBytes = new Uint8Array(data, 2, headerLen);
                const headerText = new TextDecoder('ascii').decode(headerBytes);

                if (headerText.includes('Path:audio')) {
                    audioChunks.push(data.slice(2 + headerLen));
                }
            }
        };

        ws.onerror = (e) => {
            clearTimeout(timeout);
            console.error('[Edge TTS] WebSocket error:', e);
            reject(new Error('Edge TTS WebSocket error'));
        };

        ws.onclose = () => {
            clearTimeout(timeout);
            // If we haven't resolved/rejected yet
            if (audioChunks.length > 0) {
                resolve(_concatChunks(audioChunks));
            }
        };
    });
}

function _concatChunks(chunks) {
    const total = chunks.reduce((s, c) => s + c.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }
    return new Blob([result], { type: 'audio/mpeg' });
}

// ─── Cloud TTS Engine (Edge TTS — direct browser WebSocket) ───

class CloudTTSEngine {
    constructor() {
        this._audioElement = null;
        this._currentBlobUrl = null;
        this._ready = false;
        this._stopped = false;
        this._paused = false;
        this._endResolve = null;
        this._prefetchCache = new Map(); // text|voice → Promise<Blob>
        this.onBoundary = null;
        this.onEnd = null;
        this.onError = null;
    }

    async init() {
        this._ready = true;
        console.log('[Cloud TTS] Engine ready (Edge TTS direct WebSocket)');
        return true;
    }

    get isReady() { return this._ready; }
    get isLoading() { return false; }

    setAudioElement(el) {
        this._audioElement = el;
        console.log('[Cloud TTS] Audio element set (pre-warmed)');
    }

    getAvailableVoices() {
        return Object.entries(VOICE_PRESETS.cloud).map(([key, preset]) => ({
            id: preset.id,
            name: preset.label,
            gender: preset.gender,
            style: preset.style,
        }));
    }

    /**
     * Pre-fetch audio for the next segment while the current one plays.
     */
    prefetch(text, voiceId, rate = 1.0, pitch = 1.0) {
        if (!text?.trim()) return;
        const key = `${text}|${voiceId}`;
        if (!this._prefetchCache.has(key)) {
            const ratePercent = Math.round((rate - 1) * 100);
            const pitchHz = Math.round((pitch - 1) * 50);
            this._prefetchCache.set(
                key,
                edgeTtsSynthesize(text, voiceId || 'en-US-JennyNeural', ratePercent, pitchHz)
                    .catch(err => { console.warn('[Cloud TTS] Prefetch failed:', err.message); return null; })
            );
        }
    }

    async speak(text, voiceId, rate = 1.0, pitch = 1.0) {
        if (!text?.trim()) return;
        this._stopped = false;
        this._paused = false;

        try {
            console.log('[Cloud TTS] Synthesizing:', text.substring(0, 50) + '...');

            const ratePercent = Math.round((rate - 1) * 100);
            const pitchHz = Math.round((pitch - 1) * 50);

            // Check prefetch cache first
            const key = `${text}|${voiceId}`;
            let audioBlob;
            if (this._prefetchCache.has(key)) {
                audioBlob = await this._prefetchCache.get(key);
                this._prefetchCache.delete(key);
                if (audioBlob) console.log('[Cloud TTS] Using prefetched audio');
            }

            if (!audioBlob) {
                audioBlob = await edgeTtsSynthesize(
                    text,
                    voiceId || 'en-US-JennyNeural',
                    ratePercent,
                    pitchHz
                );
            }

            if (this._stopped) return;
            if (!audioBlob || audioBlob.size === 0) {
                console.warn('[Cloud TTS] Empty audio received');
                return;
            }

            console.log(`[Cloud TTS] Audio: ${(audioBlob.size / 1024).toFixed(1)}KB`);

            // Create blob URL for playback
            if (this._currentBlobUrl) URL.revokeObjectURL(this._currentBlobUrl);
            this._currentBlobUrl = URL.createObjectURL(audioBlob);

            if (!this._audioElement) {
                console.warn('[Cloud TTS] No pre-warmed audio element, creating fallback');
                this._audioElement = new Audio();
            }

            const el = this._audioElement;
            el.src = this._currentBlobUrl;

            // Wait if paused
            if (this._paused) {
                await new Promise(resolve => { this._endResolve = resolve; });
                if (this._stopped) return;
            }

            return new Promise((resolve, reject) => {
                const onEnded = () => {
                    cleanup();
                    if (this.onEnd && !this._stopped) this.onEnd();
                    resolve();
                };
                const onError = (e) => {
                    cleanup();
                    console.error('[Cloud TTS] Playback error:', e);
                    if (this.onError && !this._stopped) this.onError(e);
                    reject(new Error('Audio playback failed'));
                };
                const cleanup = () => {
                    el.removeEventListener('ended', onEnded);
                    el.removeEventListener('error', onError);
                };

                el.addEventListener('ended', onEnded, { once: true });
                el.addEventListener('error', onError, { once: true });

                console.log('[Cloud TTS] Playing...');
                const playPromise = el.play();
                if (playPromise) {
                    playPromise.catch(err => {
                        console.error('[Cloud TTS] play() rejected:', err);
                        cleanup();
                        reject(err);
                    });
                }
            });
        } catch (err) {
            if (this._stopped) return;
            console.error('[Cloud TTS] Error:', err);
            if (this.onError) this.onError(err);
            throw err;
        }
    }

    pause() {
        this._paused = true;
        if (this._audioElement && !this._audioElement.paused) {
            this._audioElement.pause();
        }
    }

    resume() {
        this._paused = false;
        if (this._endResolve) {
            this._endResolve();
            this._endResolve = null;
        }
        if (this._audioElement?.paused && this._audioElement.src) {
            this._audioElement.play().catch(() => {});
        }
    }

    stop() {
        this._stopped = true;
        this._paused = false;
        if (this._endResolve) {
            this._endResolve();
            this._endResolve = null;
        }
        if (this._audioElement) {
            this._audioElement.pause();
            this._audioElement.currentTime = 0;
        }
    }

    get speaking() {
        return this._audioElement ? !this._audioElement.paused : false;
    }

    get paused() {
        return this._paused;
    }

    destroy() {
        this.stop();
        this._prefetchCache.clear();
        if (this._currentBlobUrl) {
            URL.revokeObjectURL(this._currentBlobUrl);
            this._currentBlobUrl = null;
        }
        if (this._audioElement) {
            this._audioElement.pause();
            this._audioElement.removeAttribute('src');
            this._audioElement = null;
        }
        this._ready = false;
        this.onBoundary = null;
        this.onEnd = null;
        this.onError = null;
    }
}

// ─── Engine Factory ─────────────────────────────────────

/**
 * Create a TTS engine based on the specified type.
 * @param {'system'|'cloud'|'kokoro'} type
 * @returns {SystemTTSEngine|CloudTTSEngine|KokoroTTSEngine}
 */
export function createTTSEngine(type = 'cloud') {
    if (type === 'cloud') return new CloudTTSEngine();
    if (type === 'kokoro') return new KokoroTTSEngine();
    return new SystemTTSEngine();
}

/**
 * Check if Kokoro.js model is available in cache.
 */
export async function isKokoroModelCached() {
    try {
        const cache = await caches.open('transformers-cache');
        const keys = await cache.keys();
        return keys.some(k => k.url.includes('Kokoro'));
    } catch {
        return false;
    }
}

/**
 * Get the appropriate voice ID for a character based on engine type.
 */
export function getVoiceForCharacter(engineType, gender, characterIndex = 0) {
    const presets = VOICE_PRESETS[engineType] || VOICE_PRESETS.system;
    const voiceKeys = Object.keys(presets);

    if (gender === 'female') {
        const femaleKeys = voiceKeys.filter(k => presets[k].gender === 'female');
        return femaleKeys[characterIndex % femaleKeys.length] || voiceKeys[0];
    }
    if (gender === 'male') {
        const maleKeys = voiceKeys.filter(k => presets[k].gender === 'male');
        return maleKeys[characterIndex % maleKeys.length] || voiceKeys[0];
    }

    return 'narrator';
}
