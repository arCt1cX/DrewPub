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
import { saveDialogueAnalysis, getDialogueAnalysis, saveVoiceOverrides, getVoiceOverrides } from '../db';

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
    const [characters, setCharacters] = useState({});       // { name: { gender, count } }
    const [characterVoices, setCharacterVoices] = useState({}); // { name: voiceId }

    const engineRef = useRef(null);
    const segmentsRef = useRef([]);
    const voiceAssignmentRef = useRef({});
    const parsedDataRef = useRef(null);
    const stoppedRef = useRef(false);
    const activeRef = useRef(false);
    const settingsRef = useRef(settings);
    const audioElRef = useRef(null);
    const voiceOverridesRef = useRef({});
    const loopIdRef = useRef(0);

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
        const needle = segment.text.replace(/\s+/g, ' ').trim();
        if (needle.length < 2) return;

        // Use a long-enough search key to uniquely identify the sentence
        const searchKey = needle.substring(0, Math.min(50, needle.length));

        try {
            const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node;
            let found = false;

            while ((node = walker.nextNode())) {
                const nodeText = node.textContent;
                const idx = nodeText.indexOf(searchKey);

                if (idx !== -1) {
                    found = true;
                    try {
                        // Split the text node to wrap only the matching portion
                        let target = node;
                        if (idx > 0) target = node.splitText(idx);
                        const endPos = Math.min(target.textContent.length, needle.length);
                        if (endPos < target.textContent.length) {
                            target.splitText(endPos);
                        }

                        const span = doc.createElement('span');
                        span.className = 'tts-highlight';
                        target.parentNode.insertBefore(span, target);
                        span.appendChild(target);

                        // Only scroll if not already visible
                        const rect = span.getBoundingClientRect();
                        const viewH = doc.documentElement.clientHeight || 600;
                        if (rect.bottom < 0 || rect.top > viewH) {
                            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    } catch {
                        // splitText failed — wrap entire text node
                        const span = doc.createElement('span');
                        span.className = 'tts-highlight';
                        node.parentNode.insertBefore(span, node);
                        span.appendChild(node);
                    }
                    break;
                }
            }

            if (!found && element !== doc.body) {
                element.classList.add('tts-highlight-block');
                const rect = element.getBoundingClientRect();
                const viewH = doc.documentElement.clientHeight || 600;
                if (rect.bottom < 0 || rect.top > viewH) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
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
        const narratorVoice = settingsRef.current.ttsNarratorVoice || presets.narrator.id;

        // Single-voice mode
        if (!multiVoice) return narratorVoice;

        // Narration / heading → narrator voice
        if (segment.segType !== 'dialogue') return narratorVoice;

        // Dialogue with known speaker and existing voice assignment
        if (segment.speaker && assignment[segment.speaker]) {
            return assignment[segment.speaker];
        }

        // Speaker known but not yet assigned — auto-assign by gender
        if (segment.speaker) {
            const malePool = Object.values(presets)
                .filter(p => p.gender === 'male' && p.id !== presets.narrator.id);
            const femalePool = Object.values(presets).filter(p => p.gender === 'female');

            let voice;
            if (segment.gender === 'female' && femalePool.length > 0) {
                voice = femalePool[0].id;
            } else if (malePool.length > 0) {
                voice = malePool[0].id;
            } else {
                voice = narratorVoice;
            }
            assignment[segment.speaker] = voice;
            return voice;
        }

        // Dialogue with NO speaker — use a distinct voice so it sounds
        // different from narration (first non-narrator voice available)
        const allNonNarrator = Object.values(presets)
            .filter(p => p.id !== narratorVoice && p.id !== presets.narrator.id);
        return allNonNarrator.length > 0 ? allNonNarrator[0].id : narratorVoice;
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
    const buildVoiceAssignment = useCallback((chars) => {
        const engineType = settingsRef.current.ttsEngine || 'cloud';
        const presets = VOICE_PRESETS[engineType] || VOICE_PRESETS.cloud;

        const allVoices = Object.entries(presets)
            .filter(([key]) => key !== 'narrator')
            .map(([_, v]) => v);

        const narratorVoice = settingsRef.current.ttsNarratorVoice || presets.narrator.id;

        const auto = assignVoicesToCharacters(chars, allVoices, narratorVoice);

        // Apply user overrides on top
        const overrides = voiceOverridesRef.current;
        for (const [name, info] of Object.entries(overrides)) {
            if (info.voiceId) auto[name] = info.voiceId;
        }
        return auto;
    }, []);

    // ── AI-enhanced dialogue analysis ───────────────────────
    const enhanceWithAI = useCallback(async (parsed) => {
        try {
            const dialogueSegs = parsed.segments
                .map((s, i) => ({ ...s, index: i }))
                .filter(s => s.segType === 'dialogue');

            if (dialogueSegs.length === 0) return parsed;

            const payload = {
                segments: parsed.segments.map((s, i) => ({
                    text: s.text.substring(0, 400),
                    segType: s.segType,
                    speaker: s.speaker || null,
                    index: i,
                })),
                knownCharacters: parsed.characters,
            };

            const resp = await fetch('/api/analyze-dialogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
            });

            if (!resp.ok) {
                console.warn('[AI] Dialogue analysis failed:', resp.status);
                return parsed;
            }

            const data = await resp.json();
            if (!data.speakers || !Array.isArray(data.speakers)) return parsed;

            let updated = 0;
            for (const item of data.speakers) {
                const seg = parsed.segments[item.index];
                if (!seg || seg.segType !== 'dialogue') continue;

                // AI found a speaker where regex didn't, or confirmed/improved
                if (item.speaker) {
                    const wasEmpty = !seg.speaker;
                    seg.speaker = item.speaker;
                    if (item.gender && item.gender !== 'unknown') {
                        seg.gender = item.gender;
                    }

                    // Register/update character
                    if (!parsed.characters[item.speaker]) {
                        parsed.characters[item.speaker] = {
                            gender: item.gender || 'unknown',
                            count: 0,
                        };
                    }
                    if (item.gender && item.gender !== 'unknown') {
                        parsed.characters[item.speaker].gender = item.gender;
                    }
                    parsed.characters[item.speaker].count++;

                    if (wasEmpty) updated++;
                }
            }

            console.log(`[AI] Enhanced ${updated} dialogue segments with speaker info`);
            return parsed;
        } catch (err) {
            console.warn('[AI] Enhancement failed (non-blocking):', err.message);
            return parsed;
        }
    }, []);

    // ── Update a character's voice (from CharacterPanel) ────
    const updateCharacterVoice = useCallback(async (charName, voiceId, gender) => {
        // Update the live voice assignment
        voiceAssignmentRef.current[charName] = voiceId;

        // Update override ref
        voiceOverridesRef.current[charName] = { voiceId, gender: gender || null };

        // Update characters state for UI
        setCharacters(prev => {
            const updated = { ...prev };
            if (updated[charName]) {
                updated[charName] = { ...updated[charName], gender: gender || updated[charName].gender };
            }
            return updated;
        });

        // Update characterVoices state for UI
        setCharacterVoices(prev => ({ ...prev, [charName]: voiceId }));

        // Also update gender in parsed segments if gender was changed
        if (gender && parsedDataRef.current) {
            for (const seg of parsedDataRef.current.segments) {
                if (seg.speaker === charName) seg.gender = gender;
            }
            if (parsedDataRef.current.characters[charName]) {
                parsedDataRef.current.characters[charName].gender = gender;
            }
        }

        // Persist to IndexedDB
        try {
            await saveVoiceOverrides(bookId, voiceOverridesRef.current);
        } catch { /* ignore */ }
    }, [bookId]);

    // ── Playback loop ───────────────────────────────────────
    const playFromIndex = useCallback(async (startIndex) => {
        const thisLoop = ++loopIdRef.current; // unique ID for THIS loop
        stoppedRef.current = false;
        setTtsPlaying(true);
        setTtsPaused(false);

        let consecutiveFailures = 0;
        const MAX_FAILURES = 3;

        for (let i = startIndex; i < segmentsRef.current.length; i++) {
            // Bail if a newer loop started (nextSegment/prevSegment)
            if (loopIdRef.current !== thisLoop) return;
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

            // Check again after await — loop may have been superseded
            if (loopIdRef.current !== thisLoop) return;
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

        // Only proceed if this is still the active loop
        if (loopIdRef.current !== thisLoop) return;

        // Auto-advance to next chapter
        if (!stoppedRef.current && activeRef.current && consecutiveFailures < MAX_FAILURES) {
            if (settingsRef.current.ttsAutoAdvance) {
                const rendition = renditionRef.current;
                if (rendition) {
                    clearHighlights();
                    console.log('[TTS] Auto-advancing to next chapter...');

                    await rendition.next();
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    if (loopIdRef.current !== thisLoop) return;

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
            let parsed = parseDialogue(rawSegments);

            // Load voice overrides from DB
            try {
                const overrides = await getVoiceOverrides(bookId);
                voiceOverridesRef.current = overrides;
                // Apply gender overrides from saved data
                for (const [name, info] of Object.entries(overrides)) {
                    if (parsed.characters[name] && info.gender) {
                        parsed.characters[name].gender = info.gender;
                    }
                }
            } catch { /* no overrides yet */ }

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
                    // Also restore speakers from cache for unattributed segments
                    if (cached.segments) {
                        for (let i = 0; i < Math.min(cached.segments.length, parsed.segments.length); i++) {
                            const cs = cached.segments[i];
                            const ps = parsed.segments[i];
                            if (cs.speaker && !ps.speaker && ps.segType === 'dialogue') {
                                ps.speaker = cs.speaker;
                                ps.gender = cs.gender;
                                if (!parsed.characters[cs.speaker]) {
                                    parsed.characters[cs.speaker] = { gender: cs.gender || 'unknown', count: 0 };
                                }
                                parsed.characters[cs.speaker].count++;
                            }
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

            // ── AI Enhancement (non-blocking — start playback, enhance in background) ──
            segmentsRef.current = parsed.segments;
            parsedDataRef.current = parsed;
            setTotalSegments(parsed.segments.length);
            setCharacters({ ...parsed.characters });

            // Build initial voice assignments
            if (parsed.characters && Object.keys(parsed.characters).length > 0) {
                voiceAssignmentRef.current = buildVoiceAssignment(parsed.characters);
                setCharacterVoices({ ...voiceAssignmentRef.current });
            }

            setTtsActive(true);
            activeRef.current = true;
            setTtsLoading(false);

            // Start playback immediately
            playFromIndex(0);

            // Run AI in background to improve future chapters & enrich current data
            enhanceWithAI(parsed).then(enhanced => {
                if (!activeRef.current) return;

                parsedDataRef.current = enhanced;
                segmentsRef.current = enhanced.segments;

                // Rebuild voice assignments with AI-improved data
                if (enhanced.characters && Object.keys(enhanced.characters).length > 0) {
                    voiceAssignmentRef.current = buildVoiceAssignment(enhanced.characters);
                    setCharacters({ ...enhanced.characters });
                    setCharacterVoices({ ...voiceAssignmentRef.current });
                }

                // Cache the AI-enhanced analysis
                try {
                    const chapterHref = renditionRef.current?.location?.start?.href || '0';
                    saveDialogueAnalysis({
                        id: `${bookId}-${chapterHref}`,
                        bookId,
                        chapterIndex: chapterHref,
                        segments: enhanced.segments.map(s => ({
                            text: s.text.substring(0, 100),
                            segType: s.segType,
                            speaker: s.speaker,
                            gender: s.gender,
                        })),
                        characters: enhanced.characters,
                    });
                } catch { /* ignore */ }
            });

        } catch (err) {
            console.error('TTS start failed:', err);
            setTtsLoading(false);
        }
    }, [initEngine, getIframeDoc, buildVoiceAssignment, playFromIndex, bookId, renditionRef, enhanceWithAI]);

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
        characters,
        characterVoices,

        startTts,
        stopTts,
        pauseTts,
        resumeTts,
        nextSegment,
        prevSegment,
        updateCharacterVoice,
    };
}
