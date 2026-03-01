import React from 'react';
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
    rate,
    onRateChange,
}) {
    if (!visible) return null;

    const progress = totalSegments > 0
        ? Math.round((currentSegmentIndex / totalSegments) * 100)
        : 0;

    return (
        <div className="tts-controls glass">
            {/* Progress bar */}
            <div className="tts-progress-bar">
                <div
                    className="tts-progress-fill"
                    style={{ width: `${progress}%` }}
                />
            </div>

            <div className="tts-controls-inner">
                {/* Speaker info */}
                <div className="tts-info">
                    <span className="tts-speaker">
                        {currentSpeaker === 'Narrator' ? '📖' : '🎭'}{' '}
                        {currentSpeaker || 'Narrator'}
                    </span>
                    <span className="tts-segment-count">
                        {currentSegmentIndex + 1} / {totalSegments}
                    </span>
                </div>

                {/* Playback controls */}
                <div className="tts-buttons">
                    <button
                        className="tts-btn tts-btn-small"
                        onClick={onPrev}
                        title="Previous segment"
                        disabled={loading}
                    >
                        ⏮
                    </button>

                    <button
                        className="tts-btn tts-btn-main"
                        onClick={onPlayPause}
                        disabled={loading}
                        title={playing ? 'Pause' : 'Play'}
                    >
                        {loading ? (
                            <span className="tts-spinner" />
                        ) : playing ? (
                            '⏸'
                        ) : (
                            '▶'
                        )}
                    </button>

                    <button
                        className="tts-btn tts-btn-small"
                        onClick={onNext}
                        title="Next segment"
                        disabled={loading}
                    >
                        ⏭
                    </button>

                    <button
                        className="tts-btn tts-btn-small tts-btn-stop"
                        onClick={onStop}
                        title="Stop TTS"
                    >
                        ⏹
                    </button>
                </div>

                {/* Speed control */}
                <div className="tts-speed">
                    <input
                        type="range"
                        className="tts-speed-slider"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={rate}
                        onChange={(e) => onRateChange(Number(e.target.value))}
                    />
                    <span className="tts-speed-label">{rate.toFixed(1)}x</span>
                </div>
            </div>
        </div>
    );
}
