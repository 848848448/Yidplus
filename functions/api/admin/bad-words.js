// GET    /api/admin/bad-words         -> list all bad words (owner/admin only)
// POST   /api/admin/bad-words         -> add word { word }
// DELETE /api/admin/bad-words?id=X   -> remove word
// GET    /api/admin/bad-words?public=1 -> list words (for frontend filter, no auth needed)

import { json, corsHeaders, requireUser, isAdminRole } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);

    // Public endpoint — for frontend JS to load the filter list
    if (url.searchParams.get('public')) {
      const { results } = await env.DB.prepare(
        'SELECT word FROM bad_words ORDER BY word ASC'
      ).all();
      return json({ ok: true, words: results.map(r => r.word) });
    }

    // Admin only
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const { results } = await env.DB.prepare(
      'SELECT id, word, added_by, created_at FROM bad_words ORDER BY created_at DESC'
    ).all();
    return json({ ok: true, words: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const { word } = await request.json();
    if (!word || !word.trim()) return json({ ok: false, error: 'word required' }, 400);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT OR IGNORE INTO bad_words (id, word, added_by, created_at) VALUES (?, ?, ?, ?)'
    ).bind(id, word.trim().toLowerCase(), user.nickname || user.id, new Date().toISOString()).run();

    return json({ ok: true, id });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id required' }, 400);
    await env.DB.prepare('DELETE FROM bad_words WHERE id = ?').bind(id).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
        }
