export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      "SELECT level, message, source, line, count, page, created_at FROM error_log ORDER BY created_at DESC LIMIT 30"
    ).all().catch((e) => ({ results: [{ dberr: String(e && e.message) }] }));
    return new Response(JSON.stringify({ count: (results||[]).length, errors: results }, null, 2), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(JSON.stringify({ error: String(e && e.message) })); }
}
