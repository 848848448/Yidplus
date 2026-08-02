export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      "SELECT level, message, source, line, count, page FROM error_log ORDER BY count DESC, created_at DESC LIMIT 40"
    ).all().catch(() => ({ results: [] }));
    return new Response(JSON.stringify(results || [], null, 2), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(JSON.stringify({ error: String(e && e.message) })); }
}
