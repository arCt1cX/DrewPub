import React from 'react';
import { VOICE_PRESETS } from '../utils/ttsEngine';
import { IconClose, IconMic, IconVolume } from './Icons';
import './CharacterPanel.css';

export default function CharacterPanel({
    characters,
    characterVoices,
    engineType,
    onChangeVoice,
    onClose,
}) {
    const presets = VOICE_PRESETS[engineType || 'cloud'] || VOICE_PRESETS.cloud;
    const voices = Object.entries(presets).map(([key, v]) => ({
        id: v.id,
        label: v.label,
        gender: v.gender,
        key,
    }));

    const sorted = Object.entries(characters || {})
        .sort((a, b) => (b[1].count || 0) - (a[1].count || 0));

    if (sorted.length === 0) {
        return (
            <div className="char-panel">
                <div className="char-panel-header">
                    <h3 className="char-panel-title">
                        <IconMic size={15} />
                        Characters
                    </h3>
                    <button className="char-close-btn" onClick={onClose}>
                        <IconClose size={14} />
                    </button>
                </div>
                <p className="char-empty">No characters detected yet. Start TTS to analyze the chapter.</p>
            </div>
        );
    }

    return (
        <div className="char-panel">
            <div className="char-panel-header">
                <h3 className="char-panel-title">
                    <IconMic size={15} />
                    Characters
                </h3>
                <button className="char-close-btn" onClick={onClose}>
                    <IconClose size={14} />
                </button>
            </div>
            <div className="char-list">
                {sorted.map(([name, info]) => {
                    const currentVoice = characterVoices[name] || presets.narrator.id;
                    return (
                        <div key={name} className="char-row">
                            <div className="char-info">
                                <span className="char-name">{name}</span>
                                <span className={`char-gender ${info.gender || 'unknown'}`}>
                                    {info.gender === 'male' ? 'M' : info.gender === 'female' ? 'F' : '?'}
                                </span>
                                <span className="char-count">{info.count}×</span>
                            </div>
                            <div className="char-controls">
                                <div className="char-gender-btns">
                                    <button
                                        className={`char-g-btn ${info.gender === 'male' ? 'active' : ''}`}
                                        onClick={() => onChangeVoice(name, currentVoice, 'male')}
                                        title="Set as male"
                                    >M</button>
                                    <button
                                        className={`char-g-btn ${info.gender === 'female' ? 'active' : ''}`}
                                        onClick={() => onChangeVoice(name, currentVoice, 'female')}
                                        title="Set as female"
                                    >F</button>
                                </div>
                                <select
                                    className="char-voice-select"
                                    value={currentVoice}
                                    onChange={e => onChangeVoice(name, e.target.value, info.gender)}
                                >
                                    {voices.map(v => (
                                        <option key={v.id} value={v.id}>
                                            {v.label} ({v.gender === 'male' ? 'M' : 'F'})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
