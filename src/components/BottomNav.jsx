import React, { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { IconBook, IconStar, IconChart } from './Icons';
import './BottomNav.css';

const TABS = [
    { to: '/', label: 'Library', Icon: IconBook, end: true },
    { to: '/vocabulary', label: 'Vocabulary', Icon: IconStar },
    { to: '/stats', label: 'Statistics', Icon: IconChart },
];

export default function BottomNav() {
    const location = useLocation();
    const navRef = useRef(null);
    const [ribbonX, setRibbonX] = useState(null);

    // A bookmark ribbon hangs over the active tab and slides between them.
    useLayoutEffect(() => {
        const place = () => {
            const nav = navRef.current;
            const active = nav?.querySelector('.bottom-nav-item.active');
            if (!nav || !active) return;
            setRibbonX(active.offsetLeft + active.offsetWidth / 2);
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [location.pathname]);

    return (
        <nav className="bottom-nav" ref={navRef}>
            {ribbonX !== null && (
                <span className="bottom-nav-ribbon" style={{ transform: `translateX(${ribbonX - 7}px)` }} />
            )}
            {TABS.map(({ to, label, Icon, end }) => (
                <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
                >
                    <Icon size={20} />
                    <span className="bottom-nav-label">{label}</span>
                </NavLink>
            ))}
        </nav>
    );
}
