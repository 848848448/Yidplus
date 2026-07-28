// functions/api/admin/reset-views.js
// Owner-only. Resets all view counts back to 0 so the numbers start clean and
// real from now on.
//   POST -> { ok, shorts_reset, posts_reset }

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isOwnerOrCoOwner(user)) {
      return json({ ok: false, error: 'Owner only' }, 403);
    }

    let shortsReset = 0, postsReset = 0;
    try {
      const r = await env.DB.prepare('UPDATE shorts SET views = 0').run();
      shortsReset = (r && r.meta && r.meta.changes) || 0;
    } catch (e) { /* table/column may not exist */ }
    try {
      const r = await env.DB.prepare('UPDATE posts SET views = 0').run();
      postsReset = (r && r.meta && r.meta.changes) || 0;
    } catch (e) { /* posts may not have a views column */ }

    return json({ ok: true, shorts_reset: shortsReset, posts_reset: postsReset });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
