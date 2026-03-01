/**
 * ttsEngine.js
 *
 * TTS engine factory — two engines:
 *   • cloud  — Microsoft Edge Neural Voices via /api/tts server endpoint
 *   • system — Web Speech API (offline fallback)
 *
 * Each engine implements: init(), speak(), stop(), pause(), resume(),
 * destroy(), prefetch(), setAudioElement(), isReady
 */

// ── Voice Presets ─────────────────────────────────────────

export const VOICE_PRESETS = {
    cloud: {
        narrator:   { id: 'en-US-GuyNeural',           gender: 'male',   label: 'Guy (Narrator)' },
        male1:      { id: 'en-US-DavisNeural',         gender: 'male',   label: 'Davis' },
        male2:      { id: 'en-US-ChristopherNeural',   gender: 'male',   label: 'Christopher' },
        male3:      { id: 'en-GB-RyanNeural',          gender: 'male',   label: 'Ryan (British)' },
        male4:      { id: 'en-US-EricNeural',          gender: 'male',   label: 'Eric' },
        male5:      { id: 'en-US-RogerNeural',         gender: 'male',   label: 'Roger' },
        female1:    { id: 'en-US-AriaNeural',          gender: 'female', label: 'Aria' },
        female2:    { id: 'en-US-JennyNeural',         gender: 'female', label: 'Jenny' },
        female3:    { id: 'en-US-MichelleNeural',      gender: 'female', label: 'Michelle' },
        female4:    { id: 'en-GB-SoniaNeural',         gender: 'female', label: 'Sonia (British)' },
        female5:    { id: 'en-US-SaraNeural',          gender: 'female', label: 'Sara' },
    },
    system: {
        narrator:   { id: 'system-default', gender: 'male',   label: 'Default' },
        male1:      { id: 'system-male-0',  gender: 'male',   label: 'Male 1' },
        male2:      { id: 'system-male-1',  gender: 'male',   label: 'Male 2' },
        female1:    { id: 'system-female-0', gender: 'female', label: 'Female 1' },
        female2:    { id: 'system-female-1', gender: 'female', label: 'Female 2' },
    },
};

// ── Silent WAV blob (for iOS audio unlock) ────────────────

export function createSilentWavBlob() {
    const sampleRate = 8000;
    const numSamples = sampleRate;
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + numSamples, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    writeString(view, 36, 'data');
    view.setUint32(40, numSamples, true);
    new Uint8Array(buffer, 44).fill(128);

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

// ── Cloud Engine (Edge TTS via /api/tts server endpoint) ──

function createCloudEngine() {
    let audioEl = null;
    let currentObjectUrl = null;
    let ready = false;
    let aborted = false;
    let resolvePlay = null;

    const prefetchCache = new Map();

    function cacheKey(text, voice, rate, pitch) {
        return `${voice}|${rate}|${pitch}|${text.substring(0, 100)}`;
    }

    async function fetchAudio(text, voice, rate, pitch) {
        const resp = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice, rate, pitch }),
        });
        if (!resp.ok) {
            const err = await resp.text().catch(() => resp.statusText);
            throw new Error(`TTS API error ${resp.status}: ${err}`);
        }
        return resp.blob();
    }

    return {
        type: 'cloud',

        get isReady() { return ready; },

        async init() {
            try {
                const resp = await fetch('/api/tts?test=1', {
                    signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
                });
                const data = await resp.json();
                if (data.ok) {
                    ready = true;
                    console.log('[TTS] Edge TTS Cloud engine ready (server WebSocket OK)');
                    return true;
                }
                console.warn('[TTS] Edge TTS server test failed:', data.error);
                return false;
            } catch (e) {
                console.warn('[TTS] Edge TTS init error:', e.message);
                return false;
            }
        },

        setAudioElement(el) {
            audioEl = el;
        },

        async speak(text, voice, rate, pitch) {
            aborted = false;
            const key = cacheKey(text, voice, rate, pitch);
            let audioBlob;

            if (prefetchCache.has(key)) {
                audioBlob = prefetchCache.get(key);
                prefetchCache.delete(key);
            } else {
                audioBlob = await fetchAudio(text, voice, rate || 1.0, pitch || 1.0);
            }

            if (aborted) return;

            return new Promise((resolve, reject) => {
                resolvePlay = resolve;

                if (!audioEl) {
                    audioEl = new Audio();
                    audioEl.volume = 1.0;
                }

                if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);

                currentObjectUrl = URL.createObjectURL(audioBlob);
                audioEl.src = currentObjectUrl;
                audioEl.playbackRate = 1.0;

                audioEl.onended = () => { resolvePlay = null; resolve(); };
                audioEl.onerror = () => { resolvePlay = null; reject(new Error('Audio playback failed')); };

                if (aborted) { resolvePlay = null; resolve(); return; }

                audioEl.play().catch(e => { resolvePlay = null; reject(e); });
            });
        },

        async prefetch(text, voice, rate, pitch) {
            const key = cacheKey(text, voice, rate, pitch);
            if (prefetchCache.has(key)) return;
            try {
                const blob = await fetchAudio(text, voice, rate || 1.0, pitch || 1.0);
                prefetchCache.set(key, blob);
                if (prefetchCache.size > 5) {
                    prefetchCache.delete(prefetchCache.keys().next().value);
                }
            } catch { /* best-effort */ }
        },

        stop() {
            aborted = true;
            if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; }
            if (resolvePlay) { resolvePlay(); resolvePlay = null; }
        },

        pause() { if (audioEl) audioEl.pause(); },

        resume() { if (audioEl) audioEl.play().catch(() => {}); },

        destroy() {
            this.stop();
            if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
            prefetchCache.clear();
            audioEl = null;
            ready = false;
        },
    };
}

