import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

// Storage & health snapshot for the admin dashboard: row counts per table plus
// an R2 usage estimate, so the owner can see how big things are getting and how
// close they are to Cloudflare limits.
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const tables = [
      'users', 'messages', 'rooms', 'room_members', 'posts', 'shorts',
      'statuses', 'channels', 'music_tracks', 'sessions', 'push_subscriptions',
      'reports', 'polls', 'user_follows', 'device_bans', 'login_logs'
    ];

    const counts = {};
    for (const t of tables) {
      try {
        const r = await env.DB.prepare('SELECT COUNT(*) AS c FROM ' + t).first();
        counts[t] = r ? r.c : 0;
      } catch (e) { counts[t] = null; } // table may not exist yet
    }

    // R2 usage (bounded): list up to a few pages so we don't run forever.
    let r2 = { objects: 0, bytes: 0, truncated: false };
    if (env.MY_BUCKET) {
      try {
        let cursor = undefined, pages = 0;
        do {
          const listed = await env.MY_BUCKET.list({ limit: 1000, cursor });
          (listed.objects || []).forEach(function (o) { r2.objects++; r2.bytes += (o.size || 0); });
          cursor = listed.truncated ? listed.cursor : undefined;
          pages++;
          if (pages >= 10) { r2.truncated = !!cursor; break; } // cap at ~10k objects
        } while (cursor);
      } catch (e) { r2.error = e.message; }
    }

    return json({ ok: true, counts: counts, r2: r2, generated_at: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
