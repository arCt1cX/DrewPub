import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SettingsProvider } from './contexts/SettingsContext';
import App from './App';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter basename="/DrewPub/">
            <SettingsProvider>
                <App />
            </SettingsProvider>
        </BrowserRouter>
    </React.StrictMode>
);
