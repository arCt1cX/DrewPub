// Web-novel support: fetch a serialized novel from a supported source,
// assemble it into a valid EPUB, and sync new chapters incrementally.
//
// Currently supports novelight.net. The flow is orchestrated client-side so
// each network hop is a single Cloudflare Function subrequest (the functions
// can't loop over thousands of chapters within one invocation).
//
// Rate limiting (novelight 429s the Cloudflare egress IP when hit hard):
//   - The chapter LIST is cached on the book, so resume/sync never re-walk all
//     ~60 pages — that burst was what heated the IP before the text phase.
//   - Text fetches run one-at-a-time with an ADAPTIVE gap: it widens on 429 and
//     slowly narrows on success, self-tuning to the source's tolerance.
//   - On a sustained block we stop cleanly and keep what we have; "Check for new
//     chapters" resumes the rest. Imports are fully resumable.

import JSZip from 'jszip';
import { generateId } from './epub';
import {
    addBook,
    saveNovelChapter,
    getNovelChapters,
    getAllNovelChapters,
    pruneOrphanNovelChapters,
} from '../db';

const MAX_LIST_PAGES = 500;        // safety cap (~25k chapters)
const LIST_PAGE_GAP = 500;         // ms between chapter-list pages
const POST_LIST_COOLDOWN = 5000;   // ms to let the IP cool before the text phase
const CHECKPOINT_EVERY = 50;       // persist progress every N saved chapters

// Adaptive pacing for the text phase
const GAP_START = 600;             // ms between chapter requests
const GAP_MIN = 400;
const GAP_MAX = 6000;
const GAP_STEP_UP = 700;           // widen on rate limit
const GAP_STEP_DOWN = 80;          // narrow on success
const MAX_CONSECUTIVE_BLOCKS = 6;  // give up the run after this many in a row

// ─── Public API ─────────────────────────────────────

/**
 * Import a web novel into the library. The book record is created up-front and
 * checkpointed during download, so it's visible & resumable even if the run is
 * interrupted. Returns the final (already-saved) book record.
 */
export async function importNovel(url, { onProgress, onCheckpoint } = {}) {
    const report = onProgress || (() => {});

    report('Fetching novel info…');
    const meta = await fetchMeta(url);

    report('Listing chapters…');
    const list = await fetchFullList(meta.sourceBookId, report);
    if (list.length === 0) throw new Error('No chapters found for this novel');

    const bookId = generateId();
    const base = { addedAt: Date.now(), progress: 0 };
    const result = await downloadInto({ bookId, meta, list, base, report, onCheckpoint });
    return result.book;
}

/**
 * Check a web-novel book for new chapters AND backfill any not-yet-downloaded
 * ones (resume a partial import), persisting progress as it goes.
 * @returns {Promise<{book: object, added: number, complete: boolean}>}
 */
export async function syncNovel(book, { onProgress, onCheckpoint } = {}) {
    const report = onProgress || (() => {});
    if (book.sourceType !== 'webnovel') throw new Error('Not a web novel');

    // Reuse the cached chapter list; only scan the newest pages for additions.
    let list = Array.isArray(book.chapterList) ? book.chapterList.slice() : [];
    if (list.length === 0) {
        report('Listing chapters…');
        list = await fetchFullList(book.sourceBookId, report);
    } else {
        report('Checking for new chapters…');
        const known = new Set(list.map(c => c.id));
        const fresh = await fetchNewChapters(book.sourceBookId, known, report);
        if (fresh.length) {
            list = [...list, ...fresh];
            list.sort((a, b) => (a.num ?? 0) - (b.num ?? 0));
        }
    }

    const before = (await getNovelChapters(book.id)).length;
    const meta = {
        title: book.title, author: book.author, cover: book.cover,
        sourceUrl: book.sourceUrl, sourceBookId: book.sourceBookId,
    };
    const result = await downloadInto({ bookId: book.id, meta, list, base: book, report, onCheckpoint });
    const added = result.fetched - before;

    report(result.book.complete
        ? (added > 0 ? `Added ${added} chapter${added !== 1 ? 's' : ''}` : 'Already up to date')
        : `Added ${added} (more remain)`);
    return { book: result.book, added, complete: result.book.complete };
}

