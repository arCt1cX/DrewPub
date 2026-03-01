import React from 'react';
import { VOICE_PRESETS } from '../utils/ttsEngine';
import './CharacterPanel.css';

/**
 * Panel that shows all detected characters and lets the user
 * change their assigned TTS voice.
 */
export default function CharacterPanel({
    characters,       // { name: { gender, count } }
    characterVoices,  // { name: voiceId }
    engineType,       // 'cloud' | 'system'
    onChangeVoice,    // (charName, voiceId, gender) => void
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
            <div className="char-panel glass">
                <div className="char-panel-header">
                    <h3>🎭 Characters</h3>
                    <button className="char-close-btn" onClick={onClose}>✕</button>
                </div>
                <p className="char-empty">No characters detected yet. Start TTS to analyze the chapter.</p>
            </div>
        );
    }

    return (
        <div className="char-panel glass">
            <div className="char-panel-header">
                <h3>🎭 Characters</h3>
                <button className="char-close-btn" onClick={onClose}>✕</button>
            </div>
            <div className="char-list">
                {sorted.map(([name, info]) => {
                    const currentVoice = characterVoices[name] || presets.narrator.id;
                    return (
                        <div key={name} className="char-row">
                            <div className="char-info">
                                <span className="char-name">{name}</span>
                                <span className={`char-gender ${info.gender || 'unknown'}`}>
                                    {info.gender === 'male' ? '♂' : info.gender === 'female' ? '♀' : '?'}
                                </span>
                                <span className="char-count">{info.count}×</span>
                            </div>
                            <div className="char-controls">
                                <div className="char-gender-btns">
                                    <button
                                        className={`char-g-btn ${info.gender === 'male' ? 'active' : ''}`}
                                        onClick={() => onChangeVoice(name, currentVoice, 'male')}
                                        title="Set as male"
                                    >♂</button>
                                    <button
                                        className={`char-g-btn ${info.gender === 'female' ? 'active' : ''}`}
                                        onClick={() => onChangeVoice(name, currentVoice, 'female')}
                                        title="Set as female"
                                    >♀</button>
                                </div>
                                <select
                                    className="char-voice-select"
                                    value={currentVoice}
                                    onChange={e => onChangeVoice(name, e.target.value, info.gender)}
                                >
                                    {voices.map(v => (
                                        <option key={v.id} value={v.id}>
                                            {v.label} {v.gender === 'male' ? '♂' : '♀'}
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
