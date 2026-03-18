import { openDB } from 'idb';

const DB_NAME = 'drewpub-db';
const DB_VERSION = 3;

let dbPromise;

function getDB() {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db, oldVersion) {
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
                // v2: TTS stores
                if (!db.objectStoreNames.contains('ttsCache')) {
                    const ttsStore = db.createObjectStore('ttsCache', { keyPath: 'id' });
                    ttsStore.createIndex('bookId', 'bookId');
                }
                if (!db.objectStoreNames.contains('dialogueAnalysis')) {
                    const daStore = db.createObjectStore('dialogueAnalysis', { keyPath: 'id' });
                    daStore.createIndex('bookId', 'bookId');
                }
                // v3: Voice overrides per book
                if (!db.objectStoreNames.contains('voiceOverrides')) {
                    const voStore = db.createObjectStore('voiceOverrides', { keyPath: 'id' });
                    voStore.createIndex('bookId', 'bookId');
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
    const tx = db.transaction(['books', 'positions', 'ttsCache', 'dialogueAnalysis', 'voiceOverrides'], 'readwrite');
    
    await Promise.all([
        tx.objectStore('books').delete(id),
        tx.objectStore('positions').delete(id),
        // Clear TTS cache for this book (using index)
        (async () => {
            const ttsStore = tx.objectStore('ttsCache');
            const ttsIdx = ttsStore.index('bookId');
            let cursor = await ttsIdx.openKeyCursor(IDBKeyRange.only(id));
            while (cursor) {
                await ttsStore.delete(cursor.primaryKey);
                cursor = await cursor.continue();
            }
        })(),
        // Clear Dialogue Analysis (mostly based on bookId-chapterIndex keys, but some might be indexed)
        // DialogueAnalysis store has id "bookId-chapterIndex" but also index "bookId"
        (async () => {
            const daStore = tx.objectStore('dialogueAnalysis');
            const daIdx = daStore.index('bookId');
            let cursor = await daIdx.openKeyCursor(IDBKeyRange.only(id));
            while (cursor) {
                await daStore.delete(cursor.primaryKey);
                cursor = await cursor.continue();
            }
        })(),
        tx.objectStore('voiceOverrides').delete(id)
    ]);
    
    await tx.done;
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

// ─── TTS Cache ──────────────────────────────────────

export async function saveTtsSegment(segment) {
    // segment: { id: 'bookId-chIdx-segIdx', bookId, chapterIndex, segmentIndex, audioData }
    const db = await getDB();
    return db.put('ttsCache', segment);
}

export async function getTtsSegments(bookId, chapterIndex) {
    const db = await getDB();
    const all = await db.getAllFromIndex('ttsCache', 'bookId', bookId);
    return all.filter(s => s.chapterIndex === chapterIndex);
}

export async function clearTtsCache(bookId) {
    const db = await getDB();
    const all = await db.getAllFromIndex('ttsCache', 'bookId', bookId);
    const tx = db.transaction('ttsCache', 'readwrite');
    for (const s of all) {
        tx.store.delete(s.id);
    }
    await tx.done;
}

// ─── Dialogue Analysis Cache ────────────────────────

export async function saveDialogueAnalysis(analysis) {
    // analysis: { id: 'bookId-chIdx', bookId, chapterIndex, segments, characters }
    const db = await getDB();
    return db.put('dialogueAnalysis', analysis);
}

export async function getDialogueAnalysis(bookId, chapterIndex) {
    const db = await getDB();
    return db.get('dialogueAnalysis', `${bookId}-${chapterIndex}`);
}

export async function getBookCharacters(bookId) {
    const db = await getDB();
    const all = await db.getAllFromIndex('dialogueAnalysis', 'bookId', bookId);
    const characters = {};
    for (const chapter of all) {
        if (chapter.characters) {
            for (const [name, info] of Object.entries(chapter.characters)) {
                if (!characters[name]) {
                    characters[name] = { ...info, count: 0 };
                }
                characters[name].count += info.count || 1;
                if (info.gender && info.gender !== 'unknown') {
                    characters[name].gender = info.gender;
                }
            }
        }
    }
    return characters;
}

// ─── Voice Overrides ────────────────────────────────

export async function saveVoiceOverrides(bookId, overrides) {
    // overrides: { characterName: { voiceId, gender } }
    const db = await getDB();
    return db.put('voiceOverrides', { id: bookId, bookId, overrides, updatedAt: Date.now() });
}

export async function getVoiceOverrides(bookId) {
    const db = await getDB();
    const record = await db.get('voiceOverrides', bookId);
    return record?.overrides || {};
}
