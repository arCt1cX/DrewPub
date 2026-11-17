import JSZip from 'jszip';
import { getDB } from '../db';

// Everything worth keeping. The TTS audio cache is left out: it can be large
// and is rebuilt on demand.
const STORES = [
    'books', 'bookData', 'positions', 'settings', 'novelChapters',
    'dialogueAnalysis', 'voiceOverrides', 'vocabulary', 'readingStats',
];

const FORMAT = 'drewpub-backup';
const FORMAT_VERSION = 1;

// Binary values (EPUB bytes, blobs) go into separate zip entries; the JSON
// keeps a small marker in their place.
async function encode(value, bins) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof ArrayBuffer) {
        const path = `bin/${bins.length}`;
        bins.push({ path, data: value });
        return { __bin: path, kind: 'arraybuffer' };
    }
    if (ArrayBuffer.isView(value)) {
        const path = `bin/${bins.length}`;
        bins.push({ path, data: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) });
        return { __bin: path, kind: 'u8' };
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        const path = `bin/${bins.length}`;
        bins.push({ path, data: await value.arrayBuffer() });
        return { __bin: path, kind: 'blob', mime: value.type };
    }
    if (value instanceof Date) return { __date: value.getTime() };
    if (Array.isArray(value)) {
        const out = [];
        for (const v of value) out.push(await encode(v, bins));
        return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await encode(v, bins);
    return out;
}

async function decode(value, zip) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        const out = [];
        for (const v of value) out.push(await decode(v, zip));
        return out;
    }
    if (typeof value.__bin === 'string') {
        const file = zip.file(value.__bin);
        if (!file) return null;
        const buf = await file.async('arraybuffer');
        if (value.kind === 'u8') return new Uint8Array(buf);
        if (value.kind === 'blob') return new Blob([buf], { type: value.mime || '' });
        return buf;
    }
    if (typeof value.__date === 'number') return new Date(value.__date);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await decode(v, zip);
    return out;
}

/** Packs the whole library into a single .zip file. */
export async function createBackup(onProgress = () => {}) {
    const db = await getDB();
    const zip = new JSZip();
    const bins = [];
    const counts = {};

    for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) continue;
        onProgress(`Packing ${name === 'bookData' ? 'book files' : name}…`);
        const rows = await db.getAll(name);
        const encoded = [];
        for (const row of rows) encoded.push(await encode(row, bins));
        counts[name] = rows.length;
        zip.file(`data/${name}.json`, JSON.stringify(encoded));
    }

    for (const b of bins) {
        // EPUBs are already compressed; storing them as-is is much faster.
        zip.file(b.path, b.data, { compression: 'STORE' });
    }

    zip.file('backup.json', JSON.stringify({
        format: FORMAT,
        version: FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        counts,
    }, null, 2));

    onProgress('Compressing…');
    const blob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (meta) => onProgress(`Compressing… ${Math.round(meta.percent)}%`)
    );

    const date = new Date().toISOString().slice(0, 10);
    return {
        file: new File([blob], `drewpub-backup-${date}.zip`, { type: 'application/zip' }),
        counts,
    };
}

/** Reads a backup file and returns its summary without changing anything. */
export async function readBackup(file) {
    const zip = await JSZip.loadAsync(file);
    const metaFile = zip.file('backup.json');
    if (!metaFile) throw new Error('This file is not a DrewPub backup.');
    const meta = JSON.parse(await metaFile.async('string'));
    if (meta.format !== FORMAT) throw new Error('This file is not a DrewPub backup.');
    if (meta.version > FORMAT_VERSION) throw new Error('This backup was made by a newer DrewPub. Update the app first.');
    return { zip, meta };
}

/**
 * Writes a backup into the library. Entries with the same id are replaced,
 * everything else already on this device is kept.
 */
export async function restoreBackup({ zip }, onProgress = () => {}) {
    const db = await getDB();
    const restored = {};

    for (const name of STORES) {
        const entry = zip.file(`data/${name}.json`);
        if (!entry || !db.objectStoreNames.contains(name)) continue;
        onProgress(`Restoring ${name === 'bookData' ? 'book files' : name}…`);
        const rows = JSON.parse(await entry.async('string'));

        // Small batches keep memory down when there are many large books.
        const BATCH = name === 'bookData' ? 1 : 200;
        for (let i = 0; i < rows.length; i += BATCH) {
            const slice = [];
            for (const r of rows.slice(i, i + BATCH)) slice.push(await decode(r, zip));
            const tx = db.transaction(name, 'readwrite');
            for (const r of slice) tx.store.put(r);
            await tx.done;
        }
        restored[name] = rows.length;
    }
    return restored;
}

/** Hands the file to the share sheet (Save to Files on iOS) or downloads it. */
export async function saveBackupFile(file) {
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: file.name });
            return 'shared';
        } catch (err) {
            if (err?.name === 'AbortError') return 'cancelled';
            // Fall through to a plain download.
        }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloaded';
}

export function formatBytes(n) {
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
