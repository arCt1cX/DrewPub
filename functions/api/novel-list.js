// Cloudflare Pages Function: GET /api/novel-list?source=<src>&bookId=<id>&page=<n>
// Returns one page of a book's chapter list, NEWEST FIRST, for either source.
// The client walks pages 1..N and stops when a page brings nothing new, so both
// sources must agree on that ordering (see the freewebnovel note below).
// `source` defaults to novelight for books imported before multi-source support.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FWN_BASE = 'https://freewebnovel.com';

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const source = url.searchParams.get('source') || 'novelight';
    const bookId = url.searchParams.get('bookId');
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);

    try {
        if (source === 'freewebnovel') {
            if (!bookId || !/^[a-z0-9][a-z0-9._~-]*$/i.test(bookId)) {
                return json({ error: 'Missing or invalid "bookId"' }, 400);
            }
            return await freewebnovelList(bookId, page);
        }

        if (!bookId || !/^\d+$/.test(bookId)) {
            return json({ error: 'Missing or invalid "bookId"' }, 400);
        }
        return await novelightList(bookId, page);
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

// ─── novelight ──────────────────────────────────────

async function novelightList(bookId, page) {
    const listUrl = `https://novelight.net/book/ajax/chapter-pagination?book_id=${bookId}&page=${encodeURIComponent(page)}`;
    const res = await fetch(listUrl, {
        headers: {
            'User-Agent': UA,
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://novelight.net/',
        },
    });
    if (!res.ok) return upstreamError(res, 'Chapter list');

    const data = await res.json().catch(() => null);
    const listHtml = data && typeof data.html === 'string' ? data.html : '';

    return json({ chapters: parseNovelightChapters(listHtml) });
}

function parseNovelightChapters(html) {
    const chapters = [];
    const anchorRe = /<a[^>]*href="\/book\/chapter\/(\d+)"[\s\S]*?<\/a>/g;
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
        const id = m[1];
        const block = m[0];
        // Number may be decimal (side chapters like "2297.1"); title span is optional.
        const titleMatch = block.match(/<div class="title">\s*([\d.]+)\s*chapter\s*(?:-\s*<span>([^<]*)<\/span>)?/i);
        const num = titleMatch ? parseFloat(titleMatch[1]) : null;
        const title = (titleMatch && titleMatch[2]) ? titleMatch[2].trim() : '';
        const dateMatch = block.match(/<span class="date">([^<]*)<\/span>/i);
        const date = dateMatch ? dateMatch[1].trim() : '';
        chapters.push({ id, num, title, date });
    }
    return chapters;
}

// ─── freewebnovel ───────────────────────────────────

// freewebnovel paginates its chapter list OLDEST first (page 1 = chapter 1),
// the opposite of novelight. We invert the page number here — client page 1 is
// the source's last page — so "check for new chapters" can keep scanning from
// page 1 and stop as soon as it recognises a chapter, for either source.
//
// The page count comes from the list page itself, so the first source page is
// fetched once to discover it (and reused directly when it IS the target).
async function freewebnovelList(slug, page) {
    const first = await fwnFetchFirst(fwnListUrls(slug, 1));
    if (!first.ok) return fwnListError(first.res);

    const total = fwnPageCount(first.html, slug);
    const target = total - (page - 1);
    if (target < 1) return json({ chapters: [] }); // walked past the oldest page

    let html = first.html;
    if (target !== 1) {
        const got = await fwnFetchFirst(fwnListUrls(slug, target));
        if (!got.ok) return fwnListError(got.res);
        html = got.html;
    }

    return json({ chapters: parseFreewebnovelChapters(html, slug) });
}

// A missing list page means we ran off the end, not a failure — report it as an
// empty page so the client stops walking instead of aborting the import.
function fwnListError(res) {
    if (res && res.status === 404) return json({ chapters: [] });
    return upstreamError(res, 'Chapter list');
}

