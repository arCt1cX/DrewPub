import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import './LadderScroll.css';

// A library ladder that rides a rail on the right edge in place of the
// scrollbar. It follows the page, swings a little with the speed of the
// scroll, and can be dragged to move through the page.
export default function LadderScroll() {
    const location = useLocation();
    const railRef = useRef(null);
    const ladderRef = useRef(null);
    const state = useRef({ dragging: false, startY: 0, startScroll: 0, lastY: 0, lastT: 0, idle: null, settle: null });

    useEffect(() => {
        document.documentElement.classList.add('has-ladder');
        return () => document.documentElement.classList.remove('has-ladder');
    }, []);

    useEffect(() => {
        const rail = railRef.current;
        const ladder = ladderRef.current;
        if (!rail || !ladder) return;
        const s = state.current;

        const metrics = () => {
            const doc = document.documentElement;
            const view = window.innerHeight;
            const total = doc.scrollHeight;
            const railH = rail.clientHeight;
            const ladderH = Math.max(46, Math.min(120, (view / Math.max(total, 1)) * railH));
            return { view, total, railH, ladderH, max: Math.max(total - view, 0) };
        };

        const place = () => {
            const m = metrics();
            rail.classList.toggle('ladder-hidden', m.max < 40);
            const f = m.max ? window.scrollY / m.max : 0;
            ladder.style.height = `${m.ladderH}px`;
            ladder.style.setProperty('--y', `${f * (m.railH - m.ladderH)}px`);
        };

        const wake = () => {
            rail.classList.add('ladder-awake');
            clearTimeout(s.idle);
            s.idle = setTimeout(() => {
                if (!s.dragging) rail.classList.remove('ladder-awake');
            }, 1200);
        };

        // The ladder hangs from the rail, so fast scrolling swings its foot.
        const swing = () => {
            const now = performance.now();
            const dy = window.scrollY - s.lastY;
            const dt = Math.max(now - s.lastT, 1);
            s.lastY = window.scrollY;
            s.lastT = now;
            const tilt = Math.max(-9, Math.min(9, (dy / dt) * -4));
            ladder.style.setProperty('--tilt', `${tilt}deg`);
            clearTimeout(s.settle);
            s.settle = setTimeout(() => ladder.style.setProperty('--tilt', '0deg'), 90);
        };

        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                place();
                if (!s.dragging) swing();
                wake();
            });
        };

        const onDown = (e) => {
            s.dragging = true;
            s.startY = e.clientY;
            s.startScroll = window.scrollY;
            ladder.setPointerCapture?.(e.pointerId);
            rail.classList.add('ladder-awake', 'ladder-dragging');
            e.preventDefault();
        };
        const onMove = (e) => {
            if (!s.dragging) return;
            const m = metrics();
            const travel = m.railH - m.ladderH;
            if (travel <= 0) return;
            const dy = e.clientY - s.startY;
            window.scrollTo({ top: s.startScroll + (dy / travel) * m.max, behavior: 'instant' });
        };
        const onUp = () => {
            if (!s.dragging) return;
            s.dragging = false;
            rail.classList.remove('ladder-dragging');
            wake();
        };

        s.lastY = window.scrollY;
        s.lastT = performance.now();
        place();

        const ro = new ResizeObserver(place);
        ro.observe(document.body);
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', place);
        ladder.addEventListener('pointerdown', onDown);
        ladder.addEventListener('pointermove', onMove);
        ladder.addEventListener('pointerup', onUp);
        ladder.addEventListener('pointercancel', onUp);

        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(s.idle);
            clearTimeout(s.settle);
            ro.disconnect();
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', place);
            ladder.removeEventListener('pointerdown', onDown);
            ladder.removeEventListener('pointermove', onMove);
            ladder.removeEventListener('pointerup', onUp);
            ladder.removeEventListener('pointercancel', onUp);
        };
    }, [location.pathname]);

    return (
        <div className="ladder-rail ladder-hidden" ref={railRef} aria-hidden="true">
            <div className="ladder" ref={ladderRef}>
                <span className="ladder-hook" />
                <span className="ladder-body" />
                <span className="ladder-wheels" />
            </div>
        </div>
    );
}
