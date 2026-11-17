import React from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Library from './pages/Library';
import Reader from './pages/Reader';
import Vocabulary from './pages/Vocabulary';
import Stats from './pages/Stats';
import BottomNav from './components/BottomNav';
import LadderScroll from './components/LadderScroll';

// The reader is full-screen and has its own controls; the nav belongs to the
// three library-side tabs only.
const NAV_ROUTES = ['/', '/vocabulary', '/stats'];

export default function App() {
    const location = useLocation();
    const showNav = NAV_ROUTES.includes(location.pathname);

    return (
        <div className="app-container">
            <Routes>
                <Route path="/" element={<Library />} />
                <Route path="/vocabulary" element={<Vocabulary />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/read/:bookId" element={<Reader />} />
            </Routes>
            {showNav && <BottomNav />}
            {showNav && <LadderScroll />}
        </div>
    );
}
