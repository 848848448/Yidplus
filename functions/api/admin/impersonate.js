// functions/api/admin/impersonate.js
// Owner-only "View as user" (read-only impersonation).
//   POST   { user_id }  -> start: become that user (read-only), keep a way back
//   DELETE              -> exit:  return to the owner's own account
//
// Safety model:
//   • Only the owner/co-owner can start it.
//   • The impersonation session is marked (impersonator_id) so the middleware
//     forces it READ-ONLY — the owner can look but cannot post/message/act.
//   • The owner's original session token is stashed in an httpOnly cookie so
//     Exit restores it exactly. Both start and exit are written to the audit log.

import { json, corsHeaders, requireUser, isOwnerOrCoOwner, getCookie, logAudit } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

const COOKIE_BASE = 'HttpOnly; Secure; Path=/; SameSite=Lax';

async function ensureColumn(env) {
  // SQLite has no "ADD COLUMN IF NOT EXISTS"; try and ignore if it already exists.
  await env.DB.prepare('ALTER TABLE sessions ADD COLUMN impersonator_id TEXT').run().catch(() => {});
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const owner = await requireUser(request, env);
    if (!owner) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isOwnerOrCoOwner(owner, env.OWNER_EMAIL)) return json({ ok: false, error: 'Owner only' }, 403);
    if (owner._impersonatorId) return json({ ok: false, error: 'Already viewing as a user' }, 400);

    const body = await request.json();
    const targetId = body.user_id;
    if (!targetId) return json({ ok: false, error: 'user_id required' }, 400);
    if (targetId === owner.id) return json({ ok: false, error: 'That is you' }, 400);

    const target = await env.DB.prepare('SELECT id, email, nickname FROM users WHERE id = ?').bind(targetId).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    // Don't impersonate another owner/co-owner.
    if (isOwnerOrCoOwner(target, env.OWNER_EMAIL)) return json({ ok: false, error: 'Cannot view as another owner' }, 403);

    await ensureColumn(env);

    const ownerToken = getCookie(request, 'yp_session');
    const impToken = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO sessions (id, user_id, created_at, impersonator_id) VALUES (?, ?, ?, ?)'
    ).bind(impToken, target.id, now, owner.id).run();

    await logAudit(env, owner, 'impersonate_start', 'user', target.id, `Viewing as @${target.nickname}`).catch(() => {});

    // Two cookies: swap to the impersonation session, stash the owner's token.
    const headers = new Headers({ ...corsHeaders, 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', `yp_owner_session=${ownerToken}; ${COOKIE_BASE}; Max-Age=3600`);
    headers.append('Set-Cookie', `yp_session=${impToken}; ${COOKIE_BASE}; Max-Age=3600`);
    return new Response(JSON.stringify({ ok: true, viewing_as: target.nickname }), { status: 200, headers });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const ownerToken = getCookie(request, 'yp_owner_session');
    const impToken = getCookie(request, 'yp_session');

    // The stashed owner session must still be valid AND belong to an owner.
    let restored = false;
    if (ownerToken) {
      const s = await env.DB.prepare('SELECT user_id FROM sessions WHERE id = ?').bind(ownerToken).first().catch(() => null);
      if (s) {
        const u = await env.DB.prepare('SELECT id, email, nickname, role FROM users WHERE id = ?').bind(s.user_id).first().catch(() => null);
        if (u && isOwnerOrCoOwner(u, env.OWNER_EMAIL)) {
          restored = true;
          await logAudit(env, u, 'impersonate_exit', 'user', null, 'Returned to own account').catch(() => {});
        }
      }
    }

    // Clean up the impersonation session row.
    if (impToken) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ? AND impersonator_id IS NOT NULL').bind(impToken).run().catch(() => {});
    }

    const headers = new Headers({ ...corsHeaders, 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', `yp_owner_session=; ${COOKIE_BASE}; Max-Age=0`);
    if (restored) {
      headers.append('Set-Cookie', `yp_session=${ownerToken}; ${COOKIE_BASE}; Max-Age=2592000`);
    }
    return new Response(JSON.stringify({ ok: true, restored }), { status: 200, headers });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
