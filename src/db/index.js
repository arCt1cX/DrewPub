import { openDB } from 'idb';

const DB_NAME = 'drewpub-db';
const DB_VERSION = 1;

let dbPromise;

function getDB() {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, 2, { // Increment DB version to 2
            upgrade(db, oldVersion, newVersion, transaction) {
                if (oldVersion < 1) {
                    const bookStore = db.createObjectStore('books', { keyPath: 'id' });
                    bookStore.createIndex('title', 'title');
                    bookStore.createIndex('author', 'author');
                    bookStore.createIndex('addedAt', 'addedAt');
                    bookStore.createIndex('lastReadAt', 'lastReadAt');

                    db.createObjectStore('positions', { keyPath: 'bookId' });
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
                if (oldVersion < 2) {
                    if (!db.objectStoreNames.contains('assets')) {
                        db.createObjectStore('assets', { keyPath: 'id' });
                    }
                }
            }
        });
    }
    return dbPromise;
}

// ─── Books ───────────────────────────────────────────

export async function addBook(book) {
    const db = await getDB();
    return db.put('books', book);
}

export async function getBook(id) {
    const db = await getDB();
    return db.get('books', id);
}

export async function getAllBooks() {
    const db = await getDB();
    return db.getAll('books');
}

export async function deleteBook(id) {
    const db = await getDB();
    await db.delete('books', id);
    await db.delete('positions', id);
}

export async function updateBookMeta(id, updates) {
    const db = await getDB();
    const book = await db.get('books', id);
    if (book) {
        Object.assign(book, updates);
        return db.put('books', book);
    }
}

// ─── Reading Positions ──────────────────────────────

export async function savePosition(bookId, cfi, percentage) {
    const db = await getDB();
    return db.put('positions', {
        bookId,
        cfi,
        percentage,
        updatedAt: Date.now()
    });
}

export async function getPosition(bookId) {
    const db = await getDB();
    return db.get('positions', bookId);
}

// ─── Settings ───────────────────────────────────────

export async function saveSetting(key, value) {
    const db = await getDB();
    return db.put('settings', { key, value });
}

export async function getSetting(key) {
    const db = await getDB();
    const result = await db.get('settings', key);
    return result?.value;
}

export async function getAllSettings() {
    const db = await getDB();
    const all = await db.getAll('settings');
    const map = {};
    for (const s of all) {
        map[s.key] = s.value;
    }
    return map;
}

// ─── Custom Assets (Fonts, Backgrounds) ─────────────

export async function saveCustomAsset(id, blob) {
    const db = await getDB();
    return db.put('assets', { id, blob, updatedAt: Date.now() });
}

export async function getCustomAsset(id) {
    const db = await getDB();
    const result = await db.get('assets', id);
    return result?.blob;
}

export async function deleteCustomAsset(id) {
    const db = await getDB();
    return db.delete('assets', id);
}