// Shared download pipeline: persist a pending book, reuse already-downloaded
// chapters, fetch the rest with adaptive pacing + checkpoints, build the EPUB.
async function downloadInto({ bookId, meta, list, base, report, onCheckpoint }) {
    // Reuse any chapter text we already have (this book's prior partial run, or
    // orphaned downloads from an interrupted import) — keyed by source id.
    report('Checking local cache…');
    const reuse = await buildReuseMap();

    const have = new Set((await getNovelChapters(bookId)).map(c => c.chapterId));
    const targets = list.filter(c => !have.has(c.id));
    const needsNetwork = targets.some(c => !reuse.has(c.id));

    // Persist a pending record immediately so it shows up and can be resumed.
    const placeholder = await buildEpub(meta, epubChapters([]));
    let book = await persist({ bookId, meta, list, fetched: have.size, aborted: false, data: placeholder, base });
    await onCheckpoint?.();

    if (targets.length === 0) {
        const stored = await getNovelChapters(bookId);
        const data = await buildEpub(meta, epubChapters(stored));
        book = await persist({ bookId, meta, list, fetched: stored.length, aborted: false, data, base });
        await onCheckpoint?.();
        await pruneOrphanNovelChapters();
        return { book, fetched: stored.length };
    }

    if (needsNetwork) {
        report('Pausing before download…');
        await sleep(POST_LIST_COOLDOWN);
    }

    const checkpoint = async () => {
        const n = (await getNovelChapters(bookId)).length;
        book = await persist({ bookId, meta, list, fetched: n, aborted: false, data: placeholder, base });
        await onCheckpoint?.();
    };

    report(`Downloading chapters (0/${targets.length})…`);
    const { aborted } = await fetchTexts(targets, bookId, {
        reuse,
        checkpoint,
        onCount: (done) => report(`Downloading chapters (${done}/${targets.length})…`),
    });

    report('Building EPUB…');
    const stored = await getNovelChapters(bookId);
    const data = await buildEpub(meta, epubChapters(stored));
    book = await persist({ bookId, meta, list, fetched: stored.length, aborted, data, base });
    await onCheckpoint?.();
    await pruneOrphanNovelChapters();
    return { book, fetched: stored.length };
}

async function persist({ bookId, meta, list, fetched, aborted, data, base }) {
    const book = makeBookRecord({ id: bookId, meta, list, fetched, aborted, data, base });
    await addBook(book);
    return book;
}

// Map of source chapterId → chapter text we already have stored anywhere.
async function buildReuseMap() {
    const all = await getAllNovelChapters();
    const map = new Map();
    for (const c of all) {
        if (c.chapterId && c.html && !map.has(c.chapterId)) map.set(c.chapterId, c.html);
    }
    return map;
}

function makeBookRecord({ id, meta, list, fetched, aborted, data, base }) {
    return {
        ...base,
        id,
        title: meta.title,
        author: meta.author,
        cover: meta.cover || base.cover || '',
        fileName: `${slug(meta.title)}.epub`,
        fileSize: data.byteLength,
        data,
        lastReadAt: base.lastReadAt || Date.now(),
        sourceType: 'webnovel',
        sourceUrl: meta.sourceUrl,
        sourceBookId: meta.sourceBookId,
        chapterList: list,                       // cached id/num/title — avoids re-listing
        chapterCount: list.length,
        fetchedCount: fetched,
        complete: !aborted && fetched >= list.length,
        lastSyncAt: Date.now(),
    };
}

// Reader needs at least one chapter; show guidance if the run got nothing yet.
function epubChapters(stored) {
    if (stored.length === 0) {
        return [{ title: 'Download pending', html: '<p>Chapters not downloaded yet. Open the ⋯ menu and tap “Check for new chapters” to download.</p>' }];
    }
    return stored.map(c => ({ title: c.title, html: c.html }));
}

// ─── Networking ─────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * 500);

async function apiGet(path) {
    const res = await fetch(path);
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
}

async function fetchMeta(url) {
    const { data } = await apiGet(`/api/novel-meta?url=${encodeURIComponent(url)}`);
    if (!data || data.error) throw new Error(data?.error || 'Could not read novel info');
    return data;
}

async function listPage(sourceBookId, page) {
    const { data, status } = await apiGet(`/api/novel-list?bookId=${sourceBookId}&page=${page}`);
    if (status === 429 || status === 503 || status >= 500) {
        // Listing rarely trips this; a short wait usually clears it.
        await sleep(jitter(4000));
        const retry = await apiGet(`/api/novel-list?bookId=${sourceBookId}&page=${page}`);
        if (!retry.data || retry.data.error) throw new Error(retry.data?.error || `Chapter list error ${retry.status}`);
        return retry.data.chapters || [];
    }
    if (!data || data.error) throw new Error(data?.error || `Chapter list error ${status}`);
    return data.chapters || [];
}

// Walk every page (newest-first) until no new ids appear; return ascending order.
async function fetchFullList(sourceBookId, report) {
    const seen = new Set();
    const collected = [];
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const chapters = await listPage(sourceBookId, page);
        if (chapters.length === 0) break;
        let added = 0;
        for (const ch of chapters) {
            if (seen.has(ch.id)) continue;
            seen.add(ch.id);
            collected.push(ch);
            added++;
        }
        report?.(`Listing chapters (${collected.length} found)…`);
        if (added === 0) break; // out-of-range pages clamp & repeat the last page
        await sleep(LIST_PAGE_GAP);
    }
    if (collected.every(c => c.num == null)) collected.reverse();
    else collected.sort((a, b) => (a.num ?? 0) - (b.num ?? 0));
    return collected;
}

