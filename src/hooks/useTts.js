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
import { parseDialogue, assignVoicesToCharacters, isValidCharacterName, normalizeCharacterName } from '../utils/dialogueParser';
import { createTTSEngine, VOICE_PRESETS, createSilentWavBlob } from '../utils/ttsEngine';
import { saveDialogueAnalysis, getDialogueAnalysis, saveVoiceOverrides, getVoiceOverrides, getBookCharacters, clearDialogueAnalysis } from '../db';

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
    const [engineActive, setEngineActive] = useState(null); // 'cloud' | 'system' — which engine actually initialized

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
            setEngineActive(engine.type);
            console.log(`[TTS] Engine ready: ${engine.type}`);
            return true;
        }

        // Fallback to system engine
        if (engineType !== 'system') {
            console.warn(`[TTS] ${engineType} engine failed, falling back to system`);
            const fallback = createTTSEngine('system');
            await fallback.init();
            engineRef.current = fallback;
            setEngineActive(fallback.type);
            return true;
        }

        setEngineActive(null);
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
    const getVoiceForSegment = useCallback((segment, index) => {
        const engineType = settingsRef.current.ttsEngine || 'cloud';
        const presets = VOICE_PRESETS[engineType] || VOICE_PRESETS.cloud;
        const assignment = voiceAssignmentRef.current;
        const multiVoice = settingsRef.current.ttsMultiVoice;
        const narratorVoice = settingsRef.current.ttsNarratorVoice || presets.narrator.id;

        // Single-voice mode
        if (!multiVoice) return narratorVoice;

        // Narration / heading → always the narrator voice.
        // (Previously a "same block as previous dialogue" heuristic kept the
        // character voice here, which wrongly made narration after a quote
        // speak in the character's voice — and linger past the quote.)
        if (segment.segType !== 'dialogue') {
            return narratorVoice;
        }

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

    // ── Build a playback chunk ──────────────────────────────
    // Merge consecutive segments that share the SAME voice into one synthesis
    // request. Kokoro then renders natural pauses between the sentences instead
    // of a hard silent gap (separate audio clip) at every period — which is
    // what made playback feel choppy. Voice changes still start a new chunk.
    const buildChunk = useCallback((startIndex) => {
        const segments = segmentsRef.current;
        const first = segments[startIndex];
        const voice = getVoiceForSegment(first, startIndex);
        const MAX_CHARS = 600; // keep requests short enough for low latency
        let text = first.text;
        let end = startIndex;

        for (let j = startIndex + 1; j < segments.length; j++) {
            if (getVoiceForSegment(segments[j], j) !== voice) break;
            if (text.length + segments[j].text.length + 1 > MAX_CHARS) break;
            text += ' ' + segments[j].text;
            end = j;
        }

        return { text, voice, end, speaker: first.speaker };
    }, [getVoiceForSegment]);

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

    // ── AI dialogue analysis (Gemini — authoritative) ──────
    // The whole chapter is sent to /api/analyze-dialogue. The AI result is
    // treated as the source of truth for dialogue speakers: it can add a
    // speaker the regex missed AND clear a speaker the regex got wrong.
    // On any failure we return `parsed` untouched → local regex stays as-is.
    const enhanceWithAI = useCallback(async (parsed) => {
        try {
            const dialogueSegs = parsed.segments.filter(s => s.segType === 'dialogue');
            if (dialogueSegs.length === 0) return parsed;

            // Hint the AI with ESTABLISHED characters so it reuses their exact
            // spelling → stable voices across chapters. Critically, this list is
            // curated: only validly-named characters that recur (count >= 2) are
            // included. Feeding the raw registry back caused the AI to re-insert
            // one-off regex/analysis noise from earlier chapters as if it were
            // real ("riaggiunge cose a caso").
            let knownCharacters = {};
            try {
                const bookChars = await getBookCharacters(bookId);
                const merged = { ...bookChars };
                for (const [n, info] of Object.entries(parsed.characters)) {
                    if (!merged[n]) merged[n] = { ...info };
                    else merged[n].count = (merged[n].count || 0) + (info.count || 0);
                }
                knownCharacters = Object.fromEntries(
                    Object.entries(merged)
                        .filter(([name, info]) => isValidCharacterName(name) && (info.count || 0) >= 2)
                        .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
                        .slice(0, 25)
                );
            } catch { /* registry optional */ }

            const payload = {
                segments: parsed.segments.map((s, i) => ({
                    text: s.text,
                    segType: s.segType,
                    speaker: s.speaker || null,
                    index: i,
                })),
                knownCharacters,
            };

            const resp = await fetch('/api/analyze-dialogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout ? AbortSignal.timeout(40000) : undefined,
            });

            if (!resp.ok) {
                console.warn('[AI] Dialogue analysis failed:', resp.status);
                return parsed;
            }

            const data = await resp.json();
            if (!data.speakers || !Array.isArray(data.speakers)) return parsed;

            // Index the AI verdicts by segment index. The AI is authoritative:
            // where it has an opinion we overwrite the regex result entirely.
            const verdict = new Map();
            for (const item of data.speakers) {
                if (typeof item.index !== 'number') continue;
                let name = item.speaker ? normalizeCharacterName(item.speaker) : null;
                if (name && !isValidCharacterName(name)) name = null;
                verdict.set(item.index, { speaker: name, gender: item.gender || 'unknown' });
            }

            // Apply verdicts to segments, then rebuild the character map from the
            // FINAL speakers so regex-invented ghosts disappear entirely.
            const characters = {};
            const canonicalOf = {}; // lowercase → canonical casing

            for (let i = 0; i < parsed.segments.length; i++) {
                const seg = parsed.segments[i];
                if (seg.segType !== 'dialogue') continue;

                if (verdict.has(i)) {
                    const v = verdict.get(i);
                    seg.speaker = v.speaker;
                    seg.gender = v.speaker ? (v.gender !== 'unknown' ? v.gender : seg.gender) : null;
                }
                // (segments the AI didn't mention keep their regex speaker)

                if (!seg.speaker) continue;

                const lower = seg.speaker.toLowerCase();
                const canonical = canonicalOf[lower] || seg.speaker;
                canonicalOf[lower] = canonical;
                seg.speaker = canonical;

                if (!characters[canonical]) {
                    characters[canonical] = { gender: seg.gender || 'unknown', count: 0 };
                }
                if (seg.gender && seg.gender !== 'unknown') characters[canonical].gender = seg.gender;
                characters[canonical].count++;
            }

            parsed.characters = characters;
            console.log(`[AI] ${Object.keys(characters).length} characters, ${verdict.size} lines resolved`);
            return parsed;
        } catch (err) {
            console.warn('[AI] Enhancement failed (non-blocking):', err.message);
            return parsed;
        }
    }, [bookId]);

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

        let i = startIndex;
        while (i < segmentsRef.current.length) {
            // Bail if a newer loop started (nextSegment/prevSegment)
            if (loopIdRef.current !== thisLoop) return;
            if (stoppedRef.current || !activeRef.current) break;

            const chunk = buildChunk(i);
            const rate = settingsRef.current.ttsRate || 1.0;
            const pitch = settingsRef.current.ttsPitch || 1.0;

            // Prefetch the NEXT chunk (with its own voice) so voice changes
            // don't stall waiting on a fresh request.
            if (chunk.end + 1 < segmentsRef.current.length && engineRef.current?.prefetch) {
                const next = buildChunk(chunk.end + 1);
                engineRef.current.prefetch(next.text, next.voice, rate, pitch);
            }

            setCurrentSegmentIndex(i);
            setCurrentSpeaker(chunk.speaker || 'Narrator');
            highlightSegment(i);

            // ── Sentence-following highlight ──
            // A chunk is one audio clip covering several sentences. We estimate
            // each sentence's slice of the clip by its character length and
            // advance the highlight as the audio plays (Kokoro gives no per-word
            // timestamps, so this is a proportional estimate — good enough to
            // follow along). Only the cloud engine exposes an <audio> element.
            const chunkStart = i;
            const chunkEnd = chunk.end;
            const audioEl = audioElRef.current;
            let stopFollow = () => {};
            if (audioEl && chunkEnd > chunkStart) {
                const lens = [];
                let total = 0;
                for (let k = chunkStart; k <= chunkEnd; k++) {
                    const L = Math.max(1, (segmentsRef.current[k]?.text || '').length);
                    lens.push(L);
                    total += L;
                }
                const fracs = [];
                let acc = 0;
                for (const L of lens) { acc += L; fracs.push(acc / total); }

                // Kokoro's mp3 often lacks a duration header → audioEl.duration
                // is Infinity/NaN. Fall back to an estimate (~14 chars/sec at 1x,
                // scaled by speed) so the highlight still advances. currentTime
                // is always reliable, so we drive progress off that.
                const estTotal = total / (14 * (settingsRef.current.ttsRate || 1.0));

                let lastHi = chunkStart;
                const onTime = () => {
                    const d = audioEl.duration;
                    const dur = (d && isFinite(d) && d > 0) ? d : estTotal;
                    const p = audioEl.currentTime / dur;
                    let k = 0;
                    while (k < fracs.length - 1 && p >= fracs[k]) k++;
                    const idx = chunkStart + k;
                    if (idx !== lastHi) {
                        lastHi = idx;
                        setCurrentSegmentIndex(idx);
                        setCurrentSpeaker(segmentsRef.current[idx]?.speaker || 'Narrator');
                        highlightSegment(idx);
                    }
                };
                audioEl.addEventListener('timeupdate', onTime);
                stopFollow = () => audioEl.removeEventListener('timeupdate', onTime);
            }

            let success;
            try {
                await engineRef.current.speak(chunk.text, chunk.voice, rate, pitch);
                success = true;
            } catch (err) {
                success = false;
                if (!stoppedRef.current) console.warn('TTS speak failed:', err);
            } finally {
                stopFollow();
            }

            // Check again after await — loop may have been superseded
            if (loopIdRef.current !== thisLoop) return;
            if (!success && stoppedRef.current) break;
            if (!success) {
                consecutiveFailures++;
                console.warn(`[TTS] Chunk at ${i} failed (${consecutiveFailures}/${MAX_FAILURES})`);
                if (consecutiveFailures >= MAX_FAILURES) {
                    console.error('[TTS] Too many consecutive failures, stopping');
                    stoppedRef.current = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 200));
                continue; // retry same chunk
            }
            consecutiveFailures = 0;
            i = chunk.end + 1;
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
    }, [buildChunk, highlightSegment, renditionRef, getIframeDoc, clearHighlights, buildVoiceAssignment]);

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

    // ── Clear cached dialogue analysis for this book ────────
    // Purges the stored per-chapter speakers + character registry so the next
    // playback re-analyzes from a clean slate (no stale/garbage names).
    const clearAnalysis = useCallback(async () => {
        let removed = 0;
        try { removed = await clearDialogueAnalysis(bookId); } catch { /* ignore */ }

        // Reset in-memory state so the panel empties immediately.
        setCharacters({});
        setCharacterVoices({});
        voiceAssignmentRef.current = {};
        if (parsedDataRef.current) {
            for (const seg of parsedDataRef.current.segments) {
                if (seg.segType === 'dialogue') { seg.speaker = null; seg.gender = null; }
            }
            parsedDataRef.current.characters = {};
        }
        console.log(`[TTS] Cleared analysis for book (${removed} chapters)`);
        return removed;
    }, [bookId]);

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
        engineActive,

        startTts,
        stopTts,
        pauseTts,
        resumeTts,
        nextSegment,
        prevSegment,
        updateCharacterVoice,
        clearAnalysis,
    };
}
