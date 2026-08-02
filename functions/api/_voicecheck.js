// TEMP — checks the latest voice note: its stored key and how it's served.
export async function onRequestGet(context) {
  const { env, request } = context;
  const out = {};
  try {
    const row = await env.DB.prepare(
      "SELECT id, media_key, type, created_at FROM messages WHERE type = 'voice' AND media_key IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    ).first();
    if (!row) { out.note = 'no voice messages found'; return json(out); }
    out.media_key = row.media_key;
    out.created_at = row.created_at;
    // What content-type does R2 have stored?
    try {
      const head = await env.MY_BUCKET.head(row.media_key);
      out.r2_size = head ? head.size : null;
      out.r2_content_type = head && head.httpMetadata ? head.httpMetadata.contentType : null;
    } catch (e) { out.r2_error = String(e && e.message); }
    // What does our media route actually serve?
    try {
      const origin = new URL(request.url).origin;
      const url = origin + '/api/media/' + row.media_key.split('/').map(encodeURIComponent).join('/');
      out.media_url = url;
      const r = await fetch(url, { headers: { Range: 'bytes=0-1' } });
      out.served_status = r.status;
      out.served_content_type = r.headers.get('Content-Type');
      out.served_disposition = r.headers.get('Content-Disposition');
    } catch (e) { out.fetch_error = String(e && e.message); }
  } catch (e) { out.error = String(e && e.message); }
  return json(out);
}
function json(o) { return new Response(JSON.stringify(o, null, 2), { headers: { 'Content-Type': 'application/json' } }); }
