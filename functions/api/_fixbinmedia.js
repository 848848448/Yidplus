// TEMP migration — chat media saved as ".bin" (no extension) is mis-detected as
// an image and renders as an empty bubble. Re-key each to the right extension
// based on the stored content-type so videos/images/audio render correctly.
export async function onRequestGet(context) {
  const { env } = context;
  const out = { fixed: [], scanned: 0 };
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, media_key FROM messages WHERE media_key LIKE '%.bin' LIMIT 25"
    ).all().catch(() => ({ results: [] }));
    out.scanned = (results || []).length;
    for (const m of (results || [])) {
      try {
        const obj = await env.MY_BUCKET.get(m.media_key);
        if (!obj) continue;
        const ct = (obj.httpMetadata && obj.httpMetadata.contentType || '').toLowerCase();
        let ext = '';
        if (ct === 'video/quicktime') ext = 'mov';
        else if (ct.startsWith('video/')) ext = ct.split('/')[1] || 'mp4';
        else if (ct.startsWith('image/')) ext = (ct.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        else if (ct.startsWith('audio/')) ext = ct.split('/')[1] || 'm4a';
        if (!ext) continue; // unknown — leave it
        const newKey = m.media_key.replace(/\.bin$/, '.' + ext);
        const body = await obj.arrayBuffer();
        await env.MY_BUCKET.put(newKey, body, { httpMetadata: { contentType: ct } });
        await env.DB.prepare("UPDATE messages SET media_key = ? WHERE id = ?").bind(newKey, m.id).run();
        await env.MY_BUCKET.delete(m.media_key).catch(() => {});
        out.fixed.push({ id: m.id, ct, to: newKey });
      } catch (e) { out.fixed.push({ id: m.id, error: String(e && e.message) }); }
    }
    const rem = await env.DB.prepare("SELECT COUNT(*) AS c FROM messages WHERE media_key LIKE '%.bin'").first().catch(() => ({ c: 0 }));
    out.remaining = (rem && rem.c) || 0;
  } catch (e) { out.error = String(e && e.message); }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
