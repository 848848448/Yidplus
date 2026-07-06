// functions/api/self-block.js
// POST /api/self-block { feature }  -> the signed-in caller blocks THEMSELVES from a
//                                       feature (shorts/statuses/music/channels/chat),
//                                       effective immediately. There is no self-unblock
//                                       here on purpose — removing it requires an admin
//                                       (via /api/admin/feature-blocks), the same way the
//                                       existing feature-blocks system already works.

import { json, corsHeaders, requireUser } from './_helpers.js';

const VALID_FEATURES = ['shorts', 'statuses', 'music', 'channels', 'chat'];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const feature = body.feature;
    if (!VALID_FEATURES.includes(feature)) return json({ ok: false, error: 'Invalid feature' }, 400);

    const now = new Date().toISOString();
    await env.DB.prepare('DELETE FROM feature_blocks WHERE user_id = ? AND feature = ?').bind(user.id, feature).run();
    await env.DB.prepare(
      `INSERT INTO feature_blocks (id, user_id, feature, blocked_until, blocked_by, created_at)
       VALUES (?, ?, ?, NULL, 'self', ?)`
    ).bind(crypto.randomUUID(), user.id, feature, now).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
