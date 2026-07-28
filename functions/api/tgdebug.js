// TEMP diagnostic: ask the stream worker for a video slice WITH a Range header
// and report exactly what it says, so we can see why videos don't play.
const WORKER_BASE = 'https://yidplus-telegram-worker.avrumy5872877.workers.dev';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ch = (url.searchParams.get('ch') || '').replace(/[^a-zA-Z0-9_]/g, '');
  const id = (url.searchParams.get('id') || '').replace(/[^0-9]/g, '');
  if (!ch || !id) return json({ error: 'need ch and id' });

  const base = env.TG_STREAM_BASE_URL || WORKER_BASE;
  const target = base.replace(/\/$/, '') + '/media?ch=' + encodeURIComponent(ch) + '&id=' + id;

  const out = {};
  // 1) A ranged request — this is what a browser video player sends.
  try {
    const r = await fetch(target, { headers: { Range: 'bytes=0-131071' } });
    const buf = await r.arrayBuffer();
    out.ranged = {
      status: r.status,
      contentType: r.headers.get('Content-Type'),
      contentRange: r.headers.get('Content-Range'),
      contentLength: r.headers.get('Content-Length'),
      acceptRanges: r.headers.get('Accept-Ranges'),
      retryAfter: r.headers.get('Retry-After'),
      bodyBytes: buf.byteLength,
      bodyStart: r.status >= 400 ? new TextDecoder().decode(buf).slice(0, 200) : null,
    };
  } catch (e) { out.ranged = { error: String(e && e.message) }; }

  // 2) The thumbnail — small, whole-file path.
  try {
    const r = await fetch(target + '&thumb=1');
    const buf = await r.arrayBuffer();
    out.thumb = { status: r.status, contentType: r.headers.get('Content-Type'), bodyBytes: buf.byteLength };
  } catch (e) { out.thumb = { error: String(e && e.message) }; }

  return json(out);
}

function json(o) {
  return new Response(JSON.stringify(o, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
