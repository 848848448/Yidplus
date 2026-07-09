// Serves R2 objects — catch-all route for /api/media/...
import { requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestGet(context) {
  const { params, env, request } = context;
  try {
    const key = decodeURIComponent((params.key || []).join('/'));
    if (!key) return new Response('Not found', { status: 404 });

    // ── Private chat media: keys look like  chat/<roomId>/...  ──
    // These are DM / group images and voice notes. Only a member of that room
    // (or an owner, for moderation) may fetch them. Everything else — avatars,
    // shorts, music, banners, statuses — stays public.
    let isPrivate = false;
    if (key.startsWith('chat/')) {
      isPrivate = true;
      const roomId = key.split('/')[1];
      const user = await requireUser(request, env).catch(() => null);
      if (!user) return new Response('Forbidden', { status: 403 });
      const member = await env.DB.prepare(
        'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
      ).bind(roomId, user.id).first().catch(() => null);
      if (!member && !isOwnerOrCoOwner(user, env.OWNER_EMAIL)) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const obj = await env.MY_BUCKET.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    // Private media must never be stored in a shared cache.
    headers.set('Cache-Control', isPrivate
      ? 'private, max-age=3600'
      : 'public, max-age=31536000, immutable');
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
