/**
 * TTS Engine — abstraction layer for speech synthesis.
 * Supports:
 * 1. Web Speech API (system voices) — works offline, available everywhere
 * 2. Kokoro.js (ONNX in-browser) — high quality, requires model download
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

// ─── Kokoro TTS Engine (ONNX WebAssembly) ───────────────

class KokoroTTSEngine {
    constructor() {
        this._kokoro = null;
        this._ready = false;
        this._loading = false;
        this._audioContext = null;
        this._currentSource = null;
        this.onBoundary = null;
        this.onEnd = null;
        this.onError = null;
        this._stopped = false;
        this._paused = false;
        this._pauseResolve = null;
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
            console.log('[Kokoro] Audio generated, playing...');

            if (this._stopped) return;

            // Wait if paused
            if (this._paused) {
                await new Promise(resolve => { this._pauseResolve = resolve; });
                if (this._stopped) return;
            }

            // Play via AudioContext
            if (!this._audioContext) {
                this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Ensure audio context is running
            if (this._audioContext.state === 'suspended') {
                await this._audioContext.resume();
            }

            // Convert to AudioBuffer
            const samples = audio.audio;
            const sampleRate = audio.sampling_rate || 24000;
            const audioBuffer = this._audioContext.createBuffer(1, samples.length, sampleRate);
            audioBuffer.getChannelData(0).set(samples);

            return new Promise((resolve, reject) => {
                const source = this._audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this._audioContext.destination);

                this._currentSource = source;

                source.onended = () => {
                    this._currentSource = null;
                    if (this.onEnd && !this._stopped) this.onEnd();
                    resolve();
                };

                source.start(0);
            });

        } catch (err) {
            if (this._stopped) return;
            if (this.onError) this.onError(err);
            throw err;
        }
    }

    pause() {
        this._paused = true;
        if (this._audioContext && this._audioContext.state === 'running') {
            this._audioContext.suspend();
        }
    }

    resume() {
        this._paused = false;
        if (this._pauseResolve) {
            this._pauseResolve();
            this._pauseResolve = null;
        }
        if (this._audioContext && this._audioContext.state === 'suspended') {
            this._audioContext.resume();
        }
    }

    stop() {
        this._stopped = true;
        this._paused = false;
        if (this._pauseResolve) {
            this._pauseResolve();
            this._pauseResolve = null;
        }
        if (this._currentSource) {
            try { this._currentSource.stop(); } catch (_) { }
            this._currentSource = null;
        }
    }

    get speaking() {
        return this._currentSource !== null && !this._paused;
    }

    get paused() {
        return this._paused;
    }

    destroy() {
        this.stop();
        if (this._audioContext) {
            this._audioContext.close().catch(() => { });
            this._audioContext = null;
        }
        this._kokoro = null;
        this._ready = false;
        this.onBoundary = null;
        this.onEnd = null;
        this.onError = null;
    }
}

// ─── Engine Factory ─────────────────────────────────────

/**
 * Create a TTS engine based on the specified type.
 * @param {'system'|'kokoro'|'auto'} type
 * @returns {SystemTTSEngine|KokoroTTSEngine}
 */
export function createTTSEngine(type = 'system') {
    if (type === 'kokoro') {
        return new KokoroTTSEngine();
    }
    if (type === 'auto') {
        // Try Kokoro first, fall back to system
        // For now, default to system since Kokoro requires explicit download
        return new SystemTTSEngine();
    }
    return new SystemTTSEngine();
}

/**
 * Check if Kokoro.js model is available in cache.
 */
export async function isKokoroModelCached() {
    try {
        // Check if the model files are in the browser's Cache API
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

    // Default to narrator
    return 'narrator';
}
