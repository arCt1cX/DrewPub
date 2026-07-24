// Cloudflare Pages Function: GET /api/novel-chapter?source=<src>&id=<chapter_id>
// Fetches a single chapter's text from the given source and returns cleaned HTML.
// `source` defaults to novelight for books imported before multi-source support.
//   novelight    — id is numeric, text comes from an ajax endpoint
//   freewebnovel — id is "<slug>/chapter-<n>", text lives in the chapter page

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FWN_BASE = 'https://freewebnovel.com';
const FWN_ID = /^[a-z0-9][a-z0-9._~-]*\/chapter-[a-z0-9._~-]+$/i;

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const source = url.searchParams.get('source') || 'novelight';
    const id = url.searchParams.get('id');

    try {
        if (source === 'freewebnovel') {
            if (!id || !FWN_ID.test(id)) return json({ error: 'Missing or invalid "id"' }, 400);
            return await freewebnovelChapter(id);
        }

        if (!id || !/^\d+$/.test(id)) return json({ error: 'Missing or invalid "id"' }, 400);
        return await novelightChapter(id);
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

// ─── novelight ──────────────────────────────────────

async function novelightChapter(id) {
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
}

// Reduce the obfuscated <div> soup to clean <p> paragraphs.
// NOTE: we do NOT try to delete ad containers by span-matching — their markup
// varies (some put a <script> between the inner and outer </div>, which made a
// greedy match swallow the rest of the chapter). Instead we drop scripts/styles
// /comments, then keep only <div> blocks that still contain text; ad blocks
// reduce to empty and are skipped, while real paragraphs survive intact.
function clean(html) {
    let s = stripNonContent(html);
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

// ─── freewebnovel ───────────────────────────────────

async function freewebnovelChapter(id) {
    const urls = [`${FWN_BASE}/${id}.html`, `${FWN_BASE}/novel/${id}`];
    let last = null;
    for (const url of urls) {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Referer': `${FWN_BASE}/` },
        });
        if (res.ok) {
            const content = cleanFreewebnovel(await res.text());
            if (!content) return json({ error: 'Empty chapter content' }, 502);
            return json({ content });
        }
        last = res;
        if (res.status === 429 || res.status >= 500) break;
    }
    return upstreamError(last, 'Chapter');
}

// The chapter body is a <div class="txt"> (historically id="article") of plain
// <p> paragraphs, followed by prev/next navigation and related-novel blocks.
// We slice out the body, then keep the paragraphs that are actual prose.
function cleanFreewebnovel(html) {
    const s = stripNonContent(html);

    const open = s.match(/<div[^>]*id="article"[^>]*>/i) ||
        s.match(/<div[^>]*class="[^"]*\btxt\b[^"]*"[^>]*>/i);
    const start = open ? open.index + open[0].length : 0;

    // Stop at whatever comes after the text: page navigation, another module
    // block, or the footer.
    const rest = s.slice(start);
    const stop = rest.search(/<div[^>]*class="[^"]*(?:page-|m-(?:foot|nav|share|newest|book)|bottom|foot)[^"]*"|<footer\b/i);
    const body = stop > -1 ? rest.slice(0, stop) : rest;

    const parts = [];
    const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = pRe.exec(body)) !== null) {
        if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(m[1])) continue;
        if (isBoilerplate(m[2])) continue;
        const text = esc(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim());
        if (text) parts.push(`<p>${text}</p>`);
    }

    // Fallback for a different layout: keep the whole body as one paragraph.
    if (parts.length === 0) {
        const text = esc(body.replace(/<[^>]+>/g, ' ').trim());
        if (text) parts.push(`<p>${text}</p>`);
    }

    return parts.join('\n');
}

// freewebnovel puts its chapter heading and its "read this on <site>" notices in
// fully-bolded paragraphs. Drop a paragraph when the bold text IS the whole
// paragraph (so bold inside real prose survives), or when a short paragraph
// carries a source/mirror plug.
const FWN_PLUG = /(freewebnovel|free\s?web\s?novel|libread|novel(?:bin|full|usb|hall|next)|read\s+(?:the\s+)?(?:latest|more)\s+chapters?\s+(?:at|on)|updated?\s+(?:by|from)\s+\w+\.(?:com|net|org)|visit\s+\S+\.(?:com|net|org)|new\s+novel\s+chapters?\s+are\s+published)/i;

function isBoilerplate(inner) {
    const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) return true;

    const bold = inner.match(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/i);
    if (bold && bold[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() === text) return true;

    return text.length < 250 && FWN_PLUG.test(text);
}

// ─── Shared cleaning ────────────────────────────────

function stripNonContent(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
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
const WM_BRAND = /\b(only on|exclusive on|official version|original source|read (it|this|the)? ?on|visit novelight|the official source)\b/;

// A parenthetical is part of the watermark only if it carries a homoglyph or a
// brand phrase — so genuine prose parentheses right after a watermark are kept.
function wmIsWatermarkParen(p) {
    return WM_HOMO.test(p) || WM_BRAND.test(wmFold(p));
}

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
    // Drop the marker, plus an adjacent parenthetical only if it's watermark-like.
    text = text.replace(/\x00\s*(\([^)]*\))?/gu, (full, paren) =>
        (paren && wmIsWatermarkParen(paren)) ? ' ' : (paren ? ' ' + paren : ' '));
    text = text.replace(WM_WORD, w => (WM_HOMO.test(w) && wmFold(w) === 'novelight') ? '' : w);
    text = text.replace(/\([^)]*\)/gu, m => (WM_HOMO.test(m) && wmFold(m).includes('novelight')) ? '' : m);
    return text.replace(/[ \t ]{2,}/g, ' ').replace(/\s+([.,!?;:"”’])/g, '$1').trim();
}

// Decode the HTML entities the sources use, then re-escape for XHTML safety.
function esc(t) {
    return t
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
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
