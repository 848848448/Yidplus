// GET /api/users/search?q=X     -> search users by nickname
// GET /api/users/search?featured=1 -> get recent/featured users
import { json, corsHeaders, requireUser } from '../_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env).catch(() => null);
    const url  = new URL(request.url);
    const q    = url.searchParams.get('q') || '';
    const featured = url.searchParams.get('featured');

    let results;
    if (featured) {
      const { results: rows } = await env.DB.prepare(
        `SELECT id, nickname, photo_url, bio, verified, role
         FROM users WHERE blocked = 0
         ORDER BY created_at DESC LIMIT 20`
      ).all();
      results = rows;
    } else if (q.trim().length >= 1) {
      const { results: rows } = await env.DB.prepare(
        `SELECT id, nickname, photo_url, bio, verified, role
         FROM users
         WHERE blocked = 0 AND LOWER(nickname) LIKE ?
         ORDER BY nickname ASC LIMIT 20`
      ).bind('%' + q.toLowerCase() + '%').all();
      results = rows;
    } else {
      results = [];
    }

    return json({ ok: true, users: results });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
                }
