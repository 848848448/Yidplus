import { json, corsHeaders } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// GET ?username=X → fetch the public channel preview server-side (Cloudflare's
// network reaches Telegram even if the visitor's network blocks it) and return
// the recent post IDs. The browser then embeds each with the official widget.
export async function onRequestGet(context) {
  const { request } = context;
  try {
    const url = new URL(request.url);
    const username = (url.searchParams.get('username') || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!username) return json({ ok: false, error: 'username required' }, 400);

    const res = await fetch('https://t.me/s/' + username, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YIDPLUS/1.0)' },
      cf: { cacheTtl: 60, cacheEverything: true }
    });
    if (!res.ok) return json({ ok: false, error: 'Channel not reachable (' + res.status + ')' }, 502);

    const html = await res.text();

    // Public channels expose data-post="username/<id>"; private/invalid ones don't.
    const ids = [];
    const re = /data-post="[^"/]+\/(\d+)"/g;
    let m;
    while ((m = re.exec(html)) && ids.length < 800) {
      const id = parseInt(m[1]);
      if (ids.indexOf(id) === -1) ids.push(id);
    }
    ids.sort((a, b) => b - a);

    // A title, if present, for nicer display.
    let title = '';
    const tm = html.match(/<div class="tgme_channel_info_header_title"[^>]*><span[^>]*>([^<]+)<\/span>/);
    if (tm) title = tm[1].trim();

    if (!ids.length) {
      return json({ ok: true, username, title, ids: [], note: 'No public posts found — the channel may be private or empty.' });
    }
    return json({ ok: true, username, title, ids: ids.slice(0, 25) });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
