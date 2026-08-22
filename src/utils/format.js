// Shared formatting helpers for reading time and dates.

export function formatDuration(ms, { short = false } = {}) {
    const totalMinutes = Math.floor((ms || 0) / 60000);
    if (totalMinutes < 1) return short ? '0m' : 'less than a minute';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

export function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    });
}

// Rough time left based on how long this book has taken so far. Needs a bit of
// progress to say anything useful, otherwise the estimate is nonsense — and a
// book at the very end has nothing worth reporting.
export function estimateRemaining(ms, progressPct) {
    if (!ms || !progressPct || progressPct < 5 || progressPct >= 98) return null;
    const remaining = (ms / progressPct) * (100 - progressPct);
    return remaining >= 60000 ? remaining : null;
}
