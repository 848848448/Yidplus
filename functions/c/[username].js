// Shareable link for a Telegram channel: /c/<username>
//
// The channel used to be shared as /chat#tg=<username>, but a fragment is never
// sent to the server — so nothing could know which channel was being shared, and
// WhatsApp and the rest had no title or picture to show. This route puts the
// name in the path instead, renders the Open Graph tags a chat app reads when it
// unfurls a link, and then sends the visitor on to the channel itself.

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const username = String(params.username || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
  const origin = new URL(request.url).origin;
  const target = `${origin}/chat#tg=${encodeURIComponent(username)}`;

  let title = username ? '@' + username : 'YID PLUS';
  let image = '';   // only set when the channel actually has a photo — see below
  let members = 0;

  if (username) {
    try {
      const row = await env.DB.prepare(
        `SELECT c.title, c.photo_key,
                (SELECT COUNT(*) FROM telegram_channel_members m WHERE m.username = c.username) AS members
         FROM telegram_channels c WHERE c.username = ?`
      ).bind(username).first();
      if (row) {
        title = row.title || title;
        members = row.members || 0;
        if (row.photo_key) image = `${origin}/api/media/${row.photo_key}`;
      }
    } catch (e) { /* fall back to the defaults above */ }
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const desc = members
    ? `${members} member${members === 1 ? '' : 's'} on YID PLUS`
    : 'Channel on YID PLUS';

  // Only emit image tags when there's a real photo. There is no logo asset in
  // the repo — the site's own pages point og:image at /images/logo.png, which
  // isn't there — and advertising a 404 gives a broken preview rather than none.
  const imageTags = image
    ? `<meta property="og:image" content="${esc(image)}">\n` +
      `<meta name="twitter:card" content="summary_large_image">\n` +
      `<meta name="twitter:image" content="${esc(image)}">`
    : `<meta name="twitter:card" content="summary">`;

  const avatar = image
    ? `<div class="av" style="background-image:url('${esc(image)}')"></div>`
    : `<div class="av av-initial">${esc((title || '?').replace(/^@/, '').charAt(0).toUpperCase())}</div>`;

  const html = `<!DOCTYPE html>
<html lang="yi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · YID PLUS</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="YID PLUS">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin)}/c/${esc(username)}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${imageTags}
<!-- Scrapers stop at the head, so the redirect below only ever runs for people. -->
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<style>
  body { margin:0; font-family: system-ui, sans-serif; background:#1F6F5C; color:#fff;
         min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .card { text-align:center; padding:2rem; }
  .av { width:96px; height:96px; border-radius:50%; margin:0 auto 1rem;
        background:#fff center/cover no-repeat; }
  .av-initial { background:#229ED9; color:#fff; display:flex; align-items:center;
                justify-content:center; font-size:2.4rem; font-weight:700; }
  a { color:#fff; }
</style>
</head>
<body>
  <div class="card">
    ${avatar}
    <h1 style="font-size:1.1rem;margin:.2rem 0">${esc(title)}</h1>
    <p style="opacity:.8;font-size:.85rem">${esc(desc)}</p>
    <p style="font-size:.85rem"><a href="${esc(target)}">Opening YID PLUS…</a></p>
  </div>
  <script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
