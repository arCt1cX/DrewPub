/**
 * useTts — React hook that orchestrates TTS playback in the EPUB reader.
 *
 * Responsibilities:
 * - Extract text from current chapter (via iframe DOM)
 * - Parse dialogue / identify speakers
 * - Manage the TTS engine lifecycle
 * - Highlight current sentence in the iframe
 * - Auto-advance pages/chapters when TTS reaches the end
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { extractChapterText, createTtsSegments } from '../utils/ttsTextExtractor';
import { parseDialogue, assignVoicesToCharacters } from '../utils/dialogueParser';
import { createTTSEngine, VOICE_PRESETS } from '../utils/ttsEngine';
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
    const [engineReady, setEngineReady] = useState(false);
    const [kokoroLoading, setKokoroLoading] = useState(false);

    const engineRef = useRef(null);
    const segmentsRef = useRef([]);
    const voiceAssignmentRef = useRef({});
    const parsedDataRef = useRef(null);
    const stoppedRef = useRef(false);
    const activeRef = useRef(false);
    const settingsRef = useRef(settings);

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
            setEngineReady(true);
            return true;
        }

        // Fallback to system engine
        if (engineType !== 'system') {
            const fallback = createTTSEngine('system');
            await fallback.init();
            engineRef.current = fallback;
            setEngineReady(true);
            return true;
        }

        setEngineReady(false);
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
            // Unwrap the highlight span
            const parent = el.parentNode;
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            parent.normalize(); // Merge adjacent text nodes
        });

        if (segmentIndex < 0 || segmentIndex >= segmentsRef.current.length) return;
        if (!settingsRef.current.ttsHighlight) return;

        const segment = segmentsRef.current[segmentIndex];
        if (!segment?.element) return;

        // Find the text in the element and wrap it
        const element = segment.element;
        const searchText = segment.text.substring(0, 60); // Use first 60 chars for matching

        try {
            const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node;
            let found = false;

            while ((node = walker.nextNode())) {
                const nodeText = node.textContent;
                const idx = nodeText.indexOf(searchText.substring(0, Math.min(30, searchText.length)));

                if (idx !== -1 && !found) {
                    found = true;
                    // Wrap the entire text node (simpler, more reliable)
                    const span = doc.createElement('span');
                    span.className = 'tts-highlight';
                    node.parentNode.insertBefore(span, node);
                    span.appendChild(node);

                    // Scroll into view
                    span.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                    });
                    break;
                }
            }

            // If text not found in individual nodes, highlight the whole element
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
        const engineType = settingsRef.current.ttsEngine || 'system';
        const presets = VOICE_PRESETS[engineType] || VOICE_PRESETS.system;
        const assignment = voiceAssignmentRef.current;
        const multiVoice = settingsRef.current.ttsMultiVoice;

        if (!multiVoice || segment.segType === 'narration' || !segment.speaker) {
            // Use narrator voice
            const narratorPreset = presets.narrator;
            if (engineType === 'kokoro') {
                return settingsRef.current.ttsNarratorVoice || narratorPreset.id;
            }
            return settingsRef.current.ttsNarratorVoice || 'system-default';
        }

        // Character voice
        if (assignment[segment.speaker]) {
            return assignment[segment.speaker];
        }

        // Auto-assign based on gender
        if (segment.gender === 'female') {
            const femalePresets = Object.values(presets).filter(p => p.gender === 'female');
            if (femalePresets.length > 0) {
                const voiceId = engineType === 'kokoro' ? femalePresets[0].id : 'system-female-0';
                assignment[segment.speaker] = voiceId;
                return voiceId;
            }
        } else if (segment.gender === 'male') {
            const malePresets = Object.values(presets).filter(p => p.gender === 'male');
            if (malePresets.length > 0) {
                const voiceId = engineType === 'kokoro' ? malePresets[0].id : 'system-male-0';
                assignment[segment.speaker] = voiceId;
                return voiceId;
            }
        }

        // Default
        return engineType === 'kokoro' ? presets.narrator.id : 'system-default';
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

        // Highlight
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

    // ── Playback loop ───────────────────────────────────────
    const playFromIndex = useCallback(async (startIndex) => {
        stoppedRef.current = false;
        setTtsPlaying(true);
        setTtsPaused(false);

        let consecutiveFailures = 0;
        const MAX_FAILURES = 3;

        for (let i = startIndex; i < segmentsRef.current.length; i++) {
            if (stoppedRef.current || !activeRef.current) break;

            const success = await speakSegment(i);
            if (!success && stoppedRef.current) break;
            if (!success) {
                consecutiveFailures++;
                console.warn(`[TTS] Segment ${i} failed (${consecutiveFailures}/${MAX_FAILURES})`);
                if (consecutiveFailures >= MAX_FAILURES) {
                    console.error('[TTS] Too many consecutive failures, stopping playback');
                    stoppedRef.current = true;
                    break;
                }
                // Small delay before trying next segment
                await new Promise(r => setTimeout(r, 200));
                continue;
            }
            consecutiveFailures = 0; // Reset on success
        }

        // If we reached the end of all segments without being stopped
        if (!stoppedRef.current && activeRef.current && consecutiveFailures < MAX_FAILURES) {
            // Check if we should auto-advance to next chapter
            if (settingsRef.current.ttsAutoAdvance) {
                const rendition = renditionRef.current;
                if (rendition) {
                    clearHighlights();
                    console.log('[TTS] Auto-advancing to next chapter...');

                    // Move to next chapter/page
                    await rendition.next();

                    // Wait for the new chapter to load
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Re-extract text from new chapter and continue
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

                            // Update voice assignments with new characters
                            if (parsed.characters) {
                                Object.assign(voiceAssignmentRef.current, buildVoiceAssignment(parsed.characters));
                            }

                            // Continue playing from start of new chapter
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
    }, [speakSegment, renditionRef, getIframeDoc, clearHighlights]);

    // ── Build voice assignment from characters ──────────────
    const buildVoiceAssignment = useCallback((characters) => {
        const engineType = settingsRef.current.ttsEngine || 'system';
        const presets = VOICE_PRESETS[engineType] || VOICE_PRESETS.system;

        const maleVoices = Object.entries(presets)
            .filter(([_, v]) => v.gender === 'male')
            .map(([key, v]) => ({ id: engineType === 'kokoro' ? v.id : `system-male-${key}`, ...v }));

        const femaleVoices = Object.entries(presets)
            .filter(([_, v]) => v.gender === 'female')
            .map(([key, v]) => ({ id: engineType === 'kokoro' ? v.id : `system-female-${key}`, ...v }));

        const narratorVoice = settingsRef.current.ttsNarratorVoice ||
            (engineType === 'kokoro' ? presets.narrator?.id : 'system-default');

        return assignVoicesToCharacters(characters, [...maleVoices, ...femaleVoices], narratorVoice);
    }, []);

    // ── Public API ──────────────────────────────────────────

    const startTts = useCallback(async () => {
        setTtsLoading(true);

        try {
            // Warm up SpeechSynthesis on user gesture (Chrome/Safari requirement)
            // Must happen synchronously within the click handler
            if (window.speechSynthesis) {
                const warmUp = new SpeechSynthesisUtterance('');
                warmUp.volume = 0;
                window.speechSynthesis.speak(warmUp);
                window.speechSynthesis.cancel();
                console.log('[TTS] SpeechSynthesis warmed up on user gesture');
            }

            // Initialize engine if needed
            if (!engineRef.current || !engineRef.current.isReady) {
                const engineType = settingsRef.current.ttsEngine || 'system';
                if (engineType === 'kokoro') {
                    setKokoroLoading(true);
                }
                const ok = await initEngine(engineType);
                setKokoroLoading(false);
                if (!ok) {
                    console.error('TTS engine failed to initialize');
                    setTtsLoading(false);
                    return;
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

            // Try to enhance dialogue analysis with Workers AI (if characters have unknown gender)
            const hasUnknowns = Object.values(parsed.characters).some(c => c.gender === 'unknown');
            if (hasUnknowns && settingsRef.current.ttsMultiVoice) {
                try {
                    const chapterText = blocks.map(b => b.text).join('\n\n');
                    const chapterHref = renditionRef.current?.location?.start?.href || '0';

                    // Check cache first
                    const cached = await getDialogueAnalysis(bookId, chapterHref);
                    if (cached?.characters) {
                        // Merge AI-resolved characters into local parse
                        for (const [name, info] of Object.entries(cached.characters)) {
                            if (parsed.characters[name] && info.gender !== 'unknown') {
                                parsed.characters[name].gender = info.gender;
                            }
                        }
                        // Update segment genders
                        for (const seg of parsed.segments) {
                            if (seg.speaker && parsed.characters[seg.speaker]) {
                                seg.gender = parsed.characters[seg.speaker].gender;
                            }
                        }
                    } else {
                        // Call Workers AI endpoint (non-blocking, best-effort)
                        const aiResponse = await Promise.race([
                            fetch('/api/analyze-dialogue', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ text: chapterText.substring(0, 3000), bookId, chapterIndex: chapterHref }),
                            }).then(r => r.json()),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
                        ]);

                        if (aiResponse?.characters && !aiResponse.fallback) {
                            // Merge AI results into local parse
                            for (const [name, info] of Object.entries(aiResponse.characters)) {
                                if (parsed.characters[name] && info.gender !== 'unknown') {
                                    parsed.characters[name].gender = info.gender;
                                }
                                // Also add new characters the AI found that regex missed
                                if (!parsed.characters[name] && info.gender) {
                                    parsed.characters[name] = info;
                                }
                            }
                            // Update segment genders
                            for (const seg of parsed.segments) {
                                if (seg.speaker && parsed.characters[seg.speaker]) {
                                    seg.gender = parsed.characters[seg.speaker].gender;
                                }
                            }
                        }
                    }
                } catch (aiErr) {
                    console.warn('Workers AI enhancement skipped:', aiErr.message);
                    // Continue with regex-only results — this is fine
                }
            }

            segmentsRef.current = parsed.segments;
            parsedDataRef.current = parsed;
            setTotalSegments(parsed.segments.length);

            // Build voice assignments
            if (parsed.characters && Object.keys(parsed.characters).length > 0) {
                voiceAssignmentRef.current = buildVoiceAssignment(parsed.characters);

                // Cache the analysis
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

            // Start playing from the beginning
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

    const toggleTts = useCallback(() => {
        if (ttsActive) {
            if (ttsPlaying) {
                pauseTts();
            } else if (ttsPaused) {
                resumeTts();
            } else {
                stopTts();
            }
        } else {
            startTts();
        }
    }, [ttsActive, ttsPlaying, ttsPaused, startTts, stopTts, pauseTts, resumeTts]);

    // ── Cleanup on unmount ──────────────────────────────────
    useEffect(() => {
        return () => {
            stoppedRef.current = true;
            activeRef.current = false;
            if (engineRef.current) {
                engineRef.current.destroy();
                engineRef.current = null;
            }
        };
    }, []);

    // ── Re-initialize engine when settings change ─────────
    useEffect(() => {
        if (engineRef.current && ttsActive) {
            // Engine type changed — need to reinitialize
            const currentType = engineRef.current instanceof Object ? settings.ttsEngine : 'system';
            if (currentType !== settingsRef.current.ttsEngine) {
                stopTts();
            }
        }
    }, [settings.ttsEngine]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        // State
        ttsActive,
        ttsPlaying,
        ttsPaused,
        ttsLoading,
        currentSegmentIndex,
        currentSpeaker,
        totalSegments,
        engineReady,
        kokoroLoading,

        // Actions
        startTts,
        stopTts,
        pauseTts,
        resumeTts,
        toggleTts,
        nextSegment,
        prevSegment,
    };
}
