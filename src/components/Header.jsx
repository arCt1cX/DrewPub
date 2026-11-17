import React from 'react';
import { IconSettings, IconPlus } from './Icons';
import './Header.css';

function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Up late';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
}

export default function Header({ onUpload, onShowSettings }) {
    return (
        <header className="header">
            <div className="header-brand">
                <span className="header-greeting">{greeting()}</span>
                <h1 className="header-title">Your shelf</h1>
            </div>

            <div className="header-actions">
                <button
                    className="btn-icon header-icon-btn"
                    onClick={onShowSettings}
                    title="Settings"
                    aria-label="Settings"
                >
                    <IconSettings size={17} />
                </button>

                <button className="header-add-btn" onClick={onUpload} aria-label="Add book">
                    <IconPlus size={18} stroke={2.2} />
                    <span className="header-add-text">Add Book</span>
                </button>
            </div>
        </header>
    );
}
