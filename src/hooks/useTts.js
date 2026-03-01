/**
 * useTts — React hook that orchestrates TTS playback in the EPUB reader.
 *
 * Responsibilities:
 * - Extract text from current chapter (via iframe DOM)
 * - Parse dialogue / identify speakers
 * - Manage the TTS engine lifecycle (Cloud or System)
 * - Highlight current sentence in the iframe
 * - Auto-advance pages/chapters when TTS reaches the end
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { extractChapterText, createTtsSegments } from '../utils/ttsTextExtractor';
import { parseDialogue, assignVoicesToCharacters } from '../utils/dialogueParser';
import { createTTSEngine, VOICE_PRESETS, createSilentWavBlob } from '../utils/ttsEngine';
import { saveDialogueAnalysis, getDialogueAnalysis } from '../db';

/**
 * @param {Object} params
 * @param {React.RefObject} params.renditionRef — epub.js rendition
 * @param {React.RefObject} params.viewerRef — viewer container div
 * @param {Object} params.settings — current settings
 * @param {string} params.bookId — current book ID
 */
export default function useTts({ renditionRef, viewerRef, settings, bookId }) {
    const [ttsActive, setTtsActive] = useState(false);
    const [ttsPlaying, setTtsPlaying] = useState(false);
    const [ttsPaused, setTtsPaused] = useState(false);
    const [ttsLoading, setTtsLoading] = useState(false);
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
    const [currentSpeaker, setCurrentSpeaker] = useState(null);
    const [totalSegments, setTotalSegments] = useState(0);

    const engineRef = useRef(null);
    const segmentsRef = useRef([]);
    const voiceAssignmentRef = useRef({});
    const parsedDataRef = useRef(null);
    const stoppedRef = useRef(false);
    const activeRef = useRef(false);
    const settingsRef = useRef(settings);
    const audioElRef = useRef(null);

    useEffect(() => { settingsRef.current = settings; }, [settings]);

    // ── Initialize / change engine ──────────────────────────
    const initEngine = useCallback(async (engineType) => {
        if (engineRef.current) {
            engineRef.current.destroy();
        }

        const engine = createTTSEngine(engineType);
        const success = await engine.init();

        if (success) {
            engineRef.current = engine;
            return true;
        }

        // Fallback to system engine
        if (engineType !== 'system') {
            console.warn(`[TTS] ${engineType} engine failed, falling back to system`);
            const fallback = createTTSEngine('system');
            await fallback.init();
            engineRef.current = fallback;
            return true;
        }

        return false;
    }, []);

    // ── Get iframe document ─────────────────────────────────
    const getIframeDoc = useCallback(() => {
        const iframe = viewerRef.current?.querySelector('iframe')
            || renditionRef.current?.manager?.container?.querySelector('iframe');
        if (!iframe) return null;
        try {
            return iframe.contentDocument || iframe.contentWindow?.document;
        } catch {
            return null;
        }
    }, [viewerRef, renditionRef]);

    // ── Highlight current segment ───────────────────────────
    const highlightSegment = useCallback((segmentIndex) => {
        const doc = getIframeDoc();
        if (!doc) return;

        // Remove existing highlights
        const existing = doc.querySelectorAll('.tts-highlight');
        existing.forEach(el => {
            const parent = el.parentNode;
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            parent.normalize();
        });

        const blocks = doc.querySelectorAll('.tts-highlight-block');
        blocks.forEach(el => el.classList.remove('tts-highlight-block'));

        if (segmentIndex < 0 || segmentIndex >= segmentsRef.current.length) return;
        if (!settingsRef.current.ttsHighlight) return;

        const segment = segmentsRef.current[segmentIndex];
        if (!segment?.element) return;

        const element = segment.element;
        const searchText = segment.text.substring(0, 60);

        try {
            const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node;
            let found = false;

            while ((node = walker.nextNode())) {
                const nodeText = node.textContent;
                const idx = nodeText.indexOf(searchText.substring(0, Math.min(30, searchText.length)));

                if (idx !== -1 && !found) {
                    found = true;
                    const span = doc.createElement('span');
                    span.className = 'tts-highlight';
                    node.parentNode.insertBefore(span, node);
                    span.appendChild(node);

                    span.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                    });
                    break;
                }
            }

            if (!found && element !== doc.body) {
                element.classList.add('tts-highlight-block');
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } catch (err) {
            console.warn('Highlight failed:', err);
        }
    }, [getIframeDoc]);

    // ── Remove all highlights ───────────────────────────────
    const clearHighlights = useCallback(() => {
        const doc = getIframeDoc();
        if (!doc) return;

        const highlights = doc.querySelectorAll('.tts-highlight');
        highlights.forEach(el => {
            const parent = el.parentNode;
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            parent.normalize();
        });

        const blocks = doc.querySelectorAll('.tts-highlight-block');
        blocks.forEach(el => el.classList.remove('tts-highlight-block'));
    }, [getIframeDoc]);

    // ── Get voice for a segment ─────────────────────────────
    const getVoiceForSegment = useCallback((segment) => {
        const engineType = settingsRef.current.ttsEngine || 'cloud';
        const presets = VOICE_PRESETS[engineType] || VOICE_PRESETS.cloud;
        const assignment = voiceAssignmentRef.current;
        const multiVoice = settingsRef.current.ttsMultiVoice;

        if (!multiVoice || segment.segType === 'narration' || !segment.speaker) {
            return settingsRef.current.ttsNarratorVoice || presets.narrator.id;
        }

        // Character voice — use assignment
        if (assignment[segment.speaker]) {
            return assignment[segment.speaker];
        }

        // Auto-assign based on gender
        const malePool = Object.values(presets).filter(p => p.gender === 'male' && p !== presets.narrator);
        const femalePool = Object.values(presets).filter(p => p.gender === 'female');

        if (segment.gender === 'female' && femalePool.length > 0) {
            const voice = femalePool[0].id;
            assignment[segment.speaker] = voice;
            return voice;
        } else if (segment.gender === 'male' && malePool.length > 0) {
            const voice = malePool[0].id;
            assignment[segment.speaker] = voice;
            return voice;
        }

        // Default for unknown gender
        const fallback = malePool.length > 0 ? malePool[0].id : presets.narrator.id;
        assignment[segment.speaker] = fallback;
        return fallback;
    }, []);

    // ── Speak a single segment ──────────────────────────────
    const speakSegment = useCallback(async (index) => {
        if (stoppedRef.current || !activeRef.current) return false;

        const engine = engineRef.current;
        const segments = segmentsRef.current;

        if (!engine || index >= segments.length || index < 0) return false;

        const segment = segments[index];
        setCurrentSegmentIndex(index);
        setCurrentSpeaker(segment.speaker || 'Narrator');

        highlightSegment(index);

        const voiceId = getVoiceForSegment(segment);
        const rate = settingsRef.current.ttsRate || 1.0;
        const pitch = settingsRef.current.ttsPitch || 1.0;

        try {
            await engine.speak(segment.text, voiceId, rate, pitch);
            return true;
        } catch (err) {
            if (stoppedRef.current) return false;
            console.warn('TTS speak failed:', err);
            return false;
        }
    }, [highlightSegment, getVoiceForSegment]);

    // ── Build voice assignment from characters ──────────────
    const buildVoiceAssignment = useCallback((characters) => {
        const engineType = settingsRef.current.ttsEngine || 'cloud';
        const presets = VOICE_PRESETS[engineType] || VOICE_PRESETS.cloud;

        const allVoices = Object.entries(presets)
            .filter(([key]) => key !== 'narrator')
            .map(([_, v]) => v);

        const narratorVoice = settingsRef.current.ttsNarratorVoice || presets.narrator.id;

        return assignVoicesToCharacters(characters, allVoices, narratorVoice);
    }, []);

    // ── Playback loop ───────────────────────────────────────
    const playFromIndex = useCallback(async (startIndex) => {
        stoppedRef.current = false;
        setTtsPlaying(true);
        setTtsPaused(false);

        let consecutiveFailures = 0;
        const MAX_FAILURES = 3;

        for (let i = startIndex; i < segmentsRef.current.length; i++) {
            if (stoppedRef.current || !activeRef.current) break;

            // Prefetch next segment
            if (i + 1 < segmentsRef.current.length && engineRef.current?.prefetch) {
                const nextSeg = segmentsRef.current[i + 1];
                const nextVoice = getVoiceForSegment(nextSeg);
                const rate = settingsRef.current.ttsRate || 1.0;
                const pitch = settingsRef.current.ttsPitch || 1.0;
                engineRef.current.prefetch(nextSeg.text, nextVoice, rate, pitch);
            }

            const success = await speakSegment(i);
            if (!success && stoppedRef.current) break;
            if (!success) {
                consecutiveFailures++;
                console.warn(`[TTS] Segment ${i} failed (${consecutiveFailures}/${MAX_FAILURES})`);
                if (consecutiveFailures >= MAX_FAILURES) {
                    console.error('[TTS] Too many consecutive failures, stopping');
                    stoppedRef.current = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 200));
                continue;
            }
            consecutiveFailures = 0;
        }

        // Auto-advance to next chapter
        if (!stoppedRef.current && activeRef.current && consecutiveFailures < MAX_FAILURES) {
            if (settingsRef.current.ttsAutoAdvance) {
                const rendition = renditionRef.current;
                if (rendition) {
                    clearHighlights();
                    console.log('[TTS] Auto-advancing to next chapter...');

                    await rendition.next();
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    const doc = getIframeDoc();
                    if (doc && activeRef.current && !stoppedRef.current) {
                        const blocks = extractChapterText(doc);
                        if (blocks.length === 0) {
                            console.warn('[TTS] New chapter has no text, stopping');
                        } else {
                            const rawSegments = createTtsSegments(blocks);
                            const parsed = parseDialogue(rawSegments);

                            segmentsRef.current = parsed.segments;
                            parsedDataRef.current = parsed;
                            setTotalSegments(parsed.segments.length);

                            if (parsed.characters && Object.keys(parsed.characters).length > 0) {
                                Object.assign(voiceAssignmentRef.current, buildVoiceAssignment(parsed.characters));
                            }

                            playFromIndex(0);
                            return;
                        }
                    }
                }
            }

            // Done playing
            setTtsPlaying(false);
            setCurrentSegmentIndex(-1);
            setCurrentSpeaker(null);
            clearHighlights();
        }
    }, [speakSegment, getVoiceForSegment, renditionRef, getIframeDoc, clearHighlights, buildVoiceAssignment]);

    // ── Public API ──────────────────────────────────────────

    const startTts = useCallback(async () => {
        setTtsLoading(true);

        try {
            // ── Warm up audio on user gesture (iOS requirement) ──
            if (window.speechSynthesis) {
                const warmUp = new SpeechSynthesisUtterance('');
                warmUp.volume = 0;
                window.speechSynthesis.speak(warmUp);
                window.speechSynthesis.cancel();
            }

            const engineType = settingsRef.current.ttsEngine || 'cloud';

            // HTML Audio element warm-up for Cloud engine (iOS needs play() in gesture)
            if (engineType === 'cloud') {
                if (!audioElRef.current) {
                    const el = new Audio();
                    el.volume = 1.0;
                    const silentBlob = createSilentWavBlob();
                    el.src = URL.createObjectURL(silentBlob);
                    try {
                        await el.play();
                        console.log('[TTS] Audio element unlocked on user gesture');
                    } catch (e) {
                        console.warn('[TTS] Audio warm-up failed:', e);
                    }
                    audioElRef.current = el;
                }
            }

            // Initialize engine
            if (!engineRef.current || !engineRef.current.isReady) {
                const ok = await initEngine(engineType);
                if (!ok) {
                    console.error('TTS engine failed to initialize');
                    setTtsLoading(false);
                    return;
                }

                if (engineType === 'cloud' && audioElRef.current && engineRef.current?.setAudioElement) {
                    engineRef.current.setAudioElement(audioElRef.current);
                }
            }

            // Extract text from current chapter
            const doc = getIframeDoc();
            if (!doc) {
                console.error('Cannot access iframe document');
                setTtsLoading(false);
                return;
            }

            const blocks = extractChapterText(doc);
            if (blocks.length === 0) {
                console.warn('No text found in chapter');
                setTtsLoading(false);
                return;
            }

            const rawSegments = createTtsSegments(blocks);
            const parsed = parseDialogue(rawSegments);

            // Try to use cached dialogue analysis for better voice assignments
            try {
                const chapterHref = renditionRef.current?.location?.start?.href || '0';
                const cached = await getDialogueAnalysis(bookId, chapterHref);
                if (cached?.characters) {
                    for (const [name, info] of Object.entries(cached.characters)) {
                        if (parsed.characters[name] && info.gender !== 'unknown') {
                            parsed.characters[name].gender = info.gender;
                        }
                    }
                    for (const seg of parsed.segments) {
                        if (seg.speaker && parsed.characters[seg.speaker]) {
                            seg.gender = parsed.characters[seg.speaker].gender;
                        }
                    }
                }
            } catch {
                // Cache miss is fine
            }

            segmentsRef.current = parsed.segments;
            parsedDataRef.current = parsed;
            setTotalSegments(parsed.segments.length);

            // Build voice assignments
            if (parsed.characters && Object.keys(parsed.characters).length > 0) {
                voiceAssignmentRef.current = buildVoiceAssignment(parsed.characters);

                // Cache analysis for next time
                try {
                    const chapterHref = renditionRef.current?.location?.start?.href || '0';
                    await saveDialogueAnalysis({
                        id: `${bookId}-${chapterHref}`,
                        bookId,
                        chapterIndex: chapterHref,
                        segments: parsed.segments.map(s => ({
                            text: s.text.substring(0, 100),
                            segType: s.segType,
                            speaker: s.speaker,
                            gender: s.gender,
                        })),
                        characters: parsed.characters,
                    });
                } catch { /* ignore cache errors */ }
            }

            setTtsActive(true);
            activeRef.current = true;
            setTtsLoading(false);

            playFromIndex(0);

        } catch (err) {
            console.error('TTS start failed:', err);
            setTtsLoading(false);
        }
    }, [initEngine, getIframeDoc, buildVoiceAssignment, playFromIndex, bookId, renditionRef]);

    const stopTts = useCallback(() => {
        stoppedRef.current = true;
        activeRef.current = false;
        if (engineRef.current) {
            engineRef.current.stop();
        }
        clearHighlights();
        setTtsActive(false);
        setTtsPlaying(false);
        setTtsPaused(false);
        setCurrentSegmentIndex(-1);
        setCurrentSpeaker(null);
        setTotalSegments(0);
        segmentsRef.current = [];
    }, [clearHighlights]);

    const pauseTts = useCallback(() => {
        if (engineRef.current) {
            engineRef.current.pause();
        }
        setTtsPlaying(false);
        setTtsPaused(true);
    }, []);

    const resumeTts = useCallback(() => {
        if (engineRef.current) {
            engineRef.current.resume();
        }
        setTtsPaused(false);
        setTtsPlaying(true);
    }, []);

    const nextSegment = useCallback(() => {
        const nextIdx = currentSegmentIndex + 1;
        if (nextIdx < segmentsRef.current.length) {
            if (engineRef.current) engineRef.current.stop();
            stoppedRef.current = false;
            playFromIndex(nextIdx);
        }
    }, [currentSegmentIndex, playFromIndex]);

    const prevSegment = useCallback(() => {
        const prevIdx = Math.max(0, currentSegmentIndex - 1);
        if (engineRef.current) engineRef.current.stop();
        stoppedRef.current = false;
        playFromIndex(prevIdx);
    }, [currentSegmentIndex, playFromIndex]);

    // ── Cleanup on unmount ──────────────────────────────────
    useEffect(() => {
        return () => {
            stoppedRef.current = true;
            activeRef.current = false;
            if (engineRef.current) {
                engineRef.current.destroy();
                engineRef.current = null;
            }
            if (audioElRef.current) {
                audioElRef.current.pause();
                audioElRef.current.removeAttribute('src');
                audioElRef.current = null;
            }
        };
    }, []);

    // ── Re-initialize engine when type changes ─────────────
    useEffect(() => {
        if (engineRef.current && ttsActive) {
            const currentType = engineRef.current.type;
            if (currentType !== settings.ttsEngine) {
                stopTts();
            }
        }
    }, [settings.ttsEngine]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        ttsActive,
        ttsPlaying,
        ttsPaused,
        ttsLoading,
        currentSegmentIndex,
        currentSpeaker,
        totalSegments,

        startTts,
        stopTts,
        pauseTts,
        resumeTts,
        nextSegment,
        prevSegment,
    };
}
