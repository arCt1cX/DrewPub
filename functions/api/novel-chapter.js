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

// Reduce the obfuscated <div> soup to clean <p> paragraphs.
// NOTE: we do NOT try to delete ad containers by span-matching — their markup
// varies (some put a <script> between the inner and outer </div>, which made a
// greedy match swallow the rest of the chapter). Instead we drop scripts/styles
// /comments, then keep only <div> blocks that still contain text; ad blocks
// reduce to empty and are skipped, while real paragraphs survive intact.
function clean(html) {
    let s = html;
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    // Unwrap the outer chapter-text container (its close is then an orphan, which
    // the paragraph matcher harmlessly ignores).
    s = s.replace(/^\s*<div[^>]*class="[^"]*chapter-text[^"]*"[^>]*>/i, '');

    // Keep each <div>…</div> block that has text after stripping inline tags.
    const parts = [];
    const blockRe = /<div[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = blockRe.exec(s)) !== null) {
        const text = esc(stripWatermarks(m[1].replace(/<[^>]+>/g, '').trim()));
        if (text) parts.push(`<p>${text}</p>`);
    }

    // Fallback: if no <div> blocks matched, keep stripped text as one paragraph.
    if (parts.length === 0) {
        const text = esc(stripWatermarks(s.replace(/<[^>]+>/g, '').trim()));
        if (text) parts.push(`<p>${text}</p>`);
    }

    return parts.join('\n');
}

// ── Anti-piracy watermark removal ──────────────────────────────
// novelight randomly injects an inline watermark like "❖ Nоvеlіgһt ❖ (Only on
// Novelight)" mid-sentence — flanked by decorative symbols and spelled with
// non-ASCII homoglyphs (Cyrillic/math letters). Real prose never mixes those,
// so we remove a symbol-delimited run that contains a non-ASCII letter (plus an
// adjacent parenthetical), without having to decode the obfuscated word.
const WM_DECO = '\\u2600-\\u27BF\\u2B00-\\u2BFF\\u2190-\\u21FF';
const WM_DECO_TEST = /[☀-➿⬀-⯿]/u;
const WM_HOMO = /[Ͱ-ϿЀ-ӿ℀-⅏Ａ-ｚ\u{1D400}-\u{1D7FF}]/u;
const WM_SEG = new RegExp('[' + WM_DECO + '][^' + WM_DECO + ']{0,80}?[' + WM_DECO + ']', 'gu');
const WM_WORD = /[\p{L}\u{1D400}-\u{1D7FF}]{6,12}/gu;

function wmFold(t) {
    return t.replace(/[I|1]/g, 'l').replace(/0/g, 'o')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[оОΟ]/g, 'o').replace(/[еЕҽ]/g, 'e').replace(/[іІ]/g, 'i').replace(/[һҺ]/g, 'h')
        .replace(/[ѕ]/g, 's').replace(/[ӏ]/g, 'l').replace(/[аА]/g, 'a').replace(/[сС]/g, 'c')
        .replace(/[рР]/g, 'p').replace(/[ɡ]/g, 'g').toLowerCase();
}

function stripWatermarks(text) {
    if (!text || (!WM_DECO_TEST.test(text) && !WM_HOMO.test(text))) return text;
    text = text.replace(WM_SEG, m => WM_HOMO.test(m) ? '\x00' : m);   // mark symbol+homoglyph runs
    text = text.replace(/\x00\s*\([^)]*\)/gu, ' ');                    // drop attached parenthetical
    text = text.replace(/\x00/g, ' ');
    text = text.replace(WM_WORD, w => (WM_HOMO.test(w) && wmFold(w) === 'novelight') ? '' : w);
    text = text.replace(/\([^)]*\)/gu, m => (WM_HOMO.test(m) && wmFold(m).includes('novelight')) ? '' : m);
    return text.replace(/[ \t ]{2,}/g, ' ').replace(/\s+([.,!?;:"”’])/g, '$1').trim();
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
