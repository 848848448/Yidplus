// POST /api/push/send -> send a real Web Push notification to a specific user or all users
// Body: { user_id?, title, body, url?, tag? }
// Only admins can broadcast to all users; any signed-in user can trigger a
// notification to a specific user_id (e.g. "you got a new message").
import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';
import { sendWebPush } from '../_webpush.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const { user_id, title, body: msgBody, url, tag } = body;

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

    if (!subs.length) return json({ ok: true, sent: 0, total: 0 });

    const payload = {
      title: title || 'YID PLUS',
      body:  msgBody || 'You have a new notification',
      icon:  '/images/logo.png',
      badge: '/images/logo.png',
      url:   url || '/chat',
      tag:   tag || 'yidplus',
    };

    let sent = 0;
    const deadEndpoints = [];

    for (const sub of subs) {
      try {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };
        const result = await sendWebPush(subscription, payload, env);
        if (result.ok) {
          sent++;
        } else if (result.status === 404 || result.status === 410) {
          // Subscription is gone (user uninstalled/unsubscribed) — clean it up.
          deadEndpoints.push(sub.endpoint);
        }
      } catch (e) {
        // One bad subscription shouldn't stop the rest from sending.
      }
    }

    if (deadEndpoints.length) {
      for (const ep of deadEndpoints) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(ep).run().catch(() => {});
      }
    }

    return json({ ok: true, sent, total: subs.length });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
