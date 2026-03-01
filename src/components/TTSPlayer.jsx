import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TTSPlayer as TTSEngine } from '../utils/tts';
import { parseChapterText, buildTTSChunks } from '../utils/textParser';
import { useSettings } from '../contexts/SettingsContext';
import './TTSPlayer.css';

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 2.0];

export default function TTSPlayer({ getChapterText, onChapterComplete, visible, onClose }) {
    const { settings } = useSettings();
    const engineRef = useRef(null);

    const [playerState, setPlayerState] = useState({
        isPlaying: false,
        isPaused: false,
        currentIndex: 0,
        totalChunks: 0,
    });
    const [currentChunk, setCurrentChunk] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [speed, setSpeed] = useState(settings.ttsSpeed || 1.0);

    // Initialize engine once
    useEffect(() => {
        if (!engineRef.current) {
            engineRef.current = new TTSEngine();
        }

        const engine = engineRef.current;

        engine.onStateChange = (state) => {
            setPlayerState({ ...state });
        };

        engine.onChunkChange = (index, chunk) => {
            setCurrentChunk(chunk);
        };

        engine.onComplete = () => {
            setCurrentChunk(null);
            onChapterComplete?.();
        };

        engine.onError = (err) => {
            setError(err.message || 'TTS error occurred');
            setLoading(false);
        };

        return () => {
            engine.onStateChange = null;
            engine.onChunkChange = null;
            engine.onComplete = null;
            engine.onError = null;
        };
    }, [onChapterComplete]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (engineRef.current) {
                engineRef.current.destroy();
                engineRef.current = null;
            }
        };
    }, []);

    const handlePlay = useCallback(async () => {
        const engine = engineRef.current;
        if (!engine) return;

        // If paused, resume
        if (engine.isPaused) {
            engine.resume();
            return;
        }

        // If already playing, pause
        if (engine.isPlaying) {
            engine.pause();
            return;
        }

        // Start fresh: get chapter text and parse it
        setLoading(true);
        setError(null);
        try {
            const text = await getChapterText();
            if (!text || text.trim().length === 0) {
                setError('No text found in current chapter.');
                setLoading(false);
                return;
            }

            const segments = parseChapterText(text);
            const chunks = buildTTSChunks(segments);

            if (chunks.length === 0) {
                setError('No readable text found.');
                setLoading(false);
                return;
            }

            const voices = {
                narrator: settings.ttsNarratorVoice || '',
                male: settings.ttsMaleVoice || '',
                female: settings.ttsFemaleVoice || '',
            };

            setLoading(false);
            await engine.start(chunks, voices, speed);
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    }, [settings, getChapterText, speed]);

    const handleStop = useCallback(() => {
        engineRef.current?.stop();
        setCurrentChunk(null);
        setError(null);
    }, []);

    const handleSkipForward = useCallback(() => {
        engineRef.current?.skipForward();
    }, []);

    const handleSkipBack = useCallback(() => {
        engineRef.current?.skipBack();
    }, []);

    const handleSpeedChange = useCallback(() => {
        const currentIdx = SPEED_OPTIONS.indexOf(speed);
        const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
        const newSpeed = SPEED_OPTIONS[nextIdx];
        setSpeed(newSpeed);
        if (engineRef.current) {
            engineRef.current.setRate(newSpeed);
        }
    }, [speed]);

    const handleClose = useCallback(() => {
        handleStop();
        onClose?.();
    }, [handleStop, onClose]);

    if (!visible) return null;

    const progress = playerState.totalChunks > 0
        ? Math.round((playerState.currentIndex / playerState.totalChunks) * 100)
        : 0;

    const voiceLabel = currentChunk
        ? currentChunk.voiceType === 'narrator'
            ? '📖 Narrator'
            : currentChunk.voiceType === 'male'
                ? `🗣️ ${currentChunk.speaker || 'Male Character'}`
                : `🗣️ ${currentChunk.speaker || 'Female Character'}`
        : null;

    return (
        <div className="tts-player glass-strong animate-slide-in-up">
            {/* Close button */}
            <button className="tts-close-btn" onClick={handleClose} title="Close TTS">
                ✕
            </button>

            {/* Error display */}
            {error && (
                <div className="tts-error">
                    <span>⚠️ {error}</span>
                    <button onClick={() => setError(null)} className="tts-error-dismiss">✕</button>
                </div>
            )}

            {/* Current text / speaker info */}
            <div className="tts-info">
                {voiceLabel && (
                    <span className="tts-voice-label">{voiceLabel}</span>
                )}
                {currentChunk && (
                    <div className="tts-current-text">
                        {currentChunk.text.length > 120
                            ? currentChunk.text.substring(0, 120) + '...'
                            : currentChunk.text}
                    </div>
                )}
                {!currentChunk && !loading && !error && (
                    <div className="tts-current-text tts-idle">
                        Tap play to start reading aloud
                    </div>
                )}
                {loading && (
                    <div className="tts-current-text tts-loading">
                        Preparing audio...
                    </div>
                )}
            </div>

            {/* Progress bar */}
            <div className="tts-progress-bar">
                <div className="tts-progress-fill" style={{ width: `${progress}%` }} />
            </div>

            {/* Controls */}
            <div className="tts-controls">
                <button
                    className="tts-btn tts-speed-btn"
                    onClick={handleSpeedChange}
                    title="Change speed"
                >
                    {speed}x
                </button>

                <button
                    className="tts-btn"
                    onClick={handleSkipBack}
                    disabled={!playerState.isPlaying}
                    title="Previous sentence"
                >
                    ⏮
                </button>

                <button
                    className="tts-btn tts-play-btn"
                    onClick={handlePlay}
                    disabled={loading}
                    title={playerState.isPlaying && !playerState.isPaused ? 'Pause' : 'Play'}
                >
                    {loading ? (
                        <span className="tts-spinner" />
                    ) : playerState.isPlaying && !playerState.isPaused ? (
                        '⏸'
                    ) : (
                        '▶'
                    )}
                </button>

                <button
                    className="tts-btn"
                    onClick={handleSkipForward}
                    disabled={!playerState.isPlaying}
                    title="Next sentence"
                >
                    ⏭
                </button>

                <button
                    className="tts-btn tts-stop-btn"
                    onClick={handleStop}
                    disabled={!playerState.isPlaying}
                    title="Stop"
                >
                    ⏹
                </button>
            </div>

            {/* Chunk counter */}
            {playerState.totalChunks > 0 && (
                <div className="tts-counter">
                    {playerState.currentIndex + 1} / {playerState.totalChunks}
                </div>
            )}
        </div>
    );
}
