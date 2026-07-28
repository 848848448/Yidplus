const WORKER_BASE = 'https://yidplus-telegram-worker.avrumy5872877.workers.dev';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ch = (url.searchParams.get('ch') || '').replace(/[^a-zA-Z0-9_]/g, '');
  const id = (url.searchParams.get('id') || '').replace(/[^0-9]/g, '');
  if (!ch || !id) return json({ error: 'need ch and id' });
  const base = env.TG_STREAM_BASE_URL || WORKER_BASE;
  const target = base.replace(/\/$/, '') + '/media?ch=' + encodeURIComponent(ch) + '&id=' + id;

  async function probe(label, url2, headers) {
    try {
      const r = await fetch(url2, { headers: headers || {} });
      const buf = await r.arrayBuffer();
      return {
        status: r.status,
        contentType: r.headers.get('Content-Type'),
        contentRange: r.headers.get('Content-Range'),
        bytes: buf.byteLength,
        err: r.status >= 400 ? new TextDecoder().decode(buf).slice(0, 120) : null,
      };
    } catch (e) { return { error: String(e && e.message) }; }
  }

  // Run sequentially (one at a time) to avoid causing concurrency ourselves.
  const out = {};
  out.video_ranged = await probe('v', target, { Range: 'bytes=0-131071' });
  out.thumb        = await probe('t', target + '&thumb=1');
  return json(out);
}
function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
