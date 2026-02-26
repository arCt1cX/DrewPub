import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getAllSettings, saveSetting } from '../db';
import { DEFAULT_SETTINGS, applyTheme, getTheme } from '../styles/themes';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [loaded, setLoaded] = useState(false);

    // Load settings from IndexedDB on mount
    useEffect(() => {
        (async () => {
            try {
                const saved = await getAllSettings();
                const merged = { ...DEFAULT_SETTINGS };
                for (const key of Object.keys(DEFAULT_SETTINGS)) {
                    if (saved[key] !== undefined) {
                        merged[key] = saved[key];
                    }
                }
                // Also load customTheme if saved
                if (saved.customTheme) merged.customTheme = saved.customTheme;
                setSettings(merged);
            } catch (e) {
                console.warn('Failed to load settings:', e);
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    // Apply theme whenever it changes
    useEffect(() => {
        if (loaded) {
            const theme = getTheme(settings.theme, settings.customTheme);
            applyTheme(theme);
        }
    }, [settings.theme, settings.customTheme, loaded]);

    const updateSetting = useCallback(async (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
        try {
            await saveSetting(key, value);
        } catch (e) {
            console.warn('Failed to save setting:', key, e);
        }
    }, []);

    const updateMultipleSettings = useCallback(async (updates) => {
        setSettings(prev => ({ ...prev, ...updates }));
        try {
            for (const [key, value] of Object.entries(updates)) {
                await saveSetting(key, value);
            }
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    }, []);

    if (!loaded) {
        return (
            <div style={{
                minHeight: '100dvh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#1a1a2e',
                color: '#e0e0e0',
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        width: 48, height: 48, margin: '0 auto 16px',
                        border: '3px solid rgba(124,92,252,0.2)',
                        borderTopColor: '#7c5cfc',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }} />
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            </div>
        );
    }

    return (
        <SettingsContext.Provider value={{ settings, updateSetting, updateMultipleSettings }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) throw new Error('useSettings must be used within SettingsProvider');
    return context;
}
