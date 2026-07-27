// GET /api/tgvid?ch=<channel>&id=<msg_id>
//
// Telegram itself will happily send a video of any size — the reason clips
// didn't play here is that they streamed straight from the external
// yidplus-telegram-worker, and browsers (Safari/iOS especially) refuse to play
// a video unless the server answers HTTP Range requests with 206. This proxy
// fixes that for good: the first time a video is asked for, we pull it from the
// worker and stream it into R2; from then on it's served out of R2 with full
// Range support, so any size video plays and seeks like it should.

const WORKER_BASE = 'https://yidplus-telegram-worker.avrumy5872877.workers.dev';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
  };
}

// Serve an R2 object honouring the Range header (206 Partial Content).
async function serveFromR2(env, key, request) {
  const headers = new Headers(corsHeaders());
  const range = request.headers.get('Range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let obj, status = 200;
  if (m) {
    const head = await env.MY_BUCKET.head(key);
    if (!head) return null;
    const size = head.size;
    let start = m[1] === '' ? undefined : parseInt(m[1], 10);
    let end   = m[2] === '' ? undefined : parseInt(m[2], 10);
    if (start === undefined) { start = Math.max(0, size - (end || 0)); end = size - 1; }
    else if (end === undefined || end >= size) { end = size - 1; }
    if (isNaN(start) || start > end || start >= size) {
      return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': 'bytes */' + size, 'Accept-Ranges': 'bytes' } });
    }
    obj = await env.MY_BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!obj) return null;
    obj.writeHttpMetadata(headers);
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
    headers.set('Content-Length', String(end - start + 1));
    status = 206;
  } else {
    obj = await env.MY_BUCKET.get(key);
    if (!obj) return null;
    obj.writeHttpMetadata(headers);
    if (obj.size != null) headers.set('Content-Length', String(obj.size));
  }
  if (!headers.get('Content-Type')) headers.set('Content-Type', 'video/mp4');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { status, headers });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const ch = (url.searchParams.get('ch') || '').replace(/[^a-zA-Z0-9_]/g, '');
    const id = (url.searchParams.get('id') || '').replace(/[^0-9]/g, '');
    if (!ch || !id) return new Response('bad request', { status: 400 });
    const key = 'tgvid/' + ch + '/' + id + '.mp4';

    // 1) Already cached → serve from R2 with Range (plays + seeks, any size).
    const cached = await serveFromR2(env, key, request).catch(() => null);
    if (cached) return cached;

    // 2) Not cached → pull it from the stream worker, cache into R2 while we
    //    hand the bytes to the player. tee() means we don't buffer the whole
    //    file, so even large videos stream through within the Worker's limits.
    const base = env.TG_STREAM_BASE_URL || WORKER_BASE;
    const upstream = await fetch(base.replace(/\/$/, '') + '/media?ch=' + encodeURIComponent(ch) + '&id=' + id, {
      headers: { 'User-Agent': 'yidplus-proxy' },
    });
    if (!upstream.ok || !upstream.body) {
      return new Response('video unavailable', { status: 502, headers: corsHeaders() });
    }
    const ct = upstream.headers.get('Content-Type') || 'video/mp4';
    const len = upstream.headers.get('Content-Length');

    const [toClient, toR2] = upstream.body.tee();
    // Store in the background so the next request is fully Range-capable.
    context.waitUntil(
      env.MY_BUCKET.put(key, toR2, { httpMetadata: { contentType: ct } }).catch(() => {})
    );

    const h = new Headers(corsHeaders());
    h.set('Content-Type', ct);
    if (len) h.set('Content-Length', len);
    h.set('Cache-Control', 'public, max-age=3600');
    // First pass streams whole; seeking becomes available once it's in R2.
    h.set('Accept-Ranges', 'none');
    return new Response(toClient, { status: 200, headers: h });
  } catch (err) {
    return new Response('error: ' + (err && err.message), { status: 500, headers: corsHeaders() });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Max-Age': '86400',
    },
  });
}
