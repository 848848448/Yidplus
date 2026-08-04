// TEMP migration — fix rooms whose photo_key stored a full /api/media/ URL.
export async function onRequestGet(context) {
  const { env } = context;
  const out = { fixed: [], scanned: 0 };
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, photo_key FROM rooms WHERE photo_key LIKE '/api/media/%' OR photo_key LIKE '%25%' OR photo_key LIKE '%2F%'"
    ).all().catch(() => ({ results: [] }));
    out.scanned = (results || []).length;
    for (const r of (results || [])) {
      let raw = String(r.photo_key || '');
      // Strip a leading /api/media/ (any number of times) then decode.
      raw = raw.replace(/^\/api\/media\//, '');
      // Decode until stable (handles double-encoding).
      for (let i = 0; i < 3; i++) {
        try {
          const dec = decodeURIComponent(raw);
          if (dec === raw) break;
          raw = dec;
        } catch (e) { break; }
      }
      // Also strip a leftover /api/media/ that appeared after decoding.
      raw = raw.replace(/^\/?api\/media\//, '');
      if (raw && raw !== r.photo_key) {
        await env.DB.prepare("UPDATE rooms SET photo_key = ? WHERE id = ?").bind(raw, r.id).run().catch(() => {});
        out.fixed.push({ id: r.id, from: r.photo_key, to: raw });
      }
    }
  } catch (e) { out.error = String(e && e.message); }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
