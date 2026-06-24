import { json, corsHeaders, requireUser } from './_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env).catch(() => null);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const isAdmin = user && (user.email === env.OWNER_EMAIL || user.email === "Jmittelman2@gmail.com" || user.role === 'admin_super' || user.role === 'admin_limited');

    // Admins see ALL statuses (including private ones).
    // Regular users see: public, followers (simplified to public for now), and their own private.
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.user_id, s.type, s.text, s.media_key, s.bg, s.color, s.created_at, s.privacy,
              u.nickname, u.photo_url
       FROM statuses s JOIN users u ON u.id = s.user_id
       WHERE s.created_at > ?
       ORDER BY s.user_id, s.created_at ASC`
    ).bind(cutoff).all();

    // Group by user, applying privacy filter
    const grouped = {};
    const myId = user ? user.id : null;
    for (const s of results) {
      // Privacy filtering (admin bypasses all)
      if (!isAdmin && s.privacy === 'private' && s.user_id !== myId) continue;

      if (!grouped[s.user_id]) {
        grouped[s.user_id] = { user_id: s.user_id, nickname: s.nickname, photo_url: s.photo_url || null, slides: [] };
      }
      grouped[s.user_id].slides.push({
        id: s.id, type: s.type, text: s.text,
        media_url: s.media_key ? `/api/media/${encodeURIComponent(s.media_key)}` : null,
        media_key: s.media_key || null,
        is_video: s.media_key ? /\.(mp4|webm|mov|avi)$/i.test(s.media_key) : false,
        bg: s.bg, color: s.color, created_at: s.created_at, privacy: s.privacy, views: s.views || 0,
      });
    }

    return json({ ok: true, statuses: Object.values(grouped) });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const contentType = request.headers.get('content-type') || '';
    let type = 'text', text = '', bg = '#1a0a2e', color = '#fff', mediaKey = null, privacy = 'public';

    if (contentType.includes('multipart')) {
      const form = await request.formData();
      type = form.get('type') || 'text';
      text = form.get('text') || '';
      bg = form.get('bg') || '#1a0a2e';
      color = form.get('color') || '#fff';
      privacy = form.get('privacy') || 'public';
      const file = form.get('media');
      if (file && file.arrayBuffer) {
        const ext = (file.name || '').split('.').pop() || 'bin';
        mediaKey = `statuses/${user.id}/${Date.now()}.${ext}`;
        await env.MY_BUCKET.put(mediaKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
        type = 'media';
      }
    } else {
      const body = await request.json();
      type = body.type || 'text';
      text = body.text || '';
      bg = body.bg || '#1a0a2e';
      color = body.color || '#fff';
      privacy = body.privacy || 'public';
    }

    if (!['public', 'followers', 'private'].includes(privacy)) privacy = 'public';

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO statuses (id, user_id, type, text, media_key, bg, color, privacy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, user.id, type, text, mediaKey, bg, color, privacy, now).run();

    return json({ ok: true, id }, 201);
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
          }

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const body = await request.json();

    // Delete own status
    if (body.action === 'delete' && body.id) {
      const row = await env.DB.prepare('SELECT user_id, media_key FROM statuses WHERE id = ?').bind(body.id).first();
      if (!row) return json({ ok: false, error: 'Not found' }, 404);
      const isAdmin = user.role === 'admin_super' || user.email === env.OWNER_EMAIL || user.email === "Jmittelman2@gmail.com";
      if (row.user_id !== user.id && !isAdmin) return json({ ok: false, error: 'Forbidden' }, 403);
      if (row.media_key) await env.MY_BUCKET.delete(row.media_key).catch(() => {});
      await env.DB.prepare('DELETE FROM statuses WHERE id = ?').bind(body.id).run();
      return json({ ok: true });
    }

    // Record a view
    if (body.view && body.id) {
      await env.DB.prepare(
        'UPDATE statuses SET views = COALESCE(views, 0) + 1 WHERE id = ? AND user_id != ?'
      ).bind(body.id, user.id).run().catch(() => {});
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
                             }
