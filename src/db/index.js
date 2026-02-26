import { openDB } from 'idb';

const DB_NAME = 'drewpub-db';
const DB_VERSION = 1;

let dbPromise;

function getDB() {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('books')) {
                    const bookStore = db.createObjectStore('books', { keyPath: 'id' });
                    bookStore.createIndex('title', 'title');
                    bookStore.createIndex('author', 'author');
                    bookStore.createIndex('addedAt', 'addedAt');
                    bookStore.createIndex('lastReadAt', 'lastReadAt');
                }
                if (!db.objectStoreNames.contains('positions')) {
                    db.createObjectStore('positions', { keyPath: 'bookId' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
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
