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
    kokoroLoading,
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
        <div className="tts-controls glass animate-slide-in-up">
            {/* Speaker indicator */}
            <div className="tts-speaker-row">
                <span className="tts-speaker-icon">🎙</span>
                <span className="tts-speaker-name">
                    {loading || kokoroLoading ? 'Loading...' : (currentSpeaker || 'Ready')}
                </span>
                <button className="tts-close-btn" onClick={onStop} title="Stop TTS">
                    ✕
                </button>
            </div>

            {/* Progress bar */}
            <div className="tts-progress-bar">
                <div
                    className="tts-progress-fill"
                    style={{ width: `${progress}%` }}
                />
            </div>

            {/* Main controls */}
            <div className="tts-buttons-row">
                {/* Speed control */}
                <button
                    className="tts-speed-btn"
                    onClick={() => {
                        const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
                        const currentIdx = speeds.indexOf(rate);
                        const nextIdx = (currentIdx + 1) % speeds.length;
                        onRateChange(speeds[nextIdx]);
                    }}
                    title={`Speed: ${rate}x`}
                >
                    {rate}x
                </button>

                {/* Previous */}
                <button
                    className="tts-nav-btn"
                    onClick={onPrev}
                    disabled={loading || currentSegmentIndex <= 0}
                    title="Previous sentence"
                >
                    ⏮
                </button>

                {/* Play / Pause */}
                <button
                    className="tts-play-btn"
                    onClick={onPlayPause}
                    disabled={loading || kokoroLoading}
                    title={playing ? 'Pause' : 'Play'}
                >
                    {loading || kokoroLoading ? (
                        <span className="tts-spinner" />
                    ) : playing ? '⏸' : '▶'}
                </button>

                {/* Next */}
                <button
                    className="tts-nav-btn"
                    onClick={onNext}
                    disabled={loading || currentSegmentIndex >= totalSegments - 1}
                    title="Next sentence"
                >
                    ⏭
                </button>

                {/* Segment counter */}
                <span className="tts-counter">
                    {currentSegmentIndex >= 0 ? currentSegmentIndex + 1 : 0}/{totalSegments}
                </span>
            </div>
        </div>
    );
}
