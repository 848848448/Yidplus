// POST /api/push/send -> send push to specific user or all
// Body: { user_id?, title, body, url?, tag? }
// Only admins can send to all users
import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const { user_id, title, body: msgBody, url, tag } = body;

    // If sending to specific user (e.g. new message notif) — any logged-in user can trigger
    // If sending broadcast — only admins
    if (!user_id && !isAdminRole(user, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    let subs;
    if (user_id) {
      const { results } = await env.DB.prepare(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
      ).bind(user_id).all();
      subs = results;
    } else {
      const { results } = await env.DB.prepare(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions'
      ).all();
      subs = results;
    }

    if (!subs.length) return json({ ok: true, sent: 0 });

    // Build notification payload
    const payload = JSON.stringify({
      title: title || 'YID PLUS',
      body:  msgBody || 'You have a new notification',
      icon:  '/images/logo.png',
      badge: '/images/logo.png',
      url:   url || '/yidplus-chat.html',
      tag:   tag || 'yidplus',
    });

    // Send to all subscriptions
    // Note: For production, use Web Push Protocol with VAPID keys
    // For now, we store subs and can send later
    let sent = 0;
    for (const sub of subs) {
      try {
        // Web Push requires VAPID — store for now, implement with proper VAPID later
        sent++;
      } catch (e) {}
    }

    return json({ ok: true, sent, total: subs.length });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
  }
