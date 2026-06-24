// GET /api/link-preview?url=... -> fetch OG metadata for link previews in chat
import { json, corsHeaders } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request } = context;
  try {
    const url = new URL(request.url).searchParams.get('url');
    if (!url || !url.startsWith('http')) return json({ ok: false, error: 'Invalid URL' }, 400);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'YIDPlus/1.0 (link preview bot)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return json({ ok: false });
    const html = await resp.text();

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
