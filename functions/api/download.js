// Cloudflare Pages Function: POST /api/download
// Proxies the EPUB download by submitting the form to OceanOfPDF,
// following redirects, and streaming the file back.

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const { action, id, filename } = body;

        if (!id || !filename) {
            return new Response(JSON.stringify({ error: 'Missing required fields: id, filename' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const formAction = action || 'https://oceanofpdf.com/Fetching_Resource.php';

        // Build form data
        const formData = new URLSearchParams();
        formData.append('id', id);
        formData.append('filename', filename);

        // Step 1: POST the download form
        const formResponse = await fetch(formAction, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://oceanofpdf.com/',
            },
            body: formData.toString(),
            redirect: 'follow',
        });

        // The response might be a redirect page (saomi.site) with JS-based redirect
        const contentType = formResponse.headers.get('content-type') || '';

        // If we got the actual file directly
        if (contentType.includes('application/epub') || contentType.includes('application/octet-stream') || contentType.includes('application/zip')) {
            const fileData = await formResponse.arrayBuffer();
            return new Response(fileData, {
                headers: {
                    'Content-Type': 'application/epub+zip',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }

        // Otherwise, parse the intermediate page for the actual download link
        const html = await formResponse.text();

        // Look for a direct download link or JS redirect in the page
        let downloadUrl = null;

        // Pattern 1: window.location or location.href redirect
        const jsRedirect = html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+\.epub[^"']*)/i);
        if (jsRedirect) {
            downloadUrl = jsRedirect[1];
        }

        // Pattern 2: meta refresh redirect
        if (!downloadUrl) {
            const metaRefresh = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)/i);
            if (metaRefresh) {
                downloadUrl = metaRefresh[1];
            }
        }

        // Pattern 3: Direct anchor link to epub
        if (!downloadUrl) {
            const epubLink = html.match(/href=["']([^"']*\.epub[^"']*)/i);
            if (epubLink) {
                downloadUrl = epubLink[1];
            }
        }

        // Pattern 4: Look for any download/file URL in the page
        if (!downloadUrl) {
            const fileUrl = html.match(/["'](https?:\/\/[^"']*\.epub[^"']*)/i);
            if (fileUrl) {
                downloadUrl = fileUrl[1];
            }
        }

        // Pattern 5: Look for drive/storage links
        if (!downloadUrl) {
            const storageUrl = html.match(/["'](https?:\/\/[^"']*(?:drive|storage|cdn|download)[^"']*)/i);
            if (storageUrl) {
                downloadUrl = storageUrl[1];
            }
        }

        if (downloadUrl) {
            // Make the URL absolute if needed
            if (downloadUrl.startsWith('/')) {
                const baseUrl = new URL(formResponse.url);
                downloadUrl = baseUrl.origin + downloadUrl;
            }

            // Fetch the actual file
            const fileResponse = await fetch(downloadUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': formResponse.url,
                },
                redirect: 'follow',
            });

            const fileData = await fileResponse.arrayBuffer();
            return new Response(fileData, {
                headers: {
                    'Content-Type': 'application/epub+zip',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }

        // If we can't find a download URL, return the intermediate page URL for debugging
        return new Response(JSON.stringify({
            error: 'Could not find download URL in intermediate page',
            intermediateUrl: formResponse.url,
            htmlSnippet: html.substring(0, 1000),
        }), {
            status: 502,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
}

// Handle CORS preflight
export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
