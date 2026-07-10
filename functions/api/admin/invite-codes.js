// functions/api/admin/invite-codes.js
// Owner-only invite codes. Pairs with the sign-in lock: a valid code lets
// someone register even while public sign-up is off.
//   GET                       -> { ok, codes:[...] }
//   POST { max_uses, expires_days, note } -> generate a code
//   DELETE ?code=CODE          -> revoke a code

import { json, corsHeaders, requireUser, isOwnerOrCoOwner } from '../_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS invite_codes (
       code TEXT PRIMARY KEY,
       created_by TEXT,
       uses_left INTEGER,
       max_uses INTEGER,
       used_count INTEGER DEFAULT 0,
       expires_at TEXT,
       note TEXT,
       created_at TEXT
     )`
  ).run().catch(() => {});
}

async function gate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return { err: json({ ok: false, error: 'Not signed in' }, 401) };
  if (!isOwnerOrCoOwner(user, env.OWNER_EMAIL)) return { err: json({ ok: false, error: 'Owner only' }, 403) };
  return { user };
}

function genCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const g = await gate(request, env); if (g.err) return g.err;
    await ensureTable(env);
    const { results } = await env.DB.prepare(
      'SELECT code, uses_left, max_uses, used_count, expires_at, note, created_at FROM invite_codes ORDER BY created_at DESC'
    ).all().catch(() => ({ results: [] }));
    return json({ ok: true, codes: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const g = await gate(request, env); if (g.err) return g.err;
    await ensureTable(env);
    const body = await request.json().catch(() => ({}));
    const maxUses = Math.max(1, Math.min(parseInt(body.max_uses, 10) || 1, 10000));
    const days = parseInt(body.expires_days, 10);
    const now = new Date();
    const expiresAt = days > 0 ? new Date(now.getTime() + days * 86400000).toISOString() : null;

    let code = genCode();
    // avoid rare collision
    for (let i = 0; i < 3; i++) {
      const clash = await env.DB.prepare('SELECT code FROM invite_codes WHERE code = ?').bind(code).first().catch(() => null);
      if (!clash) break;
      code = genCode();
    }
    await env.DB.prepare(
      'INSERT INTO invite_codes (code, created_by, uses_left, max_uses, used_count, expires_at, note, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
    ).bind(code, g.user.id, maxUses, maxUses, expiresAt, (body.note || '').trim() || null, now.toISOString()).run();

    return json({ ok: true, code });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const g = await gate(request, env); if (g.err) return g.err;
    const url = new URL(request.url);
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();
    if (!code) return json({ ok: false, error: 'code required' }, 400);
    await env.DB.prepare('DELETE FROM invite_codes WHERE code = ?').bind(code).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