function fwnListUrls(slug, page) {
    return [`${FWN_BASE}/${slug}/${page}.html`, `${FWN_BASE}/novel/${slug}/${page}`]
        .concat(page === 1 ? [`${FWN_BASE}/${slug}.html`, `${FWN_BASE}/novel/${slug}`] : []);
}

// Number of chapter-list pages: the page selector's <option> count, cross-checked
// against the highest /<slug>/<n>.html link on the page (in case the selector
// isn't rendered).
function fwnPageCount(html, slug) {
    let total = 1;

    const select = html.match(/<select[^>]*id=["']indexselect["'][^>]*>([\s\S]*?)<\/select>/i);
    if (select) {
        const options = select[1].match(/<option\b/gi);
        if (options) total = options.length;
    }

    const linkRe = new RegExp('href="[^"]*\\/' + escapeRe(slug) + '\\/(\\d+)\\.html"', 'gi');
    let m;
    while ((m = linkRe.exec(html)) !== null) {
        total = Math.max(total, parseInt(m[1], 10) || 1);
    }

    return total;
}

function parseFreewebnovelChapters(html, slug) {
    const chapters = [];
    const seen = new Set();
    // Any anchor pointing at a chapter of THIS novel — covers the list itself
    // plus the "latest chapter" links, which dedupe away.
    const anchorRe = new RegExp(
        '<a\\b[^>]*href="([^"]*\\/' + escapeRe(slug) + '\\/chapter-[^"#?]*)"[^>]*>([\\s\\S]*?)<\\/a>',
        'gi'
    );

    let m;
    while ((m = anchorRe.exec(html)) !== null) {
        const id = fwnChapterId(m[1], slug);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const titleAttr = pick(m[0], /\stitle="([^"]*)"/i);
        const raw = titleAttr || m[2].replace(/<[^>]+>/g, ' ');
        chapters.push({ id, num: fwnChapterNum(id), title: fwnChapterTitle(raw), date: '' });
    }

    return chapters;
}

// "https://freewebnovel.com/novel/some-book/chapter-12.html" → "some-book/chapter-12"
function fwnChapterId(href, slug) {
    const path = href.replace(/^https?:\/\/[^/]+/i, '').replace(/^\//, '').replace(/\.html?$/i, '');
    const rel = path.replace(/^novels?\//i, '');
    return rel.toLowerCase().startsWith(`${slug.toLowerCase()}/chapter-`) ? rel : '';
}

// "chapter-12" → 12, "chapter-12-2" (side chapter) → 12.2
function fwnChapterNum(id) {
    const m = id.match(/\/chapter-(\d+)(?:[-_.](\d+))?/i);
    if (!m) return null;
    return parseFloat(m[2] ? `${m[1]}.${m[2]}` : m[1]);
}

// The EPUB builder prefixes "Chapter <n>:" itself, so drop the source's own
// numbering and keep just the chapter's name (often empty on this source).
function fwnChapterTitle(raw) {
    return decodeEntities(raw)
        .replace(/^\s*chapter\s*[\d.\-]+\s*[:.\-–—]?\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Shared helpers ─────────────────────────────────

async function fwnFetchFirst(urls) {
    let last = null;
    for (const url of urls) {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': `${FWN_BASE}/` },
        });
        if (res.ok) return { ok: true, html: await res.text(), url };
        last = res;
        if (res.status === 429 || res.status >= 500) break;
    }
    return { ok: false, res: last };
}

function decodeEntities(s) {
    return String(s)
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function pick(html, re) {
    const m = html.match(re);
    return m ? m[1].trim() : '';
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Forward the real upstream status (and Retry-After) so the client can decide:
// 429/5xx → back off & retry, 4xx → permanent skip.
function upstreamError(res, label) {
    const status = (res && res.status) || 502;
    const retryAfter = (res && res.headers.get('retry-after')) || '';
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (retryAfter) headers['Retry-After'] = retryAfter;
    return new Response(
        JSON.stringify({ error: `${label} returned ${status}`, status, retryAfter }),
        { status, headers }
    );
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
