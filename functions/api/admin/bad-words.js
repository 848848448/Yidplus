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
      const [wordsRes, phrasesRes] = await Promise.all([
        env.DB.prepare('SELECT word FROM bad_words ORDER BY word ASC').all(),
        env.DB.prepare('SELECT phrase FROM bad_phrases ORDER BY phrase ASC').all().catch(() => ({ results: [] })),
      ]);
      return json({
        ok: true,
        words: wordsRes.results.map(r => r.word),
        phrases: phrasesRes.results.map(r => r.phrase),
      });
    }

    // Admin only
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const [wordsRes, phrasesRes] = await Promise.all([
      env.DB.prepare('SELECT id, word, added_by, created_at FROM bad_words ORDER BY created_at DESC').all(),
      env.DB.prepare('SELECT id, phrase, added_by, created_at FROM bad_phrases ORDER BY created_at DESC').all().catch(() => ({ results: [] })),
    ]);
    return json({ ok: true, words: wordsRes.results, phrases: phrasesRes.results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    if (!isAdminRole(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);

    const body = await request.json();
    const word = body.word;
    const phrase = body.phrase;

    if (phrase) {
      // Adding a phrase
      const phraseClean = phrase.trim().toLowerCase();
      if (!phraseClean || phraseClean.split(/\s+/).length < 2) return json({ ok: false, error: 'phrase must have at least 2 words' }, 400);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT OR IGNORE INTO bad_phrases (id, phrase, added_by, created_at) VALUES (?, ?, ?, ?)'
      ).bind(id, phraseClean, user.nickname || user.id, new Date().toISOString()).run();
      return json({ ok: true, id });
    }

    if (!word || !word.trim()) return json({ ok: false, error: 'word or phrase required' }, 400);

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

    const url2 = new URL(request.url);
    const id = url2.searchParams.get('id');
    const type = url2.searchParams.get('type') || 'word'; // 'word' or 'phrase'
    if (!id) return json({ ok: false, error: 'id required' }, 400);
    if (type === 'phrase') {
      await env.DB.prepare('DELETE FROM bad_phrases WHERE id = ?').bind(id).run();
    } else {
      await env.DB.prepare('DELETE FROM bad_words WHERE id = ?').bind(id).run();
    }
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
        }
