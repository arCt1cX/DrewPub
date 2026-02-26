import ePub from 'epubjs';

/**
 * Parse an EPUB file and extract metadata + cover image.
 * @param {ArrayBuffer} arrayBuffer - The EPUB file data
 * @returns {Promise<{title, author, cover}>}
 */
export async function parseEpub(arrayBuffer) {
    const book = ePub(arrayBuffer);
    await book.ready;

    const metadata = await book.loaded.metadata;
    let cover = null;

    try {
        const coverUrl = await book.coverUrl();
        if (coverUrl) {
            // Convert blob URL to data URL for storage
            const response = await fetch(coverUrl);
            const blob = await response.blob();
            cover = await blobToDataURL(blob);
        }
    } catch (e) {
        console.warn('Could not extract cover:', e);
    }

    book.destroy();

    return {
        title: metadata.title || 'Untitled',
        author: metadata.creator || 'Unknown Author',
        cover,
    };
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Generate a unique ID
 */
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}
