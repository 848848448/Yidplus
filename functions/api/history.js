// functions/api/history.js
// GET  /api/history?type=short|music  -> the caller's recently viewed/played
//                                         items of that type (or all), newest
//                                         first, hydrated with content.
// POST /api/history { item_type, item_id } -> record a view/play. Re-viewing
//                                         moves the item to the top rather than
//                                         creating a duplicate.
// DELETE /api/history                  -> clear the caller's whole history
// DELETE /api/history?item_type=X&item_id=Y -> remove a single entry
//
// Stored in a self-creating view_history table keyed by
// (user_id, item_type, item_id) with a viewed_at timestamp that gets bumped
// on every re-view. Capped implicitly by the GET LIMIT.

import { json, corsHeaders, requireUser } from './_helpers.js';

const VALID_TYPES = ['short', 'music'];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS view_history (
      user_id TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL,
      viewed_at TEXT NOT NULL, PRIMARY KEY (user_id, item_type, item_id)
    )`
  ).run().catch(() => {});
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json().catch(() => ({}));
    const itemType = body.item_type;
    const itemId = body.item_id;
    if (!VALID_TYPES.includes(itemType) || !itemId) {
      return json({ ok: false, error: 'Invalid item' }, 400);
    }

    await ensureTable(env);
    // Upsert: bump viewed_at to now so a re-view floats to the top.
    await env.DB.prepare(
      `INSERT INTO view_history (user_id, item_type, item_id, viewed_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET viewed_at = datetime('now')`
    ).bind(user.id, itemType, itemId).run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    await ensureTable(env);
    const type = new URL(request.url).searchParams.get('type');

    let rows;
    if (type && VALID_TYPES.includes(type)) {
      const r = await env.DB.prepare(
        'SELECT item_type, item_id, viewed_at FROM view_history WHERE user_id = ? AND item_type = ? ORDER BY viewed_at DESC LIMIT 100'
      ).bind(user.id, type).all().catch(() => ({ results: [] }));
      rows = r.results;
    } else {
      const r = await env.DB.prepare(
        'SELECT item_type, item_id, viewed_at FROM view_history WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 100'
      ).bind(user.id).all().catch(() => ({ results: [] }));
      rows = r.results;
    }

    const shortIds = rows.filter(s => s.item_type === 'short').map(s => s.item_id);
    const musicIds = rows.filter(s => s.item_type === 'music').map(s => s.item_id);
    const viewedAt = {};
    rows.forEach(r => { viewedAt[r.item_type + ':' + r.item_id] = r.viewed_at; });

    const items = [];

    if (shortIds.length) {
      const ph = shortIds.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT s.id, s.owner_id, s.media_key, s.caption, s.likes, s.views, u.nickname, u.photo_url
         FROM shorts s JOIN users u ON u.id = s.owner_id WHERE s.id IN (${ph})`
      ).bind(...shortIds).all().catch(() => ({ results: [] }));
      for (const row of results) {
        items.push({
          item_type: 'short', id: row.id, owner_id: row.owner_id, nick: row.nickname,
          photo_url: row.photo_url || null, caption: row.caption, likes: row.likes, views: row.views,
          media_url: `/api/media/${encodeURIComponent(row.media_key)}`,
          viewed_at: viewedAt['short:' + row.id],
        });
      }
    }

    if (musicIds.length) {
      const ph = musicIds.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT m.id, m.owner_id, m.title, m.artist, m.type, m.audio_key, m.video_key, m.cover_key, m.duration_sec, m.plays
         FROM music_tracks m WHERE m.id IN (${ph})`
      ).bind(...musicIds).all().catch(() => ({ results: [] }));
      for (const row of results) {
        items.push({
          item_type: 'music', id: row.id, owner_id: row.owner_id, title: row.title, artist: row.artist,
          media_type: row.type, audio_url: row.audio_key ? `/api/media/${encodeURIComponent(row.audio_key)}` : null,
          video_url: row.video_key ? `/api/media/${encodeURIComponent(row.video_key)}` : null,
          cover_url: row.cover_key ? `/api/media/${encodeURIComponent(row.cover_key)}` : null,
          duration_sec: row.duration_sec, plays: row.plays,
          viewed_at: viewedAt['music:' + row.id],
        });
      }
    }

    // Return in recency order (the content queries above don't preserve it).
    items.sort((a, b) => (b.viewed_at || '').localeCompare(a.viewed_at || ''));

    return json({ ok: true, items });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    await ensureTable(env);
    const url = new URL(request.url);
    const itemType = url.searchParams.get('item_type');
    const itemId = url.searchParams.get('item_id');

    if (itemType && itemId) {
      await env.DB.prepare('DELETE FROM view_history WHERE user_id = ? AND item_type = ? AND item_id = ?')
        .bind(user.id, itemType, itemId).run();
    } else {
      await env.DB.prepare('DELETE FROM view_history WHERE user_id = ?').bind(user.id).run();
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
