// Web-novel support: fetch a serialized novel from a supported source,
// assemble it into a valid EPUB, and sync new chapters incrementally.
//
// Currently supports novelight.net. The flow is orchestrated client-side so
// each network hop is a single Cloudflare Function subrequest (the functions
// can't loop over thousands of chapters within one invocation).
//
// Imports are resumable: every chapter is persisted to the novelChapters store
// as soon as it arrives, the book record is created from whatever was fetched,
// and "Check for new chapters" (syncNovel) backfills the rest on later runs.
// This is how rate limiting (HTTP 429) is handled gracefully — we save the
// partial novel and let the user resume once the limit resets.

import JSZip from 'jszip';
import { generateId } from './epub';
import { saveNovelChapter, getNovelChapters } from '../db';

const CHAPTER_CONCURRENCY = 3;
const LIST_PAGE_DELAY = 350;   // ms between chapter-list pages (be gentle)
const MAX_LIST_PAGES = 500;    // safety cap (~25k chapters)
const MAX_RETRIES = 4;         // per request, on rate-limit / transient errors

// ─── Public API ─────────────────────────────────────

/**
 * Import a web novel into the library. Resumable: returns whatever was fetched.
 * @returns {Promise<object>} a book record ready for addBook(). `complete` is
 *          false if rate limiting cut the run short — resume later via syncNovel.
 */
export async function importNovel(url, { onProgress } = {}) {
    const report = onProgress || (() => {});

    report('Fetching novel info…');
    const meta = await fetchMeta(url);

    report('Listing chapters…');
    const list = await fetchChapterList(meta.sourceBookId, report);
    if (list.length === 0) throw new Error('No chapters found for this novel');

    const bookId = generateId();

    report(`Downloading chapters (0/${list.length})…`);
    const { aborted } = await fetchChapterTexts(list, bookId, (done) =>
        report(`Downloading chapters (${done}/${list.length})…`)
    );

    report('Building EPUB…');
    const stored = await getNovelChapters(bookId);
    const data = await buildEpub(meta, stored.map(c => ({ title: c.title, html: c.html })));
    const complete = !aborted && stored.length >= list.length;

    return {
        id: bookId,
        title: meta.title,
        author: meta.author,
        cover: meta.cover,
        fileName: `${slug(meta.title)}.epub`,
        fileSize: data.byteLength,
        data,
        addedAt: Date.now(),
        lastReadAt: Date.now(),
        progress: 0,
        // web-novel sync metadata
        sourceType: 'webnovel',
        sourceUrl: meta.sourceUrl,
        sourceBookId: meta.sourceBookId,
        chapterCount: list.length,
        fetchedCount: stored.length,
        complete,
        lastSyncAt: Date.now(),
    };
}

/**
 * Check a web-novel book for new (or not-yet-fetched) chapters; download &
 * merge them and rebuild the EPUB. Doubles as "resume a partial import".
 * @returns {Promise<{book: object|null, added: number, complete: boolean}>}
 *          book is null only when nothing changed.
 */
export async function syncNovel(book, { onProgress } = {}) {
    const report = onProgress || (() => {});
    if (book.sourceType !== 'webnovel') throw new Error('Not a web novel');

    report('Checking for chapters…');
    const meta = await fetchMeta(book.sourceUrl);
    const list = await fetchChapterList(meta.sourceBookId, report);

    const existing = await getNovelChapters(book.id);
    const before = existing.length;
    const haveIds = new Set(existing.map(c => c.chapterId));
    const missing = list.filter(c => !haveIds.has(c.id));

    if (missing.length === 0) {
        report('Already up to date');
        return { book: null, added: 0, complete: true };
    }

    report(`Downloading chapters (0/${missing.length})…`);
    const { aborted } = await fetchChapterTexts(missing, book.id, (done) =>
        report(`Downloading chapters (${done}/${missing.length})…`)
    );

    report('Rebuilding EPUB…');
    const all = await getNovelChapters(book.id);
    const data = await buildEpub(
        { title: book.title, author: book.author, cover: book.cover },
        all.map(c => ({ title: c.title, html: c.html }))
    );

    const added = all.length - before;
    const complete = !aborted && all.length >= list.length;

    const updated = {
        ...book,
        data,
        fileSize: data.byteLength,
        chapterCount: list.length,
        fetchedCount: all.length,
        complete,
        cover: book.cover || meta.cover,
        lastSyncAt: Date.now(),
    };

    report(complete ? `Added ${added} chapter${added !== 1 ? 's' : ''}` : `Added ${added} (more remain)`);
    return { book: updated, added, complete };
}

