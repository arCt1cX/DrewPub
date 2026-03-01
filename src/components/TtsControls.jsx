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
        ? Math.round(((currentSegmentIndex + 1) / totalSegments) * 100)
        : 0;

    return (
        <div className="tts-controls glass">
            {/* Progress bar */}
            <div className="tts-progress-bar">
                <div className="tts-progress-fill" style={{ width: `${progress}%` }} />
            </div>

            {/* Speaker info */}
            <div className="tts-info">
                <span className="tts-speaker">
                    {loading ? '⏳ Generating...' : (currentSpeaker || 'Narrator')}
                </span>
                <span className="tts-segment-count">
                    {currentSegmentIndex >= 0 ? `${currentSegmentIndex + 1}/${totalSegments}` : '—'}
                </span>
            </div>

            {/* Controls */}
            <div className="tts-buttons">
                <button className="tts-btn" onClick={onPrev} title="Previous segment" disabled={loading}>
                    ⏮
                </button>

                <button
                    className="tts-btn tts-btn-main"
                    onClick={onPlayPause}
                    title={playing ? 'Pause' : 'Play'}
                    disabled={loading}
                >
                    {loading ? '⏳' : (playing ? '⏸' : '▶')}
                </button>

                <button className="tts-btn" onClick={onNext} title="Next segment" disabled={loading}>
                    ⏭
                </button>

                <button className="tts-btn tts-btn-stop" onClick={onStop} title="Stop TTS">
                    ⏹
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
