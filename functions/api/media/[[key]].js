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
    return new Response(obj.body, { headers });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
}
