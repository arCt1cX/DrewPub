/**
 * Cloudflare Function — Analyze dialogue using Workers AI (free tier).
 * POST /api/analyze-dialogue
 * Body: { text: string, bookId: string, chapterIndex: number }
 * Returns: { segments: [{ text, type, speaker, gender }], characters: {} }
 */

export async function onRequestPost(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    try {
        const { text, bookId, chapterIndex } = await context.request.json();

        if (!text || text.length < 10) {
            return new Response(JSON.stringify({ error: 'Text too short' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Truncate to ~3000 chars to stay within free tier token limits
        const truncated = text.length > 3000 ? text.substring(0, 3000) + '...' : text;

        // Use Cloudflare Workers AI if available (env.AI binding)
        if (context.env?.AI) {
            const prompt = `Analyze this book chapter excerpt. For each paragraph or dialogue, identify:
1. Whether it's narration or dialogue
2. If dialogue, who is speaking (character name or "Unknown")
3. Character gender (male/female/unknown)

Return ONLY a JSON object with this exact structure:
{
  "segments": [
    { "text": "first paragraph...", "type": "narration", "speaker": null, "gender": null },
    { "text": "dialogue text", "type": "dialogue", "speaker": "CharacterName", "gender": "male" }
  ],
  "characters": {
    "CharacterName": { "gender": "male", "count": 3 }
  }
}

Chapter text:
${truncated}`;

            try {
                const result = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                    messages: [
                        { role: 'system', content: 'You are a literary text analysis assistant. You only output valid JSON, no markdown.' },
                        { role: 'user', content: prompt },
                    ],
                    max_tokens: 2048,
                });

                // Try to parse the AI response as JSON
                const responseText = result?.response || '';
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return new Response(JSON.stringify(parsed), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    });
                }
            } catch (aiErr) {
                console.error('Workers AI failed:', aiErr);
                // Fall through to fallback
            }
        }

        // Fallback: return empty result (client will use local regex parser)
        return new Response(JSON.stringify({
            segments: [],
            characters: {},
            fallback: true,
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
