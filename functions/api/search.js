// Cloudflare Pages Function: GET /api/search?q=<query>&page=<page>
// Proxies search to OceanOfPDF and returns parsed results as JSON.

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const query = url.searchParams.get('q');
    const page = url.searchParams.get('page') || '1';

    if (!query) {
        return new Response(JSON.stringify({ error: 'Missing query parameter "q"' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const searchUrl = page === '1'
            ? `https://oceanofpdf.com/?s=${encodeURIComponent(query)}`
            : `https://oceanofpdf.com/page/${page}/?s=${encodeURIComponent(query)}`;

        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
        });

        if (!response.ok) {
            return new Response(JSON.stringify({ error: `OceanOfPDF returned ${response.status}` }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const html = await response.text();
        const results = parseSearchResults(html);
        const pagination = parsePagination(html);

        return new Response(JSON.stringify({ results, pagination }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

function parseSearchResults(html) {
    const results = [];
    // Match each <article> block
    const articleRegex = /<article[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g;
    let match;

    while ((match = articleRegex.exec(html)) !== null) {
        const ariaLabel = match[1];
        const articleHtml = match[2];

        // Extract detail page URL
        const linkMatch = articleHtml.match(/<h2[^>]*class="entry-title"[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/);
        const title = linkMatch ? linkMatch[2].trim() : ariaLabel;
        const detailUrl = linkMatch ? linkMatch[1] : '';

        // Extract cover image
        const imgMatch = articleHtml.match(/data-src="([^"]*)"/) || articleHtml.match(/src="(https:\/\/media\.oceanofpdf\.com[^"]*)"/);
        const cover = imgMatch ? imgMatch[1] : '';

        // Extract author
        const authorMatch = articleHtml.match(/<strong>Author:\s*<\/strong>([^<]*)/);
        const author = authorMatch ? authorMatch[1].trim() : 'Unknown';

        // Extract genre
        const genreMatch = articleHtml.match(/<strong>Genre:\s*<\/strong>([^<]*)/);
        const genre = genreMatch ? genreMatch[1].trim() : '';

        // Extract language
        const langMatch = articleHtml.match(/<strong>Language:\s*<\/strong>([^<]*)/);
        const language = langMatch ? langMatch[1].trim() : '';

        // Extract date
        const dateMatch = articleHtml.match(/<time[^>]*>([^<]*)<\/time>/);
        const date = dateMatch ? dateMatch[1].trim() : '';

        if (detailUrl) {
            results.push({ title, author, cover, genre, language, date, detailUrl });
        }
    }

    return results;
}

function parsePagination(html) {
    const pages = [];
    const pageRegex = /<li[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>.*?(\d+|Next Page)/gs;
    let match;
    let currentPage = 1;
    let totalPages = 1;

    // Find current page
    const currentMatch = html.match(/<li class="active">\s*<a[^>]*>.*?(\d+)/s);
    if (currentMatch) {
        currentPage = parseInt(currentMatch[1]);
    }

    // Find all page numbers
    const allPages = [...html.matchAll(/class="screen-reader-text">Go to page<\/span>\s*(\d+)/g)];
    if (allPages.length > 0) {
        totalPages = Math.max(...allPages.map(m => parseInt(m[1])));
    }

    const hasNext = html.includes('pagination-next');

    return { currentPage, totalPages, hasNext };
}
