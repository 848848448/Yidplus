// functions/api/saves.js
// GET    /api/saves?type=short|music   -> list the caller's saved items of that type
//                                          (or all, if no type given), newest first
// POST   /api/saves                     -> { item_type, item_id } save an item
// DELETE /api/saves?item_type=X&item_id=Y -> unsave an item
//
// One table (saved_items) keyed by (user_id, item_type, item_id). item_type
// is 'short' or 'music'. Each GET hydrates the saved rows with the actual
// content so the client can render them directly.

import { json, corsHeaders, requireUser } from './_helpers.js';

const VALID_TYPES = ['short', 'music'];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const type = new URL(request.url).searchParams.get('type');

    let saveRows;
    if (type && VALID_TYPES.includes(type)) {
      const r = await env.DB.prepare(
        'SELECT item_type, item_id, created_at FROM saved_items WHERE user_id = ? AND item_type = ? ORDER BY created_at DESC LIMIT 200'
      ).bind(user.id, type).all().catch(() => ({ results: [] }));
      saveRows = r.results;
    } else {
      const r = await env.DB.prepare(
        'SELECT item_type, item_id, created_at FROM saved_items WHERE user_id = ? ORDER BY created_at DESC LIMIT 200'
      ).bind(user.id).all().catch(() => ({ results: [] }));
      saveRows = r.results;
    }

    const shortIds = saveRows.filter(s => s.item_type === 'short').map(s => s.item_id);
    const musicIds = saveRows.filter(s => s.item_type === 'music').map(s => s.item_id);

    const items = [];

    if (shortIds.length) {
      const ph = shortIds.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT s.id, s.owner_id, s.media_key, s.caption, s.likes, s.views, s.created_at, u.nickname, u.photo_url
         FROM shorts s JOIN users u ON u.id = s.owner_id WHERE s.id IN (${ph})`
      ).bind(...shortIds).all().catch(() => ({ results: [] }));
      for (const row of results) {
        items.push({
          item_type: 'short', id: row.id, owner_id: row.owner_id, nick: row.nickname,
          photo_url: row.photo_url || null, caption: row.caption, likes: row.likes, views: row.views,
          media_url: `/api/media/${encodeURIComponent(row.media_key)}`, created_at: row.created_at,
        });
      }
    }

    if (musicIds.length) {
      const ph = musicIds.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT m.id, m.owner_id, m.title, m.artist, m.type, m.audio_key, m.video_key, m.cover_key, m.duration_sec, m.plays, m.created_at
         FROM music_tracks m WHERE m.id IN (${ph})`
      ).bind(...musicIds).all().catch(() => ({ results: [] }));
      for (const row of results) {
        items.push({
          item_type: 'music', id: row.id, owner_id: row.owner_id, title: row.title, artist: row.artist,
          media_type: row.type, audio_url: row.audio_key ? `/api/media/${encodeURIComponent(row.audio_key)}` : null,
          video_url: row.video_key ? `/api/media/${encodeURIComponent(row.video_key)}` : null,
          cover_url: row.cover_key ? `/api/media/${encodeURIComponent(row.cover_key)}` : null,
          duration_sec: row.duration_sec, plays: row.plays, created_at: row.created_at,
        });
      }
    }

    // Preserve saved-order (newest save first) using the saveRows sequence.
    const orderKey = {};
    saveRows.forEach((s, i) => { orderKey[s.item_type + ':' + s.item_id] = i; });
    items.sort((a, b) => (orderKey[a.item_type + ':' + a.id] ?? 999) - (orderKey[b.item_type + ':' + b.id] ?? 999));

    return json({ ok: true, items });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const itemType = body.item_type;
    const itemId = body.item_id;
    if (!VALID_TYPES.includes(itemType) || !itemId) {
      return json({ ok: false, error: 'item_type and item_id are required' }, 400);
    }

    await env.DB.prepare(
      'INSERT OR IGNORE INTO saved_items (user_id, item_type, item_id, created_at) VALUES (?, ?, ?, ?)'
    ).bind(user.id, itemType, itemId, new Date().toISOString()).run();

    return json({ ok: true }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const url = new URL(request.url);
    const itemType = url.searchParams.get('item_type');
    const itemId = url.searchParams.get('item_id');
    if (!itemType || !itemId) return json({ ok: false, error: 'item_type and item_id are required' }, 400);

    await env.DB.prepare(
      'DELETE FROM saved_items WHERE user_id = ? AND item_type = ? AND item_id = ?'
    ).bind(user.id, itemType, itemId).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
