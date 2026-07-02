// GET  /api/profile?user_id=X  -> public profile
// GET  /api/profile             -> own profile (full)
// PUT  /api/profile             -> update own profile
// DELETE /api/profile           -> delete own account

import { json, corsHeaders, requireUser, hashPassword, cleanupUserReferences } from './_helpers.js';

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders }); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env).catch(() => null);
    const url  = new URL(request.url);
    const targetId = url.searchParams.get('user_id');

    if (targetId) {
      // Public profile
      const profile = await env.DB.prepare(
        `SELECT id, nickname, photo_url, banner_url, bio, location, website, instagram, youtube,
                profile_color, verified, role, created_at, privacy_profile, is_private
         FROM users WHERE id = ?`
      ).bind(targetId).first();
      if (!profile) return json({ ok: false, error: 'User not found' }, 404);
      if (profile.privacy_profile === 'private' && (!user || user.id !== targetId)) {
        return json({ ok: false, error: 'Profile is private' }, 403);
      }

      // Increment view count
      if (user && user.id !== targetId) {
        await env.DB.prepare('UPDATE users SET profile_views = profile_views + 1 WHERE id = ?').bind(targetId).run().catch(() => {});
      }

      // Stats
      const [shorts, music, msgs] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as cnt FROM shorts WHERE owner_id = ?').bind(targetId).first().catch(() => ({ cnt: 0 })),
        env.DB.prepare('SELECT COUNT(*) as cnt FROM music_tracks WHERE owner_id = ?').bind(targetId).first().catch(() => ({ cnt: 0 })),
        env.DB.prepare('SELECT COUNT(*) as cnt FROM messages WHERE sender_id = ?').bind(targetId).first().catch(() => ({ cnt: 0 })),
      ]);

      return json({ ok: true, profile: { ...profile, stats: { shorts: shorts?.cnt || 0, music: music?.cnt || 0, messages: msgs?.cnt || 0 } } });
    }

    // Own full profile
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const full = await env.DB.prepare(
      `SELECT id, email, nickname, phone, photo_url, banner_url, bio, location, birthday, website,
              instagram, youtube, profile_color, verified, role, created_at, profile_views,
              privacy_profile, privacy_messages, notif_messages, notif_likes, notif_followers, notif_channels,
              no_ads, muted_until, is_private
       FROM users WHERE id = ?`
    ).bind(user.id).first();

    // Sessions
    const { results: sessions } = await env.DB.prepare(
      'SELECT id, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(user.id).all().catch(() => ({ results: [] }));

    // Login logs
    const { results: loginLogs } = await env.DB.prepare(
      'SELECT ip, action, created_at FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
    ).bind(user.id).all().catch(() => ({ results: [] }));

    // Stats
    const [shorts, music, msgs, followers] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM shorts WHERE owner_id = ?').bind(user.id).first().catch(() => ({ cnt: 0 })),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM music_tracks WHERE owner_id = ?').bind(user.id).first().catch(() => ({ cnt: 0 })),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM messages WHERE sender_id = ?').bind(user.id).first().catch(() => ({ cnt: 0 })),
      env.DB.prepare('SELECT followers FROM channels WHERE owner_id = ? LIMIT 1').bind(user.id).first().catch(() => null),
    ]);

    return json({
      ok: true,
      profile: full,
      sessions,
      login_logs: loginLogs,
      stats: {
        shorts: shorts?.cnt || 0,
        music: music?.cnt || 0,
        messages: msgs?.cnt || 0,
        profile_views: full?.profile_views || 0,
        followers: followers?.followers || 0,
      }
    });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);

    const ct = request.headers.get('content-type') || '';
    let body = {};
    if (ct.includes('multipart')) {
      const form = await request.formData();
      for (const [k, v] of form.entries()) {
        if (k === 'photo' && v instanceof File) {
          const key = `avatars/${user.id}.${v.name.split('.').pop() || 'jpg'}`;
          await env.MY_BUCKET.put(key, await v.arrayBuffer(), { httpMetadata: { contentType: v.type } });
          body.photo_url = `https://yidplus-media.a06785e7a5ea1da913c0a95975e11d74.r2.cloudflarestorage.com/${key}`;
        } else if (k === 'banner' && v instanceof File) {
          const key = `banners/${user.id}.${v.name.split('.').pop() || 'jpg'}`;
          await env.MY_BUCKET.put(key, await v.arrayBuffer(), { httpMetadata: { contentType: v.type } });
          body.banner_url = `https://yidplus-media.a06785e7a5ea1da913c0a95975e11d74.r2.cloudflarestorage.com/${key}`;
        } else { body[k] = v; }
      }
    } else {
      body = await request.json();
    }

    const ALLOWED = ['bio','location','birthday','website','instagram','youtube','profile_color',
                     'privacy_profile','privacy_messages','notif_messages','notif_likes',
                     'notif_followers','notif_channels','photo_url','banner_url','is_private'];

    const updates = []; const params = [];

    // Handle password change separately
    if (body.password) {
      if (body.password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters' }, 400);
      const hash = await hashPassword(body.password);
      updates.push('password_hash = ?');
      params.push(hash);
    }

    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED.includes(k)) { updates.push(`${k} = ?`); params.push(v); }
    }
    if (!updates.length) return json({ ok: true });
    params.push(user.id);
    await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: 'Not signed in' }, 401);
    const CO_OWNER = 'Jmittelman2@gmail.com';
    if (user.email === env.OWNER_EMAIL || user.email === CO_OWNER) {
      return json({ ok: false, error: 'Cannot delete owner account' }, 403);
    }

    await cleanupUserReferences(env, user.id, user.nickname);

    try {
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    } catch (deleteErr) {
      // Surface the real DB error (e.g. a foreign key constraint we didn't
      // anticipate) instead of a generic failure, so it's actually fixable.
      return json({ ok: false, error: 'Could not delete account: ' + deleteErr.message }, 500);
    }

    return json({ ok: true });
  } catch (err) { return json({ ok: false, error: err.message }, 500); }
}