// ─── Networking (with rate-limit backoff) ───────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Thrown when a request keeps getting rate-limited; signals "stop & resume later".
class RateLimitError extends Error {}

function backoff(attempt) {
    return Math.min(1000 * 2 ** attempt, 15000) + Math.floor(Math.random() * 500);
}

// GET a JSON API route, retrying transient/rate-limit failures with backoff.
// Throws RateLimitError if still rate-limited after MAX_RETRIES.
async function apiGet(path) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let res;
        try {
            res = await fetch(path);
        } catch (e) {
            // Network blip — retry a couple of times, then give up.
            lastErr = e;
            if (attempt >= 2) throw e;
            await sleep(backoff(attempt));
            continue;
        }

        if (res.status === 429 || res.status === 503 || res.status === 502) {
            lastErr = new RateLimitError(`HTTP ${res.status}`);
            if (attempt >= MAX_RETRIES) throw lastErr;
            const ra = parseInt(res.headers.get('Retry-After'), 10);
            await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
            continue;
        }

        const data = await res.json().catch(() => null);
        if (data && data.error) {
            // status carried in body for upstream rate limits (shouldn't reach here)
            if (data.status === 429 || data.status === 503) throw new RateLimitError(data.error);
            const err = new Error(data.error);
            err.permanent = true; // 4xx-style content error, not worth retrying
            throw err;
        }
        return data;
    }
    throw lastErr;
}

async function fetchMeta(url) {
    return apiGet(`/api/novel-meta?url=${encodeURIComponent(url)}`);
}

// Walk the paginated chapter list (newest-first) until no new ids appear,
// then return all chapters in ascending reading order.
async function fetchChapterList(sourceBookId, report) {
    const seen = new Set();
    const collected = [];

    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const data = await apiGet(`/api/novel-list?bookId=${sourceBookId}&page=${page}`);
        const chapters = data.chapters || [];
        if (chapters.length === 0) break;

        let newOnPage = 0;
        for (const ch of chapters) {
            if (seen.has(ch.id)) continue;
            seen.add(ch.id);
            collected.push(ch);
            newOnPage++;
        }
        report?.(`Listing chapters (${collected.length} found)…`);

        // Out-of-range pages clamp to the last page and repeat it → stop.
        if (newOnPage === 0) break;
        await sleep(LIST_PAGE_DELAY);
    }

    // Ascending order: prefer chapter number, fall back to source order reversed.
    if (collected.every(c => c.num == null)) collected.reverse();
    else collected.sort((a, b) => (a.num ?? 0) - (b.num ?? 0));

    return collected;
}

// Download chapter texts with a small concurrency pool, persisting each to the
// novelChapters store as it arrives. Stops early (aborted=true) when rate
// limiting can't be ridden out, leaving the rest for a later resume/sync.
async function fetchChapterTexts(list, bookId, onCount) {
    let done = 0;
    let cursor = 0;
    let aborted = false;

    async function worker() {
        while (cursor < list.length && !aborted) {
            const ch = list[cursor++];
            try {
                const data = await apiGet(`/api/novel-chapter?id=${ch.id}`);
                await saveNovelChapter(bookId, {
                    chapterId: ch.id,
                    num: ch.num,
                    title: ch.title,
                    html: data.content || '<p>(empty chapter)</p>',
                });
            } catch (err) {
                if (err instanceof RateLimitError) {
                    // Persistent rate limit → stop everyone, keep what we have.
                    aborted = true;
                    return;
                }
                if (err.permanent) {
                    // Locked/missing chapter → store a placeholder so we don't
                    // retry it forever, and keep going.
                    await saveNovelChapter(bookId, {
                        chapterId: ch.id,
                        num: ch.num,
                        title: ch.title,
                        html: `<p>[Chapter unavailable: ${escapeXml(err.message)}]</p>`,
                    });
                } else {
                    // Unknown error → stop to be safe; resume later.
                    aborted = true;
                    return;
                }
            }
            done++;
            onCount?.(done);
        }
    }

    const pool = Array.from(
        { length: Math.min(CHAPTER_CONCURRENCY, list.length) },
        worker
    );
    await Promise.all(pool);
    return { aborted };
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

    // Chapter documents
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

    // EPUB3 navigation document
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

    // EPUB2 NCX (fallback for readers/epub.js paths that prefer it)
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

    // Package document
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
