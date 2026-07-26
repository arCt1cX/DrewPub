// Cloudflare Pages Function: GET /api/novel-cover?url=<image_url>
// Proxies a web-novel cover image so the client can store the bytes with the
// book instead of hotlinking the source forever.
//
// Hotlinked freewebnovel covers load only intermittently — the site checks the
// referer and rate-limits image requests — so a book's cover came and went
// between app restarts. Fetching it once through here (with a referer the
// source accepts) lets the import keep it as a data URL, like EPUB covers.
// Restricted to the hosts we import from.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ALLOWED_HOSTS = [
    /(^|\.)novelight\.net$/i,
    /(^|\.)freewebnovel\.(com|net|me|so|cc|org)$/i,
];

const MAX_BYTES = 4 * 1024 * 1024;

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const target = url.searchParams.get('url');

    if (!target) return json({ error: 'Missing query parameter "url"' }, 400);

    let parsed;
    try {
        parsed = new URL(target);
    } catch {
        return json({ error: 'Invalid URL' }, 400);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return json({ error: 'Unsupported protocol' }, 400);
    }
    if (!ALLOWED_HOSTS.some(re => re.test(parsed.hostname))) {
        return json({ error: `Cover host not supported: ${parsed.hostname}` }, 400);
    }

    try {
        const res = await fetch(parsed.href, {
            headers: {
                'User-Agent': UA,
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': `${parsed.origin}/`,
            },
        });
        if (!res.ok) return json({ error: `Cover returned ${res.status}`, status: res.status }, res.status);

        const type = res.headers.get('content-type') || '';
        if (!/^image\//i.test(type)) return json({ error: `Not an image (${type || 'unknown type'})` }, 502);

        const bytes = await res.arrayBuffer();
        if (bytes.byteLength === 0) return json({ error: 'Empty image' }, 502);
        if (bytes.byteLength > MAX_BYTES) return json({ error: 'Cover too large' }, 413);

        return new Response(bytes, {
            headers: {
                'Content-Type': type,
                'Cache-Control': 'public, max-age=604800',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
