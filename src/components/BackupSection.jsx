import React, { useRef, useState } from 'react';
import { createBackup, readBackup, restoreBackup, saveBackupFile, formatBytes } from '../utils/backup';
import { IconDownload, IconUpload, IconCheck } from './Icons';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Save everything to a file, and bring it back after reinstalling the app or
// on another device. Making the file and saving it are two taps on purpose:
// iOS only opens the share sheet straight after a tap, and packing a big
// library takes longer than that allows.
export default function BackupSection() {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [ready, setReady] = useState(null);
    const [pending, setPending] = useState(null);
    const inputRef = useRef(null);

    const handleCreate = async () => {
        setBusy(true);
        setReady(null);
        setStatus('Packing your library…');
        try {
            const { file, counts } = await createBackup(setStatus);
            setReady(file);
            setStatus(`${plural(counts.books ?? 0, 'book', 'books')} · ${plural(counts.vocabulary ?? 0, 'word', 'words')} · ${formatBytes(file.size)}`);
        } catch (err) {
            console.error('Backup failed:', err);
            setStatus(`Could not create the backup: ${err.message}`);
        } finally {
            setBusy(false);
        }
    };

    const handleSave = async () => {
        if (!ready) return;
        const result = await saveBackupFile(ready);
        if (result === 'shared' || result === 'downloaded') {
            setStatus('Backup saved. Keep it somewhere safe, like iCloud Drive.');
        }
    };

    const handlePick = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        setStatus('Reading backup…');
        try {
            const backup = await readBackup(file);
            setPending(backup);
            const c = backup.meta.counts || {};
            const when = new Date(backup.meta.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
            setStatus(`Backup from ${when}: ${plural(c.books ?? 0, 'book', 'books')}, ${plural(c.vocabulary ?? 0, 'word', 'words')}.`);
        } catch (err) {
            setPending(null);
            setStatus(err.message || 'Could not read that file.');
        } finally {
            setBusy(false);
        }
    };

    const handleRestore = async () => {
        if (!pending) return;
        setBusy(true);
        try {
            await restoreBackup(pending, setStatus);
            setStatus('Restored. Reloading…');
            setTimeout(() => window.location.reload(), 800);
        } catch (err) {
            console.error('Restore failed:', err);
            setStatus(`Could not restore: ${err.message}`);
            setBusy(false);
        }
    };

    return (
        <section className="settings-card backup-card">
            <h3 className="section-label">Backup</h3>
            <p className="backup-desc">
                Save your books, reading progress, words, statistics and settings to one file.
                Restore it after reinstalling the app or on another device.
            </p>

            <div className="backup-actions">
                {ready ? (
                    <button className="toggle-btn active" onClick={handleSave} disabled={busy}>
                        <IconDownload size={14} /> Save backup file
                    </button>
                ) : (
                    <button className="toggle-btn" onClick={handleCreate} disabled={busy}>
                        <IconDownload size={14} /> Create backup
                    </button>
                )}

                {pending ? (
                    <button className="toggle-btn active" onClick={handleRestore} disabled={busy}>
                        <IconCheck size={14} /> Restore now
                    </button>
                ) : (
                    <button className="toggle-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
                        <IconUpload size={14} /> Restore from file
                    </button>
                )}
                <input
                    ref={inputRef}
                    type="file"
                    accept=".zip,application/zip"
                    style={{ display: 'none' }}
                    onChange={handlePick}
                />
            </div>

            {status && (
                <p className={`backup-status ${busy ? 'busy' : ''}`} role="status">{status}</p>
            )}
            {pending && !busy && (
                <p className="backup-note">
                    Books already on this device stay. Anything in the backup with the same name is replaced by the saved copy.
                </p>
            )}
        </section>
    );
}
