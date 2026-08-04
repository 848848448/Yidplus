// Serves R2 objects — catch-all route for /api/media/...
// Supports HTTP Range requests (206 Partial Content) so video/audio can seek
// and large files stream instead of downloading whole — Safari in particular
// refuses to play a video without ranged responses.
export async function onRequestGet(context) {
  const { params, env, request } = context;
  try {
    const key = decodeURIComponent((params.key || []).join('/'));
    if (!key) return new Response('Not found', { status: 404 });

    // A thumbnail was requested (?thumb=1) for a video. We don't generate video
    // posters server-side, and serving the full video into an <img> just fails
    // (and wastes bandwidth). Return a 1x1 transparent PNG so the <img> loads
    // cleanly — the play button overlay shows over the black poster.
    const _wantThumb = new URL(request.url).searchParams.get('thumb');
    if (_wantThumb && /\.(mp4|mov|webm|mkv|m4v|avi|3gp)$/i.test(key)) {
      const px = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0)
      );
      return new Response(px, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const headers = new Headers();
    let obj = null;
    let status = 200;

    const rangeHeader = request.headers.get('Range');
    const m = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      const head = await env.MY_BUCKET.head(key);
      if (!head) return new Response('Not found', { status: 404 });
      const size = head.size;
      let start = m[1] === '' ? undefined : parseInt(m[1], 10);
      let end   = m[2] === '' ? undefined : parseInt(m[2], 10);
      if (start === undefined) { start = Math.max(0, size - (end || 0)); end = size - 1; } // suffix "bytes=-N"
      else if (end === undefined || end >= size) { end = size - 1; }
      if (isNaN(start) || start > end || start >= size) {
        return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': 'bytes */' + size, 'Accept-Ranges': 'bytes' } });
      }
      obj = await env.MY_BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) return new Response('Not found', { status: 404 });
      obj.writeHttpMetadata(headers);
      headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
      headers.set('Content-Length', String(end - start + 1));
      status = 206;
    } else {
      obj = await env.MY_BUCKET.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      obj.writeHttpMetadata(headers);
      if (obj.size != null) headers.set('Content-Length', String(obj.size));
    }

    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    headers.set('X-Content-Type-Options', 'nosniff');

    // If R2 didn't store a usable content-type (older uploads often saved voice
    // notes as octet-stream), infer a safe one from the extension so legitimate
    // audio/video/images still PLAY instead of being forced to download.
    let ct = (headers.get('Content-Type') || '').toLowerCase();
    if (!ct || ct === 'application/octet-stream' || ct === 'binary/octet-stream') {
      const ext = (key.split('.').pop() || '').toLowerCase();
      const MIME = {
        webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
        mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', weba: 'audio/webm',
        mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      };
      if (MIME[ext]) { headers.set('Content-Type', MIME[ext]); ct = MIME[ext]; }
    }

    // Defense in depth: force anything script-capable to download, never render
    // as a page on this origin.
    const renderable = ct.startsWith('image/') || ct.startsWith('video/') || ct.startsWith('audio/');
    if (!renderable || ct === 'image/svg+xml') {
      headers.set('Content-Type', 'application/octet-stream');
      headers.set('Content-Disposition', 'attachment');
    } else if (ct.startsWith('audio/') || ct.startsWith('video/')) {
      // Serve a clean base type — a "audio/webm;codecs=opus" Content-Type makes
      // some browsers reject the source ("no supported source found"). The
      // codecs hint belongs on <source type>, not the HTTP header.
      headers.set('Content-Type', ct.split(';')[0].trim());
    }

    return new Response(obj.body, { status, headers });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Max-Age': '86400',
  } });
}
