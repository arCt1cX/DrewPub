// Cloudflare Pages Function: GET /api/novel-meta?url=<book_page_url>
// Fetches a novelight.net book page and extracts the book id + metadata.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const bookUrl = url.searchParams.get('url');

    if (!bookUrl) {
        return json({ error: 'Missing query parameter "url"' }, 400);
    }

    try {
        const parsed = new URL(bookUrl);
        if (!parsed.hostname.endsWith('novelight.net')) {
            return json({ error: 'URL must be from novelight.net' }, 400);
        }
    } catch {
        return json({ error: 'Invalid URL' }, 400);
    }

    try {
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

        return json({ sourceBookId, sourceUrl: bookUrl, title, author: author.trim(), cover });
    } catch (err) {
        return json({ error: err.message }, 500);
    }
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
