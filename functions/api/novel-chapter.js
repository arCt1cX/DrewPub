// Cloudflare Pages Function: GET /api/novel-chapter?id=<chapter_id>
// Fetches a single novelight.net chapter's text and returns cleaned HTML.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');

    if (!id || !/^\d+$/.test(id)) {
        return json({ error: 'Missing or invalid "id"' }, 400);
    }

    try {
        const res = await fetch(`https://novelight.net/book/ajax/read-chapter/${id}`, {
            headers: {
                'User-Agent': UA,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `https://novelight.net/book/chapter/${id}`,
            },
        });
        if (!res.ok) return upstreamError(res, 'Chapter');

        const data = await res.json().catch(() => null);
        const raw = data && typeof data.content === 'string' ? data.content : '';
        if (!raw) return json({ error: 'Empty chapter content' }, 502);

        return json({ content: clean(raw) });
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

// Strip ads/scripts and reduce the obfuscated <div> soup to clean <p> paragraphs.
function clean(html) {
    let s = html;
    // Drop ad containers entirely.
    s = s.replace(/<div[^>]*class="[^"]*advertisment[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi, '');
    // Drop any leftover scripts/styles/iframes.
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    // Unwrap the outer chapter-text container.
    s = s.replace(/^\s*<div[^>]*class="[^"]*chapter-text[^"]*"[^>]*>/i, '');
    s = s.replace(/<\/div>\s*$/i, '');

    // Split remaining content into paragraphs from the inner <div> blocks.
    const parts = [];
    const blockRe = /<div[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = blockRe.exec(s)) !== null) {
        const text = esc(m[1].replace(/<[^>]+>/g, '').trim());
        if (text) parts.push(`<p>${text}</p>`);
    }

    // Fallback: if no <div> blocks matched, keep stripped text as one paragraph.
    if (parts.length === 0) {
        const text = esc(s.replace(/<[^>]+>/g, '').trim());
        if (text) parts.push(`<p>${text}</p>`);
    }

    return parts.join('\n');
}

// Decode the few HTML entities the source uses, then re-escape for XHTML safety.
function esc(t) {
    return t
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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
