import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Library from './pages/Library';
import Reader from './pages/Reader';

export default function App() {
    return (
        <div className="app-container">
            <Routes>
                <Route path="/" element={<Library />} />
                <Route path="/read/:bookId" element={<Reader />} />
            </Routes>
        </div>
    );
}
