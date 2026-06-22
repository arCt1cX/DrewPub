// Web-novel support: fetch a serialized novel from a supported source,
// assemble it into a valid EPUB, and sync new chapters incrementally.
//
// Currently supports novelight.net. The flow is orchestrated client-side so
// each network hop is a single Cloudflare Function subrequest (the functions
// can't loop over thousands of chapters within one invocation).

import JSZip from 'jszip';
import { generateId } from './epub';
import { saveNovelChapter, getNovelChapters } from '../db';

const CHAPTER_CONCURRENCY = 4;
const MAX_LIST_PAGES = 500; // safety cap (~25k chapters)

// ─── Public API ─────────────────────────────────────

/**
 * Import a brand-new web novel into the library.
 * @returns {Promise<object>} a book record ready for addBook()
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
    const chapters = await fetchChapterTexts(list, bookId, (done) =>
        report(`Downloading chapters (${done}/${list.length})…`)
    );

    report('Building EPUB…');
    const data = await buildEpub(meta, chapters);

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
        lastSyncAt: Date.now(),
    };
}

/**
 * Check a web-novel book for new chapters; download & merge them, rebuild EPUB.
 * @returns {Promise<{book: object|null, added: number}>} book is null if nothing new.
 */
export async function syncNovel(book, { onProgress } = {}) {
    const report = onProgress || (() => {});
    if (book.sourceType !== 'webnovel') throw new Error('Not a web novel');

    report('Checking for new chapters…');
    const meta = await fetchMeta(book.sourceUrl);
    const list = await fetchChapterList(meta.sourceBookId, report);

    const existing = await getNovelChapters(book.id);
    const haveIds = new Set(existing.map(c => c.chapterId));
    const fresh = list.filter(c => !haveIds.has(c.id));

    if (fresh.length === 0) {
        report('Already up to date');
        return { book: null, added: 0 };
    }

    report(`Downloading new chapters (0/${fresh.length})…`);
    await fetchChapterTexts(fresh, book.id, (done) =>
        report(`Downloading new chapters (${done}/${fresh.length})…`)
    );

    report('Rebuilding EPUB…');
    const all = await getNovelChapters(book.id); // includes the freshly saved ones
    const data = await buildEpub(
        { title: book.title, author: book.author, cover: book.cover },
        all.map(c => ({ title: c.title, html: c.html }))
    );

    const updated = {
        ...book,
        data,
        fileSize: data.byteLength,
        chapterCount: all.length,
        cover: book.cover || meta.cover,
        lastSyncAt: Date.now(),
    };

    report(`Added ${fresh.length} new chapter${fresh.length > 1 ? 's' : ''}`);
    return { book: updated, added: fresh.length };
}

// ─── Fetch helpers ──────────────────────────────────

async function fetchMeta(url) {
    const res = await fetch(`/api/novel-meta?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

// Walk the paginated chapter list (newest-first) until no new ids appear,
// then return all chapters in ascending reading order.
async function fetchChapterList(sourceBookId, report) {
    const seen = new Set();
    const collected = [];

    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        const res = await fetch(`/api/novel-list?bookId=${sourceBookId}&page=${page}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

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
    }

    // Ascending order: prefer chapter number, fall back to source order reversed.
    collected.sort((a, b) => {
        if (a.num != null && b.num != null) return a.num - b.num;
        return 0;
    });
    if (collected.every(c => c.num == null)) collected.reverse();

    return collected;
}

// Download chapter texts with a small concurrency pool, persisting each to the
// novelChapters store as it arrives. Returns chapters in input (ascending) order.
async function fetchChapterTexts(list, bookId, onCount) {
    const results = new Array(list.length);
    let done = 0;
    let cursor = 0;

    async function worker() {
        while (cursor < list.length) {
            const i = cursor++;
            const ch = list[i];
            const html = await fetchChapterText(ch.id);
            await saveNovelChapter(bookId, {
                chapterId: ch.id,
                num: ch.num,
                title: ch.title,
                html,
            });
            results[i] = { title: ch.title, html };
            done++;
            onCount?.(done);
        }
    }

    const pool = Array.from(
        { length: Math.min(CHAPTER_CONCURRENCY, list.length) },
        worker
    );
    await Promise.all(pool);
    return results;
}

async function fetchChapterText(id, attempt = 0) {
    try {
        const res = await fetch(`/api/novel-chapter?id=${id}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data.content || '<p>(empty chapter)</p>';
    } catch (err) {
        if (attempt < 2) {
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
            return fetchChapterText(id, attempt + 1);
        }
        // Don't abort the whole import for one bad chapter.
        return `<p>[Chapter unavailable: ${escapeXml(err.message)}]</p>`;
    }
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
