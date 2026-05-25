import React from 'react';
import { IconPlay, IconPause, IconSkipBack, IconSkipForward, IconVolume, IconBookOpen, IconMic } from './Icons';
import './TtsControls.css';

export default function TtsControls({
    visible,
    playing,
    paused,
    loading,
    currentSpeaker,
    currentSegmentIndex,
    totalSegments,
    onPlayPause,
    onStop,
    onNext,
    onPrev,
    onShowCharacters,
    hasCharacters,
    rate,
    onRateChange,
}) {
    if (!visible) return null;

    const progress = totalSegments > 0
        ? Math.round(((currentSegmentIndex + 1) / totalSegments) * 100)
        : 0;

    return (
        <div className="tts-controls">
            {/* Progress bar */}
            <div className="tts-progress-bar">
                <div className="tts-progress-fill" style={{ width: `${progress}%` }} />
            </div>

            {/* Speaker info */}
            <div className="tts-info">
                <span className={`tts-speaker ${currentSpeaker && currentSpeaker !== 'Narrator' ? 'tts-speaker-character' : ''}`}>
                    {loading ? 'Generating...' : (
                        <>
                            <span className="tts-speaker-icon">
                                {currentSpeaker && currentSpeaker !== 'Narrator' ? <IconMic size={13} /> : <IconBookOpen size={13} />}
                            </span>
                            {currentSpeaker || 'Narrator'}
                        </>
                    )}
                </span>
                <span className="tts-segment-count">
                    {currentSegmentIndex >= 0 ? `${currentSegmentIndex + 1}/${totalSegments}` : '—'}
                </span>
            </div>

            {/* Controls */}
            <div className="tts-buttons">
                <button className="tts-btn" onClick={onPrev} title="Previous segment" disabled={loading}>
                    <IconSkipBack size={16} />
                </button>

                <button
                    className="tts-btn tts-btn-main"
                    onClick={onPlayPause}
                    title={playing ? 'Pause' : 'Play'}
                    disabled={loading}
                >
                    {loading ? (
                        <div className="tts-spinner-small" />
                    ) : playing ? (
                        <IconPause size={18} />
                    ) : (
                        <IconPlay size={18} />
                    )}
                </button>

                <button className="tts-btn" onClick={onNext} title="Next segment" disabled={loading}>
                    <IconSkipForward size={16} />
                </button>

                <button className="tts-btn tts-btn-stop" onClick={onStop} title="Stop TTS">
                    <IconClose size={14} />
                </button>

                <button
                    className={`tts-btn ${hasCharacters ? 'tts-btn-chars' : ''}`}
                    onClick={onShowCharacters}
                    title="Characters & Voices"
                >
                    <IconVolume size={15} />
                </button>

                {/* Speed control */}
                <div className="tts-speed">
                    <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={rate}
                        onChange={e => onRateChange(Number(e.target.value))}
                        className="tts-speed-slider"
                        title={`Speed: ${rate.toFixed(1)}x`}
                    />
                    <span className="tts-speed-label">{rate.toFixed(1)}x</span>
                </div>
            </div>
        </div>
    );
}

function IconClose(p) {
    return (
        <svg width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
    );
}
