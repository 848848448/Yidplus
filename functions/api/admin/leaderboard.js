import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';
export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user || !isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
    const [shorts, music, msgs] = await Promise.all([
      env.DB.prepare('SELECT owner_id as uid, COUNT(*) as cnt FROM shorts GROUP BY owner_id ORDER BY cnt DESC LIMIT 10').all().catch(() => ({ results: [] })),
      env.DB.prepare('SELECT uploaded_by as uid, COUNT(*) as cnt FROM music GROUP BY uploaded_by ORDER BY cnt DESC LIMIT 10').all().catch(() => ({ results: [] })),
      env.DB.prepare('SELECT sender_id as uid, COUNT(*) as cnt FROM messages GROUP BY sender_id ORDER BY cnt DESC LIMIT 10').all().catch(() => ({ results: [] })),
    ]);
    return json({ ok: true, shorts: shorts.results, music: music.results, messages: msgs.results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
                                                                                                                                                  }
