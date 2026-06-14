// functions/api/media/[[key]].js
// GET /api/media/<any/path/with/slashes>
// Serves objects directly from R2 MY_BUCKET.
// The [[key]] catch-all param captures the full path after /api/media/.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { env, params } = context;

  try {
    // params.key is an array of path segments for [[key]] routes
    const segments = Array.isArray(params.key) ? params.key : [params.key];
    const key = segments.map(decodeURIComponent).join('/');

    if (!key) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    const object = await env.MY_BUCKET.get(key);
    if (!object) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    const headers = new Headers(corsHeaders);
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    return new Response(object.body, { status: 200, headers });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500, headers: corsHeaders });
  }
}
