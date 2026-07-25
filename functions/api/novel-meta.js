// Cloudflare Pages Function: GET /api/novel-meta?url=<book_page_url>
// Resolves a supported web-novel book page to the ids + metadata the client
// needs to list and download it.
//
// Supported sources:
//   novelight    — book id lives in a BOOK_ID script constant
//   freewebnovel — "book id" is the URL slug; metadata comes from og: meta tags

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FWN_BASE = 'https://freewebnovel.com';
const FWN_HOST = /(^|\.)freewebnovel\.(com|net|me|so|cc|org)$/i;
// Path segments that are site sections, never novel slugs.
const FWN_RESERVED = new Set([
    'home', 'sort', 'genre', 'genres', 'search', 'authors', 'author', 'latest',
    'tag', 'tags', 'api', 'user', 'login', 'register', 'list', 'lists', 'index',
    'ranking', 'rankings', 'contact', 'about', 'privacy', 'terms',
]);

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const bookUrl = url.searchParams.get('url');

    if (!bookUrl) {
        return json({ error: 'Missing query parameter "url"' }, 400);
    }

    let parsed;
    try {
        parsed = new URL(bookUrl);
    } catch {
        return json({ error: 'Invalid URL' }, 400);
    }

    try {
        if (parsed.hostname.endsWith('novelight.net')) return await novelightMeta(bookUrl);
        if (FWN_HOST.test(parsed.hostname)) return await freewebnovelMeta(parsed);
        return json({ error: 'URL must be from novelight.net or freewebnovel.com' }, 400);
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

// ─── novelight ──────────────────────────────────────

async function novelightMeta(bookUrl) {
    const res = await fetch(bookUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    });
    if (!res.ok) return upstreamError(res, 'Book page');

    const html = await res.text();

    const idMatch = html.match(/BOOK_ID\s*=\s*["'](\d+)["']/);
    if (!idMatch) return json({ error: 'Could not find book id on page' }, 502);
    const sourceBookId = idMatch[1];

    // Book display name comes from the page <h1> (e.g. "Shadow Slave (Novel)").
    const bookName =
        pick(html, /<h1[^>]*>([^<]+)<\/h1>/i) ||
        pick(html, /<title>([^<]*?)(?:\s*[-–|].*)?<\/title>/i) ||
        'Untitled';
    const title = bookName.replace(/\s*\(novel\)\s*/i, '').trim() || bookName;

    // Cover: the page's own poster <img> has alt="<bookName> poster".
    let cover = '';
    const coverTag =
        matchTag(html, new RegExp('<img[^>]*alt="' + escapeRe(bookName) + ' poster"[^>]*>', 'i')) ||
        matchTag(html, /<img[^>]*src="\/media\/book\/poster\/[^"]*"[^>]*alt="[^"]+ poster"[^>]*>/i);
    if (coverTag) {
        const src = pick(coverTag, /src="([^"]+)"/i);
        if (src) cover = src.startsWith('/') ? new URL(bookUrl).origin + src : src;
    }

    // Author sits in an info row: <div class="sub-header">Author</div>
    // <div class="info">Name</div>.
    const author =
        pick(html, /sub-header">\s*Author\s*<\/div>\s*<div[^>]*class="info"[^>]*>\s*([^<]+?)\s*</i) ||
        'Unknown';

    return json({ source: 'novelight', sourceBookId, sourceUrl: bookUrl, title, author: author.trim(), cover });
}

// ─── freewebnovel ───────────────────────────────────

// Accepts any page of a novel — the book page, a chapter, or a chapter-list
// page — and reduces it to the novel's slug, which is our source book id.
async function freewebnovelMeta(parsed) {
    const slug = fwnSlug(parsed);
    if (!slug) return json({ error: 'Could not read the novel name from that freewebnovel link' }, 400);

    const page = await fwnFetchFirst(fwnBookUrls(slug));
    if (!page.ok) return upstreamError(page.res, 'Book page');
    const { html, url: sourceUrl } = page;

    const title =
        metaProp(html, 'og:title') ||
        pick(html, /<h1[^>]*class="[^"]*\btit\b[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
        pick(html, /<title>([^<]*?)(?:\s*[-–|].*)?<\/title>/i) ||
        'Untitled';

    const author =
        metaProp(html, 'og:novel:author') ||
        pick(html, /<a[^>]*href="\/authors?\/[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/i) ||
        'Unknown';

    let cover = metaProp(html, 'og:image') || pick(html, /<div[^>]*class="[^"]*\bpic\b[^"]*"[^>]*>\s*<img[^>]*src="([^"]+)"/i);
    if (cover) {
        try { cover = new URL(cover, FWN_BASE).href; } catch { cover = ''; }
    }

    return json({
        source: 'freewebnovel',
        sourceBookId: slug,
        sourceUrl,
        title: cleanText(title).replace(/\s*[-–|]\s*free\s*web\s*novel\s*$/i, '').trim() || 'Untitled',
        author: cleanText(author).split(',')[0].trim() || 'Unknown',
        cover,
    });
}

// The slug is the first path segment that isn't a site section. Handles both
// layouts: /<slug>.html and /novel/<slug>[/chapter-1].
function fwnSlug(parsed) {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'novel' || parts[0] === 'novels') parts.shift();
    const first = (parts[0] || '').replace(/\.html?$/i, '').toLowerCase();
    if (!first || FWN_RESERVED.has(first) || /^chapter-/.test(first) || !/^[a-z0-9][a-z0-9._~-]*$/.test(first)) {
        return '';
    }
    return first;
}

// /novel/<slug> is the live layout; /<slug>.html is a legacy path kept as a
// fallback (it 404s today, so trying it first wasted a subrequest on every import).
function fwnBookUrls(slug) {
    return [`${FWN_BASE}/novel/${slug}`, `${FWN_BASE}/${slug}.html`];
}

// Try each candidate URL and return the first that responds with HTML, so a
// layout change on the source (/slug.html ↔ /novel/slug) doesn't break imports.
async function fwnFetchFirst(urls) {
    let last = null;
    for (const url of urls) {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': `${FWN_BASE}/` },
        });
        if (res.ok) return { ok: true, html: await res.text(), url };
        last = res;
        // A rate limit or server fault won't be fixed by trying another path.
        if (res.status === 429 || res.status >= 500) break;
    }
    return { ok: false, res: last };
}

// ─── Shared helpers ─────────────────────────────────

function metaProp(html, property) {
    const tag = matchTag(html, new RegExp('<meta[^>]*property=["\']' + escapeRe(property) + '["\'][^>]*>', 'i'));
    if (!tag) return '';
    return cleanText(pick(tag, /content=["']([^"']*)["']/i));
}

function cleanText(s) {
    return String(s)
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function pick(html, re) {
    const m = html.match(re);
    return m ? m[1].trim() : '';
}

function matchTag(html, re) {
    const m = html.match(re);
    return m ? m[0] : '';
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upstreamError(res, label) {
    const status = res.status || 502;
    const retryAfter = res.headers.get('retry-after') || '';
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (retryAfter) headers['Retry-After'] = retryAfter;
    return new Response(
        JSON.stringify({ error: `${label} returned ${res.status}`, status: res.status, retryAfter }),
        { status, headers }
    );
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
