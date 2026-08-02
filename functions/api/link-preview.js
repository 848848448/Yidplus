// GET /api/link-preview?url=... -> fetch OG metadata for link previews in chat
import { json, corsHeaders } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request } = context;
  try {
    const raw = new URL(request.url).searchParams.get('url');
    if (!raw || !/^https?:\/\//i.test(raw)) return json({ ok: false, error: 'Invalid URL' }, 400);

    // ── SSRF protection ──
    // A user controls this URL and the server fetches it, so without guards an
    // attacker could point it at internal services or the cloud metadata
    // endpoint (169.254.169.254) to read secrets. Only allow public http(s)
    // hosts; reject localhost, private ranges, link-local, and raw IPs that
    // resolve to those.
    let target;
    try { target = new URL(raw); } catch (e) { return json({ ok: false, error: 'Invalid URL' }, 400); }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return json({ ok: false, error: 'Only http(s) allowed' }, 400);
    }
    const host = target.hostname.toLowerCase();
    const blockedHost =
      host === 'localhost' || host === '0.0.0.0' || host.endsWith('.localhost') ||
      host.endsWith('.internal') || host.endsWith('.local') ||
      // IPv4 private / loopback / link-local / metadata
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||                          // link-local + AWS/GCP metadata
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||            // 172.16.0.0 – 172.31.255.255
      /^::1$/.test(host) || /^fe80:/i.test(host) ||         // IPv6 loopback / link-local
      /^f[cd][0-9a-f]{2}:/i.test(host);                     // IPv6 unique-local
    if (blockedHost) return json({ ok: false, error: 'Blocked host' }, 400);

    const url = target.toString();
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'YIDPlus/1.0 (link preview bot)' },
      redirect: 'manual',                                   // don't auto-follow a redirect into a private host
      signal: AbortSignal.timeout(4000),
    });
    // A redirect could bounce us to an internal address — refuse to follow it.
    if (resp.status >= 300 && resp.status < 400) return json({ ok: false });
    if (!resp.ok) return json({ ok: false });
    // Only parse HTML — no point (and less risk) pulling large binaries.
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (ct && ct.indexOf('text/html') === -1 && ct.indexOf('application/xhtml') === -1) {
      return json({ ok: false });
    }
    const html = (await resp.text()).slice(0, 200000); // cap parse size

    const get = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
               || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
      return m ? m[1] : null;
    };

    const titleEl = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
    const title = get('og:title') || get('twitter:title') || (titleEl && titleEl[1]) || '';
    const description = get('og:description') || get('twitter:description') || get('description') || '';
    const image = get('og:image') || get('twitter:image') || '';

    if (!title) return json({ ok: false });

    return json({ ok: true, title: title.trim(), description: description.trim().slice(0, 120), image, url });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
      }
