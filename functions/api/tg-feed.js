import { json, corsHeaders } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// GET ?username=X → fetch the public channel preview server-side (Cloudflare's
// network reaches Telegram even if the visitor's network blocks it) and return
// recent post IDs. Always returns ok:true (status lives in the body) because the
// shared client handleRes() throws on ok:false.
export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const username = (url.searchParams.get('username') || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!username) return json({ ok: true, found: false, error: 'username required' });

  try {
    const res = await fetch('https://t.me/s/' + username, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'text/html'
      }
    });

    const status = res.status;
    if (!res.ok) {
      return json({ ok: true, found: false, status, error: 'Telegram returned ' + status });
    }

    const html = await res.text();

    const ids = [];
    const re = /data-post="[^"/]+\/(\d+)"/g;
    let m;
    while ((m = re.exec(html)) && ids.length < 800) {
      const id = parseInt(m[1]);
      if (ids.indexOf(id) === -1) ids.push(id);
    }
    ids.sort((a, b) => b - a);

    let title = '';
    const tm = html.match(/tgme_channel_info_header_title[^>]*>\s*<span[^>]*>([^<]+)<\/span>/);
    if (tm) title = tm[1].trim();

    const looksLikeChannel = /tgme_/.test(html);
    return json({
      ok: true,
      found: ids.length > 0,
      status,
      username,
      title,
      ids: ids.slice(0, 25),
      reason: ids.length ? '' : (looksLikeChannel ? 'private_or_empty' : 'not_a_channel')
    });
  } catch (err) {
    return json({ ok: true, found: false, error: err.message });
  }
}
