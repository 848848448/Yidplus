export async function onRequestGet(context) {
  const { env } = context;
  try {
    // Recent media/video messages — what do their keys look like?
    const { results } = await env.DB.prepare(
      "SELECT id, type, substr(text,1,20) AS text, media_key, created_at FROM messages WHERE type='media' OR type='video' OR media_key IS NOT NULL ORDER BY created_at DESC LIMIT 20"
    ).all().catch((e) => ({ results: [{ err: String(e) }] }));
    return new Response(JSON.stringify({ count: (results||[]).length, rows: results }, null, 2), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(JSON.stringify({ error: String(e && e.message) })); }
}
