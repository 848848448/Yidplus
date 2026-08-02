// functions/share.js
// Web Share Target endpoint. The phone's share sheet POSTs shared content here
// (title/text/url and optionally a file). We stash it briefly and redirect into
// the app, where the user picks where to send it (a chat, a channel, the feed).

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const form = await request.formData();
    const title = (form.get('title') || '').toString();
    const text = (form.get('text') || '').toString();
    const url = (form.get('url') || '').toString();
    const file = form.get('media');

    const parts = [];
    if (title) parts.push(title);
    if (text) parts.push(text);
    if (url && url !== text) parts.push(url);
    const sharedText = parts.join('\n').trim();

    let mediaKey = '';
    if (file && typeof file === 'object' && file.arrayBuffer) {
      const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : 'bin';
      mediaKey = `share-inbox/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      try {
        await env.MY_BUCKET.put(mediaKey, await file.arrayBuffer(), {
          httpMetadata: { contentType: file.type || 'application/octet-stream' },
        });
      } catch (e) { mediaKey = ''; }
    }

    // Redirect into the chat page with the shared payload, where a picker opens.
    const q = new URLSearchParams();
    if (sharedText) q.set('share_text', sharedText);
    if (mediaKey) q.set('share_media', mediaKey);
    const dest = '/chat?' + q.toString() + '#share';
    return new Response(null, { status: 303, headers: { Location: dest } });
  } catch (e) {
    return new Response(null, { status: 303, headers: { Location: '/chat' } });
  }
}

// If a browser hits it with GET (some share sheets use GET for text-only),
// forward the query straight through.
export async function onRequestGet(context) {
  const { request } = context;
  const src = new URL(request.url);
  const q = new URLSearchParams();
  const text = src.searchParams.get('text') || '';
  const title = src.searchParams.get('title') || '';
  const url = src.searchParams.get('url') || '';
  const combined = [title, text, url].filter(Boolean).join('\n').trim();
  if (combined) q.set('share_text', combined);
  return new Response(null, { status: 303, headers: { Location: '/chat?' + q.toString() + '#share' } });
}
