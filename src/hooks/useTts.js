import { useState, useRef, useCallback, useEffect } from 'react';
import { getTtsEngine, VoiceAssigner, stopAllEngines } from '../utils/tts';
import { analyzeChapter } from '../utils/dialogueAnalyzer';

/**
 * useTts — React hook for Text-to-Speech playback in the ePub reader.
 *
 * Handles:
 * - Text extraction from epubjs iframe
 * - Dialogue analysis & character voice assignment
 * - Audio playback with segment cycling
 * - Sentence highlighting in the iframe
 * - Auto-advance pages when TTS reaches non-visible content
 * - Prefetch next segments for gapless playback
 */
export default function useTts({ renditionRef, viewerRef, settings, bookId }) {
    // ── State ────────────────────────────────────────────
    const [ttsActive, setTtsActive] = useState(false);
    const [ttsPlaying, setTtsPlaying] = useState(false);
    const [ttsPaused, setTtsPaused] = useState(false);
    const [ttsLoading, setTtsLoading] = useState(false);
    const [currentSpeaker, setCurrentSpeaker] = useState('Narrator');
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
    const [totalSegments, setTotalSegments] = useState(0);

    // ── Refs ─────────────────────────────────────────────
    const segmentsRef = useRef([]);
    const currentIndexRef = useRef(0);
    const voiceAssignerRef = useRef(null);
    const engineRef = useRef(null);
    const abortRef = useRef(null);
    const activeRef = useRef(false);
    const highlightedElRef = useRef(null);
    const settingsRef = useRef(settings);

    useEffect(() => { settingsRef.current = settings; }, [settings]);

    // ── Helpers ──────────────────────────────────────────

    /** Get the iframe document from the epub viewer */
    const getIframeDoc = useCallback(() => {
        const iframe = viewerRef.current?.querySelector('iframe');
        if (!iframe) return null;
        try {
            return iframe.contentDocument || iframe.contentWindow?.document;
        } catch (_) {
            return null;
        }
    }, [viewerRef]);

    /** Highlight a DOM element in the iframe */
    const highlightElement = useCallback((element) => {
        // Remove previous highlight
        if (highlightedElRef.current) {
            highlightedElRef.current.classList.remove('tts-highlight', 'tts-highlight-block');
        }

        if (element && settingsRef.current.ttsHighlight !== false) {
            element.classList.add('tts-highlight-block');
            highlightedElRef.current = element;

            // Scroll element into view if needed (for both modes)
            try {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (_) { }
        } else {
            highlightedElRef.current = null;
        }
    }, []);

    /** Clear all highlights */
    const clearHighlights = useCallback(() => {
        if (highlightedElRef.current) {
            highlightedElRef.current.classList.remove('tts-highlight', 'tts-highlight-block');
            highlightedElRef.current = null;
        }
        // Also clear any stale highlights in iframe
        const doc = getIframeDoc();
        if (doc) {
            doc.querySelectorAll('.tts-highlight, .tts-highlight-block').forEach(el => {
                el.classList.remove('tts-highlight', 'tts-highlight-block');
            });
        }
    }, [getIframeDoc]);

    /** Analyze current chapter and build segments list */
    const analyzeCurrentChapter = useCallback(() => {
        const doc = getIframeDoc();
        if (!doc) return { segments: [], characters: {} };

        const engineType = settingsRef.current.ttsEngine || 'cloud';
        const multiVoice = settingsRef.current.ttsMultiVoice !== false;
        const result = analyzeChapter(doc, multiVoice);

        // Set up voice assigner
        voiceAssignerRef.current = new VoiceAssigner(engineType);

        // Pre-assign voices to known characters
        if (multiVoice && result.characters) {
            for (const [name, info] of Object.entries(result.characters)) {
                voiceAssignerRef.current.getVoice(name, info.gender);
            }
        }

        return result;
    }, [getIframeDoc]);

    /** Get the voice for a segment */
    const getVoiceForSegment = useCallback((segment) => {
        if (!voiceAssignerRef.current) return null;
        if (!settingsRef.current.ttsMultiVoice || segment.type !== 'dialogue') {
            return voiceAssignerRef.current.getVoice('Narrator', 'unknown');
        }
        return voiceAssignerRef.current.getVoice(segment.character, segment.gender);
    }, []);

    // ── Playback ─────────────────────────────────────────

    /** Play a single segment. Returns when segment finishes or is aborted. */
    const playSegment = useCallback(async (index) => {
        const segments = segmentsRef.current;
        if (index < 0 || index >= segments.length) return false;

        const segment = segments[index];
        const engine = engineRef.current;
        if (!engine || !activeRef.current) return false;

        const s = settingsRef.current;
        const voice = getVoiceForSegment(segment);

        currentIndexRef.current = index;
        setCurrentSegmentIndex(index);
        setCurrentSpeaker(segment.character || 'Narrator');

        // Highlight
        highlightElement(segment.element);

        try {
            setTtsPlaying(true);
            setTtsPaused(false);

            await engine.speak(segment.text, voice, {
                rate: s.ttsRate || 1.0,
                pitch: s.ttsPitch || 1.0,
                signal: abortRef.current?.signal,
            });

            return true; // Segment completed
        } catch (err) {
            if (err.name === 'AbortError') return false;

            // If cloud engine fails, try system fallback
            if (s.ttsEngine !== 'system') {
                console.warn('Cloud TTS failed, trying system fallback:', err.message);
                try {
                    const fallback = getTtsEngine('system');
                    await fallback.speak(segment.text, null, {
                        rate: s.ttsRate || 1.0,
                        pitch: s.ttsPitch || 1.0,
                        signal: abortRef.current?.signal,
                    });
                    return true;
                } catch (fallbackErr) {
                    if (fallbackErr.name === 'AbortError') return false;
                    console.error('Both TTS engines failed:', fallbackErr);
                    return true; // Skip segment on failure
                }
            }
            return true; // Skip on error
        }
    }, [getVoiceForSegment, highlightElement]);

    /** Main playback loop — plays segments sequentially */
    const playbackLoop = useCallback(async (startIndex = 0) => {
        const segments = segmentsRef.current;
        let idx = startIndex;

        while (idx < segments.length && activeRef.current) {
            const completed = await playSegment(idx);
            if (!completed || !activeRef.current) break;
            idx++;
        }

        // Reached end of chapter
        if (activeRef.current && idx >= segments.length) {
            // Try auto-advance to next chapter
            if (settingsRef.current.ttsAutoAdvance !== false) {
                const advanced = await advanceChapter();
                if (advanced) return; // New playback loop started
            }
        }

        // Stop if we exited the loop
        if (activeRef.current) {
            doStop();
        }
    }, [playSegment]);

    /** Try to advance to next chapter and continue TTS */
    const advanceChapter = useCallback(async () => {
        const rendition = renditionRef.current;
        if (!rendition) return false;

        try {
            await rendition.next();

            // Wait for new content to render
            await new Promise(resolve => setTimeout(resolve, 500));

            // Re-analyze new chapter
            const { segments } = analyzeCurrentChapter();
            if (segments.length === 0) return false;

            segmentsRef.current = segments;
            setTotalSegments(segments.length);

            // Start playing from beginning of new chapter
            playbackLoop(0);
            return true;
        } catch (_) {
            return false;
        }
    }, [renditionRef, analyzeCurrentChapter, playbackLoop]);

    // ── Public Controls ──────────────────────────────────

    const startTts = useCallback(async () => {
        // Stop any existing playback
        doStop();

        setTtsActive(true);
        setTtsLoading(true);
        activeRef.current = true;

        // Create abort controller
        abortRef.current = new AbortController();

        // Get/create engine
        const engineType = settingsRef.current.ttsEngine || 'cloud';
        engineRef.current = getTtsEngine(engineType);

        // Analyze chapter
        const { segments } = analyzeCurrentChapter();
        if (segments.length === 0) {
            setTtsLoading(false);
            setTtsActive(false);
            activeRef.current = false;
            return;
        }

        segmentsRef.current = segments;
        setTotalSegments(segments.length);
        setTtsLoading(false);

        // Start playback loop
        playbackLoop(0);
    }, [analyzeCurrentChapter, playbackLoop]);

    const pauseTts = useCallback(() => {
        if (engineRef.current) {
            engineRef.current.pause();
            setTtsPlaying(false);
            setTtsPaused(true);
        }
    }, []);

    const resumeTts = useCallback(() => {
        if (engineRef.current) {
            engineRef.current.resume();
            setTtsPlaying(true);
            setTtsPaused(false);
        }
    }, []);

    const doStop = useCallback(() => {
        activeRef.current = false;
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }
        stopAllEngines();
        clearHighlights();
        setTtsActive(false);
        setTtsPlaying(false);
        setTtsPaused(false);
        setTtsLoading(false);
        setCurrentSegmentIndex(0);
        setTotalSegments(0);
        setCurrentSpeaker('Narrator');
    }, [clearHighlights]);

    const stopTts = useCallback(() => {
        doStop();
    }, [doStop]);

    const nextSegment = useCallback(() => {
        const segments = segmentsRef.current;
        const nextIdx = currentIndexRef.current + 1;
        if (nextIdx >= segments.length) return;

        // Abort current playback
        if (abortRef.current) {
            abortRef.current.abort();
        }
        abortRef.current = new AbortController();

        const engineType = settingsRef.current.ttsEngine || 'cloud';
        engineRef.current = getTtsEngine(engineType);

        // Start from next segment
        playbackLoop(nextIdx);
    }, [playbackLoop]);

    const prevSegment = useCallback(() => {
        const prevIdx = Math.max(0, currentIndexRef.current - 1);

        // Abort current playback
        if (abortRef.current) {
            abortRef.current.abort();
        }
        abortRef.current = new AbortController();

        const engineType = settingsRef.current.ttsEngine || 'cloud';
        engineRef.current = getTtsEngine(engineType);

        // Start from previous segment
        playbackLoop(prevIdx);
    }, [playbackLoop]);

    // ── Cleanup on unmount ───────────────────────────────
    useEffect(() => {
        return () => {
            activeRef.current = false;
            if (abortRef.current) abortRef.current.abort();
            stopAllEngines();
        };
    }, []);

    // ── Re-analyze when chapter changes (relocated event) ──
    useEffect(() => {
        if (!ttsActive || !activeRef.current) return;

        // When the rendition navigates to a new chapter while TTS is active,
        // we need to re-analyze. The Reader.jsx 'relocated' handler will trigger
        // a re-render. We listen for it via a small delay after chapter change.
    }, [ttsActive]);

    return {
        ttsActive,
        ttsPlaying,
        ttsPaused,
        ttsLoading,
        currentSpeaker,
        currentSegmentIndex,
        totalSegments,
        kokoroLoading: false, // kept for backward compat with existing Reader.jsx
        startTts,
        pauseTts,
        resumeTts,
        stopTts,
        nextSegment,
        prevSegment,
    };
}
