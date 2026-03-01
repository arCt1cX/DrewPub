/**
 * tts.js — Web Speech API engine for DrewPub.
 * Uses native window.speechSynthesis for a 100% free, offline solution.
 */

/**
 * Get all available system voices, filtered by language (default English).
 * SpeechSynthesis.getVoices() is async-like, might need multiple attempts.
 */
export function getSystemVoices(langPrefix = 'en') {
    const voices = window.speechSynthesis.getVoices();
    return voices.filter(v => v.lang.startsWith(langPrefix));
}

/**
 * Heuristic to guess voice gender from its name.
 */
export function guessVoiceGender(voiceName) {
    const name = voiceName.toLowerCase();
    const femaleNames = ['samantha', 'victoria', 'karen', 'moira', 'tessa', 'siri', 'catherine', 'alice', 'veena', 'meijia'];
    const maleNames = ['daniel', 'arthur', 'rishi', 'aaron', 'fred', 'alex', 'nathan', 'clara']; // clara is sometimes male in system labels or neutral

    if (femaleNames.some(fn => name.includes(fn))) return 'female';
    if (maleNames.some(mn => name.includes(mn))) return 'male';

    // Generic iOS labels
    if (name.includes('female')) return 'female';
    if (name.includes('male')) return 'male';

    return 'unknown';
}

/**
 * TTSPlayer class — manages playback using native SpeechSynthesis.
 */
export class TTSPlayer {
    constructor() {
        this.utterance = null;
        this.chunks = [];         // array of { text, voiceType, speaker }
        this.currentIndex = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.voices = {
            narrator: '', // Voice URI or Name
            male: '',
            female: '',
        };
        this.rate = 1.0;
        this.onStateChange = null;  // callback(state)
        this.onChunkChange = null;  // callback(index, chunk)
        this.onComplete = null;     // callback()
        this.onError = null;        // callback(error)
        this._aborted = false;
    }

    /**
     * Set chunks and start playback.
     */
    async start(chunks, voices, rate) {
        window.speechSynthesis.cancel(); // Stop any current speech
        this.chunks = chunks;
        this.voices = voices;
        this.rate = rate;
        this.currentIndex = 0;
        this.isPlaying = true;
        this.isPaused = false;
        this._aborted = false;

        this._notifyState();
        this._playNext();
    }

    /**
     * Play the next chunk in the queue.
     */
    _playNext() {
        if (this._aborted || this.currentIndex >= this.chunks.length) {
            if (!this._aborted) {
                this.isPlaying = false;
                this._notifyState();
                this.onComplete?.();
            }
            return;
        }

        const chunk = this.chunks[this.currentIndex];
        this.onChunkChange?.(this.currentIndex, chunk);

        const utt = new SpeechSynthesisUtterance(chunk.text);

        // Find the selected voice object
        const voiceId = this._getVoiceForChunk(chunk);
        const allVoices = window.speechSynthesis.getVoices();
        const selectedVoice = allVoices.find(v => v.voiceURI === voiceId || v.name === voiceId) ||
            allVoices.find(v => v.lang.startsWith('en')) ||
            allVoices[0];

        utt.voice = selectedVoice;
        utt.rate = this.rate;
        utt.pitch = 1.0;
        utt.volume = 1.0;

        utt.onend = () => {
            if (!this._aborted && !this.isPaused) {
                this.currentIndex++;
                this._playNext();
                this._notifyState();
            }
        };

        utt.onerror = (event) => {
            if (event.error === 'interrupted' || event.error === 'canceled') return;
            console.error('TTS Utterance Error:', event);
            this.onError?.(new Error(`System speech error: ${event.error}`));
        };

        this.utterance = utt;
        window.speechSynthesis.speak(utt);
    }

    _getVoiceForChunk(chunk) {
        if (chunk.voiceType === 'female') return this.voices.female;
        if (chunk.voiceType === 'male') return this.voices.male;
        return this.voices.narrator;
    }

    pause() {
        if (!this.isPlaying) return;
        this.isPaused = true;
        window.speechSynthesis.pause();
        this._notifyState();
    }

    resume() {
        if (!this.isPlaying || !this.isPaused) return;
        this.isPaused = false;
        window.speechSynthesis.resume();
        // Bug in some browsers: resume doesn't always work, might need to restart if stalled
        if (!window.speechSynthesis.speaking) {
            this._playNext();
        }
        this._notifyState();
    }

    stop() {
        this._aborted = true;
        this.isPlaying = false;
        this.isPaused = false;
        this.currentIndex = 0;
        window.speechSynthesis.cancel();
        this._notifyState();
    }

    skipForward() {
        if (!this.isPlaying) return;
        window.speechSynthesis.cancel();
        this.currentIndex = Math.min(this.chunks.length - 1, this.currentIndex + 1);
        this._playNext();
    }

    skipBack() {
        if (!this.isPlaying) return;
        window.speechSynthesis.cancel();
        this.currentIndex = Math.max(0, this.currentIndex - 1);
        this._playNext();
    }

    setRate(rate) {
        this.rate = rate;
        // Native API doesn't allow changing rate mid-utterance reliably,
        // it will apply to the next chunk.
    }

    _notifyState() {
        this.onStateChange?.({
            isPlaying: this.isPlaying,
            isPaused: this.isPaused,
            currentIndex: this.currentIndex,
            totalChunks: this.chunks.length,
        });
    }

    destroy() {
        this.stop();
    }
}
