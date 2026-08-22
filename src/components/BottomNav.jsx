import React from 'react';
import { NavLink } from 'react-router-dom';
import { IconBook, IconStar, IconChart } from './Icons';
import './BottomNav.css';

const TABS = [
    { to: '/', label: 'Library', Icon: IconBook, end: true },
    { to: '/vocabulary', label: 'Vocabulary', Icon: IconStar },
    { to: '/stats', label: 'Statistics', Icon: IconChart },
];

export default function BottomNav() {
    return (
        <nav className="bottom-nav">
            {TABS.map(({ to, label, Icon, end }) => (
                <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
                >
                    <Icon size={19} />
                    <span className="bottom-nav-label">{label}</span>
                </NavLink>
            ))}
        </nav>
    );
}