// ── System Engine (Web Speech API) ────────────────────────

function createSystemEngine() {
    let ready = false;
    let currentUtterance = null;
    let resolvePlay = null;
    let aborted = false;

    let systemVoices = [];
    let maleVoices = [];
    let femaleVoices = [];

    function loadVoices() {
        systemVoices = window.speechSynthesis?.getVoices() || [];
        const english = systemVoices.filter(v => v.lang?.startsWith('en'));
        maleVoices = english.filter(v =>
            /\bmale\b/i.test(v.name) || /\bguy\b/i.test(v.name) ||
            /\bdavid\b/i.test(v.name) || /\bjames\b/i.test(v.name) ||
            /\bdaniel\b/i.test(v.name) || /\bmark\b/i.test(v.name)
        );
        femaleVoices = english.filter(v =>
            /\bfemale\b/i.test(v.name) || /\bwoman\b/i.test(v.name) ||
            /\bzira\b/i.test(v.name) || /\bsam\b/i.test(v.name) ||
            /\bkaren\b/i.test(v.name) || /\bfiona\b/i.test(v.name) ||
            /\bvictoria\b/i.test(v.name)
        );

        if (maleVoices.length === 0 && femaleVoices.length === 0 && english.length > 1) {
            maleVoices = english.filter((_, i) => i % 2 === 0);
            femaleVoices = english.filter((_, i) => i % 2 === 1);
        }
    }

    function getVoice(voiceId) {
        if (voiceId === 'system-default') {
            return systemVoices.find(v => v.default) || systemVoices[0] || null;
        }
        const match = voiceId.match(/system-(male|female)-(\d+)/);
        if (match) {
            const pool = match[1] === 'male' ? maleVoices : femaleVoices;
            const idx = parseInt(match[2], 10);
            return pool[idx % pool.length] || systemVoices[0] || null;
        }
        return systemVoices[0] || null;
    }

    return {
        type: 'system',

        get isReady() { return ready; },

        async init() {
            if (!window.speechSynthesis) return false;

            return new Promise((resolve) => {
                loadVoices();
                if (systemVoices.length > 0) {
                    ready = true;
                    resolve(true);
                    return;
                }
                window.speechSynthesis.onvoiceschanged = () => {
                    loadVoices();
                    ready = systemVoices.length > 0;
                    resolve(ready);
                };
                setTimeout(() => {
                    loadVoices();
                    ready = systemVoices.length > 0;
                    resolve(ready);
                }, 3000);
            });
        },

        setAudioElement() {},

        async speak(text, voiceId, rate, pitch) {
            aborted = false;
            if (!window.speechSynthesis) throw new Error('Speech synthesis not available');

            return new Promise((resolve, reject) => {
                resolvePlay = resolve;

                const utterance = new SpeechSynthesisUtterance(text);
                const voice = getVoice(voiceId);
                if (voice) utterance.voice = voice;
                utterance.rate = Math.max(0.1, Math.min(10, rate || 1.0));
                utterance.pitch = Math.max(0, Math.min(2, pitch || 1.0));
                utterance.volume = 1.0;

                utterance.onend = () => { currentUtterance = null; resolvePlay = null; resolve(); };
                utterance.onerror = (e) => {
                    currentUtterance = null;
                    resolvePlay = null;
                    if (e.error === 'canceled' || aborted) resolve();
                    else reject(new Error(`Speech error: ${e.error}`));
                };

                currentUtterance = utterance;
                if (aborted) { resolvePlay = null; resolve(); return; }
                window.speechSynthesis.speak(utterance);
            });
        },

        async prefetch() {},

        stop() {
            aborted = true;
            window.speechSynthesis?.cancel();
            currentUtterance = null;
            if (resolvePlay) { resolvePlay(); resolvePlay = null; }
        },

        pause() { window.speechSynthesis?.pause(); },

        resume() { window.speechSynthesis?.resume(); },

        destroy() {
            this.stop();
            ready = false;
        },
    };
}

// ── Factory ───────────────────────────────────────────────

export function createTTSEngine(type) {
    switch (type) {
        case 'cloud':
            return createCloudEngine();
        case 'system':
            return createSystemEngine();
        default:
            console.warn(`Unknown TTS engine type "${type}", falling back to system`);
            return createSystemEngine();
    }
}
