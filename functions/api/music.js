// functions/api/music.js
// GET    /api/music                -> list all tracks (singles + album tracks), with liked flag
// POST   /api/music                -> multipart upload: title, artist, type, album_name, audio (file), video (file, optional), cover (file, optional)
// PUT    /api/music                -> { id, like: true|false } toggle like, OR { id, trending: true|false } (admin only)
// DELETE /api/music?id=xxx         -> delete own track, or any if Moderator/Admin

import { json, corsHeaders, requireUser, isAdminRole, canDeleteContent, isSuperOrOwner, logAudit } from './_helpers.js';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env).catch(() => null);

    const { results } = await env.DB.prepare(
      `SELECT id, owner_id, title, artist, type, album_id, album_name,
              audio_key, video_key, cover_key, duration_sec, trending, plays, created_at
       FROM music_tracks ORDER BY created_at DESC LIMIT 200`
    ).all();

    let likedIds = new Set();
    if (user) {
      const { results: likedRows } = await env.DB.prepare(
        `SELECT track_id FROM music_likes WHERE user_id = ?`
      ).bind(user.id).all();
      likedIds = new Set(likedRows.map(r => r.track_id));
    }

    const out = results.map(t => ({
      ...t,
      audio_url: t.audio_key ? `/api/media/${encodeURIComponent(t.audio_key)}` : null,
      video_url: t.video_key ? `/api/media/${encodeURIComponent(t.video_key)}` : null,
      cover_url: t.cover_key ? `/api/media/${encodeURIComponent(t.cover_key)}` : null,
      liked: likedIds.has(t.id),
    }));

    return json({ ok: true, tracks: out });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const form = await request.formData();
    const title  = (form.get('title') || '').toString().trim();
    const artist = (form.get('artist') || user.nickname || '').toString().trim();
    const type   = (form.get('type') || 'single').toString();
    const albumName = (form.get('album_name') || '').toString().trim();
    const albumId   = (form.get('album_id') || '').toString() || (albumName ? crypto.randomUUID() : null);
    const audio  = form.get('audio');
    const video  = form.get('video');
    const cover  = form.get('cover');

    if (!title) return json({ ok: false, error: 'title is required' }, 400);
    if (!audio || typeof audio !== 'object' || !audio.arrayBuffer) {
      return json({ ok: false, error: 'audio file is required' }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const audioExt = (audio.name && audio.name.includes('.')) ? audio.name.split('.').pop() : 'mp3';
    const audioKey = `music/${user.id}/${id}_audio.${audioExt}`;
    await env.MY_BUCKET.put(audioKey, await audio.arrayBuffer(), {
      httpMetadata: { contentType: audio.type || 'audio/mpeg' },
    });

    let videoKey = null;
    if (video && typeof video === 'object' && video.arrayBuffer) {
      const videoExt = (video.name && video.name.includes('.')) ? video.name.split('.').pop() : 'mp4';
      videoKey = `music/${user.id}/${id}_video.${videoExt}`;
      await env.MY_BUCKET.put(videoKey, await video.arrayBuffer(), {
        httpMetadata: { contentType: video.type || 'video/mp4' },
      });
    }

    let coverKey = null;
    if (cover && typeof cover === 'object' && cover.arrayBuffer) {
      const coverExt = (cover.name && cover.name.includes('.')) ? cover.name.split('.').pop() : 'jpg';
      coverKey = `music/${user.id}/${id}_cover.${coverExt}`;
      await env.MY_BUCKET.put(coverKey, await cover.arrayBuffer(), {
        httpMetadata: { contentType: cover.type || 'image/jpeg' },
      });
    }

    await env.DB.prepare(
      `INSERT INTO music_tracks
         (id, owner_id, title, artist, type, album_id, album_name, audio_key, video_key, cover_key, duration_sec, trending, plays, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`
    ).bind(id, user.id, title, artist, type, albumId, albumName || null, audioKey, videoKey, coverKey, now).run();

    return json({ ok: true, id }, 201);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const body = await request.json();
    const { id } = body;
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    if (typeof body.like === 'boolean') {
      const existing = await env.DB.prepare(
        `SELECT 1 FROM music_likes WHERE track_id = ? AND user_id = ?`
      ).bind(id, user.id).first();

      if (body.like && !existing) {
        await env.DB.prepare(`INSERT INTO music_likes (track_id, user_id, created_at) VALUES (?, ?, ?)`)
          .bind(id, user.id, new Date().toISOString()).run();
      } else if (!body.like && existing) {
        await env.DB.prepare(`DELETE FROM music_likes WHERE track_id = ? AND user_id = ?`).bind(id, user.id).run();
      }
      return json({ ok: true });
    }

    if (typeof body.trending === 'boolean') {
      if (!isSuperOrOwner(user, env.OWNER_EMAIL)) return json({ ok: false, error: 'Forbidden' }, 403);
      await env.DB.prepare(`UPDATE music_tracks SET trending = ? WHERE id = ?`).bind(body.trending ? 1 : 0, id).run();
      return json({ ok: true });
    }

    if (body.play) {
      await env.DB.prepare(`UPDATE music_tracks SET plays = plays + 1 WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }

    return json({ ok: false, error: 'No valid action specified' }, 400);
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
    const id = url.searchParams.get('id');
    if (!id) return json({ ok: false, error: 'id is required' }, 400);

    const track = await env.DB.prepare(`SELECT owner_id, audio_key, video_key, cover_key, title FROM music_tracks WHERE id = ?`).bind(id).first();
    if (!track) return json({ ok: false, error: 'Not found' }, 404);

    if (!canDeleteContent(user, track.owner_id, env.OWNER_EMAIL)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    if (track.audio_key) await env.MY_BUCKET.delete(track.audio_key);
    if (track.video_key) await env.MY_BUCKET.delete(track.video_key);
    if (track.cover_key) await env.MY_BUCKET.delete(track.cover_key);
    await env.DB.prepare(`DELETE FROM music_likes WHERE track_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM music_tracks WHERE id = ?`).bind(id).run();

    if (user.id !== track.owner_id && isAdminRole(user, env.OWNER_EMAIL)) {
      await logAudit(env, user, 'delete_music', 'music', id, `Deleted track "${track.title}"`);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
        }
