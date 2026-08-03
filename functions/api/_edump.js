export async function onRequestGet(context) {
  const { env } = context;
  const out = {};
  try {
    const cols = await env.DB.prepare("PRAGMA table_info(error_log)").all().catch((e) => ({ results: [{ e: String(e) }] }));
    out.columns = (cols.results || []).map((c) => c.name);
  } catch (e) { out.schema_err = String(e && e.message); }
  // Try a direct insert and report any error verbatim.
  try {
    await env.DB.prepare(
      "INSERT INTO error_log (id, level, message, source, line, col, stack, page, ua, user_id, nickname, count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)"
    ).bind(crypto.randomUUID(), 'test', 'direct insert probe', 'probe', 0, 0, '', '/', '', null, null, new Date().toISOString()).run();
    out.insert = 'ok';
  } catch (e) { out.insert_error = String(e && e.message); }
  try {
    const { results } = await env.DB.prepare("SELECT level, message, created_at FROM error_log ORDER BY created_at DESC LIMIT 10").all();
    out.rows = results;
  } catch (e) { out.select_error = String(e && e.message); }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
