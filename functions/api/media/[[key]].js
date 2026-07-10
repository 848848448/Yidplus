// Serves R2 objects — catch-all route for /api/media/...
export async function onRequestGet(context) {
  const { params, env } = context;
  try {
    const key = decodeURIComponent((params.key || []).join('/'));
    if (!key) return new Response('Not found', { status: 404 });

    const obj = await env.MY_BUCKET.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('X-Content-Type-Options', 'nosniff');

    // Defense in depth: this route serves user uploads from the app's OWN
    // origin. If anything script-capable (html, svg, xml, js...) is ever
    // in the bucket — e.g. uploaded before the upload-side restrictions
    // existed — force it to download instead of render, so it can never
    // execute as a page on this origin.
    const ct = (headers.get('Content-Type') || '').toLowerCase();
    const renderable = ct.startsWith('image/') || ct.startsWith('video/') || ct.startsWith('audio/');
    if (!renderable || ct === 'image/svg+xml') {
      headers.set('Content-Type', 'application/octet-stream');
      headers.set('Content-Disposition', 'attachment');
    }

    return new Response(obj.body, { headers });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
}
