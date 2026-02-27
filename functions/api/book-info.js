// Cloudflare Pages Function: GET /api/book-info?url=<detail_page_url>
// Fetches a book's detail page and extracts the EPUB download form data.

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const detailUrl = url.searchParams.get('url');

    if (!detailUrl) {
        return new Response(JSON.stringify({ error: 'Missing query parameter "url"' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Validate URL is from oceanofpdf.com
    try {
        const parsed = new URL(detailUrl);
        if (!parsed.hostname.endsWith('oceanofpdf.com')) {
            return new Response(JSON.stringify({ error: 'URL must be from oceanofpdf.com' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const response = await fetch(detailUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
        });

        if (!response.ok) {
            return new Response(JSON.stringify({ error: `Failed to fetch detail page: ${response.status}` }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const html = await response.text();
        const downloads = parseDownloadForms(html);
        const description = parseDescription(html);
        const coverFull = parseCoverFull(html);

        return new Response(JSON.stringify({ downloads, description, coverFull }), {
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

function parseDownloadForms(html) {
    const forms = [];
    // Match download forms — look for forms with Fetching_Resource.php action
    const formRegex = /<form[^>]*action="([^"]*Fetching_Resource\.php)"[^>]*>([\s\S]*?)<\/form>/g;
    let match;

    while ((match = formRegex.exec(html)) !== null) {
        const action = match[1];
        const formHtml = match[2];

        // Extract hidden inputs
        const idMatch = formHtml.match(/<input[^>]*name="id"[^>]*value="([^"]*)"/);
        const filenameMatch = formHtml.match(/<input[^>]*name="filename"[^>]*value="([^"]*)"/);

        if (idMatch && filenameMatch) {
            const filename = filenameMatch[1];
            // Determine format from filename
            const isEpub = filename.toLowerCase().includes('.epub');
            const isPdf = filename.toLowerCase().includes('.pdf');

            forms.push({
                action,
                id: idMatch[1],
                filename: filename,
                format: isEpub ? 'epub' : isPdf ? 'pdf' : 'unknown',
            });
        }
    }

    return forms;
}

function parseDescription(html) {
    // Try to find the main content/description
    const descMatch = html.match(/<div class="entry-content"[^>]*>([\s\S]*?)<\/div>/);
    if (descMatch) {
        // Strip HTML tags
        return descMatch[1].replace(/<[^>]*>/g, '').trim().substring(0, 500);
    }
    return '';
}

function parseCoverFull(html) {
    // Look for the full-size cover image on the detail page
    const coverMatch = html.match(/class="[^"]*wp-post-image[^"]*"[^>]*data-src="([^"]*)"/);
    if (coverMatch) return coverMatch[1];

    const coverMatch2 = html.match(/class="[^"]*wp-post-image[^"]*"[^>]*src="(https:\/\/media\.oceanofpdf\.com[^"]*)"/);
    if (coverMatch2) return coverMatch2[1];

    return '';
}
