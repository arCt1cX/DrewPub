// Cloudflare Pages Function: GET /api/novel-list?bookId=<id>&page=<n>
// Returns one page of a novelight.net book's chapter list (newest first).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const bookId = url.searchParams.get('bookId');
    const page = url.searchParams.get('page') || '1';

    if (!bookId || !/^\d+$/.test(bookId)) {
        return json({ error: 'Missing or invalid "bookId"' }, 400);
    }

    try {
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
        const chapters = parseChapters(listHtml);

        return json({ chapters });
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

function parseChapters(html) {
    const chapters = [];
    const anchorRe = /<a[^>]*href="\/book\/chapter\/(\d+)"[\s\S]*?<\/a>/g;
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
        const id = m[1];
        const block = m[0];
        const titleMatch = block.match(/<div class="title">\s*(\d+)\s*chapter\s*-\s*<span>([^<]*)<\/span>/i);
        const num = titleMatch ? parseInt(titleMatch[1], 10) : null;
        const title = titleMatch ? titleMatch[2].trim() : `Chapter ${id}`;
        const dateMatch = block.match(/<span class="date">([^<]*)<\/span>/i);
        const date = dateMatch ? dateMatch[1].trim() : '';
        chapters.push({ id, num, title, date });
    }
    return chapters;
}

// Forward rate-limit / unavailable status (and Retry-After) so the client can back off.
function upstreamError(res, label) {
    const status = (res.status === 429 || res.status === 503) ? res.status : 502;
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
