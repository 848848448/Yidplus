export async function onRequestGet(context) {
  const { env, request } = context;
  const out = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT media_key, created_at FROM messages WHERE type = 'voice' AND media_key IS NOT NULL ORDER BY created_at DESC LIMIT 6"
    ).all();
    for (const r of (results || [])) {
      const rec = { key: r.media_key, created_at: r.created_at };
      try {
        const head = await env.MY_BUCKET.head(r.media_key);
        rec.size = head ? head.size : null;
        rec.ct = head && head.httpMetadata ? head.httpMetadata.contentType : null;
        const obj = await env.MY_BUCKET.get(r.media_key, { range: { offset: 0, length: 8 } });
        if (obj) {
          const buf = new Uint8Array(await obj.arrayBuffer());
          rec.first8 = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');
          // webm EBML magic = 1a 45 df a3 ; mp4 has 'ftyp' at bytes 4-7 ; ogg='4f 67 67 53'
          rec.valid_webm = rec.first8.startsWith('1a 45 df a3');
        }
      } catch (e) { rec.err = String(e && e.message); }
      out.push(rec);
    }
  } catch (e) { return new Response(JSON.stringify({ error: String(e && e.message) }), { headers: { 'Content-Type': 'application/json' } }); }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