// Scan newest pages only, stopping once a page contains an already-known id.
async function fetchNewChapters(sourceBookId, knownIds, report) {
    const found = [];
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const chapters = await listPage(sourceBookId, page);
        if (chapters.length === 0) break;
        const novel = chapters.filter(c => !knownIds.has(c.id));
        found.push(...novel);
        report?.(`Checking for new chapters (${found.length})…`);
        if (novel.length < chapters.length) break; // reached known territory
        await sleep(LIST_PAGE_GAP);
    }
    return found;
}

// One-at-a-time text download with an adaptive inter-request gap. Persists each
// chapter as it arrives and checkpoints periodically; stops (aborted) on a
// sustained block, keeping progress. Reuses already-downloaded text for free.
async function fetchTexts(targets, bookId, { reuse, checkpoint, onCount } = {}) {
    let gap = GAP_START;
    let consecutiveBlocks = 0;
    let done = 0;
    let sinceCheckpoint = 0;

    const advance = async () => {
        done++;
        onCount?.(done);
        if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
            sinceCheckpoint = 0;
            if (checkpoint) await checkpoint(done);
        }
    };

    for (const ch of targets) {
        // Free reuse: we already have this chapter's text somewhere.
        if (reuse && reuse.has(ch.id)) {
            await saveNovelChapter(bookId, { chapterId: ch.id, num: ch.num, title: ch.title, html: reuse.get(ch.id) });
            await advance();
            continue;
        }

        let settled = false;
        while (!settled) {
            await sleep(gap);
            let result;
            try {
                result = await apiGet(`/api/novel-chapter?id=${ch.id}`);
            } catch {
                result = { status: 0, ok: false, data: null };
            }
            const { status, ok, data } = result;

            if (ok && data && typeof data.content === 'string') {
                await saveNovelChapter(bookId, { chapterId: ch.id, num: ch.num, title: ch.title, html: data.content });
                consecutiveBlocks = 0;
                gap = Math.max(GAP_MIN, gap - GAP_STEP_DOWN); // speed back up on success
                settled = true;
                await advance();
                continue;
            }

            const rateLimited = status === 429 || status === 503 || status === 0 || status >= 500 || status === 502;
            if (rateLimited) {
                consecutiveBlocks++;
                if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
                    return { aborted: true, done };
                }
                gap = Math.min(GAP_MAX, gap + GAP_STEP_UP); // back off
                await sleep(jitter(Math.min(5000 * consecutiveBlocks, 30000)));
                continue; // retry same chapter
            }

            // Permanent (4xx / locked / empty): record a placeholder and move on.
            await saveNovelChapter(bookId, {
                chapterId: ch.id, num: ch.num, title: ch.title,
                html: `<p>[Chapter unavailable]</p>`,
            });
            consecutiveBlocks = 0;
            settled = true;
            await advance();
        }
    }
    return { aborted: false, done };
}

// ─── EPUB assembly ──────────────────────────────────

async function buildEpub(meta, chapters) {
    const zip = new JSZip();
    const uuid = `urn:uuid:${generateId()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const title = meta.title || 'Untitled';
    const author = meta.author || 'Unknown';

    // mimetype MUST be the first entry and stored uncompressed.
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    zip.file('META-INF/container.xml',
        `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

    const oebps = zip.folder('OEBPS');

    const items = [];
    const navPoints = [];
    const spine = [];
    chapters.forEach((ch, idx) => {
        const file = `chap${idx + 1}.xhtml`;
        const id = `c${idx + 1}`;
        const chTitle = escapeXml(ch.title || `Chapter ${idx + 1}`);
        oebps.file(file,
            `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><meta charset="utf-8"/><title>${chTitle}</title></head>
<body>
<h2>${chTitle}</h2>
${ch.html || '<p></p>'}
</body>
</html>`);
        items.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
        spine.push(`<itemref idref="${id}"/>`);
        navPoints.push(
            `<navPoint id="np${idx + 1}" playOrder="${idx + 1}"><navLabel><text>${chTitle}</text></navLabel><content src="${file}"/></navPoint>`
        );
    });

    oebps.file('nav.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${chapters.map((ch, idx) => `<li><a href="chap${idx + 1}.xhtml">${escapeXml(ch.title || `Chapter ${idx + 1}`)}</a></li>`).join('\n')}
</ol></nav>
</body>
</html>`);

    oebps.file('toc.ncx',
        `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
  <meta name="dtb:uid" content="${uuid}"/>
  <meta name="dtb:depth" content="1"/>
  <meta name="dtb:totalPageCount" content="0"/>
  <meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(title)}</text></docTitle>
<navMap>
${navPoints.join('\n')}
</navMap>
</ncx>`);

    oebps.file('content.opf',
        `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${items.join('\n')}
  </manifest>
  <spine toc="ncx">
${spine.join('\n')}
  </spine>
</package>`);

    return zip.generateAsync({ type: 'arraybuffer', mimeType: 'application/epub+zip' });
}

// ─── Small utils ────────────────────────────────────

function escapeXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'novel';
}

export function isNovelUrl(url) {
    try {
        return new URL(url).hostname.endsWith('novelight.net');
    } catch {
        return false;
    }
}
